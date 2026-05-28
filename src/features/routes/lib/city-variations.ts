/**
 * city-variations — A→B rotası için waypoint variation şehirleri seçer.
 *
 * Strateji:
 *   1. Rota orta noktası hesapla
 *   2. Orta noktanın haversine(A,B) * 0.15 yarıçapındaki büyük şehirleri bul
 *   3. Nüfusa göre sırala, top N dön
 *
 * Çıktı: A→C→B rotasının "anlamlı" sapma sağlayacağı şehir adayları.
 */

import provinces from '@/data/tr-locations/provinces.json';
import { haversineKm, type LatLng } from './detour-calc';

interface Province {
  plaka: number;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus: number;
  bolge: string;
}

const PROVINCES = provinces as Province[];

export interface CityVariation {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  nufus: number;
  /** Bu şehirden geçince oluşan ek sapma (kuşbakışı km — gerçek Mapbox sonrası belli olur) */
  approxExtraKm: number;
}

/**
 * Rota orta noktasının yarı-A-B çapı içinde bulunan büyük şehirleri döndürür.
 *
 * @param a Başlangıç
 * @param b Bitiş
 * @param opts.maxCities Top kaç şehir (default 4)
 * @param opts.minPopulation Min nüfus filtresi (default 150k)
 * @param opts.radiusRatio Yarıçap = haversine(A,B) × bu oran (default 0.20)
 * @param opts.excludeStartEnd A veya B yakınındaki şehirleri ele (50km içi)
 */
export function selectVariationCities(
  a: LatLng,
  b: LatLng,
  opts: {
    maxCities?: number;
    minPopulation?: number;
    radiusRatio?: number;
    excludeStartEnd?: boolean;
  } = {},
): CityVariation[] {
  const maxCities = opts.maxCities ?? 4;
  const minPop = opts.minPopulation ?? 150_000;
  const radiusRatio = opts.radiusRatio ?? 0.2;
  const exclude = opts.excludeStartEnd !== false;

  const routeKm = haversineKm(a, b);
  if (routeKm < 30) return []; // şehir-içi rotada variation anlamsız

  const mid: LatLng = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  const maxFromMid = routeKm * radiusRatio;

  const candidates = PROVINCES.filter((p) => p.nufus >= minPop)
    .map((p) => {
      const center: LatLng = { lat: p.lat, lng: p.lng };
      const distFromMid = haversineKm(mid, center);
      const distFromA = haversineKm(a, center);
      const distFromB = haversineKm(b, center);
      // A→C→B ek mesafe yaklaşıklığı (gerçek yol değil, kuşbakışı)
      const approxExtraKm = distFromA + distFromB - routeKm;
      return { p, distFromMid, distFromA, distFromB, approxExtraKm };
    })
    .filter((x) => x.distFromMid <= maxFromMid)
    .filter((x) => (exclude ? x.distFromA > 50 && x.distFromB > 50 : true))
    .filter((x) => x.approxExtraKm < routeKm * 0.4) // %40'tan fazla ekleyense ele
    .sort((x, y) => y.p.nufus - x.p.nufus) // büyük şehirler önce
    .slice(0, maxCities);

  return candidates.map((c) => ({
    slug: c.p.slug,
    name: c.p.ad,
    lat: c.p.lat,
    lng: c.p.lng,
    nufus: c.p.nufus,
    approxExtraKm: c.approxExtraKm,
  }));
}

/**
 * 2 polyline'ın yaklaşık benzerliği — örneklem noktalardan ortalama
 * cross-track mesafe (km). 2'den küçük → "neredeyse aynı rota".
 */
export function polylineSimilarityKm(
  pa: Array<[number, number]>,
  pb: Array<[number, number]>,
): number {
  if (pa.length === 0 || pb.length === 0) return Infinity;
  const sampleCount = Math.min(20, pa.length);
  const step = Math.floor(pa.length / sampleCount);
  let total = 0;
  let count = 0;
  for (let i = 0; i < pa.length; i += Math.max(1, step)) {
    const [lng, lat] = pa[i]!;
    // En yakın pb noktasının kuşbakışı mesafesi
    let minDist = Infinity;
    for (const [lng2, lat2] of pb) {
      const d = haversineKm({ lat, lng }, { lat: lat2, lng: lng2 });
      if (d < minDist) minDist = d;
    }
    total += minDist;
    count++;
  }
  return count > 0 ? total / count : Infinity;
}
