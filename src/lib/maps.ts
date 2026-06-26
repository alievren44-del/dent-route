/**
 * Harita yardımcı fonksiyonları — Google Maps deep-link (API key gerekmez, ücretsiz URL).
 *
 * Bileşenler bu util'ü import eder; her dosyada local kopya tutulmasına gerek yoktur.
 */

/**
 * Google Maps yol tarifi deep-link URL'i oluşturur.
 *
 * `destination` parametresi koordinat-öncelikli hazırlanır. `name` verilirse
 * "Klinik Adı @lat,lng" biçimi kullanılır; bu sayede Google Maps doğru pin'i ve
 * klinik adını gösterir.
 *
 * @param lat  - Klinik enlemi (WGS-84)
 * @param lng  - Klinik boylamı (WGS-84)
 * @param name - (İsteğe bağlı) Klinik adı; koordinat pinini isimlendirir.
 * @returns Google Maps yol tarifi URL'i (https://www.google.com/maps/dir/...)
 */
export function googleMapsDirectionsUrl(lat: number, lng: number, name?: string): string {
  const dest = name ? `${name} @${lat},${lng}` : `${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
