// deno-lint-ignore-file
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const allowed = reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
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
const PAGE_TOKEN_WAIT_MS = 2000;

interface ScanBody {
  lat: number;
  lng: number;
  radiusM: number;
  provinceSlug: string;
  districtSlug?: string;
  vertical?: string;
  types?: string[];
}

interface MappedResult {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  rating?: number;
  userRatingCount?: number;
  types: string[];
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

async function fetchPlacesForType(
  apiKey: string,
  lat: number,
  lng: number,
  type: string,
): Promise<{ results: any[]; errors: string[] }> {
  const allResults: any[] = [];
  const errors: string[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    if (pageToken) {
      params.set('pagetoken', pageToken);
      params.set('key', apiKey);
    } else {
      params.set('location', `${lat},${lng}`);
      params.set('rankby', 'distance');
      params.set('type', type);
      params.set('key', apiKey);
    }

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      errors.push(`google_http_${resp.status}_type_${type}`);
      break;
    }
    const json: any = await resp.json();
    const gStatus: string = json?.status ?? 'UNKNOWN';

    if (gStatus === 'OVER_QUERY_LIMIT') {
      errors.push('over_query_limit');
      break;
    }
    if (gStatus !== 'OK' && gStatus !== 'ZERO_RESULTS') {
      errors.push(`google_${gStatus.toLowerCase()}_type_${type}`);
      break;
    }

    const pageResults: any[] = Array.isArray(json?.results) ? json.results : [];
    allResults.push(...pageResults);

    pageToken = typeof json?.next_page_token === 'string' ? json.next_page_token : undefined;
    if (!pageToken) break;
    await sleep(PAGE_TOKEN_WAIT_MS);
  }

  return { results: allResults, errors };
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
    if (!GOOGLE_PLACES_API_KEY) {
      console.error('GOOGLE_PLACES_API_KEY missing');
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['api_key_missing'] }, 500, cors);
    }

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['unauthorized'] }, 401, cors);
    }
    const token = authHeader.slice(7).trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_token'] }, 401, cors);
    }
    const userId = userData.user.id;

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

    let body: ScanBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', scanned: 0, new: 0, updated: 0, errors: ['invalid_json'] }, 400, cors);
    }

    const { lat, lng, radiusM, provinceSlug, districtSlug, vertical, types } = body || ({} as ScanBody);

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

    const scanTypes: string[] = types && types.length > 0 ? types : ['dentist'];
    const verticalKey: string = vertical && vertical.trim().length > 0 ? vertical : 'dental';

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

    // Multi-type loop with pagination
    const collectedErrors: string[] = [];
    const dedupMap = new Map<string, MappedResult>();

    for (const t of scanTypes) {
      if (typeof t !== 'string' || t.trim().length === 0) continue;
      const { results: rawPage, errors: pageErrs } = await fetchPlacesForType(
        GOOGLE_PLACES_API_KEY,
        lat,
        lng,
        t.trim(),
      );
      collectedErrors.push(...pageErrs);

      for (const r of rawPage) {
        const placeId: string | undefined = r?.place_id;
        const name: string | undefined = r?.name;
        const gLat = r?.geometry?.location?.lat;
        const gLng = r?.geometry?.location?.lng;
        if (!placeId || !name || typeof gLat !== 'number' || typeof gLng !== 'number') continue;

        // Client-side radius filter (rankby=distance ignores radius)
        const dist = haversineM(lat, lng, gLat, gLng);
        if (dist > radiusM) continue;

        if (dedupMap.has(placeId)) continue;

        dedupMap.set(placeId, {
          placeId,
          name,
          lat: gLat,
          lng: gLng,
          address: typeof r?.vicinity === 'string' ? r.vicinity : undefined,
          rating: typeof r?.rating === 'number' ? r.rating : undefined,
          userRatingCount: typeof r?.user_ratings_total === 'number' ? r.user_ratings_total : undefined,
          types: Array.isArray(r?.types) ? r.types : [],
          raw: r,
        });
      }
    }

    const results: MappedResult[] = Array.from(dedupMap.values());

    if (results.length === 0) {
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
          ...(collectedErrors.length > 0 ? { errors: collectedErrors } : {}),
        },
        200,
        cors,
      );
    }

    // Pre-fetch existing google_place_ids for new vs updated split
    const placeIds = results.map((r) => r.placeId);
    const { data: existing, error: existingErr } = await supabase
      .from('saha_clinics')
      .select('google_place_id')
      .in('google_place_id', placeIds);

    if (existingErr) {
      console.error('existing fetch error:', existingErr.message);
      collectedErrors.push('existing_fetch_failed');
    }
    const existingSet = new Set((existing ?? []).map((e: any) => e.google_place_id));
    const newCount = results.filter((r) => !existingSet.has(r.placeId)).length;
    const updatedCount = results.length - newCount;

    // Upsert into saha_clinics
    const nowIso = new Date().toISOString();
    const upsertPayload = results.map((r) => ({
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
      raw_payload: r.raw,
    }));

    const { error: upsertErr } = await supabase
      .from('saha_clinics')
      .upsert(upsertPayload, { onConflict: 'google_place_id' });

    if (upsertErr) {
      console.error('upsert error:', upsertErr.message);
      return jsonResponse(
        {
          status: 'error',
          scanned: results.length,
          new: 0,
          updated: 0,
          errors: [...collectedErrors, `upsert_failed_${upsertErr.message}`],
        },
        500,
        cors,
      );
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
        scanned: results.length,
        new: newCount,
        updated: updatedCount,
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
