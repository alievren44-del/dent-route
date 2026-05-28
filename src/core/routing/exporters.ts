/**
 * Route exporters — harici harita uygulamalarına derin link üretici saf fonksiyonlar.
 *
 * Desteklenen: Google Maps (driving/walking), Apple Maps, Yandex Maps.
 * React/React Router bağımlılığı YOK — server/CLI testlerinde de kullanılabilir.
 *
 * NOT (Google Maps): /dir/ endpoint'i origin + 9 waypoint + destination = max ~10
 * nokta destekler. Daha uzun rotalar otomatik olarak parçalanır. Her parça
 * önceki parçanın son durağından başlar (zincirleme).
 */

export interface RoutePoint {
  lat: number;
  lng: number;
}

export type TravelMode = 'driving' | 'walking' | 'bicycling';

/** Google Maps /dir/ endpoint origin + waypoints + destination = 10 nokta. */
const GMAPS_MAX_POINTS_PER_URL = 10;

function fmt(p: RoutePoint): string {
  return `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
}

/**
 * Google Maps URL'leri üretir. start + stops > 10 ise parçalara böler.
 * Dönen dizinin uzunluğu >= 1 garantilidir (start gerekli).
 */
export function buildGoogleMapsUrls(
  start: RoutePoint,
  stops: RoutePoint[],
  mode: TravelMode = 'driving',
): string[] {
  const all: RoutePoint[] = [start, ...stops];
  if (all.length === 1) {
    // Sadece başlangıç — harita aç ama yol tarifi olmadan
    return [`https://www.google.com/maps/search/?api=1&query=${fmt(start)}`];
  }

  const urls: string[] = [];
  let cursor = 0;

  while (cursor < all.length - 1) {
    // Bu parçanın başı (origin)
    const chunkStart = cursor;
    const chunkEnd = Math.min(chunkStart + GMAPS_MAX_POINTS_PER_URL - 1, all.length - 1);
    const chunk = all.slice(chunkStart, chunkEnd + 1);

    const origin = chunk[0]!;
    const destination = chunk[chunk.length - 1]!;
    const waypoints = chunk.slice(1, -1);

    const params = new URLSearchParams();
    params.set('api', '1');
    params.set('origin', fmt(origin));
    params.set('destination', fmt(destination));
    params.set('travelmode', mode);
    if (waypoints.length > 0) {
      params.set('waypoints', waypoints.map(fmt).join('|'));
    }

    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`);

    // Bir sonraki parça bu parçanın son noktasından başlasın (zincirleme)
    cursor = chunkEnd;
  }

  return urls;
}

/**
 * Apple Maps URL — saddr / daddr / waypoint zinciri.
 * Apple Maps web `https://maps.apple.com/?saddr=...&daddr=...+to:...+to:...` formatını destekler.
 */
export function buildAppleMapsUrl(start: RoutePoint, stops: RoutePoint[]): string {
  if (stops.length === 0) {
    return `https://maps.apple.com/?ll=${fmt(start)}`;
  }
  const saddr = fmt(start);
  const daddr = stops.map(fmt).join('+to:');
  const params = new URLSearchParams();
  params.set('saddr', saddr);
  params.set('daddr', daddr);
  params.set('dirflg', 'd'); // driving
  return `https://maps.apple.com/?${params.toString()}`;
}

/**
 * Yandex Maps URL — rtext lat1,lng1~lat2,lng2~... formatı.
 * rtt=auto = sürüş.
 */
export function buildYandexMapsUrl(start: RoutePoint, stops: RoutePoint[]): string {
  const all: RoutePoint[] = [start, ...stops];
  const rtext = all.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('~');
  const params = new URLSearchParams();
  params.set('rtext', rtext);
  params.set('rtt', 'auto');
  return `https://yandex.com/maps/?${params.toString()}`;
}

/**
 * Tek URL'de tüm rotayı Google Maps'te aç — 10+ duraklarda otomatik parçalar
 * varsa ilk URL'yi döndürür (paylaşım için).
 */
export function buildGoogleMapsRouteUrl(
  stops: Array<{ lat: number; lng: number; name?: string }>,
): string {
  if (stops.length === 0) return 'https://www.google.com/maps';
  const start = stops[0]!;
  const rest = stops.slice(1);
  const urls = buildGoogleMapsUrls(start, rest, 'driving');
  return urls[0] ?? 'https://www.google.com/maps';
}

/**
 * WhatsApp mesajı — rep'e gönderilecek rota paylaşım metni.
 */
export interface WaMessagePayload {
  repName: string;
  routeName: string;
  origin: string;
  destination: string;
  km: number;
  durationMin: number;
  clinics: Array<{ name: string; district?: string | null }>;
  mapsUrl: string;
}

export function buildWaWhatsappMessage(p: WaMessagePayload): string {
  const lines: string[] = [];
  lines.push(`🚗 Merhaba ${p.repName},`);
  lines.push('');
  lines.push(`📋 ${p.routeName}`);
  lines.push('');
  lines.push(`📍 Başlangıç: ${p.origin}`);
  lines.push(`🎯 Varış: ${p.destination}`);
  lines.push(`📏 ${p.km.toFixed(1)} km · ⏱️ ${p.durationMin} dk`);
  lines.push('');
  if (p.clinics.length > 0) {
    lines.push(`🏥 Uğrak klinikler (${p.clinics.length}):`);
    const show = p.clinics.slice(0, 15);
    show.forEach((c, i) => {
      lines.push(`${i + 1}. ${c.name}${c.district ? ` — ${c.district}` : ''}`);
    });
    if (p.clinics.length > 15) {
      lines.push(`... ve ${p.clinics.length - 15} klinik daha`);
    }
    lines.push('');
  }
  lines.push(`🗺️ Google Maps: ${p.mapsUrl}`);
  return lines.join('\n');
}
