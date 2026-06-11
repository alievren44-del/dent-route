/**
 * Shared Supabase Client
 *
 * Uygulama boyunca tek bir Supabase client instance kullanılır.
 * - SupabaseCRMAdapter
 * - AuthClient
 * - Edge Function çağrıları (Sprint 2+)
 *
 * Aynı Supabase auth session'ı paylaşır, tek bir realtime bağlantı tutar.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database.types';
import { getEnv } from '@config/env';
import { pushDebug } from '@/lib/debugLog';

let cachedClient: SupabaseClient | null = null;

/**
 * SSO migration — eski `saha-app-auth` key'inden yeni shared key'e taşı.
 * Bir kez çalışır; sonraki açılışlarda no-op.
 */
function migrateLegacyAuthKey(): void {
  if (typeof window === 'undefined') return;
  try {
    const legacy = window.localStorage.getItem('saha-app-auth');
    const shared = window.localStorage.getItem('parla-shared-auth');
    if (legacy && !shared) {
      window.localStorage.setItem('parla-shared-auth', legacy);
    }
  } catch {
    /* yutulur */
  }
}

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  migrateLegacyAuthKey();

  const env = getEnv();
  cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // 3 app (Parla Web, Parla App, Saha Nav) ortak SSO key.
      // *.parladisdeposu.com subdomain'leri arası login paylaşır.
      storageKey: 'parla-shared-auth',
    },
    global: {
      headers: {
        'x-client-info': 'saha-navigasyon/0.1.0',
      },
      // Supabase-js'in kendi fetch'i her zaman bizim wrap'lı global fetch'i kullansın
      fetch: (...args) => window.fetch(...(args as Parameters<typeof fetch>)),
    },
  });

  // functions.invoke wrapper — gönderilen body + dönen error/data debug panele
  const fn = cachedClient.functions;
  const origInvoke = fn.invoke.bind(fn);
  fn.invoke = (async (
    fnName: string,
    opts?: { body?: unknown; headers?: Record<string, string> },
  ) => {
    const t0 = performance.now();
    try {
      const res = await origInvoke(fnName, opts as never);
      const dur = Math.round(performance.now() - t0);
      if ((res as { error?: unknown }).error) {
        const err = (res as { error: unknown }).error;
        pushDebug(
          'error',
          'supabase.invoke',
          `${fnName} → error (${dur}ms)`,
          `error: ${safe(err)}\nbody: ${safe(opts?.body)}\ndata: ${safe(
            (res as { data?: unknown }).data,
          )}`,
        );
      }
      return res;
    } catch (err) {
      const dur = Math.round(performance.now() - t0);
      pushDebug(
        'error',
        'supabase.invoke',
        `${fnName} → throw (${dur}ms)`,
        `error: ${safe(err)}\nbody: ${safe(opts?.body)}`,
      );
      throw err;
    }
  }) as typeof fn.invoke;

  return cachedClient;
}

function safe(v: unknown): string {
  if (v == null) return String(v);
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * A5 additive — strongly-typed Supabase client helper.
 *
 * Aynı runtime singleton'ı tip-cast ile döndürür.
 * Sıfır runtime davranış değişikliği; yeni call site'lar (SupabaseCRMAdapter pilot)
 * bu helper üzerinden tam DB şema tiplerini alır.
 *
 * Usage:
 *   const sb = getTypedClient();
 *   const { data } = await sb.from('saha_clinics').select('id, name'); // tam tipli
 */
let _typed: SupabaseClient<Database> | null = null;
export function getTypedClient(): SupabaseClient<Database> {
  if (!_typed) _typed = getSupabaseClient() as unknown as SupabaseClient<Database>;
  return _typed;
}

/**
 * Test için cache temizler.
 */
export function resetSupabaseClient(): void {
  cachedClient = null;
  _typed = null;
}
