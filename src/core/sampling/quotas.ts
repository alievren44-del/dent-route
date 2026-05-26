import { getSupabaseClient } from '@lib/supabase';
import type { SampleQuota } from './types';

export function currentYearMonth(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export async function getQuota(repId: string, yearMonth = currentYearMonth()): Promise<SampleQuota | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_sample_quotas')
    .select('rep_id, year_month, budget_tl, spent_tl')
    .eq('rep_id', repId)
    .eq('year_month', yearMonth)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { rep_id: string; year_month: string; budget_tl: number | string; spent_tl: number | string };
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

export async function ensureQuota(repId: string, yearMonth: string, defaultBudgetTl: number): Promise<SampleQuota> {
  const existing = await getQuota(repId, yearMonth);
  if (existing) return existing;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_sample_quotas')
    .insert({ rep_id: repId, year_month: yearMonth, budget_tl: defaultBudgetTl, spent_tl: 0 })
    .select('rep_id, year_month, budget_tl, spent_tl')
    .single();
  if (error || !data) throw error ?? new Error('quota_insert_failed');
  const row = data as { rep_id: string; year_month: string; budget_tl: number | string; spent_tl: number | string };
  return {
    repId: row.rep_id,
    yearMonth: row.year_month,
    budgetTl: Number(row.budget_tl),
    spentTl: Number(row.spent_tl),
  };
}

export async function incrementSpent(repId: string, amountTl: number, yearMonth = currentYearMonth()): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('saha_increment_sample_spent', {
    _rep_id: repId,
    _year_month: yearMonth,
    _amount: amountTl,
  });
  if (error) {
    const q = await getQuota(repId, yearMonth);
    if (!q) throw new Error('quota_not_found');
    const newSpent = q.spentTl + amountTl;
    const { error: updErr } = await supabase
      .from('saha_sample_quotas')
      .update({ spent_tl: newSpent })
      .eq('rep_id', repId)
      .eq('year_month', yearMonth);
    if (updErr) throw updErr;
  }
}
