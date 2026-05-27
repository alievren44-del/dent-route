/**
 * detour-calc — A→B rotasına klinik eklenince oluşan ek mesafe/zaman.
 *
 * Naive haversine yaklaşımı:
 *   detourKm = (A→C + C→B) − (A→B)
 * Süre tahmini: araç = 50 km/h, yaya = 5 km/h ortalama (kuşbakışı).
 *
 * Hassas hesap için "Detayları gör" akışı Mapbox Directions çağrısı yapabilir
 * — V2'ye bırakıldı.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function computeDetour(
  a: LatLng,
  c: LatLng,
  b: LatLng,
  profile: 'driving' | 'walking' = 'driving',
): { distanceKm: number; durationMin: number } {
  const baseline = haversineKm(a, b);
  const viaC = haversineKm(a, c) + haversineKm(c, b);
  const detourKm = Math.max(0, viaC - baseline);
  const avgKmh = profile === 'walking' ? 5 : 50;
  const detourMin = (detourKm / avgKmh) * 60;
  return { distanceKm: detourKm, durationMin: detourMin };
}
