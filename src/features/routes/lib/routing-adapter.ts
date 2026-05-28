/**
 * routing-adapter — Mapbox + Google Directions tek arayüz.
 *
 * Frontend provider-agnostic kalır. localStorage'da seçim saklanır.
 * Edge fn'lar:
 *   - mapbox-directions  (default, ucuz)
 *   - google-directions  (fallback / kullanıcı switch)
 *
 * computeWithAlternatives ayrıca waypoint variation (sadece Mapbox) destekler:
 * frontend birden çok call ile gerçek koridor çeşitliliği üretir.
 */

import { getSupabaseClient } from '@lib/supabase';
import { selectVariationCities, polylineSimilarityKm, type CityVariation } from './city-variations';
import { decodePolyline } from '@/lib/polyline';

export type RouteProfile = 'driving' | 'walking';
export type RouteProvider = 'mapbox' | 'google';

const PROVIDER_STORAGE_KEY = 'routing-provider-v1';

export interface LatLng {
  lat: number;
  lng: number;
}

/** Single route option */
export interface RouteOption {
  /** Mapbox/Google encoded polyline */
  geometry: string;
  /** Route gerçek yol mesafesi (m) */
  distanceM: number;
  /** Route gerçek yol süresi (sn) */
  durationS: number;
  /** Hangi provider'dan geldi */
  provider: RouteProvider;
  /** Bu rota direct mi yoksa waypoint variation mı */
  viaCity?: CityVariation | null;
}

/**
 * 3 alternatif rota üret. Strateji:
 *   - Provider=mapbox: direct + manual waypoint variations (city seçimi)
 *   - Provider=google: alternatives=true (Google kendi alternatif algoritması)
 *   - Manuel waypoint'ler verilirse direct yerine onları kullan
 *
 * @returns en hızlıdan en yavaşa max 5 rota
 */
export async function computeRouteAlternatives(opts: {
  a: LatLng;
  b: LatLng;
  profile: RouteProfile;
  provider?: RouteProvider;
  /** Kullanıcının elle eklediği ara nokta şehirleri (her biri ayrı call üretir) */
  manualWaypoints?: CityVariation[];
  /** Otomatik şehir variation aç/kapa (default true Mapbox'ta) */
  autoVariations?: boolean;
  /** Max kaç rota döndür (default 3) */
  maxRoutes?: number;
}): Promise<RouteOption[]> {
  const provider = opts.provider ?? getStoredProvider();
  const maxRoutes = opts.maxRoutes ?? 3;
  const profile = opts.profile;
  const supabase = getSupabaseClient();

  // ---- Google: alternatives flag ile tek call
  if (provider === 'google') {
    const { data, error } = await supabase.functions.invoke('google-directions', {
      body: {
        coords: [opts.a, opts.b],
        profile,
        alternatives: true,
      },
    });
    if (error) throw new Error(error.message);
    const resp = data as {
      status: string;
      routes?: Array<{ geometry: string; distanceM: number; durationS: number }>;
    };
    if (resp.status !== 'ok' || !resp.routes) {
      throw new Error('Google rota bulamadı');
    }
    return resp.routes
      .slice(0, maxRoutes)
      .map((r) => ({ ...r, provider: 'google' as const, viaCity: null }));
  }

  // ---- Mapbox: direct + waypoint variations
  // 1. Direct call (alternatives Mapbox'tan otomatik gelir 1-3)
  const directRes = await invokeMapbox(supabase, [opts.a, opts.b], profile, true);

  const collected: RouteOption[] = directRes.map((r) => ({
    ...r,
    provider: 'mapbox' as const,
    viaCity: null,
  }));

  // 2. Manuel waypoint'ler — kullanıcı belirlediği şehirler
  const manual = opts.manualWaypoints ?? [];
  // 3. Otomatik variation şehirleri (manuel + auto union, dedup by slug)
  const autoOn = opts.autoVariations !== false;
  const autoCities = autoOn ? selectVariationCities(opts.a, opts.b, { maxCities: 4 }) : [];
  const allWp = uniqueBySlug([...manual, ...autoCities]);

  // 4. Her waypoint için ayrı Mapbox call (parallel, ama hız nedeniyle 3'er batch)
  const wpResults = await Promise.allSettled(
    allWp.slice(0, 6).map(async (city) => {
      const routes = await invokeMapbox(
        supabase,
        [opts.a, { lat: city.lat, lng: city.lng }, opts.b],
        profile,
        false, // waypoint'li alternatif Mapbox'ta zaten zorlama
      );
      return { city, routes };
    }),
  );

  for (const r of wpResults) {
    if (r.status !== 'fulfilled') continue;
    const { city, routes } = r.value;
    if (routes.length === 0) continue;
    // Sadece ilk (en kısa) varyasyon
    collected.push({ ...routes[0]!, provider: 'mapbox', viaCity: city });
  }

  // 5. Similarity filter — birbirine çok yakın olanları ele
  const filtered = dedupBySimilarity(collected, 5); // 5km altı ortalama farksa "aynı"

  // 6. Süreye göre sırala, max N
  filtered.sort((a, b) => a.durationS - b.durationS);
  return filtered.slice(0, maxRoutes);
}

async function invokeMapbox(
  supabase: ReturnType<typeof getSupabaseClient>,
  coords: LatLng[],
  profile: RouteProfile,
  alternatives: boolean,
): Promise<Array<{ geometry: string; distanceM: number; durationS: number }>> {
  const { data, error } = await supabase.functions.invoke('mapbox-directions', {
    body: { coords, profile, alternatives },
  });
  if (error) throw new Error(error.message);
  const resp = data as {
    status: string;
    geometry?: string;
    distanceM?: number;
    durationS?: number;
    routes?: Array<{ geometry: string; distanceM: number; durationS: number }>;
  };
  if (resp.status !== 'ok') {
    throw new Error(`Mapbox: ${resp.status}`);
  }
  if (resp.routes && resp.routes.length > 0) return resp.routes;
  if (resp.geometry) {
    return [
      { geometry: resp.geometry, distanceM: resp.distanceM ?? 0, durationS: resp.durationS ?? 0 },
    ];
  }
  return [];
}

function uniqueBySlug(cities: CityVariation[]): CityVariation[] {
  const seen = new Set<string>();
  const out: CityVariation[] = [];
  for (const c of cities) {
    if (seen.has(c.slug)) continue;
    seen.add(c.slug);
    out.push(c);
  }
  return out;
}

function dedupBySimilarity(routes: RouteOption[], thresholdKm: number): RouteOption[] {
  const out: RouteOption[] = [];
  const decoded: Array<Array<[number, number]>> = [];
  for (const r of routes) {
    const dec = decodePolyline(r.geometry);
    let isDup = false;
    for (let i = 0; i < out.length; i++) {
      const sim = polylineSimilarityKm(dec, decoded[i]!);
      if (sim < thresholdKm) {
        isDup = true;
        break;
      }
    }
    if (!isDup) {
      out.push(r);
      decoded.push(dec);
    }
  }
  return out;
}

export function getStoredProvider(): RouteProvider {
  if (typeof window === 'undefined') return 'mapbox';
  const v = window.localStorage.getItem(PROVIDER_STORAGE_KEY);
  return v === 'google' ? 'google' : 'mapbox';
}

export function setStoredProvider(p: RouteProvider): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PROVIDER_STORAGE_KEY, p);
}
