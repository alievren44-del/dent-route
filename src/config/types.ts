/**
 * Saha Config Types
 *
 * `.saha-config.json` dosyasının TypeScript karşılığı.
 * Şema değişirse hem bu dosya hem `config/.saha-config.example.json` güncellenmelidir.
 */

import type { VerticalConfig, VerticalOverride } from '@core/verticals/types';

export interface SahaConfig {
  tenant: TenantConfig;
  branding: BrandingConfig;
  vertical: VerticalSelectionConfig;
  crm: CRMConfig;
  features: FeatureFlags;
  external: ExternalServicesConfig;
  geo: GeoConfig;
  legal: LegalConfig;
  deployment: DeploymentConfig;
}

export interface TenantConfig {
  id: string;
  name: string;
  domain: string;
}

export interface BrandingConfig {
  name: string;
  logo: string;
  primaryColor: string;
  accentColor: string;
}

export interface VerticalSelectionConfig {
  extends: string; // verticals/<id>.json
  overrides?: VerticalOverride;
}

export type CRMConfig =
  | { type: 'supabase'; config: SupabaseCRMConfig }
  | { type: 'custom_rest'; config: CustomRESTCRMConfig };

export interface SupabaseCRMConfig {
  // Supabase URL ve key environment variable'lardan okunur,
  // bu obje şu an için boş ama gelecek genişleme için duruyor.
}

export interface CustomRESTCRMConfig {
  baseUrl: string;
  auth: {
    type: 'bearer' | 'basic' | 'custom_header';
    tokenEnvVar?: string;
    headerName?: string;
  };
  endpoints: Record<string, { method: string; path: string }>;
  fieldMapping: Record<string, Record<string, string>>;
}

export interface FeatureFlags {
  orders: boolean;
  balance: boolean;
  campaigns: boolean;
  mileageTracking: boolean;
  recurringRoutes: boolean;
  visitPhotos: boolean;
  offlineMode: boolean;
  realtimeTraffic: boolean;
}

export interface ExternalServicesConfig {
  mapbox: {
    publicTokenEnvVar: string;
    rateLimit: {
      optimizationPerUserPerDay: number;
      directionsPerUserPerDay: number;
    };
  };
  googlePlaces: {
    rateLimit: {
      searchesPerUserPerDay: number;
      autocompletePerUserPerDay: number;
    };
  };
  mapTiler?: {
    enabled: boolean;
    publicKeyEnvVar: string;
  };
}

export interface GeoConfig {
  country: string;
  defaultMapCenter: { lat: number; lng: number; zoom: number };
  discoveryRadiusKm: number;
  discoveryMaxResults: number;
}

export interface LegalConfig {
  kvkkRequired: boolean;
  kvkkVersion: string;
  kvkkUrl: string;
  dataRetention: {
    visitsMonths: number;
    gpsLogDays: number;
    photosMonths: number;
  };
}

export interface DeploymentConfig {
  supabaseUrlEnvVar: string;
  supabaseAnonKeyEnvVar: string;
  environment: 'development' | 'staging' | 'production';
}

/**
 * Loaded ve resolved (vertical merge edilmiş) config tipi.
 * Runtime'da `useSahaConfig()` ile erişilir.
 */
export interface ResolvedSahaConfig extends Omit<SahaConfig, 'vertical'> {
  vertical: VerticalConfig;
}
