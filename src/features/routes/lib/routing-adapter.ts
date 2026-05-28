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

  const manual = opts.manualWaypoints ?? [];

  // 2. Manuel waypoint'ler — KULLANICI ÖZEL:
  //    - 2+ waypoint → TEK rota hepsini gezsin (A→W1→W2→...→B)
  //    - 1 waypoint → tek variation (A→W1→B)
  //    Auto variations ek olarak devam (Mapbox provider only)
  if (manual.length >= 2) {
    try {
      const coords: LatLng[] = [
        opts.a,
        ...manual.map((w) => ({ lat: w.lat, lng: w.lng })),
        opts.b,
      ];
      const routes = await invokeMapbox(supabase, coords, profile, false);
      if (routes.length > 0) {
        const label = manual.map((w) => w.name).join(' → ');
        collected.push({
          ...routes[0]!,
          provider: 'mapbox',
          viaCity: { slug: 'combined', name: label, lat: manual[0]!.lat, lng: manual[0]!.lng, nufus: 0, approxExtraKm: 0 },
        });
      }
    } catch {
      /* yutulur */
    }
  } else if (manual.length === 1) {
    try {
      const city = manual[0]!;
      const routes = await invokeMapbox(
        supabase,
        [opts.a, { lat: city.lat, lng: city.lng }, opts.b],
        profile,
        false,
      );
      if (routes.length > 0) {
        collected.push({ ...routes[0]!, provider: 'mapbox', viaCity: city });
      }
    } catch {
      /* yutulur */
    }
  }

  // 3. Otomatik variation şehirleri (her biri ayrı A→C→B varyasyonu)
  const autoOn = opts.autoVariations !== false;
  if (autoOn) {
    const autoCities = selectVariationCities(opts.a, opts.b, { maxCities: 4 });
    // Manuel waypoint'lerle çakışanları çıkar
    const manualSlugs = new Set(manual.map((m) => m.slug));
    const autoFiltered = autoCities.filter((c) => !manualSlugs.has(c.slug));

    const wpResults = await Promise.allSettled(
      autoFiltered.slice(0, 4).map(async (city) => {
        const routes = await invokeMapbox(
          supabase,
          [opts.a, { lat: city.lat, lng: city.lng }, opts.b],
          profile,
          false,
        );
        return { city, routes };
      }),
    );

    for (const r of wpResults) {
      if (r.status !== 'fulfilled') continue;
      const { city, routes } = r.value;
      if (routes.length === 0) continue;
      collected.push({ ...routes[0]!, provider: 'mapbox', viaCity: city });
    }
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
