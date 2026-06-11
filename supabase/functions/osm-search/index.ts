// deno-lint-ignore-file
// OSM Overpass alternative discovery source for the saha-navigasyon platform.
// Called either directly by an authenticated admin user, OR internally from
// clinic-scan with the project service_role key (server-to-server).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const allowed =
    reqOrigin && (ALLOWED_ORIGINS.includes(reqOrigin) || reqOrigin === 'https://localhost' || reqOrigin === 'capacitor://localhost') ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Multiple Overpass mirrors — primary often slow/overloaded.
// Order: fastest first, fallback on timeout or 5xx.
const OVERPASS_MIRRORS: string[] = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
const OVERPASS_TIMEOUT_MS = 60000; // 60s — allow heavy queries (full province scans)

interface OsmBody {
  lat: number;
  lng: number;
  radiusM: number;
  verticalKey?: string;
  mode?: 'clinics' | 'neighborhoods';
}

interface NeighborhoodResult {
  name: string;
  lat: number;
  lng: number;
}

interface OsmResult {
  osm_id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  website?: string;
  types: string[];
  source: 'osm';
}

// Overpass QL template for neighborhood enumeration. Combines `place=*` tags
// (node/way) with admin-level 10/11 boundary relations.
const NEIGHBORHOODS_QUERY_TEMPLATE = `
    [out:json][timeout:25];
    (
      node["place"~"neighbourhood|quarter|suburb"](around:RADIUS,LAT,LNG);
      relation["boundary"="administrative"]["admin_level"~"10|11"](around:RADIUS,LAT,LNG);
      way["place"~"neighbourhood|quarter|suburb"](around:RADIUS,LAT,LNG);
    );
    out center tags;
  `;

// Overpass QL templates per vertical. The placeholder tokens
// LAT / LNG / RADIUS are substituted at request time.
const QUERIES_BY_VERTICAL: Record<string, string> = {
  dental: `
    [out:json][timeout:25];
    (
      node["amenity"="dentist"](around:RADIUS,LAT,LNG);
      way["amenity"="dentist"](around:RADIUS,LAT,LNG);
      node["healthcare"="dentist"](around:RADIUS,LAT,LNG);
      way["healthcare"="dentist"](around:RADIUS,LAT,LNG);
    );
    out center tags;
  `,
  pharmacy: `
    [out:json][timeout:25];
    (
      node["amenity"="pharmacy"](around:RADIUS,LAT,LNG);
      way["amenity"="pharmacy"](around:RADIUS,LAT,LNG);
    );
    out center tags;
  `,
  optician: `
    [out:json][timeout:25];
    (
      node["shop"="optician"](around:RADIUS,LAT,LNG);
      way["shop"="optician"](around:RADIUS,LAT,LNG);
      node["healthcare"="optometrist"](around:RADIUS,LAT,LNG);
    );
    out center tags;
  `,
  veterinary: `
    [out:json][timeout:25];
    (
      node["amenity"="veterinary"](around:RADIUS,LAT,LNG);
      way["amenity"="veterinary"](around:RADIUS,LAT,LNG);
    );
    out center tags;
  `,
};

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function isValidCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function buildQuery(template: string, lat: number, lng: number, radiusM: number): string {
  return template
    .replace(/LAT/g, String(lat))
    .replace(/LNG/g, String(lng))
    .replace(/RADIUS/g, String(Math.round(radiusM)));
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function elementToResult(el: OverpassElement): OsmResult | null {
  const tags = el.tags ?? {};
  const name = tags.name ?? tags['name:tr'] ?? tags['operator'];
  if (!name) return null;

  let lat: number | undefined;
  let lng: number | undefined;
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    lat = el.lat;
    lng = el.lon;
  } else if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    lat = el.center.lat;
    lng = el.center.lon;
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const addrParts = [
    tags['addr:street'],
    tags['addr:housenumber'],
    tags['addr:neighbourhood'],
    tags['addr:district'],
    tags['addr:city'],
    tags['addr:province'],
  ].filter(Boolean);
  const address = addrParts.length > 0 ? addrParts.join(' ') : tags['addr:full'];

  const typeTags: string[] = [];
  if (tags.amenity) typeTags.push(tags.amenity);
  if (tags.healthcare) typeTags.push(tags.healthcare);
  if (tags.shop) typeTags.push(tags.shop);

  return {
    osm_id: `${el.type}/${el.id}`,
    name,
    lat,
    lng,
    address: address || undefined,
    phone: tags.phone ?? tags['contact:phone'] ?? undefined,
    website: tags.website ?? tags['contact:website'] ?? undefined,
    types: typeTags,
    source: 'osm',
  };
}

function neighborhoodElementToResult(el: OverpassElement): NeighborhoodResult | null {
  const tags = el.tags ?? {};
  const rawName = tags.name ?? tags['name:tr'];
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) return null;

  let lat: number | undefined;
  let lng: number | undefined;
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    lat = el.lat;
    lng = el.lon;
  } else if (el.center && typeof el.center.lat === 'number' && typeof el.center.lon === 'number') {
    lat = el.center.lat;
    lng = el.center.lon;
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  return { name, lat, lng };
}

async function fetchOverpassOnce(
  url: string,
  query: string,
): Promise<{ elements: OverpassElement[]; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'DentRoute/1.0 (saha-navigasyon)',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    if (!resp.ok) {
      return { elements: [], error: `overpass_${resp.status}` };
    }
    const json: any = await resp.json();
    const els: OverpassElement[] = Array.isArray(json?.elements) ? json.elements : [];
    return { elements: els };
  } catch (e) {
    const isAbort = (e as Error)?.name === 'AbortError';
    const msg = (e as Error)?.message ?? 'overpass_unknown';
    return { elements: [], error: isAbort ? 'overpass_timeout' : `overpass_fetch_${msg}` };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpass(
  query: string,
): Promise<{ elements: OverpassElement[]; error?: string; mirror?: string }> {
  const collectedErrors: string[] = [];
  for (const url of OVERPASS_MIRRORS) {
    const res = await fetchOverpassOnce(url, query);
    if (res.elements.length > 0 || !res.error) {
      return { elements: res.elements, mirror: url };
    }
    collectedErrors.push(`${new URL(url).host}:${res.error}`);
    // Try next mirror only on timeout / 5xx / network errors.
    // For 4xx (bad query, rate limit), still fall through to next mirror — cheap.
  }
  return { elements: [], error: collectedErrors.join('|') };
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse(
      { status: 'error', scanned: 0, results: [], errors: ['method_not_allowed'] },
      405,
      cors,
    );
  }

  try {
    // Auth: accept either the service_role key (server-to-server from
    // clinic-scan) OR a valid user JWT belonging to an ADMIN.
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse(
        { status: 'error', scanned: 0, results: [], errors: ['unauthorized'] },
        401,
        cors,
      );
    }
    const token = authHeader.slice(7).trim();

    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;

    if (!isServiceRole) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return jsonResponse(
          { status: 'error', scanned: 0, results: [], errors: ['invalid_token'] },
          401,
          cors,
        );
      }
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userData.user.id)
        .maybeSingle();
      if (profileErr) {
        return jsonResponse(
          { status: 'error', scanned: 0, results: [], errors: ['profile_lookup_failed'] },
          500,
          cors,
        );
      }
      const role: string = (profileData as any)?.role ?? '';
      if (!role || role.toUpperCase() !== 'ADMIN') {
        return jsonResponse(
          { status: 'error', scanned: 0, results: [], errors: ['forbidden'] },
          403,
          cors,
        );
      }
    }

    let body: OsmBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse(
        { status: 'error', scanned: 0, results: [], errors: ['invalid_json'] },
        400,
        cors,
      );
    }

    const { lat, lng, radiusM, verticalKey, mode } = body || ({} as OsmBody);
    const effectiveMode: 'clinics' | 'neighborhoods' = mode === 'neighborhoods' ? 'neighborhoods' : 'clinics';

    if (!isValidCoord(lat) || lat < -90 || lat > 90) {
      return jsonResponse(
        { status: 'error', scanned: 0, results: [], errors: ['invalid_lat'] },
        400,
        cors,
      );
    }
    if (!isValidCoord(lng) || lng < -180 || lng > 180) {
      return jsonResponse(
        { status: 'error', scanned: 0, results: [], errors: ['invalid_lng'] },
        400,
        cors,
      );
    }
    if (!isValidCoord(radiusM) || radiusM < 1 || radiusM > 50000) {
      return jsonResponse(
        { status: 'error', scanned: 0, results: [], errors: ['invalid_radius'] },
        400,
        cors,
      );
    }

    if (effectiveMode === 'neighborhoods') {
      const query = buildQuery(NEIGHBORHOODS_QUERY_TEMPLATE, lat, lng, radiusM);
      const { elements, error: overpassErr } = await fetchOverpass(query);
      if (overpassErr) {
        return jsonResponse(
          {
            status: 'error',
            mode: 'neighborhoods',
            count: 0,
            neighborhoods: [],
            errors: [overpassErr],
          },
          200,
          cors,
        );
      }

      const neighborhoods: NeighborhoodResult[] = [];
      const seenNames = new Set<string>();
      for (const el of elements) {
        const mapped = neighborhoodElementToResult(el);
        if (!mapped) continue;
        const key = mapped.name.toLocaleLowerCase('tr-TR');
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        neighborhoods.push(mapped);
      }

      return jsonResponse(
        { status: 'ok', mode: 'neighborhoods', count: neighborhoods.length, neighborhoods },
        200,
        cors,
      );
    }

    const vkey = verticalKey && typeof verticalKey === 'string' && verticalKey.trim().length > 0
      ? verticalKey.trim()
      : 'dental';
    const template = QUERIES_BY_VERTICAL[vkey] ?? QUERIES_BY_VERTICAL.dental;
    const query = buildQuery(template, lat, lng, radiusM);

    const { elements, error: overpassErr } = await fetchOverpass(query);
    if (overpassErr) {
      // Return HTTP 200 with status=error so the caller (clinic-scan) doesn't
      // blow up on a non-2xx response; it just records the failure in errors[].
      return jsonResponse(
        { status: 'error', scanned: 0, results: [], errors: [overpassErr] },
        200,
        cors,
      );
    }

    const results: OsmResult[] = [];
    const seen = new Set<string>();
    for (const el of elements) {
      const mapped = elementToResult(el);
      if (!mapped) continue;
      if (seen.has(mapped.osm_id)) continue;
      seen.add(mapped.osm_id);
      results.push(mapped);
    }

    return jsonResponse(
      { status: 'ok', scanned: results.length, results },
      200,
      cors,
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('osm-search fatal:', msg);
    return jsonResponse(
      { status: 'error', scanned: 0, results: [], errors: [msg] },
      500,
      cors,
    );
  }
});
