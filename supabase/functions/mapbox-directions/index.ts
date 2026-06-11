// deno-lint-ignore-file
// ============================================================================
// mapbox-directions — A→B (veya multi-point) Mapbox Directions API wrapper
// ============================================================================
// CorridorRoutePage'in A→B yol-üstü öneri akışı için. Mapbox Optimize'dan
// farklı: sıra optimize etmez, verilen sırayla rota döner (en kısa yol A→B).
//
// Body: { coords: [{lat,lng}, ...], profile?: 'driving'|'walking'|'driving-traffic' }
// Resp: { status, geometry (encoded), distanceM, durationS, legs }
//
// Auth: kullanıcı JWT zorunlu (verify_jwt=true default ama biz kendi check
// yapacağız: 'authorization: bearer <jwt>').
// Rate limit: 50/gün/user (saha_api_usage tablosu).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MAPBOX_SECRET_TOKEN = Deno.env.get('MAPBOX_SECRET_TOKEN');

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

const ENDPOINT = 'mapbox-directions';
const DAILY_LIMIT = 50;

type Profile = 'driving' | 'driving-traffic' | 'walking';
interface Coord { lat: number; lng: number; }
interface DirBody { coords: Coord[]; profile?: Profile; alternatives?: boolean; }

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
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', error: 'method_not_allowed' }, 405, cors);
  }

  try {
    if (!MAPBOX_SECRET_TOKEN) {
      return jsonResponse({ status: 'error', error: 'api_key_missing' }, 500, cors);
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
          message: userErr?.message ?? 'no user in token',
          tokenPrefix: token.slice(0, 20),
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
    const profile: Profile = body.profile && ['driving', 'driving-traffic', 'walking'].includes(body.profile)
      ? body.profile
      : 'driving';

    // Mapbox Directions API
    const coordStr = coords.map((c) => `${c.lng},${c.lat}`).join(';');
    const params = new URLSearchParams();
    params.set('access_token', MAPBOX_SECRET_TOKEN);
    params.set('geometries', 'polyline');
    params.set('overview', 'full');
    params.set('steps', 'false');
    params.set('annotations', 'distance,duration');
    if (body.alternatives === true) {
      params.set('alternatives', 'true');
    }

    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${coordStr}?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return jsonResponse(
        { status: 'error', error: `mapbox_http_${resp.status}`, message: errText.slice(0, 200) },
        500,
        cors,
      );
    }
    const json: any = await resp.json();
    if (json?.code !== 'Ok' || !Array.isArray(json?.routes) || json.routes.length === 0) {
      return jsonResponse({ status: 'error', error: `mapbox_${json?.code ?? 'unknown'}` }, 500, cors);
    }
    const route = json.routes[0];
    // Alternatif rotalar varsa hepsini topla
    const allRoutes = (json.routes as any[]).map((r) => ({
      geometry: r.geometry,
      distanceM: r.distance,
      durationS: r.duration,
    }));

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
        geometry: route.geometry,
        distanceM: route.distance,
        durationS: route.duration,
        legs: Array.isArray(route.legs)
          ? route.legs.map((l: any) => ({ distanceM: l.distance, durationS: l.duration }))
          : [],
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
