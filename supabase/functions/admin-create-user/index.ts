// deno-lint-ignore-file
/**
 * admin-create-user — Edge Function
 *
 * Yeni kullanıcı oluşturur (auth.users + profiles), opsiyonel davet linki üretir
 * ve admin_audit_logs'a kayıt düşer. Sadece ADMIN rolündeki kullanıcılar
 * çağırabilir. CORS allowlist ALLOWED_ORIGINS env'inden alınır.
 *
 * Body:
 *   { email, password, fullName, role, phone?, sendInvite? }
 *
 * Yanıt:
 *   { status: 'ok', userId, inviteLink? }
 *   { status: 'error', error }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_ROLES = new Set(['ADMIN', 'MANAGER', 'REP', 'USER']);
const MIN_PASSWORD_LEN = 8;

function buildCorsHeaders(reqOrigin: string | null): Record<string, string> {
  const allowed =
    reqOrigin && ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : ALLOWED_ORIGINS[0] ?? 'null';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

interface CreateBody {
  email?: string;
  password?: string;
  fullName?: string;
  role?: string;
  phone?: string;
  sendInvite?: boolean;
}

function jsonResponse(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
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

    // Token → caller user
    const { data: callerData, error: callerErr } = await supabase.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return jsonResponse({ status: 'error', error: 'invalid_token' }, 401, cors);
    }
    const callerId = callerData.user.id;

    // Admin role check
    const { data: callerProfile, error: profileErr } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', callerId)
      .maybeSingle();
    if (profileErr) {
      console.error('caller profile lookup error:', profileErr.message);
      return jsonResponse({ status: 'error', error: 'profile_lookup_failed' }, 500, cors);
    }
    const callerRole = String((callerProfile as { role?: string } | null)?.role ?? '').toUpperCase();
    if (callerRole !== 'ADMIN') {
      return jsonResponse({ status: 'error', error: 'forbidden' }, 403, cors);
    }

    // Body parse + validate
    let body: CreateBody;
    try {
      body = (await req.json()) as CreateBody;
    } catch {
      return jsonResponse({ status: 'error', error: 'invalid_json' }, 400, cors);
    }

    const email = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const role = typeof body.role === 'string' ? body.role.toUpperCase() : '';
    const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
    const sendInvite = body.sendInvite === true;

    if (!email || !email.includes('@')) {
      return jsonResponse({ status: 'error', error: 'invalid_email' }, 400, cors);
    }
    if (!password || password.length < MIN_PASSWORD_LEN) {
      return jsonResponse({ status: 'error', error: 'invalid_password' }, 400, cors);
    }
    if (!fullName) {
      return jsonResponse({ status: 'error', error: 'invalid_full_name' }, 400, cors);
    }
    if (!role || !ALLOWED_ROLES.has(role)) {
      return jsonResponse({ status: 'error', error: 'invalid_role' }, 400, cors);
    }

    // 1) Auth user oluştur
    const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        ...(phone ? { phone } : {}),
      },
    });
    if (createErr || !createData?.user) {
      return jsonResponse(
        { status: 'error', error: `create_user_failed: ${createErr?.message ?? 'unknown'}` },
        400,
        cors,
      );
    }
    const newUserId = createData.user.id;

    // 2) profiles upsert — trigger auto-create varsa override et
    const profilePatch: Record<string, unknown> = {
      id: newUserId,
      email,
      ad_soyad: fullName,
      role,
    };
    if (phone) profilePatch.telefon = phone;

    const { error: upsertErr } = await supabase
      .from('profiles')
      .upsert(profilePatch, { onConflict: 'id' });
    if (upsertErr) {
      // Auth user oluştu ama profil yazılamadı — best effort cleanup
      console.error('profile upsert error:', upsertErr.message);
      try {
        await supabase.auth.admin.deleteUser(newUserId);
      } catch (e) {
        console.warn('cleanup deleteUser failed:', (e as Error).message);
      }
      return jsonResponse(
        { status: 'error', error: `profile_upsert_failed: ${upsertErr.message}` },
        500,
        cors,
      );
    }

    // 3) Davet linki (opsiyonel)
    let inviteLink: string | undefined;
    if (sendInvite) {
      try {
        const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
          type: 'recovery',
          email,
        });
        if (linkErr) {
          console.warn('generateLink error:', linkErr.message);
        } else {
          // Supabase JS shape: linkData.properties.action_link
          const properties = (linkData as { properties?: { action_link?: string } } | null)?.properties;
          inviteLink = properties?.action_link;
        }
      } catch (e) {
        console.warn('generateLink exception:', (e as Error).message);
      }
    }

    // 4) Audit log
    try {
      const { error: auditErr } = await supabase.from('admin_audit_logs').insert({
        actor_id: callerId,
        action: 'create_user',
        target_table: 'profiles',
        target_id: newUserId,
        details: { email, role, sendInvite },
      });
      if (auditErr) console.warn('audit log error:', auditErr.message);
    } catch (e) {
      console.warn('audit log exception:', (e as Error).message);
    }

    return jsonResponse(
      {
        status: 'ok',
        userId: newUserId,
        ...(inviteLink ? { inviteLink } : {}),
      },
      200,
      cors,
    );
  } catch (e) {
    const msg = (e as Error)?.message ?? 'unknown_error';
    console.error('admin-create-user fatal:', msg);
    return jsonResponse({ status: 'error', error: msg }, 500, cors);
  }
});
