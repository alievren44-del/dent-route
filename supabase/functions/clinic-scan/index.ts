// deno-lint-ignore-file
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getFilterForVertical, type FilterResult } from './filters.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const allowed = reqOrigin && (ALLOWED_ORIGINS.includes(reqOrigin) || reqOrigin === 'https://localhost' || reqOrigin === 'capacitor://localhost') ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const ENDPOINT = 'clinic-scan';
const DAILY_LIMIT = 50;
const MAX_PAGES = 3;
const PAGE_TOKEN_WAIT_MS = 2500;
const INVALID_RETRY_WAIT_MS = 3000;
const DEDUP_RADIUS_M = 50;
const QUERY_CONCURRENCY = 3;
const CHUNK_SLEEP_MS = 100;

type SourceMode = 'google' | 'osm' | 'both';

interface ScanBody {
  lat: number;
  lng: number;
  radiusM: number;
  provinceSlug: string;
  districtSlug?: string;
  vertical?: string;
  types?: string[];
  keywords?: string[];
  intensity?: 'standard' | 'high' | 'max';
  source?: SourceMode;
}

// Türkiye diş hekimi için tipik keyword'ler. Google `type=dentist` döndürmeyen
// kayıtları yakalamak için kullanılır (Dr. X, Diş Polikliniği, vb).
const DEFAULT_KEYWORDS_BY_VERTICAL: Record<string, string[]> = {
  dental: [
    'diş hekimi',
    'diş kliniği',
    'ortodontist',
    'ağız diş sağlığı',
  ],
};

interface MappedResult {
  placeId: string | null;
  osmId: string | null;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  userRatingCount?: number;
  types: string[];
  sources: string[];
  raw: any;
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function isValidCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Grid scan noktaları üretir. Tek noktada Google nearbysearch max 60 sonuç
 * döndürdüğü için büyük radius'larda kayıp olur. Grid ile çakışık taramalar
 * yapıp dedup edersek toplam coverage artar.
 *
 * Densite kuralı:
 *   ≤ 2 km   → 1 nokta (center)
 *   2-5 km   → 5 nokta (center + N/S/E/W @ radius/2)
 *   5-10 km  → 9 nokta (3x3 grid, step = radius/2)
 *   > 10 km  → 13 nokta (3x3 + 4 diyagonal-2x @ radius/1.5)
 */
function buildGridPoints(
  centerLat: number,
  centerLng: number,
  radiusM: number,
): Array<{ lat: number; lng: number }> {
  if (radiusM <= 2000) return [{ lat: centerLat, lng: centerLng }];

  const latPerM = 1 / 111000;
  const lngPerM = 1 / (111000 * Math.cos((centerLat * Math.PI) / 180));

  const step = radiusM / 2; // overlap için yarıçap/2
  const stepLat = step * latPerM;
  const stepLng = step * lngPerM;

  const points: Array<{ lat: number; lng: number }> = [{ lat: centerLat, lng: centerLng }];

  // N/S/E/W
  points.push({ lat: centerLat + stepLat, lng: centerLng });
  points.push({ lat: centerLat - stepLat, lng: centerLng });
  points.push({ lat: centerLat, lng: centerLng + stepLng });
  points.push({ lat: centerLat, lng: centerLng - stepLng });

  if (radiusM <= 5000) return points;

  // 4 diyagonal (NE/NW/SE/SW)
  points.push({ lat: centerLat + stepLat, lng: centerLng + stepLng });
  points.push({ lat: centerLat + stepLat, lng: centerLng - stepLng });
  points.push({ lat: centerLat - stepLat, lng: centerLng + stepLng });
  points.push({ lat: centerLat - stepLat, lng: centerLng - stepLng });

  if (radiusM <= 10000) return points;

  // 4 dış kenar @ radius/1.5
  const outerStep = radiusM / 1.5;
  const outerLat = outerStep * latPerM;
  const outerLng = outerStep * lngPerM;
  points.push({ lat: centerLat + outerLat, lng: centerLng });
  points.push({ lat: centerLat - outerLat, lng: centerLng });
  points.push({ lat: centerLat, lng: centerLng + outerLng });
  points.push({ lat: centerLat, lng: centerLng - outerLng });

  return points;
}

interface PlacesQuery {
  type?: string;
  keyword?: string;
}

function shortenMsg(msg: unknown): string {
  if (typeof msg !== 'string') return '';
  const s = msg.replace(/[\r\n]+/g, ' ').slice(0, 60);
  return s.replace(/\s+/g, '_');
}

async function fetchPlacesForQuery(
  apiKey: string,
  lat: number,
  lng: number,
  query: PlacesQuery,
): Promise<{ results: any[]; errors: string[] }> {
  const allResults: any[] = [];
  const errors: string[] = [];
  let pageToken: string | undefined;
  const tag = query.type ?? query.keyword ?? 'noop';

  for (let page = 0; page < MAX_PAGES; page++) {
    let attempt = 0;
    let pageDone = false;

    while (!pageDone && attempt < 2) {
      attempt++;
      const params = new URLSearchParams();
      if (pageToken) {
        params.set('pagetoken', pageToken);
        params.set('key', apiKey);
      } else {
        params.set('location', `${lat},${lng}`);
        params.set('rankby', 'distance');
        if (query.type) params.set('type', query.type);
        if (query.keyword) params.set('keyword', query.keyword);
        params.set('key', apiKey);
      }

      const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        errors.push(`google_http_${resp.status}_${tag}_p${page}`);
        return { results: allResults, errors };
      }
      const json: any = await resp.json();
      const gStatus: string = json?.status ?? 'UNKNOWN';
      const errMsg = shortenMsg(json?.error_message);

      if (gStatus === 'OVER_QUERY_LIMIT') {
        errors.push(`over_query_limit_${tag}_p${page}`);
        if (errMsg) errors.push(`gmsg:${errMsg}`);
        return { results: allResults, errors };
      }
      if (gStatus === 'INVALID_REQUEST' && page > 0 && attempt === 1) {
        await sleep(INVALID_RETRY_WAIT_MS);
        continue;
      }
      if (gStatus !== 'OK' && gStatus !== 'ZERO_RESULTS') {
        errors.push(`google_${gStatus.toLowerCase()}_${tag}_p${page}`);
        if (errMsg) errors.push(`gmsg:${errMsg}`);
        return { results: allResults, errors };
      }

      const pageResults: any[] = Array.isArray(json?.results) ? json.results : [];
      allResults.push(...pageResults);
      pageToken = typeof json?.next_page_token === 'string' ? json.next_page_token : undefined;
      pageDone = true;
    }

    if (!pageToken) break;
    await sleep(PAGE_TOKEN_WAIT_MS);
  }

  return { results: allResults, errors };
}

// Eski API uyumluluğu — sadece type ile arar.
async function fetchPlacesForType(
  apiKey: string,
  lat: number,
  lng: number,
  type: string,
): Promise<{ results: any[]; errors: string[] }> {
  return fetchPlacesForQuery(apiKey, lat, lng, { type });
}

interface OsmFetchResult {
  results: Array<{
    osm_id: string;
    name: string;
    lat: number;
    lng: number;
    address?: string;
    phone?: string;
    website?: string;
    types: string[];
    source: 'osm';
  }>;
  errors: string[];
}

async function fetchFromOsm(
  lat: number,
  lng: number,
  radiusM: number,
  verticalKey: string,
): Promise<OsmFetchResult> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/osm-search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ lat, lng, radiusM, verticalKey }),
    });
    if (!resp.ok) {
      return { results: [], errors: [`osm_http_${resp.status}`] };
    }
    const json: any = await resp.json();
    if (json?.status === 'error') {
      return { results: [], errors: Array.isArray(json?.errors) ? json.errors : ['osm_error'] };
    }
    const results = Array.isArray(json?.results) ? json.results : [];
    return { results, errors: [] };
  } catch (e) {
    return { results: [], errors: [`osm_fetch_${(e as Error)?.message ?? 'unknown'}`] };
  }
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['method_not_allowed'] }, 405, cors);
  }

  try {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['unauthorized'] }, 401, cors);
    }
    const token = authHeader.slice(7).trim();
    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let userId = 'service-role';
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_token'] }, 401, cors);
      }
      userId = userData.user.id;

      // Admin role check
      const { data: profileData, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();

      if (profileErr) {
        console.error('profile fetch error:', profileErr.message);
        return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['profile_lookup_failed'] }, 500, cors);
      }
      const role: string = (profileData as any)?.role ?? '';
      if (!role || role.toUpperCase() !== 'ADMIN') {
        return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['forbidden'] }, 403, cors);
      }
    }

    let body: ScanBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_json'] }, 400, cors);
    }

    const {
      lat,
      lng,
      radiusM,
      provinceSlug,
      districtSlug,
      vertical,
      types,
      keywords,
      intensity,
      source,
    } = body || ({} as ScanBody);

    if (!isValidCoord(lat) || lat < -90 || lat > 90) {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_lat'] }, 400, cors);
    }
    if (!isValidCoord(lng) || lng < -180 || lng > 180) {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_lng'] }, 400, cors);
    }
    if (!isValidCoord(radiusM) || radiusM < 1 || radiusM > 50000) {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_radius'] }, 400, cors);
    }
    if (!provinceSlug || typeof provinceSlug !== 'string') {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_province_slug'] }, 400, cors);
    }
    if (districtSlug !== undefined && districtSlug !== null && typeof districtSlug !== 'string') {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_district_slug'] }, 400, cors);
    }
    if (vertical !== undefined && typeof vertical !== 'string') {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_vertical'] }, 400, cors);
    }
    if (types !== undefined && !Array.isArray(types)) {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_types'] }, 400, cors);
    }

    let sourceMode: SourceMode = 'google';
    if (source !== undefined) {
      if (source !== 'google' && source !== 'osm' && source !== 'both') {
        return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_source'] }, 400, cors);
      }
      sourceMode = source;
    }

    const wantsGoogle = sourceMode === 'google' || sourceMode === 'both';
    const wantsOsm = sourceMode === 'osm' || sourceMode === 'both';

    if (wantsGoogle && !GOOGLE_PLACES_API_KEY) {
      console.error('GOOGLE_PLACES_API_KEY missing');
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['api_key_missing'] }, 500, cors);
    }

    const scanTypes: string[] = types && types.length > 0 ? types : ['dentist'];
    const verticalKey: string = vertical && vertical.trim().length > 0 ? vertical : 'dental';
    const intensityKey: 'standard' | 'high' | 'max' = intensity ?? 'standard';

    // Intensity'ye göre keyword sayısı:
    //   standard: sadece type tarama (mevcut davranış, en ucuz)
    //   high: type + 2 keyword (ortalama 3x maliyet)
    //   max: type + tüm default keyword'ler (~5x maliyet)
    const defaultKeywords = DEFAULT_KEYWORDS_BY_VERTICAL[verticalKey] ?? [];
    const userKeywords = Array.isArray(keywords) ? keywords.filter((k) => typeof k === 'string' && k.trim()) : [];
    let scanKeywords: string[];
    if (userKeywords.length > 0) {
      scanKeywords = userKeywords;
    } else if (intensityKey === 'high') {
      scanKeywords = defaultKeywords.slice(0, 2);
    } else if (intensityKey === 'max') {
      scanKeywords = defaultKeywords;
    } else {
      scanKeywords = [];
    }

    // Rate limit check
    const now = new Date();
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    let rateLimitActive = true;
    try {
      const { count, error: countErr } = await supabase
        .from('saha_api_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('endpoint', ENDPOINT)
        .gte('used_at', startOfDay.toISOString());

      if (countErr) {
        console.warn('rate limit count error:', countErr.message);
        rateLimitActive = false;
      } else if ((count ?? 0) >= DAILY_LIMIT) {
        return jsonResponse({ status: 'over_limit', scanned: 0, new: 0, updated: 0 }, 429, cors);
      }
    } catch (e) {
      console.warn('rate limit table not available:', (e as Error).message);
      rateLimitActive = false;
    }

    const collectedErrors: string[] = [];
    const filter = getFilterForVertical(verticalKey);
    let filteredOutCount = 0;
    const filteredReasons: Array<{ name: string; reason: string }> = [];

    // ----------------------------------------------------------------------
    // Google Places: multi-type loop with pagination + per-place dedup
    // ----------------------------------------------------------------------
    const googleByPlaceId = new Map<string, MappedResult>();

    if (wantsGoogle) {
      // Multi-point grid (büyük radius'larda Google 60-result limitini aşmak için)
      const gridPoints = buildGridPoints(lat, lng, radiusM);
      let googleGridCalls = 0;

      const queries: PlacesQuery[] = [
        ...scanTypes.filter((t) => typeof t === 'string' && t.trim()).map((t) => ({ type: t.trim() })),
        ...scanKeywords.map((k) => ({ keyword: k })),
      ];

      // Tüm (grid x query) çiftlerini tek bir liste yap, sonra QUERY_CONCURRENCY ile paralel işle.
      const tasks: Array<{ point: { lat: number; lng: number }; q: PlacesQuery }> = [];
      for (const point of gridPoints) {
        for (const q of queries) {
          tasks.push({ point, q });
        }
      }

      for (let i = 0; i < tasks.length; i += QUERY_CONCURRENCY) {
        if (i > 0) await sleep(CHUNK_SLEEP_MS);
        const slice = tasks.slice(i, i + QUERY_CONCURRENCY);
        const settled = await Promise.allSettled(
          slice.map(({ point, q }) =>
            fetchPlacesForQuery(GOOGLE_PLACES_API_KEY!, point.lat, point.lng, q),
          ),
        );
        for (const s of settled) {
          googleGridCalls++;
          if (s.status !== 'fulfilled') {
            collectedErrors.push(`task_failed_${(s.reason as Error)?.message ?? 'unknown'}`);
            continue;
          }
          const rawPage = s.value.results;
          collectedErrors.push(...s.value.errors);

          for (const r of rawPage) {
            const placeId: string | undefined = r?.place_id;
            const name: string | undefined = r?.name;
            const gLat = r?.geometry?.location?.lat;
            const gLng = r?.geometry?.location?.lng;
            if (!placeId || !name || typeof gLat !== 'number' || typeof gLng !== 'number') continue;

            // Client-side radius filter: distance to ORIGINAL center, not grid point
            const dist = haversineM(lat, lng, gLat, gLng);
            if (dist > radiusM) continue;

            if (googleByPlaceId.has(placeId)) continue;

            const rTypes: string[] = Array.isArray(r?.types) ? r.types : [];
            const address = typeof r?.vicinity === 'string' ? r.vicinity : undefined;

            // Vertical filter (e.g. dental keyword / forbidden keyword)
            const fres: FilterResult = filter(name, rTypes, address);
            if (!fres.valid) {
              filteredOutCount++;
              if (filteredReasons.length < 10) {
                filteredReasons.push({ name, reason: fres.reason ?? 'unknown' });
              }
              continue;
            }

            googleByPlaceId.set(placeId, {
              placeId,
              osmId: null,
              name,
              lat: gLat,
              lng: gLng,
              address,
              rating: typeof r?.rating === 'number' ? r.rating : undefined,
              userRatingCount: typeof r?.user_ratings_total === 'number' ? r.user_ratings_total : undefined,
              types: rTypes,
              sources: ['google'],
              raw: r,
            });
          }
        }
      }

      collectedErrors.push(`google_grid_points:${gridPoints.length}`);
      collectedErrors.push(`google_grid_calls:${googleGridCalls}`);
      collectedErrors.push(`google_intensity:${intensityKey}`);
      collectedErrors.push(`google_keywords:${scanKeywords.length}`);
    }

    // ----------------------------------------------------------------------
    // OSM via osm-search Edge Function
    // ----------------------------------------------------------------------
    const osmByOsmId = new Map<string, MappedResult>();

    if (wantsOsm) {
      const osmResp = await fetchFromOsm(lat, lng, radiusM, verticalKey);
      collectedErrors.push(...osmResp.errors);

      for (const r of osmResp.results) {
        if (typeof r?.osm_id !== 'string' || typeof r?.name !== 'string') continue;
        if (typeof r.lat !== 'number' || typeof r.lng !== 'number') continue;

        // Client-side radius (Overpass already filters but be defensive)
        const dist = haversineM(lat, lng, r.lat, r.lng);
        if (dist > radiusM) continue;

        if (osmByOsmId.has(r.osm_id)) continue;

        const fres: FilterResult = filter(r.name, r.types ?? [], r.address);
        if (!fres.valid) {
          filteredOutCount++;
          if (filteredReasons.length < 10) {
            filteredReasons.push({ name: r.name, reason: fres.reason ?? 'unknown' });
          }
          continue;
        }

        osmByOsmId.set(r.osm_id, {
          placeId: null,
          osmId: r.osm_id,
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          address: r.address,
          phone: r.phone,
          website: r.website,
          types: r.types ?? [],
          sources: ['osm'],
          raw: r,
        });
      }
    }

    // ----------------------------------------------------------------------
    // Merge Google + OSM: dedup by (lat/lng proximity + name) when source==both
    // ----------------------------------------------------------------------
    const googleArr = Array.from(googleByPlaceId.values());
    const osmArr = Array.from(osmByOsmId.values());

    // If a Google entry matches an OSM entry, merge them. OSM-only entries
    // that don't match remain as separate records (osm_id set, place_id null).
    const consumedOsmIds = new Set<string>();
    if (wantsGoogle && wantsOsm) {
      for (const g of googleArr) {
        const gNorm = normName(g.name);
        for (const o of osmArr) {
          if (consumedOsmIds.has(o.osmId!)) continue;
          const dist = haversineM(g.lat, g.lng, o.lat, o.lng);
          if (dist <= DEDUP_RADIUS_M && normName(o.name) === gNorm) {
            // merge: attach osm_id + sources to the google record
            g.osmId = o.osmId;
            g.sources = ['google', 'osm'];
            // fill empty fields from OSM if google missing
            if (!g.address && o.address) g.address = o.address;
            if (!g.phone && o.phone) g.phone = o.phone;
            if (!g.website && o.website) g.website = o.website;
            consumedOsmIds.add(o.osmId!);
            break;
          }
        }
      }
    }

    const unmatchedOsm = osmArr.filter((o) => !consumedOsmIds.has(o.osmId!));
    const mergedResults: MappedResult[] = [...googleArr, ...unmatchedOsm];

    const googleCount = googleArr.length;
    const osmCount = osmArr.length;

    if (mergedResults.length === 0) {
      if (rateLimitActive) {
        try {
          await supabase.from('saha_api_usage').insert({
            user_id: userId,
            endpoint: ENDPOINT,
            used_at: new Date().toISOString(),
            count: 1,
          });
        } catch (e) {
          console.warn('usage insert exception:', (e as Error).message);
        }
      }
      return jsonResponse(
        {
          status: 'ok',
          scanned: 0,
          new: 0,
          updated: 0,
          filtered_out: filteredOutCount,
          ...(filteredReasons.length > 0 ? { filtered_reasons: filteredReasons } : {}),
          ...(wantsGoogle ? { google_count: googleCount } : {}),
          ...(wantsOsm ? { osm_count: osmCount } : {}),
          ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
        },
        200,
        cors,
      );
    }

    // ----------------------------------------------------------------------
    // Determine new vs updated counts (best effort)
    // ----------------------------------------------------------------------
    const placeIds = mergedResults.map((r) => r.placeId).filter((x): x is string => !!x);
    const osmIds = mergedResults.map((r) => r.osmId).filter((x): x is string => !!x);

    const existingPlaceIds = new Set<string>();
    const existingOsmIds = new Set<string>();

    if (placeIds.length > 0) {
      const { data: existing, error: existingErr } = await supabase
        .from('saha_clinics')
        .select('google_place_id')
        .in('google_place_id', placeIds);
      if (existingErr) {
        console.error('existing place_id fetch error:', existingErr.message);
        collectedErrors.push('existing_fetch_failed');
      } else {
        for (const e of existing ?? []) {
          if ((e as any).google_place_id) existingPlaceIds.add((e as any).google_place_id);
        }
      }
    }
    if (osmIds.length > 0) {
      const { data: existingOsm, error: existingOsmErr } = await supabase
        .from('saha_clinics')
        .select('osm_id')
        .in('osm_id', osmIds);
      if (existingOsmErr) {
        console.error('existing osm_id fetch error:', existingOsmErr.message);
        collectedErrors.push('existing_osm_fetch_failed');
      } else {
        for (const e of existingOsm ?? []) {
          if ((e as any).osm_id) existingOsmIds.add((e as any).osm_id);
        }
      }
    }

    let newCount = 0;
    let updatedCount = 0;
    for (const r of mergedResults) {
      const isExisting =
        (r.placeId && existingPlaceIds.has(r.placeId)) ||
        (r.osmId && existingOsmIds.has(r.osmId));
      if (isExisting) updatedCount++;
      else newCount++;
    }

    // ----------------------------------------------------------------------
    // Upsert — split into two batches:
    //   (a) records with google_place_id  → onConflict: google_place_id
    //   (b) OSM-only records (no place_id) → onConflict: osm_id
    // ----------------------------------------------------------------------
    const nowIso = new Date().toISOString();

    const toRow = (r: MappedResult) => ({
      google_place_id: r.placeId,
      osm_id: r.osmId,
      sources: r.sources,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      address: r.address ?? null,
      phone: r.phone ?? null,
      website: r.website ?? null,
      rating: r.rating ?? null,
      user_ratings_total: r.userRatingCount ?? null,
      types: r.types ?? [],
      province_slug: provinceSlug,
      district_slug: districtSlug ?? null,
      vertical_key: verticalKey,
      last_seen_at: nowIso,
      last_verified_at: nowIso,
      raw_payload: r.raw,
    });

    const withGoogle = mergedResults.filter((r) => !!r.placeId).map(toRow);
    const osmOnly = mergedResults.filter((r) => !r.placeId && !!r.osmId).map(toRow);

    if (withGoogle.length > 0) {
      const { error: upsertErr } = await supabase
        .from('saha_clinics')
        .upsert(withGoogle, { onConflict: 'google_place_id' });
      if (upsertErr) {
        console.error('upsert (google) error:', upsertErr.message);
        return jsonResponse(
          {
            status: 'error',
            scanned: mergedResults.length,
            new: 0,
            updated: 0,
            filtered_out: filteredOutCount,
            errors: [...collectedErrors, `upsert_failed_${upsertErr.message}`],
          },
          500,
          cors,
        );
      }
    }

    if (osmOnly.length > 0) {
      const { error: upsertErr } = await supabase
        .from('saha_clinics')
        .upsert(osmOnly, { onConflict: 'osm_id' });
      if (upsertErr) {
        console.error('upsert (osm) error:', upsertErr.message);
        return jsonResponse(
          {
            status: 'error',
            scanned: mergedResults.length,
            new: 0,
            updated: 0,
            filtered_out: filteredOutCount,
            errors: [...collectedErrors, `upsert_osm_failed_${upsertErr.message}`],
          },
          500,
          cors,
        );
      }
    }

    // Record usage (best effort)
    if (rateLimitActive) {
      try {
        const { error: insErr } = await supabase
          .from('saha_api_usage')
          .insert({
            user_id: userId,
            endpoint: ENDPOINT,
            used_at: new Date().toISOString(),
            count: 1,
          });
        if (insErr) console.warn('usage insert error:', insErr.message);
      } catch (e) {
        console.warn('usage insert exception:', (e as Error).message);
      }
    }

    return jsonResponse(
      {
        status: 'ok',
        scanned: mergedResults.length,
        new: newCount,
        updated: updatedCount,
        filtered_out: filteredOutCount,
        ...(filteredReasons.length > 0 ? { filtered_reasons: filteredReasons } : {}),
        ...(wantsGoogle ? { google_count: googleCount } : {}),
        ...(wantsOsm ? { osm_count: osmCount } : {}),
        ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
      },
      200,
      cors,
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('clinic-scan fatal:', msg);
    return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: [msg] }, 500, cors);
  }
});
