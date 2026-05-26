import { getSupabaseClient } from '@lib/supabase';
import type { HunterCandidate } from './types';

export interface HunterThresholds {
  warningCount: number;
  riskyCount: number;
  blacklistCount: number;
  lookbackMonths: number;
}

const DEFAULT_THRESHOLDS: HunterThresholds = {
  warningCount: 2,
  riskyCount: 3,
  blacklistCount: 4,
  lookbackMonths: 6,
};

export function classifySeverity(
  sampleCount: number,
  orderCount: number,
  t: HunterThresholds,
): HunterCandidate['severity'] | null {
  if (orderCount > 0) return null;
  if (sampleCount >= t.blacklistCount) return 'blacklist';
  if (sampleCount >= t.riskyCount) return 'risky';
  if (sampleCount >= t.warningCount) return 'warning';
  return null;
}

export async function getHunterCandidates(
  thresholds: HunterThresholds = DEFAULT_THRESHOLDS,
): Promise<HunterCandidate[]> {
  const supabase = getSupabaseClient();
  const since = new Date();
  since.setMonth(since.getMonth() - thresholds.lookbackMonths);
  const sinceIso = since.toISOString();

  const { data: sampleRows, error: sErr } = await supabase
    .from('saha_samples')
    .select('account_id')
    .gte('given_at', sinceIso);
  if (sErr) throw sErr;

  const sampleCounts = new Map<string, number>();
  for (const row of (sampleRows ?? []) as Array<{ account_id: string | null }>) {
    if (!row.account_id) continue;
    sampleCounts.set(row.account_id, (sampleCounts.get(row.account_id) ?? 0) + 1);
  }

  if (sampleCounts.size === 0) return [];

  const accountIds = Array.from(sampleCounts.keys());

  const { data: orderRows, error: oErr } = await supabase
    .from('orders')
    .select('customer_id')
    .in('customer_id', accountIds)
    .gte('created_at', sinceIso);

  const orderCounts = new Map<string, number>();
  if (!oErr && orderRows) {
    for (const row of orderRows as Array<{ customer_id: string }>) {
      orderCounts.set(row.customer_id, (orderCounts.get(row.customer_id) ?? 0) + 1);
    }
  }

  const { data: accountRows } = await supabase
    .from('accounts')
    .select('id, name')
    .in('id', accountIds);

  const nameById = new Map<string, string>();
  for (const row of (accountRows ?? []) as Array<{ id: string; name: string }>) {
    nameById.set(row.id, row.name);
  }

  const results: HunterCandidate[] = [];
  for (const [accountId, sampleCount] of sampleCounts) {
    const orderCount = orderCounts.get(accountId) ?? 0;
    const severity = classifySeverity(sampleCount, orderCount, thresholds);
    if (!severity) continue;
    results.push({
      accountId,
      accountName: nameById.get(accountId) ?? 'Bilinmiyor',
      sampleCount,
      orderCount,
      lookbackMonths: thresholds.lookbackMonths,
      severity,
    });
  }

  const severityOrder = { blacklist: 3, risky: 2, warning: 1 } as const;
  results.sort(
    (a, b) => severityOrder[b.severity] - severityOrder[a.severity] || b.sampleCount - a.sampleCount,
  );

  return results;
}
