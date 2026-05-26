import type {
  NewSampleLine,
  Sample,
  SamplePolicy,
  SamplePolicyCategory,
  SampleValidationResult,
  SampleValidationIssue,
  SamplePolicyOverride,
} from './types';

export interface PolicyCheckInput {
  line: NewSampleLine;
  verticalKey: string;
  policy: SamplePolicy | undefined;        // verticals/*.json'dan
  overrides: SamplePolicyOverride[];       // DB'den (saha_sample_policies)
  isBlacklisted: boolean;                  // saha_blacklist'ten
  previousSamplesThisAccount: Sample[];    // son 1 yıl
  remainingBudgetTl: number;
  estimatedLineCostTl: number;
}

function daysAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86400000;
}

interface ResolvedPolicy {
  maxPerAccountYearly: number;
  cooldownDays: number;
  minConversionPct: number;
}

function resolvePolicy(
  input: PolicyCheckInput,
): { resolved: ResolvedPolicy | undefined; missing: boolean } {
  const { line, verticalKey, policy, overrides } = input;
  const categoryKey = line.categoryKey;

  if (categoryKey) {
    const override = overrides.find(
      (o) => o.verticalKey === verticalKey && o.productCategoryKey === categoryKey,
    );
    if (override) {
      return {
        resolved: {
          maxPerAccountYearly: override.maxPerAccountYearly,
          cooldownDays: override.cooldownDays,
          minConversionPct: override.minConversionPct,
        },
        missing: false,
      };
    }
  }

  if (!policy) {
    return { resolved: undefined, missing: false };
  }

  if (categoryKey && policy.categories && policy.categories[categoryKey]) {
    const cat: SamplePolicyCategory = policy.categories[categoryKey];
    return {
      resolved: {
        maxPerAccountYearly: cat.maxPerAccountYearly,
        cooldownDays: cat.cooldownDays,
        minConversionPct: cat.minConversionPct,
      },
      missing: false,
    };
  }

  return { resolved: undefined, missing: true };
}

export function validateCanGiveSample(input: PolicyCheckInput): SampleValidationResult {
  const issues: SampleValidationIssue[] = [];

  // 1. blacklist
  if (input.isBlacklisted) {
    issues.push({
      code: 'blacklisted',
      message: 'Hesap kara listede; numune verilemez.',
    });
    return { ok: false, issues };
  }

  // 2. policy resolve
  const { resolved, missing } = resolvePolicy(input);

  if (missing && input.policy && input.policy.enabled) {
    issues.push({
      code: 'no_policy',
      message: 'Bu kategori için tanımlı politika yok.',
      data: { categoryKey: input.line.categoryKey, verticalKey: input.verticalKey },
    });
  }

  let ok = true;

  if (resolved) {
    // 3. cooldown
    const cooldownHit = input.previousSamplesThisAccount.find(
      (s) => daysAgo(s.givenAt) <= resolved.cooldownDays,
    );
    if (cooldownHit) {
      issues.push({
        code: 'cooldown',
        message: `Cooldown aktif: son ${resolved.cooldownDays} gün içinde numune verilmiş.`,
        data: { lastGivenAt: cooldownHit.givenAt, cooldownDays: resolved.cooldownDays },
      });
      ok = false;
    }

    // 4. max per account yearly
    const yearlyCount = input.previousSamplesThisAccount.filter(
      (s) => daysAgo(s.givenAt) <= 365,
    ).length;
    if (yearlyCount >= resolved.maxPerAccountYearly) {
      issues.push({
        code: 'max_reached',
        message: `Yıllık maksimum numune sayısına ulaşıldı (${resolved.maxPerAccountYearly}).`,
        data: { yearlyCount, maxPerAccountYearly: resolved.maxPerAccountYearly },
      });
      ok = false;
    }
  }

  // 5. budget
  if (input.estimatedLineCostTl > input.remainingBudgetTl) {
    issues.push({
      code: 'budget_exceeded',
      message: 'Bütçe aşıldı; admin onayı gerekli.',
      data: {
        estimatedLineCostTl: input.estimatedLineCostTl,
        remainingBudgetTl: input.remainingBudgetTl,
      },
    });
    ok = false;
  }

  return { ok, issues };
}
