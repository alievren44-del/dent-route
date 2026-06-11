/**
 * sample-policy — Numune/Tarama bütçe + politika doğrulama birim testleri.
 *
 * `src/core/sampling/policies.ts` -> validateCanGiveSample (saf, DI yok)
 * `src/core/sampling/quotas.ts`   -> getRemainingBudget, currentYearMonth (saf)
 *
 * Supabase erişimli quota fonksiyonları (getQuota/ensureQuota/incrementSpent)
 * test edilmiyor — sadece saf yardımcılar.
 */

import { describe, expect, it } from 'vitest';
import { validateCanGiveSample } from '@core/sampling/policies';
import { getRemainingBudget, currentYearMonth } from '@core/sampling/quotas';
import type {
  Sample,
  SamplePolicyOverride,
  SamplePolicy,
} from '@core/sampling/types';

// ── Yardımcı kurucular ──────────────────────────────────────────────────
function sample(daysAgoGiven: number): Sample {
  const iso = new Date(Date.now() - daysAgoGiven * 86400000).toISOString();
  return {
    id: `s-${daysAgoGiven}`,
    accountId: 'acc-1',
    repId: 'rep-1',
    givenAt: iso,
    followUpAt: iso,
    status: 'verildi',
    kvkkConsentVersion: 'v1',
    createdAt: iso,
    updatedAt: iso,
  };
}

const baseInput = {
  line: { productName: 'Test', qty: 1, categoryKey: 'composite_adhesive' },
  verticalKey: 'dental',
  policy: undefined as SamplePolicy | undefined,
  overrides: [] as SamplePolicyOverride[],
  isBlacklisted: false,
  previousSamplesThisAccount: [] as Sample[],
  remainingBudgetTl: 1000,
  estimatedLineCostTl: 100,
};

const override: SamplePolicyOverride = {
  verticalKey: 'dental',
  productCategoryKey: 'composite_adhesive',
  maxPerAccountYearly: 3,
  cooldownDays: 30,
  minConversionPct: 0,
};

describe('validateCanGiveSample — blacklist', () => {
  it('kara liste → anında reddet, başka kontrol yok', () => {
    const r = validateCanGiveSample({ ...baseInput, isBlacklisted: true });
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]!.code).toBe('blacklisted');
  });
});

describe('validateCanGiveSample — bütçe (scan-budget)', () => {
  it('maliyet kalan bütçeden büyük → budget_exceeded', () => {
    const r = validateCanGiveSample({
      ...baseInput,
      remainingBudgetTl: 50,
      estimatedLineCostTl: 100,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'budget_exceeded')).toBe(true);
  });

  it('maliyet == kalan bütçe → izin (> kullanılıyor, sınır dahil)', () => {
    const r = validateCanGiveSample({
      ...baseInput,
      remainingBudgetTl: 100,
      estimatedLineCostTl: 100,
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('maliyet kalan bütçeden 0.01 fazla → reddet (sınır-değer)', () => {
    const r = validateCanGiveSample({
      ...baseInput,
      remainingBudgetTl: 100,
      estimatedLineCostTl: 100.01,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'budget_exceeded')).toBe(true);
  });
});

describe('validateCanGiveSample — override politika (cooldown & max)', () => {
  it('cooldown içinde önceki numune → cooldown issue', () => {
    const r = validateCanGiveSample({
      ...baseInput,
      overrides: [override],
      previousSamplesThisAccount: [sample(10)], // 10 gün < 30 cooldown
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'cooldown')).toBe(true);
  });

  it('cooldown dışında → cooldown issue YOK', () => {
    const r = validateCanGiveSample({
      ...baseInput,
      overrides: [override],
      previousSamplesThisAccount: [sample(40)], // 40 > 30
    });
    expect(r.issues.some((i) => i.code === 'cooldown')).toBe(false);
    expect(r.ok).toBe(true);
  });

  it('yıllık max aşıldı → max_reached', () => {
    const r = validateCanGiveSample({
      ...baseInput,
      overrides: [override], // maxPerAccountYearly = 3
      previousSamplesThisAccount: [sample(60), sample(120), sample(200)], // 3 adet, hepsi cooldown dışı
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === 'max_reached')).toBe(true);
  });

  it('365 günden eski numuneler yıllık sayıma girmez', () => {
    const r = validateCanGiveSample({
      ...baseInput,
      overrides: [override],
      previousSamplesThisAccount: [sample(400), sample(500)], // ikisi de >365
    });
    expect(r.issues.some((i) => i.code === 'max_reached')).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe('validateCanGiveSample — politika yokluğu', () => {
  it('policy enabled ama kategori politikası yok → no_policy (uyarı, ok=true)', () => {
    const policy: SamplePolicy = {
      enabled: true,
      categories: {},
    } as unknown as SamplePolicy;
    const r = validateCanGiveSample({
      ...baseInput,
      policy,
    });
    expect(r.issues.some((i) => i.code === 'no_policy')).toBe(true);
    // no_policy ok'u false yapmıyor (sadece uyarı), budget de geçiyorsa ok=true
    expect(r.ok).toBe(true);
  });

  it('hiç policy/override yok → kontroller atlanır, bütçe yeterliyse ok', () => {
    const r = validateCanGiveSample({ ...baseInput });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });
});

describe('getRemainingBudget', () => {
  it('null quota → 0', () => {
    expect(getRemainingBudget(null)).toBe(0);
  });

  it('budget - spent', () => {
    expect(
      getRemainingBudget({ repId: 'r', yearMonth: '2026-06', budgetTl: 1000, spentTl: 300 }),
    ).toBe(700);
  });

  it('aşım durumunda 0 (negatif değil)', () => {
    expect(
      getRemainingBudget({ repId: 'r', yearMonth: '2026-06', budgetTl: 1000, spentTl: 1500 }),
    ).toBe(0);
  });

  it('tam tükenmiş → 0', () => {
    expect(
      getRemainingBudget({ repId: 'r', yearMonth: '2026-06', budgetTl: 500, spentTl: 500 }),
    ).toBe(0);
  });
});

describe('currentYearMonth', () => {
  it('YYYY-MM formatı, ay sıfır-dolgulu (UTC)', () => {
    expect(currentYearMonth(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01');
    expect(currentYearMonth(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-12');
  });

  it('UTC sınır: ay başı', () => {
    expect(currentYearMonth(new Date(Date.UTC(2025, 8, 1)))).toBe('2025-09');
  });
});
