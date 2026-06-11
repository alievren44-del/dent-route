// deno-lint-ignore-file
// ============================================================================
// clinic-scan-v2 — High-coverage discovery (PROMPT-16 implementation)
// ============================================================================
//
// Why a separate function (not a clinic-scan upgrade)?
//   - clinic-scan kept as-is for batch-scan callers (rate-friendly, $0.5/ilçe).
//   - v2 is opt-in, aggressive, ~$10-30/ilçe but yields 3-5x more results.
//
// Strategy vs. v1:
//   - NearbySearch uses radius+location (NOT rankby=distance) — every grid
//     point can independently return up to 60 results.
//   - 5×5 = 25 grid points, step = radius/3 (overlapping coverage).
//   - 9 keyword queries per point (vs. 1 type in v1).
//   - TextSearch ("diş hekimi <ilçe>" style) as a 26th nokta-agnostic query.
//   - filters.ts shared with v1 — same dental whitelist + softening.
//   - Upsert to saha_clinics — same schema, same dedup by google_place_id.
//   - Logs each invocation into saha_clinic_scan_logs (audit + reload).
//
// Body (POST JSON):
//   { lat, lng, radiusM, provinceSlug, districtSlug?, vertical?,
//     gridSize?: 9|13|25, keywords?: string[],
//     useTextSearch?: boolean,            // default true
//     source?: 'google'|'osm'|'both' }    // default 'google'
//
// Auth: same as clinic-scan — admin user JWT OR service_role bypass.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { getFilterForVertical, type FilterResult } from '../clinic-scan/filters.ts';

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

const ENDPOINT = 'clinic-scan-v2';
const DAILY_LIMIT = 100;
const MAX_PAGES = 3;
const PAGE_TOKEN_WAIT_MS = 2500; // Google next_page_token bazen 2sn+ ister
const INVALID_RETRY_WAIT_MS = 3000;
// Edge Function wall-clock limit 150sn — agresif paralelliği indirip Google
// rate-limit (INVALID_REQUEST/OVER_QUERY_LIMIT) riskini azaltıyoruz.
const GRID_CONCURRENCY = 3;
const QUERY_CONCURRENCY = 2;
const CHUNK_SLEEP_MS = 100;

// 9-keyword default for dental vertical (per PROMPT-16).
const DEFAULT_KEYWORDS_BY_VERTICAL: Record<string, string[]> = {
  dental: [
    'diş hekimi',
    'diş kliniği',
    'dental klinik',
    'ortodontist',
    'pedodontist',
    'implant merkezi',
    'ağız diş sağlığı',
    'diş polikliniği',
    'diş protez',
  ],
};

type SourceMode = 'google' | 'osm' | 'both';

interface ScanV2Body {
  lat: number;
  lng: number;
  radiusM: number;
  provinceSlug: string;
  districtSlug?: string;
  vertical?: string;
  gridSize?: 9 | 13 | 25;
  keywords?: string[];
  useTextSearch?: boolean;
  source?: SourceMode;
  dryRun?: boolean;
  placeIdsAllowlist?: string[];
}

interface MappedResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  rating?: number;
  userRatingCount?: number;
  types: string[];
  raw: unknown;
}

interface PreviewClinic {
  place_id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  rating?: number;
  user_ratings_total?: number;
  types: string[];
  sources: string[];
  db_status: 'new' | 'existing';
  confidence: number;
  is_suspicious: boolean;
  suspicious_reasons: string[];
}

function computeConfidence(name: string, types: string[]): { confidence: number; suspicious: boolean; reasons: string[] } {
  const nameLc = name.toLowerCase();
  const typesLc = types.map((t) => t.toLowerCase());
  const dentalKeywords = ['diş', 'dis', 'dental', 'dent', 'ortodont', 'pedodont', 'ağız', 'agiz', 'çene', 'cene', 'oral', 'denta', 'implant', 'protez'];
  const hasDentalName = dentalKeywords.some((k) => nameLc.includes(k));
  const hasDentistType = typesLc.includes('dentist');
  const reasons: string[] = [];

  if (hasDentistType && hasDentalName) return { confidence: 100, suspicious: false, reasons: [] };
  if (hasDentistType) return { confidence: 85, suspicious: false, reasons: [] };
  if (hasDentalName) {
    if (/^d[rt]\.?\s/.test(nameLc)) {
      reasons.push('title_prefix_only');
      return { confidence: 75, suspicious: false, reasons };
    }
    return { confidence: 80, suspicious: false, reasons: [] };
  }

  // Dr./Dt. prefix + medical-generic type — softening kabulü
  if (/^d[rt]\.?\s/.test(nameLc) && typesLc.some((t) => ['doctor', 'health', 'establishment', 'point_of_interest'].includes(t))) {
    reasons.push('no_dental_keyword', 'title_only');
    return { confidence: 45, suspicious: true, reasons };
  }

  reasons.push('no_dental_signal');
  return { confidence: 30, suspicious: true, reasons };
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

/**
 * Build a grid of N points centered at (lat,lng).
 *   9  → 3×3
 *   13 → 3×3 + 4 outer
 *   25 → 5×5 (densest, default)
 * Step = radiusM/3 for 5×5 → overlapping (each point covers radius/3 well).
 */
function buildGrid(centerLat: number, centerLng: number, radiusM: number, size: 9 | 13 | 25): Array<{ lat: number; lng: number }> {
  const latPerM = 1 / 111000;
  const lngPerM = 1 / (111000 * Math.cos((centerLat * Math.PI) / 180));

  if (size === 9) {
    const step = radiusM / 2;
    const sLat = step * latPerM;
    const sLng = step * lngPerM;
    return [
      { lat: centerLat, lng: centerLng },
      { lat: centerLat + sLat, lng: centerLng },
      { lat: centerLat - sLat, lng: centerLng },
      { lat: centerLat, lng: centerLng + sLng },
      { lat: centerLat, lng: centerLng - sLng },
      { lat: centerLat + sLat, lng: centerLng + sLng },
      { lat: centerLat + sLat, lng: centerLng - sLng },
      { lat: centerLat - sLat, lng: centerLng + sLng },
      { lat: centerLat - sLat, lng: centerLng - sLng },
    ];
  }

  if (size === 13) {
    const step = radiusM / 2;
    const outerStep = radiusM / 1.3;
    const sLat = step * latPerM;
    const sLng = step * lngPerM;
    const oLat = outerStep * latPerM;
    const oLng = outerStep * lngPerM;
    return [
      { lat: centerLat, lng: centerLng },
      { lat: centerLat + sLat, lng: centerLng },
      { lat: centerLat - sLat, lng: centerLng },
      { lat: centerLat, lng: centerLng + sLng },
      { lat: centerLat, lng: centerLng - sLng },
      { lat: centerLat + sLat, lng: centerLng + sLng },
      { lat: centerLat + sLat, lng: centerLng - sLng },
      { lat: centerLat - sLat, lng: centerLng + sLng },
      { lat: centerLat - sLat, lng: centerLng - sLng },
      { lat: centerLat + oLat, lng: centerLng },
      { lat: centerLat - oLat, lng: centerLng },
      { lat: centerLat, lng: centerLng + oLng },
      { lat: centerLat, lng: centerLng - oLng },
    ];
  }

  // 25 = 5×5 grid
  const step = radiusM / 3;
  const sLat = step * latPerM;
  const sLng = step * lngPerM;
  const points: Array<{ lat: number; lng: number }> = [];
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      points.push({
        lat: centerLat + r * sLat,
        lng: centerLng + c * sLng,
      });
    }
  }
  return points;
}

/**
 * NearbySearch — `rankby=distance` mode.
 *
 * Google'da `rankby=distance` her çağrıda en yakın 60 sonucu döner (radius
 * göz ardı edilir). `radius` mode'da bazı keyword'ler 0 dönüyor (Google'ın
 * arama kalitesi düşük). Distance modu daha tutarlı sonuç verir; grid +
 * keyword kombinasyonu ile aynı noktada farklı sıralama → unique set
 * dedup sonrası genişler.
 */
function shortenMsg(msg: unknown): string {
  if (typeof msg !== 'string') return '';
  const s = msg.replace(/[\r\n]+/g, ' ').slice(0, 60);
  return s.replace(/\s+/g, '_');
}

async function nearbySearchByDistance(
  apiKey: string,
  lat: number,
  lng: number,
  query: { type?: string; keyword?: string },
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

      // Transient INVALID_REQUEST on paginated pages: pagetoken not ready yet.
      // Retry once after extra wait.
      if (gStatus === 'INVALID_REQUEST' && page > 0 && attempt === 1) {
        await sleep(INVALID_RETRY_WAIT_MS);
        continue; // retry same page
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

/**
 * TextSearch — text query only.
 *
 * NOT: location+radius bias kombinasyonu Google'dan INVALID_REQUEST aldı
 * (Türkçe ilçe slug + lat/lng iyi geçmiyor). Sadece `query` ile çağırıyoruz;
 * Google "diş hekimi malatya" tipinde lokasyonu metinde otomatik çıkarır.
 */
async function textSearch(
  apiKey: string,
  query: string,
): Promise<{ results: any[]; errors: string[] }> {
  const allResults: any[] = [];
  const errors: string[] = [];
  let pageToken: string | undefined;

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
        params.set('query', query);
        params.set('key', apiKey);
      }
      const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`;
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        errors.push(`text_http_${resp.status}_p${page}`);
        return { results: allResults, errors };
      }
      const json: any = await resp.json();
      const gStatus: string = json?.status ?? 'UNKNOWN';
      const errMsg = shortenMsg(json?.error_message);

      if (gStatus === 'OVER_QUERY_LIMIT') {
        errors.push(`over_query_limit_text_p${page}`);
        if (errMsg) errors.push(`gmsg:${errMsg}`);
        return { results: allResults, errors };
      }
      if (gStatus === 'INVALID_REQUEST' && page > 0 && attempt === 1) {
        await sleep(INVALID_RETRY_WAIT_MS);
        continue;
      }
      if (gStatus !== 'OK' && gStatus !== 'ZERO_RESULTS') {
        errors.push(`text_${gStatus.toLowerCase()}_p${page}`);
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

/**
 * Türkçe ilçe/il slug'unı insan-okunabilir biçime çevir ("battalgazi" → "Battalgazi").
 * TextSearch sorgu metninde kullanılır.
 */
function slugToReadable(slug: string): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['method_not_allowed'] }, 405, cors);
  }

  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return jsonResponse({ status: 'error', errors: ['api_key_missing'] }, 500, cors);
    }

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ status: 'error', errors: ['unauthorized'] }, 401, cors);
    }
    const token = authHeader.slice(7).trim();
    const isServiceRole = token === SUPABASE_SERVICE_ROLE_KEY;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let userId: string | null = null;
    if (!isServiceRole) {
      const { data: userData, error: userErr } = await supabase.auth.getUser(token);
      if (userErr || !userData?.user) {
        return jsonResponse({ status: 'error', errors: ['invalid_token'] }, 401, cors);
      }
      userId = userData.user.id;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId).maybeSingle();
      const role: string = (profile as any)?.role ?? '';
      if (!role || role.toUpperCase() !== 'ADMIN') {
        return jsonResponse({ status: 'error', errors: ['forbidden'] }, 403, cors);
      }
    }

    let body: ScanV2Body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', errors: ['invalid_json'] }, 400, cors);
    }

    const {
      lat,
      lng,
      radiusM,
      provinceSlug,
      districtSlug,
      vertical,
      gridSize,
      keywords,
      useTextSearch,
      source,
      dryRun,
      placeIdsAllowlist,
    } = body || ({} as ScanV2Body);

    const isDryRun = dryRun === true;
    const allowlist: Set<string> | null =
      Array.isArray(placeIdsAllowlist) && placeIdsAllowlist.length > 0
        ? new Set(placeIdsAllowlist.filter((s) => typeof s === 'string'))
        : null;

    if (!isValidCoord(lat) || lat < -90 || lat > 90) return jsonResponse({ status: 'error', errors: ['invalid_lat'] }, 400, cors);
    if (!isValidCoord(lng) || lng < -180 || lng > 180) return jsonResponse({ status: 'error', errors: ['invalid_lng'] }, 400, cors);
    if (!isValidCoord(radiusM) || radiusM < 1 || radiusM > 50000) return jsonResponse({ status: 'error', errors: ['invalid_radius'] }, 400, cors);
    if (!provinceSlug || typeof provinceSlug !== 'string') return jsonResponse({ status: 'error', errors: ['invalid_province_slug'] }, 400, cors);

    const verticalKey = vertical && vertical.trim() ? vertical : 'dental';
    // Default 9 (60-90sn safe). 13 ve 25 opt-in (timeout riski var).
    const gridSizeFinal: 9 | 13 | 25 = gridSize === 13 || gridSize === 25 ? gridSize : 9;
    const useText = useTextSearch === true; // default false — pahalı + yavaş
    const wantsGoogle = source !== 'osm';
    const wantsOsm = source === 'osm' || source === 'both';

    const defaultKw = DEFAULT_KEYWORDS_BY_VERTICAL[verticalKey] ?? [];
    const kw: string[] = Array.isArray(keywords) && keywords.length > 0
      ? keywords.filter((k) => typeof k === 'string' && k.trim().length > 0)
      : defaultKw;

    // Rate limit (per-user daily — service role bypassed)
    if (userId) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('saha_api_usage')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('endpoint', ENDPOINT)
        .gte('used_at', startOfDay.toISOString());
      if ((count ?? 0) >= DAILY_LIMIT) {
        return jsonResponse({ status: 'over_limit', scanned: 0, new: 0, updated: 0 }, 429, cors);
      }
    }

    const collectedErrors: string[] = [];
    const filter = getFilterForVertical(verticalKey);
    let filteredOutCount = 0;
    const filteredReasons: Array<{ name: string; reason: string }> = [];

    const placeMap = new Map<string, MappedResult>();
    let totalCalls = 0;

    if (wantsGoogle) {
      const grid = buildGrid(lat, lng, radiusM, gridSizeFinal);
      const perPointRadius = Math.max(500, Math.round(radiusM / Math.sqrt(gridSizeFinal)));

      const onFilter = (r: { name: string; reason: string }) => {
        filteredOutCount++;
        if (filteredReasons.length < 15) filteredReasons.push(r);
      };

      // Her grid noktası için tüm sorguları (1 type + N keyword) paralel çalıştır.
      // Sonra noktaları da chunk'lar halinde paralel işle.
      const allTasks: Array<() => Promise<{ results: any[]; errors: string[] }>> = [];
      for (const point of grid) {
        allTasks.push(() =>
          nearbySearchByDistance(GOOGLE_PLACES_API_KEY!, point.lat, point.lng, { type: 'dentist' }),
        );
        for (const k of kw) {
          allTasks.push(() =>
            nearbySearchByDistance(GOOGLE_PLACES_API_KEY!, point.lat, point.lng, { keyword: k }),
          );
        }
      }
      if (useText) {
        const districtName = slugToReadable(districtSlug ?? '');
        const provinceName = slugToReadable(provinceSlug);
        const locationLabel = districtName ? `${districtName} ${provinceName}` : provinceName;
        for (const k of kw) {
          const q = `${k} ${locationLabel}`.trim();
          allTasks.push(() => textSearch(GOOGLE_PLACES_API_KEY!, q));
        }
      }

      // Chunked parallel execution to bound concurrency (Google rate limit guard).
      const CHUNK = GRID_CONCURRENCY * QUERY_CONCURRENCY;
      for (let i = 0; i < allTasks.length; i += CHUNK) {
        if (i > 0) await sleep(CHUNK_SLEEP_MS);
        const slice = allTasks.slice(i, i + CHUNK);
        const settled = await Promise.allSettled(slice.map((t) => t()));
        for (const s of settled) {
          totalCalls++;
          if (s.status !== 'fulfilled') {
            collectedErrors.push(`task_failed_${(s.reason as Error)?.message ?? 'unknown'}`);
            continue;
          }
          collectedErrors.push(...s.value.errors);
          ingestResults(s.value.results, placeMap, lat, lng, radiusM, filter, onFilter);
        }
      }

      collectedErrors.push(`grid_size:${gridSizeFinal}`);
      collectedErrors.push(`grid_calls:${totalCalls}`);
      collectedErrors.push(`keywords:${kw.length}`);
      collectedErrors.push(`text_search:${useText}`);
    }

    const allResults = Array.from(placeMap.values());

    // OSM optional add-on (delegated to osm-search EF)
    if (wantsOsm) {
      try {
        const osmResp = await fetch(`${SUPABASE_URL}/functions/v1/osm-search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
          body: JSON.stringify({ lat, lng, radiusM, verticalKey }),
        });
        if (osmResp.ok) {
          const osmJson: any = await osmResp.json();
          if (Array.isArray(osmJson?.results)) {
            for (const o of osmJson.results) {
              if (!o?.osm_id || !o?.name) continue;
              // Skip OSM-only if already present in Google set by name+coord proximity
              const dup = allResults.find(
                (g) =>
                  g.name.toLowerCase() === String(o.name).toLowerCase() &&
                  haversineM(g.lat, g.lng, o.lat, o.lng) < 50,
              );
              if (dup) continue;
              // OSM-only records go via a separate upsert; for simplicity, skip here.
              // v1 has full OSM merge; v2 prioritizes Google density.
            }
          }
        } else {
          collectedErrors.push(`osm_http_${osmResp.status}`);
        }
      } catch (e) {
        collectedErrors.push(`osm_fetch_${(e as Error)?.message ?? 'unknown'}`);
      }
    }

    if (allResults.length === 0) {
      await logScan(supabase, userId, lat, lng, radiusM, provinceSlug, districtSlug ?? null, source ?? 'google', 'v2', {
        scanned: 0, new: 0, updated: 0, filtered_out: filteredOutCount, errors: collectedErrors, dry_run: isDryRun,
      });
      return jsonResponse({
        status: 'ok', scanned: 0, new: 0, updated: 0,
        filtered_out: filteredOutCount,
        clinics: [],
        ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
      }, 200, cors);
    }

    // Pre-fetch existing place_ids (always — needed for db_status flag in preview)
    const placeIds = allResults.map((r) => r.placeId);
    const { data: existing } = await supabase
      .from('saha_clinics')
      .select('google_place_id')
      .in('google_place_id', placeIds);
    const existingSet = new Set((existing ?? []).map((e: any) => e.google_place_id));
    const newCount = allResults.filter((r) => !existingSet.has(r.placeId)).length;
    const updatedCount = allResults.length - newCount;

    const nowIso = new Date().toISOString();

    // Build preview clinics list (always populated — used by dryRun + audit)
    const previewClinics: PreviewClinic[] = allResults.map((r) => {
      const { confidence, suspicious, reasons } = computeConfidence(r.name, r.types ?? []);
      return {
        place_id: r.placeId,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        address: r.address,
        phone: r.phone,
        rating: r.rating,
        user_ratings_total: r.userRatingCount,
        types: r.types ?? [],
        sources: ['google'],
        db_status: existingSet.has(r.placeId) ? 'existing' : 'new',
        confidence,
        is_suspicious: suspicious,
        suspicious_reasons: reasons,
      };
    });

    // dryRun: no DB write, return preview only
    if (isDryRun) {
      await logScan(supabase, userId, lat, lng, radiusM, provinceSlug, districtSlug ?? null, source ?? 'google', 'v2', {
        scanned: allResults.length,
        new: newCount,
        updated: updatedCount,
        filtered_out: filteredOutCount,
        google_count: allResults.length,
        grid_size: gridSizeFinal,
        grid_calls: totalCalls,
        keywords: kw,
        text_search: useText,
        dry_run: true,
        errors: collectedErrors,
      });

      return jsonResponse({
        status: 'ok',
        dry_run: true,
        scanned: allResults.length,
        new: newCount,
        updated: updatedCount,
        filtered_out: filteredOutCount,
        google_count: allResults.length,
        osm_count: 0,
        clinics: previewClinics,
        ...(filteredReasons.length > 0 ? { filtered_reasons: filteredReasons.slice(0, 15) } : {}),
        ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
      }, 200, cors);
    }

    // Filter by allowlist if provided (commit only selected place_ids)
    const resultsToUpsert = allowlist
      ? allResults.filter((r) => allowlist.has(r.placeId))
      : allResults;

    const upsertPayload = resultsToUpsert.map((r) => ({
      google_place_id: r.placeId,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      address: r.address ?? null,
      rating: r.rating ?? null,
      user_ratings_total: r.userRatingCount ?? null,
      types: r.types ?? [],
      province_slug: provinceSlug,
      district_slug: districtSlug ?? null,
      vertical_key: verticalKey,
      last_seen_at: nowIso,
      last_verified_at: nowIso,
      sources: ['google'],
      raw_payload: r.raw,
    }));

    if (upsertPayload.length === 0) {
      // Allowlist boş — kullanıcı hiçbir şey seçmedi
      await logScan(supabase, userId, lat, lng, radiusM, provinceSlug, districtSlug ?? null, source ?? 'google', 'v2', {
        scanned: allResults.length,
        new: 0,
        updated: 0,
        filtered_out: filteredOutCount,
        allowlist_applied: true,
        errors: collectedErrors,
      });
      return jsonResponse({
        status: 'ok',
        scanned: allResults.length,
        new: 0,
        updated: 0,
        filtered_out: filteredOutCount,
        clinics: [],
        ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
      }, 200, cors);
    }

    const upsertNewCount = upsertPayload.filter((p) => !existingSet.has(p.google_place_id)).length;
    const upsertUpdatedCount = upsertPayload.length - upsertNewCount;

    const { error: upsertErr } = await supabase
      .from('saha_clinics')
      .upsert(upsertPayload, { onConflict: 'google_place_id' });

    if (upsertErr) {
      return jsonResponse({
        status: 'error',
        scanned: allResults.length,
        new: 0,
        updated: 0,
        errors: [...collectedErrors, `upsert_failed_${upsertErr.message}`],
      }, 500, cors);
    }

    if (userId) {
      try {
        await supabase.from('saha_api_usage').insert({
          user_id: userId, endpoint: ENDPOINT, used_at: nowIso, count: 1,
        });
      } catch { /* yutulur */ }
    }

    await logScan(supabase, userId, lat, lng, radiusM, provinceSlug, districtSlug ?? null, source ?? 'google', 'v2', {
      scanned: allResults.length,
      new: upsertNewCount,
      updated: upsertUpdatedCount,
      filtered_out: filteredOutCount,
      google_count: allResults.length,
      grid_size: gridSizeFinal,
      grid_calls: totalCalls,
      keywords: kw,
      text_search: useText,
      allowlist_applied: allowlist !== null,
      committed: upsertPayload.length,
      errors: collectedErrors,
    });

    const committedClinics = previewClinics.filter((c) =>
      upsertPayload.some((p) => p.google_place_id === c.place_id),
    );

    return jsonResponse({
      status: 'ok',
      scanned: allResults.length,
      new: upsertNewCount,
      updated: upsertUpdatedCount,
      filtered_out: filteredOutCount,
      google_count: allResults.length,
      osm_count: 0,
      clinics: committedClinics,
      ...(filteredReasons.length > 0 ? { filtered_reasons: filteredReasons.slice(0, 15) } : {}),
      ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
    }, 200, cors);
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('clinic-scan-v2 fatal:', msg);
    return jsonResponse({ status: 'error', errors: [msg] }, 500, cors);
  }
});

function ingestResults(
  rows: any[],
  placeMap: Map<string, MappedResult>,
  centerLat: number,
  centerLng: number,
  radiusM: number,
  filter: ReturnType<typeof getFilterForVertical>,
  onFilter: (r: { name: string; reason: string }) => void,
): void {
  for (const r of rows) {
    const placeId: string | undefined = r?.place_id;
    const name: string | undefined = r?.name;
    const gLat = r?.geometry?.location?.lat;
    const gLng = r?.geometry?.location?.lng;
    if (!placeId || !name || typeof gLat !== 'number' || typeof gLng !== 'number') continue;

    // Original-center radius filter (defense against grid bleed)
    const dist = haversineM(centerLat, centerLng, gLat, gLng);
    if (dist > radiusM) continue;

    if (placeMap.has(placeId)) continue;

    const types: string[] = Array.isArray(r?.types) ? r.types : [];
    const address = typeof r?.vicinity === 'string' ? r.vicinity : (typeof r?.formatted_address === 'string' ? r.formatted_address : undefined);

    const fres: FilterResult = filter(name, types, address);
    if (!fres.valid) {
      onFilter({ name, reason: fres.reason ?? 'unknown' });
      continue;
    }

    const phone = typeof r?.formatted_phone_number === 'string'
      ? r.formatted_phone_number
      : (typeof r?.international_phone_number === 'string' ? r.international_phone_number : undefined);

    placeMap.set(placeId, {
      placeId,
      name,
      lat: gLat,
      lng: gLng,
      address,
      phone,
      rating: typeof r?.rating === 'number' ? r.rating : undefined,
      userRatingCount: typeof r?.user_ratings_total === 'number' ? r.user_ratings_total : undefined,
      types,
      raw: r,
    });
  }
}

async function logScan(
  supabase: ReturnType<typeof createClient>,
  performedBy: string | null,
  lat: number,
  lng: number,
  radiusM: number,
  provinceSlug: string,
  districtSlug: string | null,
  source: string,
  scanMode: string,
  summary: Record<string, unknown>,
): Promise<void> {
  try {
    await supabase.from('saha_clinic_scan_logs').insert({
      performed_by: performedBy,
      lat,
      lng,
      radius_m: Math.round(radiusM),
      province_slug: provinceSlug,
      district_slug: districtSlug,
      source,
      scan_mode: scanMode,
      result_summary: summary,
    });
  } catch (_e) {
    // tablo henüz yoksa veya RLS engellerse loglama atlanır — kritik değil
  }
}
