/**
 * detour-calc — A→B rotasına klinik eklenince oluşan ek mesafe/zaman.
 *
 * İki strateji:
 *   1) computeDetour: haversine via-C (kuşbakışı) — kısa rotalar için OK.
 *   2) computeDetourFromPolyline: gerçek yol polyline'ına dik mesafe
 *      (cross-track) × 2. Uzun rotalarda çok daha doğru — polyline zaten
 *      Mapbox'tan gerçek yolu izliyor.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const R_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.sqrt(h));
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

/**
 * Point-to-segment km — flat-earth yaklaşıklığı (segment kısa olduğu için
 * tipik <0.1km hata). Polyline vertex'leri 30-100m aralık → güvenli.
 */
function pointToSegmentKm(p: LatLng, a: LatLng, b: LatLng): number {
  // Lat → km, lng → km (ortalama enlemde)
  const midLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos(toRad(midLat));
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * cosLat;

  const ax = (a.lng - p.lng) * kmPerDegLng;
  const ay = (a.lat - p.lat) * kmPerDegLat;
  const bx = (b.lng - p.lng) * kmPerDegLng;
  const by = (b.lat - p.lat) * kmPerDegLat;

  // Segment vector
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(ax, ay);
  // Parametric position of closest point on segment (clamped 0..1)
  let t = -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(cx, cy);
}

/**
 * Polyline'a noktanın en yakın dik mesafesi (km).
 * polyline: decoded coordinates `[lng, lat]` pairs.
 */
export function pointToPolylineKm(p: LatLng, polyline: Array<[number, number]>): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return haversineKm(p, { lng: polyline[0]![0], lat: polyline[0]![1] });
  }
  let min = Infinity;
  for (let i = 1; i < polyline.length; i++) {
    const a = { lng: polyline[i - 1]![0], lat: polyline[i - 1]![1] };
    const b = { lng: polyline[i]![0], lat: polyline[i]![1] };
    const d = pointToSegmentKm(p, a, b);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Polyline-bazlı detour — gerçek yol mesafesi yaklaşıklığı.
 * Klinik ana yola crossDist uzakta → uğramak için 2 × crossDist sapma.
 */
export function computeDetourFromPolyline(
  c: LatLng,
  polyline: Array<[number, number]>,
  profile: 'driving' | 'walking' = 'driving',
): { distanceKm: number; durationMin: number } {
  const crossKm = pointToPolylineKm(c, polyline);
  const detourKm = 2 * crossKm;
  const avgKmh = profile === 'walking' ? 5 : 50;
  const detourMin = (detourKm / avgKmh) * 60;
  return { distanceKm: detourKm, durationMin: detourMin };
}

/**
 * Adaptive parametreler — rota uzunluğuna göre buffer + detour eşikleri.
 * Kısa şehir-içi rotada sıkı, uzun şehirler-arası rotada gevşek.
 */
export function adaptiveCorridorParams(routeKm: number): {
  bufferM: number;
  detourKmMax: number;
  detourMinMax: number;
  limit: number;
  /** A ve B noktasının bu km'lik yarıçapı içindeki klinikleri ele (origin/destination zone) */
  excludeStartEndKm: number;
} {
  if (routeKm < 30) {
    return {
      bufferM: 800,
      detourKmMax: 1.5,
      detourMinMax: 4,
      limit: 25,
      excludeStartEndKm: 0.5,
    };
  }
  if (routeKm < 100) {
    return {
      bufferM: 2500,
      detourKmMax: 4,
      detourMinMax: 8,
      limit: 60,
      excludeStartEndKm: 3,
    };
  }
  if (routeKm < 300) {
    return {
      bufferM: 8000,
      detourKmMax: 12,
      detourMinMax: 18,
      limit: 150,
      excludeStartEndKm: 8,
    };
  }
  if (routeKm < 600) {
    return {
      bufferM: 15000,
      detourKmMax: 25,
      detourMinMax: 30,
      limit: 250,
      excludeStartEndKm: 15,
    };
  }
  return {
    bufferM: 25000,
    detourKmMax: 35,
    detourMinMax: 45,
    limit: 300,
    excludeStartEndKm: 20,
  };
}
