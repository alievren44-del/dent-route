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
import { getEnv } from '@config/env';

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const env = getEnv();
  cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'saha-app-auth',
    },
    global: {
      headers: {
        'x-client-info': 'saha-navigasyon/0.1.0',
      },
    },
  });

  return cachedClient;
}

/**
 * Test için cache temizler.
 */
export function resetSupabaseClient(): void {
  cachedClient = null;
}
