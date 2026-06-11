// deno-lint-ignore-file
// ============================================================================
// google-directions — Google Routes API v2 wrapper (legacy Directions yerine)
// ============================================================================
// Legacy Directions API kapalı; Google "Routes API" (computeRoutes) kullanıyor.
// POST https://routes.googleapis.com/directions/v2:computeRoutes
// Header: X-Goog-FieldMask zorunlu (cost optimization)
//
// Body: {
//   coords: [{lat,lng}, ...],     // 1. = origin, son = destination, ara = waypoints
//   profile?: 'driving'|'walking',
//   alternatives?: boolean,        // default true
// }
//
// Resp: {
//   status: 'ok' | 'error',
//   geometry: encoded polyline,
//   distanceM, durationS,
//   routes: [{ geometry, distanceM, durationS }]
// }
//
// Secret: GOOGLE_DIRECTIONS_API_KEY (Routes API enabled olmalı GCP Console'da)
// Rate limit: 50/gün/user (saha_api_usage)
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_API_KEY = Deno.env.get('GOOGLE_DIRECTIONS_API_KEY');

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
    Vary: 'Origin',
  };
}

const ENDPOINT = 'google-directions';
const DAILY_LIMIT = 50;

type Profile = 'driving' | 'walking';
interface Coord {
  lat: number;
  lng: number;
}
interface DirBody {
  coords: Coord[];
  profile?: Profile;
  alternatives?: boolean;
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

function googleTravelMode(p: Profile): string {
  return p === 'walking' ? 'WALK' : 'DRIVE';
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', error: 'method_not_allowed' }, 405, cors);
  }

  try {
    if (!GOOGLE_API_KEY) {
      return jsonResponse(
        {
          status: 'error',
          error: 'api_key_missing',
          message: 'GOOGLE_DIRECTIONS_API_KEY secret yok',
        },
        500,
        cors,
      );
    }
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return jsonResponse({ status: 'error', error: 'unauthorized' }, 401, cors);
    }
    const token = authHeader.slice(7).trim();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return jsonResponse(
        {
          status: 'error',
          error: 'invalid_token',
          message: userErr?.message ?? 'no user',
        },
        401,
        cors,
      );
    }
    const userId = userData.user.id;

    // Rate limit
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('saha_api_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('endpoint', ENDPOINT)
      .gte('used_at', startOfDay.toISOString());
    if ((count ?? 0) >= DAILY_LIMIT) {
      return jsonResponse({ status: 'over_limit' }, 429, cors);
    }

    let body: DirBody;
    try {
      body = (await req.json()) as DirBody;
    } catch {
      return jsonResponse({ status: 'error', error: 'invalid_json' }, 400, cors);
    }

    const coords = Array.isArray(body.coords) ? body.coords : [];
    if (coords.length < 2 || coords.length > 25) {
      return jsonResponse({ status: 'error', error: 'invalid_coords_count' }, 400, cors);
    }
    for (const c of coords) {
      if (!isValidCoord(c.lat) || !isValidCoord(c.lng)) {
        return jsonResponse({ status: 'error', error: 'invalid_coord' }, 400, cors);
      }
    }
    const profile: Profile =
      body.profile && ['driving', 'walking'].includes(body.profile) ? body.profile : 'driving';
    const wantAlts = body.alternatives !== false;

    // Google Routes API request body (v2)
    const origin = coords[0]!;
    const destination = coords[coords.length - 1]!;
    const intermediates = coords.slice(1, -1);

    const requestBody: any = {
      origin: {
        location: { latLng: { latitude: origin.lat, longitude: origin.lng } },
      },
      destination: {
        location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
      },
      travelMode: googleTravelMode(profile),
      routingPreference: profile === 'driving' ? 'TRAFFIC_AWARE' : undefined,
      computeAlternativeRoutes: wantAlts,
      polylineEncoding: 'ENCODED_POLYLINE',
      languageCode: 'tr',
      regionCode: 'TR',
    };
    if (intermediates.length > 0) {
      requestBody.intermediates = intermediates.map((c) => ({
        location: { latLng: { latitude: c.lat, longitude: c.lng } },
      }));
    }

    const fieldMask = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline';

    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(requestBody),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return jsonResponse(
        { status: 'error', error: `google_http_${resp.status}`, message: errText.slice(0, 400) },
        500,
        cors,
      );
    }
    const json: any = await resp.json();
    if (!Array.isArray(json?.routes) || json.routes.length === 0) {
      return jsonResponse(
        {
          status: 'error',
          error: 'google_no_routes',
          message: JSON.stringify(json).slice(0, 300),
        },
        500,
        cors,
      );
    }

    const allRoutes = (json.routes as any[]).map((r) => {
      // duration format: "1234s" (string with 's' suffix)
      const durStr: string = r.duration ?? '0s';
      const durationS = Number.parseInt(durStr.replace(/[^\d]/g, ''), 10) || 0;
      return {
        geometry: r.polyline?.encodedPolyline ?? '',
        distanceM: r.distanceMeters ?? 0,
        durationS,
      };
    });

    const primary = allRoutes[0]!;

    // Usage track
    try {
      await supabase.from('saha_api_usage').insert({
        user_id: userId,
        endpoint: ENDPOINT,
        used_at: new Date().toISOString(),
        count: 1,
      });
    } catch {
      /* yutulur */
    }

    return jsonResponse(
      {
        status: 'ok',
        geometry: primary.geometry,
        distanceM: primary.distanceM,
        durationS: primary.durationS,
        routes: allRoutes,
      },
      200,
      cors,
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    return jsonResponse({ status: 'error', error: msg }, 500, cors);
  }
});
