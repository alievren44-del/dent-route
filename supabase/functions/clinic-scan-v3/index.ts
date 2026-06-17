// deno-lint-ignore-file
// ============================================================================
// clinic-scan-v3 — Tarama-tamam-toplam discovery (Phase 2)
// ============================================================================
//
// Why v3 (not v2 patch)?
//   - v2: 25-noktalı grid + 9 keyword × NearbySearch (rankby=distance).
//   - v3: mahalle-aware sorgular + uzmanlık dalları + DoktorTakvimi enrich +
//     KAMU segment ayrımı + Türkçe-aware dedup + ilçe-sınır SOFT check.
//
// Akış (brief Phase 2):
//   1. CORS + auth (service_role bypass + ADMIN JWT)
//   2. Body validate (lat/lng/radiusM/provinceSlug/districtSlug mandatory)
//   3. District lookup (districts.json yan dosya)
//   4. enum-neighborhoods çağır → ilk 10 mahalle (ilçe merkezine en yakın)
//   5. buildQueries → text/nearby/specialty sorgu seti
//   6. makeGrid(intensity'e göre grid count)
//   7. Google: NearbySearch × grid × 2 keyword + TextSearch (text + specialty)
//   8. (opt) OSM clinics call
//   9. (opt) DoktorTakvimi scrape → her hekim için Google reverse-lookup
//  10. dedupClinics (Türkçe normalize + 150m haversine, earlier-wins)
//  11. filterClinicV3 → KAMU segment ayır, district_mismatch flag'le
//  12. confidence + is_suspicious
//  13. existing place_ids pre-fetch → db_status
//  14. dryRun → preview, commit → upsert
//  15. logScan (scan_mode='v3')
//
// Body params:
//   {
//     lat, lng, radiusM,
//     provinceSlug, districtSlug,           // her ikisi de mandatory
//     vertical?: 'dental',                  // default 'dental'
//     dryRun?: boolean,
//     placeIdsAllowlist?: string[],
//     source?: 'google'|'osm'|'doktor_takvimi'|'all',  // default 'all'
//     intensity?: 'standard'|'deep'|'exhaustive',       // default 'standard'
//     includeKamu?: boolean                              // default true
//   }
//
// Wall-clock guard: MAX_INVOCATION_TIME_MS = 130_000ms (150 - 20s buffer).
// Auth: ADMIN user JWT OR service_role token (verify_jwt=false at gateway).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import districtsData from './districts.json' with { type: 'json' };
import { buildQueries } from './query-builder.ts';
import { makeGrid, type GridPoint } from './grid.ts';
import { dedupClinics, normNameTr, haversineM } from './dedup.ts';
import { filterClinicV3, type Segment } from './filters-v3.ts';
import { isSpecialty } from './specialty-queries.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  // Origin'i HER ZAMAN yansıt. POST + header-auth (Authorization/apikey) API,
  // cookie/credentials yok → wildcard-eşdeğeri güvenli. ALLOWED_ORIGINS allowlist'i
  // CORS'u GATE'lemiyordu artık: native WebView (https://localhost / capacitor://
  // localhost / null) + web prod domain HEPSİ tek kodla geçer. Bu sınıf CORS bug
  // (yeni origin → "Failed to fetch") bir daha çıkmaz.
  return {
    'Access-Control-Allow-Origin': reqOrigin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const ENDPOINT = 'clinic-scan-v3';
const DAILY_LIMIT = 50; // v3 ağır — v2'den daha düşük per-user limit
const MAX_PAGES = 3;
const PAGE_TOKEN_WAIT_MS = 2500;
const INVALID_RETRY_WAIT_MS = 3000;
const CHUNK_CONCURRENCY = 6; // 3 → 6 paralel: Google rate-limit'i ile uyumlu, gateway 150s aşmasın
const CHUNK_SLEEP_MS = 100;
const PER_POINT_BIAS_RADIUS_M = 900; // brief madde 5
const MAX_INVOCATION_TIME_MS = 110_000; // Gateway hard limit 150s. 40s buffer (OSM/DT/response build).
const SUB_FETCH_HARD_CAP_MS = 30_000;   // OSM/DT call'lara kalan-zaman üst sınırı
const MAX_NEIGHBORHOODS = 10;

// ── Type defs ────────────────────────────────────────────────────────────────

type SourceMode = 'google' | 'osm' | 'doktor_takvimi' | 'all';
type Intensity = 'standard' | 'deep' | 'exhaustive';

interface CommitClinic {
  place_id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
  phone?: string | null;
  rating?: number | null;
  user_ratings_total?: number | null;
  types?: string[];
  segment?: Segment;
  sources?: string[];
}

interface ScanV3Body {
  lat: number;
  lng: number;
  radiusM: number;
  provinceSlug: string;
  districtSlug: string;
  vertical?: string;
  dryRun?: boolean;
  placeIdsAllowlist?: string[];
  /** Tarama atla, payload'ı direkt upsert et (preview commit hızlı yolu). */
  commitOnly?: boolean;
  commitClinics?: CommitClinic[];
  /** İlçe seçildiyse adresi başka ilçeye düşen sonuçları HARD reject et.
   *  Mahalle listesi varsa adres mahalle adı içeriyorsa kabul edilir. */
  strictDistrict?: boolean;
  source?: SourceMode;
  intensity?: Intensity;
  includeKamu?: boolean;
}

interface DistrictRow {
  il_plaka: number;
  il_ad: string;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus_2023: number;
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
  sources: string[]; // 'google' | 'osm' | 'doktor_takvimi'
  raw: unknown;
  segment: Segment;
  filterReason?: string;
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
  segment: Segment;
  db_status: 'new' | 'existing';
  confidence: number;
  is_suspicious: boolean;
  suspicious_reasons: string[];
  filter_reason?: string;
}

const DISTRICTS = districtsData as DistrictRow[];

// ── Utility ──────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidCoord(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function shortenMsg(msg: unknown): string {
  if (typeof msg !== 'string') return '';
  const s = msg.replace(/[\r\n]+/g, ' ').slice(0, 60);
  return s.replace(/\s+/g, '_');
}

function slugToReadable(slug: string): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map((part) => (part.length > 0 ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

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

/**
 * district-classifier mantığı (Deno port — frontend kodu import edilemez).
 * Sonuç: countTarget grid noktası (intensity'e göre çarpılır).
 */
function getGridCount(nufus: number, intensity: Intensity): number {
  const baseCount =
    nufus >= 500_000 ? 35 : nufus >= 200_000 ? 25 : nufus >= 80_000 ? 15 : nufus >= 20_000 ? 8 : 5;
  if (intensity === 'standard') return Math.max(1, Math.ceil(baseCount / 2));
  if (intensity === 'deep') return baseCount;
  if (intensity === 'exhaustive') return Math.max(baseCount, Math.ceil(baseCount * 1.4));
  return baseCount;
}

function computeConfidence(
  name: string,
  types: string[],
  segment: Segment,
): { confidence: number; suspicious: boolean; reasons: string[] } {
  const nameLc = name.toLowerCase();
  const typesLc = types.map((t) => t.toLowerCase());
  const dentalKeywords = [
    'diş',
    'dis',
    'dental',
    'dent',
    'ortodont',
    'pedodont',
    'ağız',
    'agiz',
    'çene',
    'cene',
    'oral',
    'denta',
    'implant',
    'protez',
  ];
  const hasDentalName = dentalKeywords.some((k) => nameLc.includes(k));
  const hasDentistType = typesLc.includes('dentist');
  const reasons: string[] = [];

  // KAMU klinikleri otomatik confidence 90 (kurumsal, doğrulanmış).
  if (segment === 'kamu') {
    return { confidence: 90, suspicious: false, reasons: ['kamu_segment'] };
  }

  if (hasDentistType && hasDentalName) return { confidence: 100, suspicious: false, reasons: [] };
  if (hasDentistType) return { confidence: 85, suspicious: false, reasons: [] };
  if (hasDentalName) {
    if (/^d[rt]\.?\s/.test(nameLc)) {
      reasons.push('title_prefix_only');
      return { confidence: 75, suspicious: false, reasons };
    }
    return { confidence: 80, suspicious: false, reasons: [] };
  }
  // Türkiye'de "Dt." unvanı sadece diş hekimlerine verilir → güvenilir sinyal.
  // ("Dr." farklı: genel doktor, ek dental keyword olmadan yetersiz.)
  if (/^dt\.?\s/.test(nameLc)) {
    reasons.push('dt_title_only');
    return { confidence: 80, suspicious: false, reasons };
  }
  if (
    /^dr\.?\s/.test(nameLc) &&
    typesLc.some((t) => ['doctor', 'health', 'establishment', 'point_of_interest'].includes(t))
  ) {
    reasons.push('no_dental_keyword', 'dr_title_only');
    return { confidence: 45, suspicious: true, reasons };
  }
  // Specialty pattern bonus
  if (isSpecialty(name)) {
    reasons.push('specialty_detected');
    return { confidence: 70, suspicious: false, reasons };
  }
  reasons.push('no_dental_signal');
  return { confidence: 30, suspicious: true, reasons };
}

// ── Google calls (NearbySearch + TextSearch) ─────────────────────────────────

/**
 * NearbySearch — `location + radius` mode (rankby kullanmıyoruz — radius bias).
 * Brief madde 5: per-point radius = 900m. Bu grid step (1500m) ile birlikte
 * ~~%50 overlap sağlar.
 */
async function nearbySearchByRadius(
  apiKey: string,
  lat: number,
  lng: number,
  radius: number,
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
        params.set('radius', String(Math.round(radius)));
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

/**
 * TextSearch — Türkçe sorgu metni. Lokasyon string'i kuyrukta (ilçe ismi vs).
 */
async function textSearch(
  apiKey: string,
  query: string,
): Promise<{ results: any[]; errors: string[] }> {
  const allResults: any[] = [];
  const errors: string[] = [];
  let pageToken: string | undefined;
  const tag = `text:${query.slice(0, 24).replace(/[^a-zA-Z0-9]+/g, '_')}`;

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

/**
 * Reverse-lookup for DoktorTakvimi hekim → Google place. TextSearch
 * `"<doktor_name> <ilceName>"` ile ilk match'i alıyoruz. Geri dönen ilk
 * sonuç klinik adı doktor adıyla eşleşmeyebilir — confidence düşürülür.
 */
async function reverseLookupDoctor(
  apiKey: string,
  doctorName: string,
  ilceName: string,
): Promise<{ result: any | null; errors: string[] }> {
  const q = `${doctorName} ${ilceName}`.trim();
  const { results, errors } = await textSearch(apiKey, q);
  return { result: results.length > 0 ? results[0] : null, errors };
}

// ── Result ingestion ─────────────────────────────────────────────────────────

function ingestGoogleResult(
  r: any,
  centerLat: number,
  centerLng: number,
  outerRadiusM: number,
  ilceReadable: string,
  collector: Map<string, MappedResult>,
  filteredOutCount: { v: number },
  filteredReasons: Array<{ name: string; reason: string }>,
  filterOpts: { strictDistrict: boolean; mahalleList: string[] },
  fromNearbySearch: boolean,
): void {
  const placeId: string | undefined = r?.place_id;
  const name: string | undefined = r?.name;
  const gLat = r?.geometry?.location?.lat;
  const gLng = r?.geometry?.location?.lng;
  if (!placeId || !name || typeof gLat !== 'number' || typeof gLng !== 'number') return;

  // Outer radius check — defense against TextSearch sonucu ilçe dışına çıkarsa.
  // Grid noktası bias 900m; toplam outerRadiusM ile sıkı tut.
  const dist = haversineM(centerLat, centerLng, gLat, gLng);
  if (dist > outerRadiusM) return;

  if (collector.has(placeId)) {
    // Already have it — just merge sources tag (Google'dan ikinci kez aldıysa
    // 'google' zaten var).
    return;
  }

  const types: string[] = Array.isArray(r?.types) ? r.types : [];
  const address =
    typeof r?.vicinity === 'string'
      ? r.vicinity
      : typeof r?.formatted_address === 'string'
        ? r.formatted_address
        : undefined;

  // NearbySearch zaten lat/radius bias'lı (klinik coğrafi olarak ilçeye yakın).
  // Google vicinity field'i "İstasyon, 2309. Sk." gibi kısa adres döner;
  // il/ilçe info içermez → strict mode'da false reject olur.
  // TextSearch geniş arama yapar (dünya geneli) → strict mode burada uygun.
  const fres = filterClinicV3(name, types, address, ilceReadable, {
    strictDistrict: filterOpts.strictDistrict && !fromNearbySearch,
    targetMahalleList: filterOpts.mahalleList,
  });
  if (!fres.valid) {
    filteredOutCount.v++;
    if (filteredReasons.length < 20) {
      filteredReasons.push({ name, reason: fres.reason ?? 'unknown' });
    }
    return;
  }

  const phone =
    typeof r?.formatted_phone_number === 'string'
      ? r.formatted_phone_number
      : typeof r?.international_phone_number === 'string'
        ? r.international_phone_number
        : undefined;

  collector.set(placeId, {
    placeId,
    name,
    lat: gLat,
    lng: gLng,
    address,
    phone,
    rating: typeof r?.rating === 'number' ? r.rating : undefined,
    userRatingCount: typeof r?.user_ratings_total === 'number' ? r.user_ratings_total : undefined,
    types,
    sources: ['google'],
    raw: r,
    segment: fres.segment,
    filterReason: fres.reason,
  });
}

// ── Edge Function entry ──────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));
  const t0 = Date.now();

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse(
      { status: 'error', scanned: 0, new: 0, updated: 0, errors: ['method_not_allowed'] },
      405,
      cors,
    );
  }

  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return jsonResponse({ status: 'error', errors: ['api_key_missing'] }, 500, cors);
    }

    // ── Auth ─────────────────────────────────────────────────────────────────
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
      // ADMIN + REP/SALES_REP tarama yapabilir. Rate limit (50/gün/user)
      // saha_api_usage tablosunda zaten var; manuel kullanıcı taramayı engeller.
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle();
      const role: string = ((profile as any)?.role ?? '').toUpperCase();
      const allowed = ['ADMIN', 'REP', 'SALES_REP', 'MANAGER'].includes(role);
      if (!allowed) {
        return jsonResponse({ status: 'error', errors: ['forbidden'] }, 403, cors);
      }
    }

    // ── Body parse + validate ───────────────────────────────────────────────
    let body: ScanV3Body;
    try {
      body = (await req.json()) as ScanV3Body;
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
      dryRun,
      placeIdsAllowlist,
      source,
      intensity,
      includeKamu,
    } = body || ({} as ScanV3Body);

    const isDryRun = dryRun === true;
    const allowlist: Set<string> | null =
      Array.isArray(placeIdsAllowlist) && placeIdsAllowlist.length > 0
        ? new Set(placeIdsAllowlist.filter((s) => typeof s === 'string'))
        : null;

    if (!isValidCoord(lat) || lat < -90 || lat > 90) {
      return jsonResponse({ status: 'error', errors: ['invalid_lat'] }, 400, cors);
    }
    if (!isValidCoord(lng) || lng < -180 || lng > 180) {
      return jsonResponse({ status: 'error', errors: ['invalid_lng'] }, 400, cors);
    }
    if (!isValidCoord(radiusM) || radiusM < 1 || radiusM > 50000) {
      return jsonResponse({ status: 'error', errors: ['invalid_radius'] }, 400, cors);
    }
    if (!provinceSlug || typeof provinceSlug !== 'string') {
      return jsonResponse({ status: 'error', errors: ['invalid_province_slug'] }, 400, cors);
    }
    if (!districtSlug || typeof districtSlug !== 'string') {
      return jsonResponse({ status: 'error', errors: ['invalid_district_slug'] }, 400, cors);
    }

    const verticalKey = vertical && vertical.trim() ? vertical : 'dental';
    const sourceMode: SourceMode = source ?? 'all';
    const intensityKey: Intensity = intensity ?? 'standard';
    const includeKamuFlag = includeKamu !== false; // default true

    // ── Commit-only fast path (preview "Kaydet" akışı) ──────────────────────
    // Tarama atla; client'tan gelen preview clinics'i doğrudan upsert et.
    // Gateway 150s timeout sorununu çözer: 90s scan + 30s scan = 504. Bunun
    // yerine 1-3sn'lik commit.
    if (body.commitOnly === true) {
      const commitClinics = Array.isArray(body.commitClinics) ? body.commitClinics : [];
      if (commitClinics.length === 0) {
        return jsonResponse(
          { status: 'error', errors: ['commit_clinics_empty'] },
          400,
          cors,
        );
      }
      const nowIso = new Date().toISOString();
      const upsertPayload = commitClinics
        .filter((c) => c?.place_id && !c.place_id.startsWith('osm:'))
        .filter((c) => typeof c.lat === 'number' && typeof c.lng === 'number')
        .map((c) => ({
          google_place_id: c.place_id,
          name: c.name,
          lat: c.lat,
          lng: c.lng,
          address: c.address ?? null,
          phone: c.phone ?? null,
          rating: c.rating ?? null,
          user_ratings_total: c.user_ratings_total ?? null,
          types: Array.isArray(c.types) ? c.types : [],
          province_slug: provinceSlug,
          district_slug: districtSlug,
          vertical_key: verticalKey,
          clinic_segment: c.segment ?? 'private',
          last_seen_at: nowIso,
          last_verified_at: nowIso,
        }));

      if (upsertPayload.length === 0) {
        return jsonResponse(
          { status: 'ok', scanned: 0, new: 0, updated: 0, committed: 0 },
          200,
          cors,
        );
      }

      const { data: existingRows } = await supabase
        .from('saha_clinics')
        .select('google_place_id')
        .in(
          'google_place_id',
          upsertPayload.map((p) => p.google_place_id),
        );
      const existingSetCommit = new Set(
        (existingRows ?? []).map((r: any) => r.google_place_id),
      );
      const newCount = upsertPayload.filter(
        (p) => !existingSetCommit.has(p.google_place_id),
      ).length;
      const updatedCount = upsertPayload.length - newCount;

      const { error: upsertErr } = await supabase
        .from('saha_clinics')
        .upsert(upsertPayload, { onConflict: 'google_place_id' });

      if (upsertErr) {
        return jsonResponse(
          {
            status: 'error',
            errors: [`upsert_failed_${upsertErr.message}`],
          },
          500,
          cors,
        );
      }

      await logScan(
        supabase,
        userId,
        lat,
        lng,
        radiusM,
        provinceSlug,
        districtSlug,
        sourceMode,
        'v3_commit_only',
        {
          scanned: upsertPayload.length,
          new: newCount,
          updated: updatedCount,
          committed: upsertPayload.length,
          duration_ms: Date.now() - t0,
        },
      );

      return jsonResponse(
        {
          status: 'ok',
          scanned: upsertPayload.length,
          new: newCount,
          updated: updatedCount,
          committed: upsertPayload.length,
        },
        200,
        cors,
      );
    }

    // ── Rate limit (per-user daily — service_role bypassed) ─────────────────
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
        return jsonResponse(
          { status: 'over_limit', scanned: 0, new: 0, updated: 0 },
          429,
          cors,
        );
      }
    }

    // ── District lookup ─────────────────────────────────────────────────────
    const district = findDistrict(provinceSlug, districtSlug);
    const nufus = district?.nufus_2023 ?? 50_000; // safe-default Orta-Küçük arası
    const ilceReadable = district?.ad ?? slugToReadable(districtSlug);
    const ilReadable = district?.il_ad ?? slugToReadable(provinceSlug);
    const gridCount = getGridCount(nufus, intensityKey);

    const collectedErrors: string[] = [];
    if (!district) collectedErrors.push('district_not_found_in_json_fallback_default');

    // ── Mahalle yükle ───────────────────────────────────────────────────────
    let neighborhoodNames: string[] = [];
    try {
      const nResp = await fetch(`${SUPABASE_URL}/functions/v1/enum-neighborhoods`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({ provinceSlug, districtSlug }),
      });
      if (nResp.ok) {
        const nJson: any = await nResp.json();
        const items: Array<{ name: string; lat: number | null; lng: number | null }> = Array.isArray(
          nJson?.neighborhoods,
        )
          ? nJson.neighborhoods
          : [];
        // İlçe merkezine en yakın MAX_NEIGHBORHOODS mahalle.
        const ranked = items
          .map((n) => ({
            name: n.name,
            lat: n.lat,
            lng: n.lng,
            d:
              typeof n.lat === 'number' && typeof n.lng === 'number'
                ? haversineM(lat, lng, n.lat, n.lng)
                : Number.MAX_SAFE_INTEGER,
          }))
          .sort((a, b) => a.d - b.d)
          .slice(0, MAX_NEIGHBORHOODS);
        neighborhoodNames = ranked.map((n) => n.name);
      } else {
        collectedErrors.push(`enum_neighborhoods_http_${nResp.status}`);
      }
    } catch (e) {
      collectedErrors.push(`enum_neighborhoods_fetch_${(e as Error)?.message ?? 'unknown'}`);
    }

    // ── Query set ───────────────────────────────────────────────────────────
    const qSet = buildQueries({
      ilceName: ilceReadable,
      ilName: ilReadable,
      neighborhoods: neighborhoodNames,
    });

    // ── Grid noktaları ──────────────────────────────────────────────────────
    const grid: GridPoint[] = makeGrid(lat, lng, radiusM, gridCount);

    collectedErrors.push(`intensity:${intensityKey}`);
    collectedErrors.push(`grid_count:${grid.length}`);
    collectedErrors.push(`neighborhoods:${neighborhoodNames.length}`);
    collectedErrors.push(`queries_text:${qSet.text.length}`);
    collectedErrors.push(`queries_specialty:${qSet.specialty.length}`);

    // Filter options — strictDistrict + mahalle list filter v3'e geçirilir.
    // strictDistrict default false; ClinicScanPage'da il+ilçe seçilince true
    // gönderilir → adresi başka ilçeyi gösteren sonuçlar HARD reject.
    const filterOpts = {
      strictDistrict: body?.strictDistrict === true,
      mahalleList: neighborhoodNames.map((n) => n.toLowerCase()),
    };
    collectedErrors.push(`strict_district:${filterOpts.strictDistrict}`);

    // ── Google task list ────────────────────────────────────────────────────
    const collector = new Map<string, MappedResult>();
    const filteredOutCount = { v: 0 };
    const filteredReasons: Array<{ name: string; reason: string }> = [];

    const wantsGoogle = sourceMode === 'all' || sourceMode === 'google';
    const wantsOsm = sourceMode === 'all' || sourceMode === 'osm';
    const wantsDoktorTakvimi = sourceMode === 'all' || sourceMode === 'doktor_takvimi';

    let googleCount = 0;
    let osmCount = 0;
    let doktorTakvimiCount = 0;

    if (wantsGoogle) {
      // 1. NearbySearch per grid point × 2 nearby keyword
      // 2. TextSearch text[] (merkez bazlı, sorgu içinde lokasyon string'i)
      // 3. TextSearch specialty[]
      type TaskResult = { results: any[]; errors: string[]; fromNearbySearch: boolean };
      type Task = () => Promise<TaskResult>;
      const tasks: Task[] = [];

      for (const point of grid) {
        for (const kw of qSet.nearby) {
          tasks.push(async () => {
            const r = await nearbySearchByRadius(GOOGLE_PLACES_API_KEY!, point.lat, point.lng, PER_POINT_BIAS_RADIUS_M, {
              keyword: kw,
            });
            return { ...r, fromNearbySearch: true };
          });
        }
        // Bonus: type=dentist per point (yüksek-yatırımlı sonuç)
        tasks.push(async () => {
          const r = await nearbySearchByRadius(GOOGLE_PLACES_API_KEY!, point.lat, point.lng, PER_POINT_BIAS_RADIUS_M, {
            type: 'dentist',
          });
          return { ...r, fromNearbySearch: true };
        });
      }

      for (const q of qSet.text) tasks.push(async () => {
        const r = await textSearch(GOOGLE_PLACES_API_KEY!, q);
        return { ...r, fromNearbySearch: false };
      });
      for (const q of qSet.specialty) tasks.push(async () => {
        const r = await textSearch(GOOGLE_PLACES_API_KEY!, q);
        return { ...r, fromNearbySearch: false };
      });

      // Outer radius — TextSearch sonucu ilçe dışına çıkmasın diye sıkı tut.
      // Grid yarıçapı yaklaşık (grid_count^0.5)/2 × 1500m + bias 900m. Min: radiusM.
      const sideHalf = Math.ceil(Math.sqrt(grid.length)) / 2;
      const outerRadiusM = Math.max(radiusM, sideHalf * 1500 + PER_POINT_BIAS_RADIUS_M);

      for (let i = 0; i < tasks.length; i += CHUNK_CONCURRENCY) {
        if (Date.now() - t0 > MAX_INVOCATION_TIME_MS) {
          collectedErrors.push('wall_clock_timeout');
          break;
        }
        if (i > 0) await sleep(CHUNK_SLEEP_MS);
        const slice = tasks.slice(i, i + CHUNK_CONCURRENCY);
        const settled = await Promise.allSettled(slice.map((t) => t()));
        for (const s of settled) {
          if (s.status !== 'fulfilled') {
            collectedErrors.push(`task_failed_${(s.reason as Error)?.message ?? 'unknown'}`);
            continue;
          }
          collectedErrors.push(...s.value.errors);
          for (const r of s.value.results) {
            ingestGoogleResult(r, lat, lng, outerRadiusM, ilceReadable, collector, filteredOutCount, filteredReasons, filterOpts, s.value.fromNearbySearch);
          }
        }
      }
      googleCount = collector.size;
    }

    // ── OSM add-on ──────────────────────────────────────────────────────────
    if (wantsOsm && Date.now() - t0 < MAX_INVOCATION_TIME_MS) {
      const remaining = MAX_INVOCATION_TIME_MS - (Date.now() - t0);
      const osmBudget = Math.min(SUB_FETCH_HARD_CAP_MS, Math.max(5_000, remaining - 10_000));
      const osmCtrl = new AbortController();
      const osmTimer = setTimeout(() => osmCtrl.abort(), osmBudget);
      try {
        const osmResp = await fetch(`${SUPABASE_URL}/functions/v1/osm-search`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ lat, lng, radiusM, verticalKey, mode: 'clinics' }),
          signal: osmCtrl.signal,
        });
        if (osmResp.ok) {
          const osmJson: any = await osmResp.json();
          if (Array.isArray(osmJson?.results)) {
            for (const o of osmJson.results) {
              if (!o?.osm_id || !o?.name) continue;
              if (typeof o.lat !== 'number' || typeof o.lng !== 'number') continue;
              const dist = haversineM(lat, lng, o.lat, o.lng);
              if (dist > radiusM) continue;
              // OSM key: osm_id (synthetic, place_id namespace ile çakışmaz).
              const key = `osm:${o.osm_id}`;
              if (collector.has(key)) continue;
              const fres = filterClinicV3(o.name, Array.isArray(o.types) ? o.types : [], o.address, ilceReadable, {
                strictDistrict: filterOpts.strictDistrict,
                targetMahalleList: filterOpts.mahalleList,
              });
              if (!fres.valid) {
                filteredOutCount.v++;
                if (filteredReasons.length < 20) {
                  filteredReasons.push({ name: o.name, reason: fres.reason ?? 'unknown' });
                }
                continue;
              }
              collector.set(key, {
                placeId: key,
                name: o.name,
                lat: o.lat,
                lng: o.lng,
                address: o.address ?? undefined,
                phone: o.phone ?? undefined,
                rating: undefined,
                userRatingCount: undefined,
                types: Array.isArray(o.types) ? o.types : [],
                sources: ['osm'],
                raw: o,
                segment: fres.segment,
                filterReason: fres.reason,
              });
              osmCount++;
            }
          }
        } else {
          collectedErrors.push(`osm_http_${osmResp.status}`);
        }
      } catch (e) {
        const m = (e as Error)?.message ?? 'unknown';
        collectedErrors.push(`osm_fetch_${m}`);
      } finally {
        clearTimeout(osmTimer);
      }
    }

    // ── DoktorTakvimi enrich ────────────────────────────────────────────────
    if (wantsDoktorTakvimi && Date.now() - t0 < MAX_INVOCATION_TIME_MS) {
      const remaining = MAX_INVOCATION_TIME_MS - (Date.now() - t0);
      const dtBudget = Math.min(SUB_FETCH_HARD_CAP_MS, Math.max(5_000, remaining - 5_000));
      const dtCtrl = new AbortController();
      const dtTimer = setTimeout(() => dtCtrl.abort(), dtBudget);
      try {
        const dtResp = await fetch(`${SUPABASE_URL}/functions/v1/doktor-takvimi-scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ provinceSlug, districtSlug }),
          signal: dtCtrl.signal,
        });
        if (dtResp.ok) {
          const dtJson: any = await dtResp.json();
          const doctors: Array<{
            name: string;
            clinic_name?: string;
            address_hint?: string;
            neighborhood?: string;
            phone?: string;
            specialty?: string;
            rating?: number;
            review_count?: number;
            source_url?: string;
          }> = Array.isArray(dtJson?.doctors) ? dtJson.doctors : [];

          // Wall-clock budget: doktor başına bir TextSearch = ~1-3sn. Maks 15 doktor reverse.
          const MAX_REVERSE = 15;
          const slice = doctors.slice(0, MAX_REVERSE);

          for (const doc of slice) {
            if (Date.now() - t0 > MAX_INVOCATION_TIME_MS) {
              collectedErrors.push('wall_clock_timeout_during_doktor_takvimi');
              break;
            }
            if (!doc?.name) continue;
            try {
              const { result: g, errors: revErrs } = await reverseLookupDoctor(
                GOOGLE_PLACES_API_KEY!,
                doc.name,
                ilceReadable,
              );
              collectedErrors.push(...revErrs);
              if (!g?.place_id) {
                // Google'da YOK → DT-only kayıt (Milimetrik gibi Google-görünmez
                // klinikler). v5: koordinat yok → ilçe-merkez (scan center) + düşük
                // güven, rep doğrular. Sentetik `dt:` key → google_place_id UNIQUE
                // onConflict ile re-scan'de dedupe; gerçek Google verisini kirletmez.
                const dtName = doc.clinic_name ?? doc.name;
                const dtFres = filterClinicV3(dtName, ['dentist'], doc.address_hint, ilceReadable, {
                  strictDistrict: filterOpts.strictDistrict,
                  targetMahalleList: filterOpts.mahalleList,
                });
                if (!dtFres.valid) {
                  filteredOutCount.v++;
                  continue;
                }
                const dtKey = `dt:${doc.source_url || dtName}`;
                if (!collector.has(dtKey)) {
                  // Gerçek koordinat: adres_hint varsa textSearch ile geocode et.
                  // Başarısız → scan-center fallback (koordinatsız kayda tercih).
                  let dtLat = lat, dtLng = lng;
                  let dtReason = 'dt_only_approx_location';
                  if (typeof doc.address_hint === 'string' && doc.address_hint.trim().length > 0) {
                    try {
                      const { results: geoRes, errors: geoErrs } = await textSearch(
                        GOOGLE_PLACES_API_KEY!,
                        `${doc.address_hint}, ${ilceReadable}`,
                      );
                      collectedErrors.push(...geoErrs);
                      const gp = geoRes?.[0]?.geometry?.location;
                      if (
                        typeof gp?.lat === 'number' &&
                        typeof gp?.lng === 'number' &&
                        haversineM(lat, lng, gp.lat, gp.lng) <= radiusM * 1.5
                      ) {
                        dtLat = gp.lat;
                        dtLng = gp.lng;
                        dtReason = 'dt_only_geocoded';
                      }
                    } catch (_geoErr) {
                      collectedErrors.push('dt_geocode_failed');
                    }
                  }
                  collector.set(dtKey, {
                    placeId: dtKey,
                    name: dtName,
                    lat: dtLat,
                    lng: dtLng,
                    address: doc.address_hint,
                    phone: doc.phone,
                    rating: typeof doc.rating === 'number' ? doc.rating : undefined,
                    userRatingCount:
                      typeof doc.review_count === 'number' ? doc.review_count : undefined,
                    types: ['dentist'],
                    sources: ['doktor_takvimi'],
                    raw: { doktor_takvimi: doc },
                    segment: dtFres.segment,
                    filterReason: dtReason,
                  });
                  doktorTakvimiCount++;
                }
                continue;
              }
              const gLat = g?.geometry?.location?.lat;
              const gLng = g?.geometry?.location?.lng;
              if (typeof gLat !== 'number' || typeof gLng !== 'number') continue;
              const dist = haversineM(lat, lng, gLat, gLng);
              if (dist > radiusM * 1.5) continue; // ilçe dışı

              const existing = collector.get(g.place_id);
              if (existing) {
                // Merge sources + phone enrich
                if (!existing.sources.includes('doktor_takvimi')) {
                  existing.sources.push('doktor_takvimi');
                }
                if (!existing.phone && doc.phone) existing.phone = doc.phone;
                doktorTakvimiCount++;
                continue;
              }
              const types: string[] = Array.isArray(g?.types) ? g.types : [];
              const address =
                typeof g?.formatted_address === 'string' ? g.formatted_address : doc.address_hint;
              const fres = filterClinicV3(g.name, types, address, ilceReadable, {
                strictDistrict: filterOpts.strictDistrict,
                targetMahalleList: filterOpts.mahalleList,
              });
              if (!fres.valid) {
                filteredOutCount.v++;
                if (filteredReasons.length < 20) {
                  filteredReasons.push({ name: g.name ?? doc.name, reason: fres.reason ?? 'unknown' });
                }
                continue;
              }
              collector.set(g.place_id, {
                placeId: g.place_id,
                name: g.name ?? doc.clinic_name ?? doc.name,
                lat: gLat,
                lng: gLng,
                address,
                phone: doc.phone,
                rating: typeof g?.rating === 'number' ? g.rating : undefined,
                userRatingCount:
                  typeof g?.user_ratings_total === 'number' ? g.user_ratings_total : undefined,
                types,
                sources: ['doktor_takvimi', 'google'],
                raw: { google: g, doktor_takvimi: doc },
                segment: fres.segment,
                filterReason: fres.reason,
              });
              doktorTakvimiCount++;
            } catch (e) {
              collectedErrors.push(`dt_reverse_${(e as Error)?.message ?? 'unknown'}`);
            }
          }
        } else {
          collectedErrors.push(`doktor_takvimi_http_${dtResp.status}`);
        }
      } catch (e) {
        collectedErrors.push(`doktor_takvimi_fetch_${(e as Error)?.message ?? 'unknown'}`);
      } finally {
        clearTimeout(dtTimer);
      }
    }

    // ── Dedup (Türkçe normalize + 150m haversine) ───────────────────────────
    const beforeDedup = Array.from(collector.values());
    const deduped = dedupClinics(
      beforeDedup.map((r) => ({ key: r.placeId, name: r.name, lat: r.lat, lng: r.lng, _ref: r })),
    ) as Array<{ key: string; name: string; lat: number; lng: number; _ref: MappedResult }>;
    const allResults = deduped.map((d) => d._ref);
    collectedErrors.push(`dedup_dropped:${beforeDedup.length - allResults.length}`);

    // KAMU filter — includeKamu=false ise KAMU klinikleri çıkar
    const visibleResults = includeKamuFlag
      ? allResults
      : allResults.filter((r) => r.segment !== 'kamu');
    const kamuCount = allResults.filter((r) => r.segment === 'kamu').length;

    if (visibleResults.length === 0) {
      await logScan(
        supabase,
        userId,
        lat,
        lng,
        radiusM,
        provinceSlug,
        districtSlug,
        sourceMode,
        'v3',
        {
          scanned: 0,
          new: 0,
          updated: 0,
          filtered_out: filteredOutCount.v,
          google_count: googleCount,
          osm_count: osmCount,
          doktor_takvimi_count: doktorTakvimiCount,
          kamu_count: kamuCount,
          dry_run: isDryRun,
          intensity: intensityKey,
          grid_count: grid.length,
          errors: collectedErrors,
          duration_ms: Date.now() - t0,
        },
      );
      return jsonResponse(
        {
          status: 'ok',
          scanned: 0,
          new: 0,
          updated: 0,
          filtered_out: filteredOutCount.v,
          google_count: googleCount,
          osm_count: osmCount,
          doktor_takvimi_count: doktorTakvimiCount,
          kamu_count: kamuCount,
          clinics: [],
          ...(filteredReasons.length > 0 ? { filtered_reasons: filteredReasons.slice(0, 20) } : {}),
          ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
        },
        200,
        cors,
      );
    }

    // ── Hybrid existing-match: place_id + name/coord ────────────────────────
    // Excel import edilen klinikler google_place_id NULL ile yatıyor. Sadece
    // place_id eşleşmesi yapılırsa orphan satırlar tekrar 'new' olarak çıkar.
    // Çözüm: aynı province+district'taki tüm kayıtları çek, name normalize +
    // haversine <200m ile eşleştir. Match olan orphan satırlar bulunan place_id
    // ile UPDATE edilir → sonraki taramalarda 'existing'.
    const googlePlaceIds = visibleResults
      .filter((r) => !r.placeId.startsWith('osm:'))
      .map((r) => r.placeId);

    // Fetch existing clinics for this district — two passes:
    //   Pass A: same province + same district_slug (exact match rows)
    //   Pass B: same province + district_slug IS NULL (Excel/Milimetrik merge rows
    //           that haven't been assigned a district yet; ~23.9% of saha_clinics)
    // Both passes are needed: Pass B rows are invisible to .eq('district_slug',...)
    // because Postgres .eq filters out NULLs (NULL ≠ 'ankara' is true, but also
    // NULL ≠ NULL is not false — the filter simply excludes nulls).
    const [{ data: districtClinicsExact }, { data: districtClinicsNullSlug }] = await Promise.all([
      supabase
        .from('saha_clinics')
        .select('id, google_place_id, name, lat, lng')
        .eq('province_slug', provinceSlug)
        .eq('district_slug', districtSlug),
      supabase
        .from('saha_clinics')
        .select('id, google_place_id, name, lat, lng')
        .eq('province_slug', provinceSlug)
        .is('district_slug', null),
    ]);
    // Merge both result sets; deduplicate by id so a row can't double-count.
    const seenIds = new Set<string>();
    const districtClinics: Array<{ id: string; google_place_id: string | null; name: string; lat: number; lng: number }> = [];
    for (const row of [...(districtClinicsExact ?? []), ...(districtClinicsNullSlug ?? [])]) {
      if (row && !seenIds.has(row.id)) {
        seenIds.add(row.id);
        districtClinics.push(row);
      }
    }
    collectedErrors.push(`district_lookup:exact=${districtClinicsExact?.length ?? 0},null_slug=${districtClinicsNullSlug?.length ?? 0}`);

    const existingSet = new Set<string>();
    const orphanUpdates: Array<{ id: string; place_id: string }> = [];

    if (districtClinics.length > 0) {
      // 1) Doğrudan place_id match
      for (const r of districtClinics) {
        if (r.google_place_id && googlePlaceIds.includes(r.google_place_id)) {
          existingSet.add(r.google_place_id);
        }
      }
      // 2) name + coord match (orphan rows, place_id NULL)
      //
      // İki tier:
      //   T1: full normalized-name equality → distance-bağımsız high-confidence match.
      //       "Mevadent ADSP" (Excel) ↔ "Mevadent Ağız Diş Sağlığı" (Google) tam
      //       eşit değil → bu tier sadece kesin eşitliği yakalar.
      //
      //   T2: 10-char normalized prefix eşit + haversine ≤ 250m.
      //       10 char (eski 6'dan uzatıldı): district içinde ilk 6 char çakışması
      //       yüksek ("ankara", "izmir", "dental" gibi ortak prefix'ler). 10 char
      //       ile "mevadenta" ↔ "mevadenta" eşleşir ama "ankaradis" ↔ "ankaraag"
      //       eşleşmez.
      //       Mesafe 250m (eski 200m): Excel geocode'u bazen 100-200m kayabilir;
      //       250m farklı klinikleri birleştirmez ama kayık geocode'u kapsar.
      //
      //   T3: her iki normalize-isim ≥ 5 char AND biri diğerinin içinde + ≤ 150m.
      //       "Milimetrik" ↔ "Milimetrik Dental Poliklinik" gibi kısa-prefix durumu.
      const PFX2 = 10; // T2 prefix uzunluğu
      const DIST_T2 = 250; // T2 max mesafe (m)
      const DIST_T3 = 150; // T3 max mesafe (m)
      const MIN_CONTAIN = 5; // T3 minimum token uzunluğu

      const orphans = districtClinics.filter((c) => !c.google_place_id);
      for (const result of visibleResults) {
        if (result.placeId.startsWith('osm:')) continue;
        if (existingSet.has(result.placeId)) continue;
        const rNormFull = normNameTr(result.name);
        if (!rNormFull) continue;
        const rNormPfx = rNormFull.slice(0, PFX2);
        let matched = false;

        for (const orph of orphans) {
          const cNormFull = normNameTr(String(orph.name ?? ''));
          if (!cNormFull) continue;

          // T1: full normalized-name equality (highest confidence, no distance needed)
          if (cNormFull === rNormFull) {
            matched = true;
          }

          // T2: 10-char prefix equality + ≤ 250m
          if (!matched) {
            const cNormPfx = cNormFull.slice(0, PFX2);
            if (
              cNormPfx.length >= PFX2 &&
              rNormPfx.length >= PFX2 &&
              cNormPfx === rNormPfx
            ) {
              const d = haversineM(orph.lat, orph.lng, result.lat, result.lng);
              if (d <= DIST_T2) matched = true;
            }
          }

          // T3: containment + ≤ 150m (catches "Milimetrik" ↔ "Milimetrik Dental Pol.")
          if (!matched) {
            if (
              cNormFull.length >= MIN_CONTAIN &&
              rNormFull.length >= MIN_CONTAIN &&
              (cNormFull.includes(rNormFull) || rNormFull.includes(cNormFull))
            ) {
              const d = haversineM(orph.lat, orph.lng, result.lat, result.lng);
              if (d <= DIST_T3) matched = true;
            }
          }

          if (matched) {
            existingSet.add(result.placeId);
            orphanUpdates.push({ id: orph.id, place_id: result.placeId });
            break;
          }
        }
      }
    }

    // Orphan satırlara place_id yaz → sonraki taramada direct match.
    for (const u of orphanUpdates) {
      try {
        await supabase
          .from('saha_clinics')
          .update({ google_place_id: u.place_id, updated_at: new Date().toISOString() })
          .eq('id', u.id);
      } catch {
        /* yutulur: place_id çakışması olursa eski satır olduğu gibi kalır */
      }
    }
    collectedErrors.push(`orphan_matched:${orphanUpdates.length}`);

    const newCount = visibleResults.filter((r) => !existingSet.has(r.placeId)).length;
    const updatedCount = visibleResults.length - newCount;

    const nowIso = new Date().toISOString();

    // ── Build preview clinics ───────────────────────────────────────────────
    const previewClinics: PreviewClinic[] = visibleResults.map((r) => {
      const { confidence, suspicious, reasons } = computeConfidence(r.name, r.types, r.segment);
      const out: PreviewClinic = {
        place_id: r.placeId,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        address: r.address,
        phone: r.phone,
        rating: r.rating,
        user_ratings_total: r.userRatingCount,
        types: r.types,
        sources: r.sources,
        segment: r.segment,
        db_status: existingSet.has(r.placeId) ? 'existing' : 'new',
        confidence,
        is_suspicious: suspicious,
        suspicious_reasons: reasons,
      };
      if (r.filterReason) out.filter_reason = r.filterReason;
      return out;
    });

    // ── dryRun: skip upsert ─────────────────────────────────────────────────
    if (isDryRun) {
      await logScan(
        supabase,
        userId,
        lat,
        lng,
        radiusM,
        provinceSlug,
        districtSlug,
        sourceMode,
        'v3',
        {
          scanned: visibleResults.length,
          new: newCount,
          updated: updatedCount,
          filtered_out: filteredOutCount.v,
          google_count: googleCount,
          osm_count: osmCount,
          doktor_takvimi_count: doktorTakvimiCount,
          kamu_count: kamuCount,
          dry_run: true,
          intensity: intensityKey,
          grid_count: grid.length,
          neighborhoods: neighborhoodNames.length,
          errors: collectedErrors,
          duration_ms: Date.now() - t0,
        },
      );

      return jsonResponse(
        {
          status: 'ok',
          dry_run: true,
          scanned: visibleResults.length,
          new: newCount,
          updated: updatedCount,
          filtered_out: filteredOutCount.v,
          google_count: googleCount,
          osm_count: osmCount,
          doktor_takvimi_count: doktorTakvimiCount,
          kamu_count: kamuCount,
          clinics: previewClinics,
          ...(filteredReasons.length > 0 ? { filtered_reasons: filteredReasons.slice(0, 20) } : {}),
          ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
        },
        200,
        cors,
      );
    }

    // ── Commit: allowlist filter + upsert ───────────────────────────────────
    const upsertSource = allowlist
      ? visibleResults.filter((r) => allowlist.has(r.placeId))
      : visibleResults;

    // saha_clinics tablosu google_place_id UNIQUE — OSM-only kayıtları (osm:…)
    // şu an clinic-scan v1/v2'de de upsert edilmiyor (v2 source merge yapmıyor).
    // v3 de aynı yaklaşımı izliyor: sadece google place_id olan kayıtları yazıyoruz.
    // OSM-only kayıtlar preview'da görünür ama DB'ye yazılmaz (UI ayrı OSM tablosu
    // gerekirse ileride eklenir).
    const upsertPayload = upsertSource
      .filter((r) => !r.placeId.startsWith('osm:'))
      .map((r) => ({
        google_place_id: r.placeId,
        name: r.name,
        lat: r.lat,
        lng: r.lng,
        address: r.address ?? null,
        phone: r.phone ?? null,
        rating: r.rating ?? null,
        user_ratings_total: r.userRatingCount ?? null,
        types: r.types ?? [],
        province_slug: provinceSlug,
        district_slug: districtSlug,
        vertical_key: verticalKey,
        clinic_segment: r.segment, // ← v3 yeni kolon
        last_seen_at: nowIso,
        last_verified_at: nowIso,
        raw_payload: r.raw,
      }));

    if (upsertPayload.length === 0) {
      await logScan(
        supabase,
        userId,
        lat,
        lng,
        radiusM,
        provinceSlug,
        districtSlug,
        sourceMode,
        'v3',
        {
          scanned: visibleResults.length,
          new: 0,
          updated: 0,
          filtered_out: filteredOutCount.v,
          google_count: googleCount,
          osm_count: osmCount,
          doktor_takvimi_count: doktorTakvimiCount,
          kamu_count: kamuCount,
          allowlist_applied: allowlist !== null,
          intensity: intensityKey,
          errors: collectedErrors,
          duration_ms: Date.now() - t0,
        },
      );
      return jsonResponse(
        {
          status: 'ok',
          scanned: visibleResults.length,
          new: 0,
          updated: 0,
          filtered_out: filteredOutCount.v,
          google_count: googleCount,
          osm_count: osmCount,
          doktor_takvimi_count: doktorTakvimiCount,
          kamu_count: kamuCount,
          clinics: [],
          ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
        },
        200,
        cors,
      );
    }

    const upsertNewCount = upsertPayload.filter((p) => !existingSet.has(p.google_place_id)).length;
    const upsertUpdatedCount = upsertPayload.length - upsertNewCount;

    const { error: upsertErr } = await supabase
      .from('saha_clinics')
      .upsert(upsertPayload, { onConflict: 'google_place_id' });

    if (upsertErr) {
      return jsonResponse(
        {
          status: 'error',
          scanned: visibleResults.length,
          new: 0,
          updated: 0,
          errors: [...collectedErrors, `upsert_failed_${upsertErr.message}`],
        },
        500,
        cors,
      );
    }

    if (userId) {
      try {
        await supabase.from('saha_api_usage').insert({
          user_id: userId,
          endpoint: ENDPOINT,
          used_at: nowIso,
          count: 1,
        });
      } catch {
        // yutulur
      }
    }

    await logScan(
      supabase,
      userId,
      lat,
      lng,
      radiusM,
      provinceSlug,
      districtSlug,
      sourceMode,
      'v3',
      {
        scanned: visibleResults.length,
        new: upsertNewCount,
        updated: upsertUpdatedCount,
        filtered_out: filteredOutCount.v,
        google_count: googleCount,
        osm_count: osmCount,
        doktor_takvimi_count: doktorTakvimiCount,
        kamu_count: kamuCount,
        intensity: intensityKey,
        grid_count: grid.length,
        neighborhoods: neighborhoodNames.length,
        allowlist_applied: allowlist !== null,
        committed: upsertPayload.length,
        errors: collectedErrors,
        duration_ms: Date.now() - t0,
      },
    );

    const committedSet = new Set(upsertPayload.map((p) => p.google_place_id));
    const committedClinics = previewClinics.filter((c) => committedSet.has(c.place_id));

    return jsonResponse(
      {
        status: 'ok',
        scanned: visibleResults.length,
        new: upsertNewCount,
        updated: upsertUpdatedCount,
        filtered_out: filteredOutCount.v,
        google_count: googleCount,
        osm_count: osmCount,
        doktor_takvimi_count: doktorTakvimiCount,
        kamu_count: kamuCount,
        clinics: committedClinics,
        ...(filteredReasons.length > 0 ? { filtered_reasons: filteredReasons.slice(0, 20) } : {}),
        ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
      },
      200,
      cors,
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('clinic-scan-v3 fatal:', msg);
    return jsonResponse({ status: 'error', errors: [msg] }, 500, cors);
  }
});

// Loose-typed param: createClient returns SupabaseClient<any,"public",any> but
// the generic export type is SupabaseClient<unknown,never,GenericSchema>. We
// only call .from() so a structural escape hatch is fine — same trade-off as v2.
async function logScan(
  // deno-lint-ignore no-explicit-any
  supabase: any,
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
    // tablo yoksa veya RLS engellerse loglama atlanır — kritik değil
  }
}
