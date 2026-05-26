/**
 * Config Loader
 *
 * `.saha-config.json` dosyasını yükler, Zod ile şema validasyonu yapar,
 * vertical template'ini merge eder, runtime'a hazır config döner.
 */

import { z } from 'zod';
import { loadVertical } from '@core/verticals/VerticalLoader';
import type { ResolvedSahaConfig, SahaConfig } from './types';

// Vite, import.meta.glob ile build sırasında config'i statik olarak okur.
// Deploy başına .saha-config.json değişebilir, build sırasında bake edilir.
const configModule: Record<string, unknown> = import.meta.glob('/config/.saha-config.json', {
  eager: true,
  import: 'default',
});

// ─── Zod Schema ────────────────────────────────────────

const verticalSelectionSchema = z.object({
  extends: z.string().min(1),
  overrides: z.record(z.unknown()).optional(),
});

const sahaConfigSchema: z.ZodType<SahaConfig> = z.object({
  tenant: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    domain: z.string().min(1),
  }),
  branding: z.object({
    name: z.string().min(1),
    logo: z.string().min(1),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'HEX renk bekleniyor'),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'HEX renk bekleniyor'),
  }),
  vertical: verticalSelectionSchema as unknown as z.ZodType<SahaConfig['vertical']>,
  crm: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('supabase'),
      config: z.object({}).passthrough(),
    }),
    z.object({
      type: z.literal('custom_rest'),
      config: z.object({
        baseUrl: z.string().url(),
        auth: z.object({
          type: z.enum(['bearer', 'basic', 'custom_header']),
          tokenEnvVar: z.string().optional(),
          headerName: z.string().optional(),
        }),
        endpoints: z.record(
          z.object({
            method: z.string(),
            path: z.string(),
          }),
        ),
        fieldMapping: z.record(z.record(z.string())),
      }),
    }),
  ]) as unknown as z.ZodType<SahaConfig['crm']>,
  features: z.object({
    orders: z.boolean(),
    balance: z.boolean(),
    campaigns: z.boolean(),
    mileageTracking: z.boolean(),
    recurringRoutes: z.boolean(),
    visitPhotos: z.boolean(),
    offlineMode: z.boolean(),
    realtimeTraffic: z.boolean(),
  }),
  external: z.object({
    mapbox: z.object({
      publicTokenEnvVar: z.string(),
      rateLimit: z.object({
        optimizationPerUserPerDay: z.number().int().positive(),
        directionsPerUserPerDay: z.number().int().positive(),
      }),
    }),
    googlePlaces: z.object({
      rateLimit: z.object({
        searchesPerUserPerDay: z.number().int().positive(),
        autocompletePerUserPerDay: z.number().int().positive(),
      }),
    }),
    mapTiler: z
      .object({
        enabled: z.boolean(),
        publicKeyEnvVar: z.string(),
      })
      .optional(),
  }),
  geo: z.object({
    country: z.string().length(2),
    defaultMapCenter: z.object({
      lat: z.number(),
      lng: z.number(),
      zoom: z.number(),
    }),
    discoveryRadiusKm: z.number().positive(),
    discoveryMaxResults: z.number().int().positive(),
  }),
  legal: z.object({
    kvkkRequired: z.boolean(),
    kvkkVersion: z.string(),
    kvkkUrl: z.string(),
    dataRetention: z.object({
      visitsMonths: z.number().int().positive(),
      gpsLogDays: z.number().int().positive(),
      photosMonths: z.number().int().positive(),
    }),
  }),
  deployment: z.object({
    supabaseUrlEnvVar: z.string(),
    supabaseAnonKeyEnvVar: z.string(),
    environment: z.enum(['development', 'staging', 'production']),
  }),
});

// ─── Loader ────────────────────────────────────────────

let cachedConfig: ResolvedSahaConfig | null = null;

export function loadSahaConfig(): ResolvedSahaConfig {
  if (cachedConfig) return cachedConfig;

  const rawConfig = configModule['/config/.saha-config.json'];
  if (!rawConfig) {
    throw new ConfigNotFoundError();
  }

  const parsed = sahaConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new ConfigValidationError(parsed.error.message);
  }

  const config = parsed.data;
  const vertical = loadVertical(config.vertical.extends, config.vertical.overrides);

  cachedConfig = { ...config, vertical };
  return cachedConfig;
}

/**
 * Test için cache temizleme.
 */
export function clearConfigCache(): void {
  cachedConfig = null;
}

// ─── Errors ────────────────────────────────────────────

export class ConfigNotFoundError extends Error {
  constructor() {
    super(
      '.saha-config.json bulunamadı. config/.saha-config.example.json dosyasını kopyalayıp düzenleyin.',
    );
    this.name = 'ConfigNotFoundError';
  }
}

export class ConfigValidationError extends Error {
  constructor(details: string) {
    super(`.saha-config.json şema validasyonu başarısız: ${details}`);
    this.name = 'ConfigValidationError';
  }
}
