/**
 * saha-rate-limit — Preflight kullanım sayımı (saha_api_usage tablosundan).
 *
 * Edge function rate limit'i 50/gün ama UI tarafında preflight check güzel UX:
 *   "Bugün 4/5 kullandın, kalan 1" gibi.
 */

import { getSupabaseClient } from '@/lib/supabase';

export interface UsageStat {
  used: number;
  limit: number;
  remaining: number;
}

export async function getDailyUsage(
  endpoint: string,
  defaultLimit = 5,
): Promise<UsageStat> {
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { used: 0, limit: defaultLimit, remaining: defaultLimit };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('saha_api_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
    .gte('used_at', startOfDay.toISOString());

  const used = count ?? 0;
  return {
    used,
    limit: defaultLimit,
    remaining: Math.max(0, defaultLimit - used),
  };
}
