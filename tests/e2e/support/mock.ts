import type { Page } from '@playwright/test';

/**
 * Hermetik Supabase mock router — NAV (dent-route).
 * NAV tüm veriyi Supabase REST + auth + Edge Functions (functions/v1) üzerinden çeker
 * (SupabaseCRMAdapter). Bu helper o çağrıları intercept eder → deterministik E2E.
 *
 * Kullanım:
 *   await installSupabaseMock(page, {
 *     tables: { saha_clinics: [...], orders: [...] },
 *     rpc: { approve_order_if_authorized: { ok: true } },
 *     fn: { 'scan-clinics': { results: [] } },
 *     user: makeUser({ role: 'ADMIN' }),
 *   });
 */

export const SUPA_HOST = 'https://rranpzicmhgfupgabgbi.supabase.co';
export const AUTH_STORAGE_KEY = 'parla-shared-auth';

export interface MockUser {
  id: string;
  email: string;
  role?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
}

export interface MockConfig {
  /** Tablo adı → satırlar. */
  tables?: Record<string, unknown[]>;
  /** RPC adı → yanıt. */
  rpc?: Record<string, unknown>;
  /** Edge Function adı (functions/v1/<name>) → yanıt. */
  fn?: Record<string, unknown>;
  /** Oturum kullanıcısı. */
  user?: MockUser | null;
  onUnknownTable?: 'empty' | 'error';
}

export function makeUser(over: Partial<MockUser> = {}): MockUser {
  const role = over.role ?? 'ADMIN';
  return {
    id: over.id ?? '00000000-0000-4000-8000-0000000000a1',
    email: over.email ?? 'test_admin@parla.local',
    role,
    app_metadata: { provider: 'email', role, ...(over.app_metadata ?? {}) },
    user_metadata: { role, ...(over.user_metadata ?? {}) },
  };
}

function fakeSession(user: MockUser) {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { ...user, aud: 'authenticated', created_at: new Date(0).toISOString() },
  };
}

export async function installSupabaseMock(page: Page, cfg: MockConfig = {}): Promise<void> {
  const user = cfg.user ?? null;

  await page.route(`${SUPA_HOST}/auth/v1/**`, (route) => {
    const url = route.request().url();
    if (url.includes('/token')) {
      if (!user) return route.fulfill({ status: 400, json: { error: 'invalid_grant', error_description: 'Invalid login credentials' } });
      return route.fulfill({ json: fakeSession(user) });
    }
    if (url.includes('/user')) {
      if (!user) return route.fulfill({ status: 401, json: { message: 'no session' } });
      return route.fulfill({ json: { ...user, aud: 'authenticated' } });
    }
    if (url.includes('/logout')) return route.fulfill({ status: 204, body: '' });
    if (url.includes('/signup')) return route.fulfill({ json: user ? fakeSession(user) : { user: null, session: null } });
    return route.fulfill({ json: {} });
  });

  await page.route(`${SUPA_HOST}/rest/v1/**`, (route) => {
    const u = new URL(route.request().url());
    const path = u.pathname.replace('/rest/v1/', '');
    const method = route.request().method();

    if (path.startsWith('rpc/')) {
      const fn = path.slice(4);
      return route.fulfill({ json: cfg.rpc?.[fn] ?? null });
    }
    const table = path.split('/')[0] ?? '';
    if (method !== 'GET' && method !== 'HEAD') {
      let body: unknown = {};
      try { body = route.request().postDataJSON(); } catch { /* ignore */ }
      const arr = Array.isArray(body) ? body : [body];
      return route.fulfill({ status: 201, json: arr, headers: { 'content-range': `0-${arr.length}/${arr.length}` } });
    }
    const rows = cfg.tables?.[table];
    if (rows == null && cfg.onUnknownTable === 'error') {
      return route.fulfill({ status: 500, json: { message: `unmocked table: ${table}` } });
    }
    const data = rows ?? [];
    // .single()/.maybeSingle() → Accept: application/vnd.pgrst.object+json → tek obje döndür
    const accept = route.request().headers()['accept'] ?? '';
    if (accept.includes('pgrst.object')) {
      return route.fulfill({ json: (data[0] ?? null) as object });
    }
    return route.fulfill({ json: data, headers: { 'content-range': `0-${Math.max(0, data.length - 1)}/${data.length}` } });
  });

  // Edge Functions
  await page.route(`${SUPA_HOST}/functions/v1/**`, (route) => {
    const u = new URL(route.request().url());
    const name = u.pathname.replace('/functions/v1/', '').split('/')[0] ?? '';
    return route.fulfill({ json: cfg.fn?.[name] ?? { ok: true } });
  });

  // Storage placeholder
  await page.route(`${SUPA_HOST}/storage/v1/**`, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }),
  );

  // Mapbox tiles/style — boş yanıt (harita testleri çökmesin)
  await page.route(/api\.mapbox\.com|events\.mapbox\.com/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
}

/** Oturumu localStorage'a tohumla (supabase-js parla-shared-auth key'inden okur). */
export async function seedAuth(page: Page, user: MockUser): Promise<void> {
  const session = fakeSession(user);
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k as string, v as string),
    [AUTH_STORAGE_KEY, JSON.stringify(session)],
  );
}
