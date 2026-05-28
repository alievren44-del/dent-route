/**
 * VerticalLoader
 *
 * verticals/<id>.json dosyalarını Vite'ın `import.meta.glob` ile compile-time yükler,
 * config'teki overrides ile merge eder, Zod ile şema validasyonu yapar.
 *
 * Kullanım: VerticalContext bunu çağırır, useVertical() hook'u sonucu döner.
 */

import { z } from 'zod';
import type { VerticalConfig, VerticalOverride, CustomField } from './types';

// ─── Zod schemas ────────────────────────────────────────────────

const customFieldSchema: z.ZodType<CustomField> = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['text', 'number', 'boolean', 'select', 'multiselect', 'date']),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  placeholder: z.string().optional(),
  helperText: z.string().optional(),
  defaultValue: z.unknown().optional(),
});

const verticalConfigSchema: z.ZodType<VerticalConfig> = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  labels: z.object({
    customer: z.object({ singular: z.string(), plural: z.string() }),
    customer_type: z.string(),
    discovery: z.string(),
    visit: z.string(),
  }),
  customerTypes: z
    .array(z.object({ key: z.string(), label: z.string(), icon: z.string().optional() }))
    .min(1),
  googlePlacesTypes: z.array(z.string()).min(1),
  visitOutcomes: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        color: z.string().optional(),
        requiresOrder: z.boolean().optional(),
      }),
    )
    .min(1),
  customFields: z.object({
    account: z.array(customFieldSchema).optional(),
    visit: z.array(customFieldSchema).optional(),
  }),
  iconSet: z.string().optional(),
  primaryColorSuggestion: z.string().optional(),
  features: z
    .object({
      photoCompliance: z
        .object({
          enabled: z.boolean(),
          minPhotos: z.number().int().nonnegative().optional(),
          categories: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
});

// ─── Vite glob import ───────────────────────────────────────────
// Build sırasında verticals/*.json dosyaları compile-time olarak import edilir.

const verticalModules: Record<string, unknown> = import.meta.glob('/verticals/*.json', {
  eager: true,
  import: 'default',
});

/**
 * Vertical ID listesini döner (dosyalardan derive edilir).
 */
export function listAvailableVerticals(): string[] {
  return Object.keys(verticalModules)
    .map((path) => {
      const match = path.match(/\/([^/]+)\.json$/);
      return match?.[1];
    })
    .filter((id): id is string => Boolean(id));
}

/**
 * Verilen ID için base vertical template'i döner.
 * @throws VerticalNotFoundError
 */
export function loadBaseVertical(id: string): VerticalConfig {
  const path = `/verticals/${id}.json`;
  const raw = verticalModules[path];
  if (!raw) {
    throw new VerticalNotFoundError(id, listAvailableVerticals());
  }
  const result = verticalConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new VerticalValidationError(id, result.error.message);
  }
  return result.data;
}

/**
 * Override'ları base vertical'a merge eder.
 * Merge stratejisi:
 *   - labels:      deep merge
 *   - customerTypes / googlePlacesTypes / visitOutcomes: tam replace
 *   - customFields.account/visit: anahtar bazlı merge (key eşleşirse override, yoksa append)
 *   - features:    deep merge
 */
export function mergeVerticalOverrides(
  base: VerticalConfig,
  overrides: VerticalOverride | undefined,
): VerticalConfig {
  if (!overrides) return base;

  return {
    ...base,
    labels: { ...base.labels, ...overrides.labels },
    customerTypes: overrides.customerTypes ?? base.customerTypes,
    googlePlacesTypes: overrides.googlePlacesTypes ?? base.googlePlacesTypes,
    visitOutcomes: overrides.visitOutcomes ?? base.visitOutcomes,
    customFields: mergeCustomFields(base.customFields, overrides.customFields),
    features: { ...base.features, ...overrides.features },
  };
}

function mergeCustomFields(
  base: VerticalConfig['customFields'],
  override?: VerticalOverride['customFields'],
): VerticalConfig['customFields'] {
  if (!override) return base;
  return {
    account: mergeFieldArray(base.account, override.account),
    visit: mergeFieldArray(base.visit, override.visit),
  };
}

function mergeFieldArray(
  baseFields: CustomField[] | undefined,
  overrideFields: CustomField[] | undefined,
): CustomField[] | undefined {
  if (!overrideFields) return baseFields;
  if (!baseFields) return overrideFields;

  const merged = new Map<string, CustomField>();
  baseFields.forEach((f) => merged.set(f.key, f));
  overrideFields.forEach((f) => merged.set(f.key, f)); // override
  return Array.from(merged.values());
}

/**
 * Tam yükleme — base + override + validation.
 */
export function loadVertical(id: string, overrides?: VerticalOverride): VerticalConfig {
  const base = loadBaseVertical(id);
  return mergeVerticalOverrides(base, overrides);
}

// ─── Errors ─────────────────────────────────────────────────────

export class VerticalNotFoundError extends Error {
  constructor(
    public id: string,
    public available: string[],
  ) {
    super(`Vertical "${id}" not found. Available: ${available.join(', ')}`);
    this.name = 'VerticalNotFoundError';
  }
}

export class VerticalValidationError extends Error {
  constructor(
    public id: string,
    public details: string,
  ) {
    super(`Vertical "${id}" schema validation failed: ${details}`);
    this.name = 'VerticalValidationError';
  }
}
