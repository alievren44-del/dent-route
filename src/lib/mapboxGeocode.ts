/**
 * mapboxGeocode — Mapbox Geocoding API v5 wrapper.
 *
 * Tek girdi noktası: `mapboxGeocode(query, opts)` (forward) ve
 * `mapboxReverseGeocode(lat, lng)` (reverse). Hem ManualAddClinicModal hem de
 * gelecekteki adres-tabanlı arama UI'ları için tek yer.
 *
 * Notlar:
 *   - country default "tr", language default "tr"
 *   - proximity → yakındaki sonuçları biasla (ilçe merkezi koord'u gibi)
 *   - HTTP error → throw, çağıran handle eder
 *   - Boş query → boş array (network çağrısı yapılmaz)
 */

import { getEnv } from '@config/env';

export interface GeocodeResult {
  /** Mapbox place id (örn. "address.123...") */
  id: string;
  /** Tam adres / yer adı */
  placeName: string;
  /** [lng, lat] (Mapbox standardı) */
  center: [number, number];
  lat: number;
  lng: number;
  /** İl adı (place context) */
  province?: string;
  /** İlçe adı (locality/district context) */
  district?: string;
  /** Mahalle (neighborhood context) */
  neighborhood?: string;
  /** Mapbox confidence (feature.relevance veya fallback 0.5) */
  relevance: number;
}

export interface GeocodeOptions {
  /** Yakın koord biasla (örn. ilçe merkezi) — [lng, lat] */
  proximity?: [number, number];
  /** Sonuç sayısı (default 5) */
  limit?: number;
  /** Ülke (default 'tr') */
  country?: string;
}

interface MapboxContextEntry {
  id?: string;
  text?: string;
}

interface MapboxFeature {
  id?: string;
  place_name?: string;
  center?: [number, number];
  context?: MapboxContextEntry[];
  relevance?: number;
}

interface MapboxResponse {
  features?: MapboxFeature[];
}

function pickContext(ctx: MapboxContextEntry[], prefix: string): string | undefined {
  const hit = ctx.find((c) => typeof c?.id === 'string' && c.id.startsWith(prefix));
  return hit?.text;
}

function featureToResult(f: MapboxFeature): GeocodeResult {
  const ctx: MapboxContextEntry[] = Array.isArray(f.context) ? f.context : [];
  const center = (Array.isArray(f.center) && f.center.length === 2 ? f.center : [0, 0]) as [
    number,
    number,
  ];
  const [lng, lat] = center;
  return {
    id: String(f.id ?? ''),
    placeName: String(f.place_name ?? ''),
    center: [lng, lat],
    lat,
    lng,
    province: pickContext(ctx, 'region') ?? pickContext(ctx, 'place'),
    district: pickContext(ctx, 'district') ?? pickContext(ctx, 'locality'),
    neighborhood: pickContext(ctx, 'neighborhood'),
    relevance: typeof f.relevance === 'number' ? f.relevance : 0.5,
  };
}

export async function mapboxGeocode(
  query: string,
  options: GeocodeOptions = {},
): Promise<GeocodeResult[]> {
  const token = getEnv().MAPBOX_PUBLIC_TOKEN;
  if (!token) throw new Error('VITE_MAPBOX_PUBLIC_TOKEN missing');
  if (!query?.trim()) return [];

  const params = new URLSearchParams();
  params.set('access_token', token);
  params.set('country', options.country ?? 'tr');
  params.set('limit', String(options.limit ?? 5));
  params.set('language', 'tr');
  if (options.proximity) {
    params.set('proximity', `${options.proximity[0]},${options.proximity[1]}`);
  }

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query.trim(),
  )}.json?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`mapbox_geocode_http_${resp.status}`);
  const json = (await resp.json()) as MapboxResponse;
  const features: MapboxFeature[] = Array.isArray(json?.features) ? json.features : [];

  return features.map(featureToResult);
}

/**
 * Reverse geocode — lat/lng → human-readable address.
 * Hata / sonuçsuz durumda `null` döner (forward'tan farklı; UI'da yumuşak).
 */
export async function mapboxReverseGeocode(
  lat: number,
  lng: number,
): Promise<GeocodeResult | null> {
  const token = getEnv().MAPBOX_PUBLIC_TOKEN;
  if (!token) throw new Error('VITE_MAPBOX_PUBLIC_TOKEN missing');

  const params = new URLSearchParams();
  params.set('access_token', token);
  params.set('language', 'tr');
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${params.toString()}`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const json = (await resp.json()) as MapboxResponse;
  const feature = Array.isArray(json?.features) ? json.features[0] : null;
  if (!feature) return null;

  const result = featureToResult(feature);
  // Reverse'te center fallback'i girdi koord'u olsun
  if (result.center[0] === 0 && result.center[1] === 0) {
    result.center = [lng, lat];
    result.lat = lat;
    result.lng = lng;
  }
  // Reverse sonucunda relevance her zaman 1
  result.relevance = 1;
  return result;
}
