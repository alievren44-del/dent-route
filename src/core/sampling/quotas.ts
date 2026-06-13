import { getTypedClient } from '@lib/supabase';
import type { SampleQuota } from './types';

export function currentYearMonth(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function getQuota(
  repId: string,
  yearMonth = currentYearMonth(),
): Promise<SampleQuota | null> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('saha_sample_quotas')
    .select('rep_id, year_month, budget_tl, spent_tl')
    .eq('rep_id', repId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as {
    rep_id: string;
    year_month: string;
    budget_tl: number | string;
    spent_tl: number | string;
  };
  return {
    repId: row.rep_id,
    yearMonth: row.year_month,
    budgetTl: Number(row.budget_tl),
    spentTl: Number(row.spent_tl),
  };
}

export function getRemainingBudget(quota: SampleQuota | null): number {
  if (!quota) return 0;
  return Math.max(0, quota.budgetTl - quota.spentTl);
}

