// deno-lint-ignore-file
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY');

// CORS origin whitelist â€” comma-separated, e.g.
//   "https://saha.parla.com,https://app.parla.com,http://localhost:5173"
// Production'da ALLOWED_ORIGINS env'i mutlaka set edilmeli.
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

const ENDPOINT = 'google-places-search';
const DAILY_LIMIT = 100;

interface SearchBody {
  lat: number;
  lng: number;
  radiusM: number;
  types?: string[];
  keyword?: string;
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

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', error: 'method_not_allowed', results: [] }, 405, cors);
  }

  try {
    if (!GOOGLE_PLACES_API_KEY) {
      console.error('GOOGLE_PLACES_API_KEY missing');
      return jsonResponse({ status: 'error', error: 'api_key_missing', results: [] }, 500, cors);
    }

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ status: 'error', error: 'unauthorized', results: [] }, 401, cors);
    }
    const token = authHeader.slice(7).trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ status: 'error', error: 'invalid_token', results: [] }, 401, cors);
    }
    const userId = userData.user.id;

    let body: SearchBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', error: 'invalid_json', results: [] }, 400, cors);
    }

    const { lat, lng, radiusM, types, keyword } = body || ({} as SearchBody);

    if (!isValidCoord(lat) || lat < -90 || lat > 90) {
      return jsonResponse({ status: 'error', error: 'invalid_lat', results: [] }, 400, cors);
    }
    if (!isValidCoord(lng) || lng < -180 || lng > 180) {
      return jsonResponse({ status: 'error', error: 'invalid_lng', results: [] }, 400, cors);
    }
    if (!isValidCoord(radiusM) || radiusM < 1 || radiusM > 50000) {
      return jsonResponse({ status: 'error', error: 'invalid_radius', results: [] }, 400, cors);
    }
    if (types !== undefined && !Array.isArray(types)) {
      return jsonResponse({ status: 'error', error: 'invalid_types', results: [] }, 400, cors);
    }
    if (keyword !== undefined && typeof keyword !== 'string') {
      return jsonResponse({ status: 'error', error: 'invalid_keyword', results: [] }, 400, cors);
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
        return jsonResponse({ status: 'over_limit', results: [] }, 429, cors);
      }
    } catch (e) {
      console.warn('rate limit table not available:', (e as Error).message);
      rateLimitActive = false;
    }

    // Build Google Places Nearby Search URL
    const params = new URLSearchParams();
    params.set('location', `${lat},${lng}`);
    params.set('radius', String(Math.floor(radiusM)));
    params.set('key', GOOGLE_PLACES_API_KEY);
    if (types && types.length > 0 && typeof types[0] === 'string') {
      params.set('type', types[0]);
    }
    if (keyword && keyword.trim().length > 0) {
      params.set('keyword', keyword.trim());
    }

    const googleUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;

    const googleResp = await fetch(googleUrl, { method: 'GET' });
    if (!googleResp.ok) {
      console.error('Google Places HTTP error:', googleResp.status);
      return jsonResponse(
        { status: 'error', error: `google_http_${googleResp.status}`, results: [] },
        502,
        cors,
      );
    }

    const googleJson: any = await googleResp.json();
    const gStatus: string = googleJson?.status ?? 'UNKNOWN';

    if (gStatus === 'OVER_QUERY_LIMIT') {
      return jsonResponse({ status: 'over_limit', results: [] }, 429, cors);
    }
    if (gStatus !== 'OK' && gStatus !== 'ZERO_RESULTS') {
      console.error('Google Places status:', gStatus, googleJson?.error_message);
      return jsonResponse(
        { status: 'error', error: `google_${gStatus.toLowerCase()}`, results: [] },
        502,
        cors,
      );
    }

    const rawResults: any[] = Array.isArray(googleJson?.results) ? googleJson.results : [];
    const results: MappedResult[] = rawResults
      .map((r): MappedResult | null => {
        const placeId: string | undefined = r?.place_id;
        const name: string | undefined = r?.name;
        const gLat = r?.geometry?.location?.lat;
        const gLng = r?.geometry?.location?.lng;
        if (!placeId || !name || typeof gLat !== 'number' || typeof gLng !== 'number') {
          return null;
        }
        return {
          placeId,
          name,
          lat: gLat,
          lng: gLng,
          address: typeof r?.vicinity === 'string' ? r.vicinity : undefined,
          rating: typeof r?.rating === 'number' ? r.rating : undefined,
          userRatingCount: typeof r?.user_ratings_total === 'number' ? r.user_ratings_total : undefined,
          types: Array.isArray(r?.types) ? r.types : [],
        };
      })
      .filter((x): x is MappedResult => x !== null);

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

    return jsonResponse({ status: 'ok', results }, 200, cors);
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('google-places-search fatal:', msg);
    return jsonResponse({ status: 'error', error: msg, results: [] }, 500, cors);
  }
});
