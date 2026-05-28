import type { SamplePolicy, SamplePolicyCategory } from '@core/verticals/types';

export type SampleStatus = 'verildi' | 'denendi' | 'donusturuldu' | 'red' | 'kayip' | 'iade';

export interface Sample {
  id: string;
  accountId: string;
  repId: string;
  givenAt: string; // ISO
  followUpAt: string; // ISO
  status: SampleStatus;
  convertedOrderId?: string;
  photoUrl?: string;
  signatureUrl?: string;
  kvkkConsentVersion: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SampleLine {
  id: string;
  sampleId: string;
  productId?: string;
  productName: string; // snapshot
  qty: number;
  unit: string;
  unitCostTl?: number;
}

export interface NewSample {
  accountId: string;
  followUpAt: string;
  status?: SampleStatus;
  photoUrl?: string;
  signatureUrl?: string;
  kvkkConsentVersion: string;
  notes?: string;
  lines: NewSampleLine[];
}

export interface NewSampleLine {
  productId?: string;
  productName: string;
  qty: number;
  unit?: string;
  unitCostTl?: number;
  categoryKey?: string; // policy check için (composite_adhesive, implant, ...)
}

export interface SampleQuota {
  repId: string;
  yearMonth: string; // 'YYYY-MM'
  budgetTl: number;
  spentTl: number;
}

export interface SamplePolicyOverride {
  verticalKey: string;
  productCategoryKey: string;
  maxPerAccountYearly: number;
  cooldownDays: number;
  minConversionPct: number;
}

export interface HunterCandidate {
  accountId: string;
  accountName: string;
  sampleCount: number;
  orderCount: number;
  lookbackMonths: number;
  severity: 'warning' | 'risky' | 'blacklist';
}

export interface SampleValidationIssue {
  code: 'cooldown' | 'max_reached' | 'blacklisted' | 'budget_exceeded' | 'no_policy';
  message: string;
  data?: Record<string, unknown>;
}

export interface SampleValidationResult {
  ok: boolean;
  issues: SampleValidationIssue[];
}

export type { SamplePolicy, SamplePolicyCategory };
