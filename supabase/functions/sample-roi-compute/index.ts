// deno-lint-ignore-file
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

interface ComputeBody {
  windowDays?: number;
}

interface SampleRow {
  id: string;
  account_id: string;
  given_at: string;
  status: string;
  converted_order_id: string | null;
}

interface OrderRow {
  id: string;
  created_at: string;
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ status: 'error', error: 'method_not_allowed' }, 405, cors);
  }

  try {
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
      return jsonResponse({ status: 'error', error: 'invalid_token' }, 401, cors);
    }
    const userId = userData.user.id;

    // Admin role check
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .single();
    if (profileErr || !profile) {
      return jsonResponse({ status: 'error', error: 'profile_not_found' }, 403, cors);
    }
    if ((profile as { role?: string }).role !== 'admin') {
      return jsonResponse({ status: 'error', error: 'admin_only' }, 403, cors);
    }

    let body: ComputeBody;
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const windowDays =
      typeof body?.windowDays === 'number' && body.windowDays > 0 && body.windowDays <= 365
        ? Math.floor(body.windowDays)
        : 90;

    // windowDays önce
    const sinceIso = addDays(new Date().toISOString(), -windowDays);

    const { data: samplesRaw, error: samplesErr } = await supabase
      .from('saha_samples')
      .select('id, account_id, given_at, status, converted_order_id')
      .is('converted_order_id', null)
      .in('status', ['verildi', 'denendi'])
      .gte('given_at', sinceIso);

    if (samplesErr) {
      console.error('sample query error:', samplesErr.message);
      return jsonResponse({ status: 'error', error: 'sample_query_failed' }, 500, cors);
    }

    const samples: SampleRow[] = (samplesRaw ?? []) as unknown as SampleRow[];

    let matched = 0;
    let processed = 0;

    for (const s of samples) {
      processed += 1;
      try {
        const endIso = addDays(s.given_at, windowDays);
        const { data: orderRaw, error: orderErr } = await supabase
          .from('orders')
          .select('id, created_at')
          .eq('customer_id', s.account_id)
          .gte('created_at', s.given_at)
          .lte('created_at', endIso)
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (orderErr) {
          console.warn('order lookup error sample', s.id, orderErr.message);
          continue;
        }

        const order = orderRaw as unknown as OrderRow | null;
        if (!order?.id) continue;

        const { error: updErr } = await supabase
          .from('saha_samples')
          .update({
            converted_order_id: order.id,
            status: 'donusturuldu',
          })
          .eq('id', s.id);

        if (updErr) {
          console.warn('sample update error', s.id, updErr.message);
          continue;
        }

        matched += 1;
      } catch (e) {
        console.warn('sample loop exception', s.id, (e as Error).message);
      }
    }

    return jsonResponse({ status: 'ok', matched, processed }, 200, cors);
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('sample-roi-compute fatal:', msg);
    return jsonResponse({ status: 'error', error: msg }, 500, cors);
  }
});
