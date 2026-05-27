// deno-lint-ignore-file
// ============================================================================
// enum-neighborhoods — Mahalle listesi orkestratörü
// ----------------------------------------------------------------------------
// Akış:
//   1) Auth (admin user JWT VEYA service_role token).
//   2) Cache kontrol: saha_neighborhoods'ta >=3 satır varsa onu döndür.
//   3) districts.json'dan ilçe koord + nüfus al, nüfusa göre radius hesapla.
//   4) osm-search Edge Function'a `mode: 'neighborhoods'` ile gel.
//   5) OSM 0 dönerse ve MAPBOX_PUBLIC_TOKEN set ise Mapbox geocoding fallback.
//   6) Sonuçları saha_neighborhoods'a best-effort insert (duplicate yutulur).
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import districtsData from './districts.json' with { type: 'json' };

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// VITE_ prefix client-tarafı için; aynı secret server'da da varsayılan olarak okunabilir.
const MAPBOX_PUBLIC_TOKEN =
  Deno.env.get('MAPBOX_PUBLIC_TOKEN') ?? Deno.env.get('VITE_MAPBOX_PUBLIC_TOKEN') ?? '';

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Toplam wall-time guard (osm-search kendi içinde 60sn timeout uyguluyor).
const WALL_TIME_MS = 20000;

interface DistrictRow {
  il_plaka: number;
  il_ad: string;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus_2023: number;
}

interface ReqBody {
  provinceSlug?: string;
  districtSlug?: string;
  force?: boolean;
}

interface Neighborhood {
  name: string;
  lat: number | null;
  lng: number | null;
}

const DISTRICTS = districtsData as DistrictRow[];

// İl adı → slug map'i (province_slug parametresi districts.json'da yok).
// batch-scan/tr-data.ts ile aynı kural: ASCII-fold + lowercase + tire.
function slugifyTr(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findDistrict(provinceSlug: string, districtSlug: string): DistrictRow | null {
  const ps = provinceSlug.toLowerCase();
  const ds = districtSlug.toLowerCase();
  for (const d of DISTRICTS) {
    if (d.slug !== ds) continue;
    if (slugifyTr(d.il_ad) === ps) return d;
  }
  return null;
}

function radiusForPopulation(nufus: number): number {
  if (nufus >= 500_000) return 9000; // MEGA
  if (nufus >= 200_000) return 7000; // Büyük
  if (nufus >= 80_000) return 5000;  // Orta
  if (nufus >= 20_000) return 3000;  // Küçük
  return 2000;                       // ÇokKüçük
}

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const allowed =
    reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function callOsmSearch(
  lat: number,
  lng: number,
  radiusM: number,
  signal: AbortSignal,
): Promise<{ neighborhoods: Neighborhood[]; error?: string }> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/osm-search`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ lat, lng, radiusM, mode: 'neighborhoods' }),
      signal,
    });
    if (!resp.ok) {
      return { neighborhoods: [], error: `osm_search_${resp.status}` };
    }
    const json: any = await resp.json();
    if (json?.status !== 'ok' || !Array.isArray(json?.neighborhoods)) {
      return { neighborhoods: [], error: json?.errors?.[0] ?? 'osm_search_bad_payload' };
    }
    const out: Neighborhood[] = [];
    for (const n of json.neighborhoods) {
      const name = typeof n?.name === 'string' ? n.name.trim() : '';
      if (!name) continue;
      const nlat = typeof n?.lat === 'number' ? n.lat : null;
      const nlng = typeof n?.lng === 'number' ? n.lng : null;
      out.push({ name, lat: nlat, lng: nlng });
    }
    return { neighborhoods: out };
  } catch (e) {
    const msg = (e as Error)?.message ?? 'osm_search_unknown';
    return { neighborhoods: [], error: `osm_search_${msg}` };
  }
}

async function callMapbox(
  districtName: string,
  lat: number,
  lng: number,
  signal: AbortSignal,
): Promise<{ neighborhoods: Neighborhood[]; error?: string }> {
  if (!MAPBOX_PUBLIC_TOKEN) {
    return { neighborhoods: [], error: 'mapbox_token_missing' };
  }
  try {
    const q = encodeURIComponent(districtName);
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json` +
      `?access_token=${MAPBOX_PUBLIC_TOKEN}` +
      `&country=tr&types=neighborhood&proximity=${lng},${lat}&limit=10`;
    const resp = await fetch(url, { signal });
    if (!resp.ok) {
      return { neighborhoods: [], error: `mapbox_${resp.status}` };
    }
    const json: any = await resp.json();
    const features: any[] = Array.isArray(json?.features) ? json.features : [];
    const out: Neighborhood[] = [];
    for (const f of features) {
      const name =
        typeof f?.text_tr === 'string' && f.text_tr.trim()
          ? f.text_tr.trim()
          : typeof f?.text === 'string'
            ? f.text.trim()
            : '';
      if (!name) continue;
      const center = Array.isArray(f?.center) ? f.center : null;
      const nlng = center && typeof center[0] === 'number' ? center[0] : null;
      const nlat = center && typeof center[1] === 'number' ? center[1] : null;
      out.push({ name, lat: nlat, lng: nlng });
    }
    return { neighborhoods: out };
  } catch (e) {
    const msg = (e as Error)?.message ?? 'mapbox_unknown';
    return { neighborhoods: [], error: `mapbox_${msg}` };
  }
}

function dedupByLowerName(list: Neighborhood[]): Neighborhood[] {
  const seen = new Set<string>();
  const out: Neighborhood[] = [];
  for (const n of list) {
    const key = n.name.toLocaleLowerCase('tr-TR');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse(
      { status: 'error', count: 0, neighborhoods: [], errors: ['method_not_allowed'] },
      405,
      cors,
    );
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return jsonResponse(
      { status: 'error', count: 0, neighborhoods: [], errors: ['unauthorized'] },
      401,
      cors,
    );
  }
  const token = authHeader.slice(7).trim();
  const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!isServiceRole) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse(
        { status: 'error', count: 0, neighborhoods: [], errors: ['invalid_token'] },
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
        { status: 'error', count: 0, neighborhoods: [], errors: ['profile_lookup_failed'] },
        500,
        cors,
      );
    }
    const role: string = (profileData as any)?.role ?? '';
    if (!role || role.toUpperCase() !== 'ADMIN') {
      return jsonResponse(
        { status: 'error', count: 0, neighborhoods: [], errors: ['forbidden'] },
        403,
        cors,
      );
    }
  }

  // ── Body parse ──────────────────────────────────────────────────────────
  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { status: 'error', count: 0, neighborhoods: [], errors: ['invalid_json'] },
      400,
      cors,
    );
  }

  const provinceSlug = typeof body?.provinceSlug === 'string' ? body.provinceSlug.trim().toLowerCase() : '';
  const districtSlug = typeof body?.districtSlug === 'string' ? body.districtSlug.trim().toLowerCase() : '';
  const force = body?.force === true;

  if (!provinceSlug) {
    return jsonResponse(
      { status: 'error', count: 0, neighborhoods: [], errors: ['invalid_province_slug'] },
      400,
      cors,
    );
  }
  if (!districtSlug) {
    return jsonResponse(
      { status: 'error', count: 0, neighborhoods: [], errors: ['invalid_district_slug'] },
      400,
      cors,
    );
  }

  // ── Cache kontrol ───────────────────────────────────────────────────────
  if (!force) {
    const { data: cached, error: cacheErr } = await supabase
      .from('saha_neighborhoods')
      .select('name, lat, lng')
      .eq('province_slug', provinceSlug)
      .eq('district_slug', districtSlug);

    if (!cacheErr && Array.isArray(cached) && cached.length >= 3) {
      const list: Neighborhood[] = cached.map((r: any) => ({
        name: String(r.name),
        lat: typeof r.lat === 'number' ? r.lat : null,
        lng: typeof r.lng === 'number' ? r.lng : null,
      }));
      return jsonResponse(
        { status: 'cached', mode: 'cache', count: list.length, neighborhoods: list },
        200,
        cors,
      );
    }
  }

  // ── District koord + radius ─────────────────────────────────────────────
  const district = findDistrict(provinceSlug, districtSlug);
  if (!district) {
    return jsonResponse(
      { status: 'error', count: 0, neighborhoods: [], errors: ['district_not_found'] },
      404,
      cors,
    );
  }
  const radiusM = radiusForPopulation(district.nufus_2023 ?? 0);

  // Wall-time guard.
  const wallController = new AbortController();
  const wallTimer = setTimeout(() => wallController.abort(), WALL_TIME_MS);

  let sourceMode: 'osm' | 'mapbox' = 'osm';
  let neighborhoods: Neighborhood[] = [];
  const errors: string[] = [];

  try {
    // ── OSM call ──────────────────────────────────────────────────────────
    const osm = await callOsmSearch(district.lat, district.lng, radiusM, wallController.signal);
    if (osm.error) errors.push(osm.error);
    neighborhoods = dedupByLowerName(osm.neighborhoods);

    // ── Mapbox fallback ───────────────────────────────────────────────────
    if (neighborhoods.length === 0) {
      if (!MAPBOX_PUBLIC_TOKEN) {
        errors.push('mapbox_token_missing_skipped');
      } else {
        const mb = await callMapbox(district.ad, district.lat, district.lng, wallController.signal);
        if (mb.error) errors.push(mb.error);
        neighborhoods = dedupByLowerName(mb.neighborhoods);
        if (neighborhoods.length > 0) sourceMode = 'mapbox';
      }
    }
  } finally {
    clearTimeout(wallTimer);
  }

  // ── Best-effort insert (duplicate hataları yutulur) ─────────────────────
  if (neighborhoods.length > 0) {
    const rows = neighborhoods.map((n) => ({
      province_slug: provinceSlug,
      district_slug: districtSlug,
      name: n.name,
      lat: n.lat,
      lng: n.lng,
      source: sourceMode,
    }));
    await Promise.allSettled(
      rows.map((r) => supabase.from('saha_neighborhoods').insert(r)),
    );
  }

  return jsonResponse(
    {
      status: 'ok',
      mode: sourceMode,
      count: neighborhoods.length,
      neighborhoods,
      errors: errors.length > 0 ? errors : undefined,
    },
    200,
    cors,
  );
});
