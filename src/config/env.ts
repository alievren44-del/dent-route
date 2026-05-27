/**
 * Env helper — Vite env'lerini typed olarak okur.
 *
 * Required env'ler eksikse uygulama startup'ta hata fırlatır.
 */

interface SahaEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MAPBOX_PUBLIC_TOKEN: string;
  MAPTILER_KEY?: string;
  CUSTOM_CRM_TOKEN?: string;
}

function read(name: string, required = true): string {
  const env = import.meta.env as Record<string, string | undefined>;
  // CF Pages env UI paste'inde leading/internal whitespace sızabiliyor — strip et.
  const value = env[name]?.replace(/\s+/g, '');
  if (required && !value) {
    throw new Error(`Gerekli env var eksik: ${name}. .env dosyasını kontrol et.`);
  }
  return value ?? '';
}

export function getEnv(): SahaEnv {
  return {
    SUPABASE_URL: read('VITE_SUPABASE_URL'),
    SUPABASE_ANON_KEY: read('VITE_SUPABASE_ANON_KEY'),
    MAPBOX_PUBLIC_TOKEN: read('VITE_MAPBOX_PUBLIC_TOKEN'),
    MAPTILER_KEY: read('VITE_MAPTILER_KEY', false),
    CUSTOM_CRM_TOKEN: read('VITE_CUSTOM_CRM_TOKEN', false),
  };
}
