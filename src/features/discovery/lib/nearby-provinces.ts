/**
 * nearby-provinces — Kullanıcı konumundan 50km içine düşen illeri sıralar.
 *
 * Pure helper. provinces.json centroid + haversine. 81 il × O(1) hesap = trivial.
 */

import provinces from '@/data/tr-locations/provinces.json';

export interface Province {
  plaka: number;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus: number;
  bolge: string;
}

export interface NearbyProvince extends Province {
  distanceKm: number;
}

const PROVINCES = provinces as Province[];

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Kullanıcı konumundan `maxKm` içine düşen illeri sıralar (yakından uzağa).
 *
 * @param lat — kullanıcı enlem
 * @param lng — kullanıcı boylam
 * @param maxKm — maksimum mesafe (km). Default 50.
 * @returns {NearbyProvince[]} mesafe ile zenginleştirilmiş ve sıralı.
 */
export function getNearbyProvinces(
  lat: number,
  lng: number,
  maxKm = 50,
): NearbyProvince[] {
  const out: NearbyProvince[] = [];
  for (const p of PROVINCES) {
    const d = haversineKm(lat, lng, p.lat, p.lng);
    if (d <= maxKm) out.push({ ...p, distanceKm: d });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}
