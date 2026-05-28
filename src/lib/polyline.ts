/**
 * polyline — Google/Mapbox encoded polyline decoder.
 *
 * Standart precision: 5 (Mapbox default). Bazı endpoint'ler precision: 6 (Google).
 *
 * Geri dönen format: [lng, lat][] — Mapbox GL JS LineString geometry standardı.
 * Lat/lng swap'i için `.map(([lng, lat]) => [lat, lng])` kullan.
 */

export function decodePolyline(str: string, precision = 5): Array<[number, number]> {
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: Array<[number, number]> = [];
  while (index < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}
