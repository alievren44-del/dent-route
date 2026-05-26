/**
 * Vertical Template System Types
 *
 * `verticals/<id>.json` dosyalarının TypeScript karşılığı.
 * Yeni alan eklenmesi durumunda hem bu dosya hem `.ai_context/05-verticals.md`
 * güncellenmelidir.
 */

export interface VerticalConfig {
  id: string;
  displayName: string;
  description?: string;

  labels: VerticalLabels;
  customerTypes: CustomerTypeOption[];
  googlePlacesTypes: string[];
  visitOutcomes: VisitOutcomeOption[];
  customFields: VerticalCustomFields;

  iconSet?: string;
  primaryColorSuggestion?: string;

  features?: VerticalFeatures;
  samplePolicy?: SamplePolicy;
}

export interface VerticalLabels {
  customer: { singular: string; plural: string };
  customer_type: string;
  discovery: string;
  visit: string;
}

export interface CustomerTypeOption {
  key: string;
  label: string;
  icon?: string;
}

export interface VisitOutcomeOption {
  key: string;
  label: string;
  color?: string;
  requiresOrder?: boolean;
}

export interface VerticalCustomFields {
  account?: CustomField[];
  visit?: CustomField[];
}

export type CustomFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'multiselect'
  | 'date';

export interface CustomField {
  key: string;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  options?: string[]; // select/multiselect için
  placeholder?: string;
  helperText?: string;
  defaultValue?: unknown;
}

export interface SamplePolicyCategory {
  label: string;
  maxPerAccountYearly: number;
  cooldownDays: number;
  minConversionPct: number;
}

export interface SamplePolicyHunterThresholds {
  warningCount: number;
  riskyCount: number;
  blacklistCount: number;
  lookbackMonths: number;
}

export interface SamplePolicy {
  enabled: boolean;
  defaultBudgetTl?: number;
  conversionWindowDays?: number;
  categories?: Record<string, SamplePolicyCategory>;
  hunterThresholds?: SamplePolicyHunterThresholds;
}

export interface VerticalFeatures {
  photoCompliance?: {
    enabled: boolean;
    minPhotos?: number;
    categories?: string[];
  };
}

/**
 * Override yapısı — config'te `vertical.overrides` altında kullanılır.
 * Base vertical'a deep merge edilir.
 */
export interface VerticalOverride {
  labels?: Partial<VerticalLabels>;
  customerTypes?: CustomerTypeOption[]; // tam replace
  googlePlacesTypes?: string[];
  visitOutcomes?: VisitOutcomeOption[];
  customFields?: VerticalCustomFields; // anahtara göre merge
  features?: VerticalFeatures;
  samplePolicy?: SamplePolicy;
}
