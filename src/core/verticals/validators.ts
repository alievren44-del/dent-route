/**
 * Vertical-aware validators
 *
 * Account ve visit kayıtları DB'ye yazılmadan önce buradan geçer.
 * DB tarafında CHECK constraint olmadığı için validation app layer'da.
 */

import type { VerticalConfig, CustomField, SamplePolicy } from './types';

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Account `type` değeri vertical'ın customerTypes'ında var mı kontrol.
 */
export function validateCustomerType(
  vertical: VerticalConfig,
  type: string | undefined | null,
): ValidationResult {
  if (!type) return { ok: true, errors: [] };
  const valid = vertical.customerTypes.some((t) => t.key === type);
  return valid
    ? { ok: true, errors: [] }
    : {
        ok: false,
        errors: [
          {
            field: 'type',
            message: `"${type}" geçerli bir ${vertical.labels.customer_type} değil. Geçerli olanlar: ${vertical.customerTypes.map((t) => t.key).join(', ')}`,
          },
        ],
      };
}

/**
 * Visit `outcome` değeri vertical'ın visitOutcomes'ında var mı kontrol.
 */
export function validateVisitOutcome(
  vertical: VerticalConfig,
  outcome: string | undefined | null,
): ValidationResult {
  if (!outcome) return { ok: true, errors: [] };
  const valid = vertical.visitOutcomes.some((o) => o.key === outcome);
  return valid
    ? { ok: true, errors: [] }
    : {
        ok: false,
        errors: [
          {
            field: 'outcome',
            message: `"${outcome}" geçerli bir ziyaret sonucu değil. Geçerli olanlar: ${vertical.visitOutcomes.map((o) => o.key).join(', ')}`,
          },
        ],
      };
}

/**
 * Custom fields validation — değerleri ilgili type'a göre kontrol eder.
 */
export function validateCustomFields(
  fields: CustomField[] | undefined,
  values: Record<string, unknown>,
): ValidationResult {
  if (!fields || fields.length === 0) return { ok: true, errors: [] };

  const errors: ValidationError[] = [];

  for (const field of fields) {
    const value = values[field.key];

    // Required check
    if (field.required && (value === undefined || value === null || value === '')) {
      errors.push({ field: field.key, message: `"${field.label}" zorunlu.` });
      continue;
    }

    if (value === undefined || value === null) continue;

    // Type check
    switch (field.type) {
      case 'text':
        if (typeof value !== 'string') {
          errors.push({ field: field.key, message: `"${field.label}" metin olmalı.` });
        }
        break;
      case 'number':
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push({ field: field.key, message: `"${field.label}" sayı olmalı.` });
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({ field: field.key, message: `"${field.label}" evet/hayır olmalı.` });
        }
        break;
      case 'select':
        if (!field.options?.includes(value as string)) {
          errors.push({
            field: field.key,
            message: `"${field.label}" geçerli bir seçenek değil.`,
          });
        }
        break;
      case 'multiselect':
        if (!Array.isArray(value) || value.some((v) => !field.options?.includes(v as string))) {
          errors.push({
            field: field.key,
            message: `"${field.label}" geçersiz seçim içeriyor.`,
          });
        }
        break;
      case 'date':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          errors.push({ field: field.key, message: `"${field.label}" geçerli bir tarih olmalı.` });
        }
        break;
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * SamplePolicy şeması — vertical config yüklenirken çağrılır.
 */
export function validateSamplePolicy(policy: SamplePolicy | undefined): ValidationResult {
  const errors: ValidationError[] = [];
  if (!policy) return { ok: true, errors };

  if (typeof policy.enabled !== 'boolean') {
    errors.push({ field: 'samplePolicy.enabled', message: 'boolean olmalı' });
  }
  if (
    policy.defaultBudgetTl !== undefined &&
    (typeof policy.defaultBudgetTl !== 'number' || policy.defaultBudgetTl < 0)
  ) {
    errors.push({ field: 'samplePolicy.defaultBudgetTl', message: 'pozitif sayı olmalı' });
  }
  if (
    policy.conversionWindowDays !== undefined &&
    (typeof policy.conversionWindowDays !== 'number' || policy.conversionWindowDays < 1)
  ) {
    errors.push({ field: 'samplePolicy.conversionWindowDays', message: 'en az 1 gün olmalı' });
  }
  if (policy.categories) {
    for (const [key, cat] of Object.entries(policy.categories)) {
      if (typeof cat.label !== 'string')
        errors.push({ field: `samplePolicy.categories.${key}.label`, message: 'metin olmalı' });
      if (typeof cat.maxPerAccountYearly !== 'number' || cat.maxPerAccountYearly < 0) {
        errors.push({
          field: `samplePolicy.categories.${key}.maxPerAccountYearly`,
          message: 'pozitif sayı olmalı',
        });
      }
      if (typeof cat.cooldownDays !== 'number' || cat.cooldownDays < 0) {
        errors.push({
          field: `samplePolicy.categories.${key}.cooldownDays`,
          message: 'pozitif sayı olmalı',
        });
      }
      if (
        typeof cat.minConversionPct !== 'number' ||
        cat.minConversionPct < 0 ||
        cat.minConversionPct > 100
      ) {
        errors.push({
          field: `samplePolicy.categories.${key}.minConversionPct`,
          message: '0-100 arası olmalı',
        });
      }
    }
  }
  if (policy.hunterThresholds) {
    const h = policy.hunterThresholds;
    if (!(h.warningCount < h.riskyCount && h.riskyCount < h.blacklistCount)) {
      errors.push({
        field: 'samplePolicy.hunterThresholds',
        message: 'warningCount < riskyCount < blacklistCount olmalı',
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
