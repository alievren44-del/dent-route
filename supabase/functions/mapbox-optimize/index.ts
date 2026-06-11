// deno-lint-ignore-file
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAPBOX_SECRET_TOKEN = Deno.env.get('MAPBOX_SECRET_TOKEN');

// CORS origin whitelist — comma-separated, e.g.
//   "https://saha.parla.com,https://app.parla.com,http://localhost:5173"
// Production'da ALLOWED_ORIGINS env'i mutlaka set edilmeli.
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Capacitor native app origin'leri — bundled APK https://localhost,
// iOS capacitor://localhost üzerinden çalışır. Bunlar uygulamanın kendi
// first-party origin'i; env allowlist'ten bağımsız her zaman kabul edilir.
const NATIVE_APP_ORIGINS = ['https://localhost', 'capacitor://localhost'];

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const isAllowed =
    reqOrigin && (ALLOWED_ORIGINS.includes(reqOrigin) || NATIVE_APP_ORIGINS.includes(reqOrigin));
  const allowed = isAllowed ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

const ENDPOINT = 'mapbox-optimize';
const DAILY_LIMIT = 50;
const MAX_WAYPOINTS = 12;
const MIN_WAYPOINTS = 2;

type Profile = 'driving' | 'driving-traffic';
type SourceMode = 'first' | 'any';
type DestinationMode = 'last' | 'any';

interface Coord {
  lat: number;
  lng: number;
}

interface OptimizeBody {
  coords: Coord[];
  profile?: Profile;
  roundtrip?: boolean;
  source?: SourceMode;
  destination?: DestinationMode;
}

interface LegOut {
  distanceM: number;
  durationS: number;
}

interface OptimizeOk {
  status: 'ok';
  order: number[];
  distanceM: number;
  durationS: number;
  geometry: string;
  legs?: LegOut[];
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

function emptyResp(): Omit<OptimizeOk, 'status'> {
  return { order: [], distanceM: 0, durationS: 0, geometry: '' };
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', error: 'method_not_allowed', ...emptyResp() }, 405, cors);
  }

  try {
    if (!MAPBOX_SECRET_TOKEN) {
      console.error('MAPBOX_SECRET_TOKEN missing');
      return jsonResponse({ status: 'error', error: 'api_key_missing', ...emptyResp() }, 500, cors);
    }

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ status: 'error', error: 'unauthorized', ...emptyResp() }, 401, cors);
    }
    const token = authHeader.slice(7).trim();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse({ status: 'error', error: 'invalid_token', ...emptyResp() }, 401, cors);
    }
    const userId = userData.user.id;

    let body: OptimizeBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ status: 'error', error: 'invalid_json', ...emptyResp() }, 400, cors);
    }

    const { coords, profile, roundtrip, source, destination } = body || ({} as OptimizeBody);

    if (!Array.isArray(coords) || coords.length < MIN_WAYPOINTS || coords.length > MAX_WAYPOINTS) {
      return jsonResponse({ status: 'error', error: 'invalid_coords_length', ...emptyResp() }, 400, cors);
    }
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!c || typeof c !== 'object') {
        return jsonResponse({ status: 'error', error: `invalid_coord_${i}`, ...emptyResp() }, 400, cors);
      }
      if (!isValidCoord(c.lat) || c.lat < -90 || c.lat > 90) {
        return jsonResponse({ status: 'error', error: `invalid_lat_${i}`, ...emptyResp() }, 400, cors);
      }
      if (!isValidCoord(c.lng) || c.lng < -180 || c.lng > 180) {
        return jsonResponse({ status: 'error', error: `invalid_lng_${i}`, ...emptyResp() }, 400, cors);
      }
    }

    const profileVal: Profile = profile ?? 'driving';
    if (profileVal !== 'driving' && profileVal !== 'driving-traffic') {
      return jsonResponse({ status: 'error', error: 'invalid_profile', ...emptyResp() }, 400, cors);
    }

    const roundtripVal: boolean = roundtrip ?? false;
    if (typeof roundtripVal !== 'boolean') {
      return jsonResponse({ status: 'error', error: 'invalid_roundtrip', ...emptyResp() }, 400, cors);
    }

    const sourceVal: SourceMode = source ?? 'first';
    if (sourceVal !== 'first' && sourceVal !== 'any') {
      return jsonResponse({ status: 'error', error: 'invalid_source', ...emptyResp() }, 400, cors);
    }

    const destinationVal: DestinationMode = destination ?? 'last';
    if (destinationVal !== 'last' && destinationVal !== 'any') {
      return jsonResponse({ status: 'error', error: 'invalid_destination', ...emptyResp() }, 400, cors);
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
        return jsonResponse({ status: 'over_limit', ...emptyResp() }, 429, cors);
      }
    } catch (e) {
      console.warn('rate limit table not available:', (e as Error).message);
      rateLimitActive = false;
    }

    // Build Mapbox Optimization URL
    const coordsPath = coords.map((c) => `${c.lng},${c.lat}`).join(';');
    const params = new URLSearchParams();
    params.set('roundtrip', roundtripVal ? 'true' : 'false');
    params.set('source', sourceVal);
    params.set('destination', destinationVal);
    params.set('geometries', 'polyline');
    params.set('overview', 'full');
    params.set('steps', 'false');
    params.set('access_token', MAPBOX_SECRET_TOKEN);

    const mapboxUrl =
      `https://api.mapbox.com/optimized-trips/v1/mapbox/${profileVal}/${coordsPath}?${params.toString()}`;

    const mbResp = await fetch(mapboxUrl, { method: 'GET' });

    if (!mbResp.ok) {
      const status = mbResp.status;
      console.error('Mapbox Optimization HTTP error:', status);
      if (status === 422) {
        return jsonResponse({ status: 'error', error: 'invalid_request', ...emptyResp() }, 400, cors);
      }
      if (status === 429) {
        return jsonResponse({ status: 'over_limit', ...emptyResp() }, 429, cors);
      }
      return jsonResponse(
        { status: 'error', error: `mapbox_${status}`, ...emptyResp() },
        502,
        cors,
      );
    }

    const mbJson: any = await mbResp.json();
    const mbCode: string = mbJson?.code ?? 'UNKNOWN';

    if (mbCode !== 'Ok') {
      console.error('Mapbox Optimization code:', mbCode, mbJson?.message);
      return jsonResponse(
        { status: 'error', error: `mapbox_${String(mbCode).toLowerCase()}`, ...emptyResp() },
        502,
        cors,
      );
    }

    const trip = Array.isArray(mbJson?.trips) ? mbJson.trips[0] : undefined;
    if (!trip) {
      return jsonResponse({ status: 'error', error: 'mapbox_no_trip', ...emptyResp() }, 502, cors);
    }

    const distanceM: number = typeof trip.distance === 'number' ? trip.distance : 0;
    const durationS: number = typeof trip.duration === 'number' ? trip.duration : 0;
    const geometry: string = typeof trip.geometry === 'string' ? trip.geometry : '';

    const rawLegs: any[] = Array.isArray(trip.legs) ? trip.legs : [];
    const legs: LegOut[] = rawLegs.map((l) => ({
      distanceM: typeof l?.distance === 'number' ? l.distance : 0,
      durationS: typeof l?.duration === 'number' ? l.duration : 0,
    }));

    const rawWaypoints: any[] = Array.isArray(mbJson?.waypoints) ? mbJson.waypoints : [];
    // Sort by waypoint_index, then map back to original input index
    const indexed = rawWaypoints
      .map((w, inputIdx) => ({
        inputIdx,
        wpIdx: typeof w?.waypoint_index === 'number' ? w.waypoint_index : -1,
      }))
      .filter((x) => x.wpIdx >= 0)
      .sort((a, b) => a.wpIdx - b.wpIdx);
    const order: number[] = indexed.map((x) => x.inputIdx);

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

    const ok: OptimizeOk = {
      status: 'ok',
      order,
      distanceM,
      durationS,
      geometry,
      legs,
    };
    return jsonResponse(ok, 200, cors);
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('mapbox-optimize fatal:', msg);
    return jsonResponse({ status: 'error', error: msg, ...emptyResp() }, 500, cors);
  }
});
