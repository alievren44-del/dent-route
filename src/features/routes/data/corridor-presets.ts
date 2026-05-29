/**
 * corridor-presets — Hazır (kayıtlı) koridor rotaları.
 *
 * Rep "çiz" yerine listeden seçer → A/B otomatik dolar → rota + yol üstü
 * klinikler hesaplanır. İlçe listesi CorridorRoutePage'de polyline'dan canlı
 * türetilir (districtsAlongPolyline), bu yüzden preset sadece A/B uçları tutar.
 *
 * Yeni rota eklemek: aşağı bir obje ekle. lat/lng il merkez centroid'i
 * (provinces.json). Maliyet $0 — preset sadece koordinat, tarama değil.
 */

export interface CorridorPreset {
  id: string;
  name: string;
  a: { placeName: string; lat: number; lng: number };
  b: { placeName: string; lat: number; lng: number };
}

export const CORRIDOR_PRESETS: CorridorPreset[] = [
  {
    id: 'ankara-sivas',
    name: 'Ankara → Sivas',
    a: { placeName: 'Ankara', lat: 39.9334, lng: 32.8597 },
    b: { placeName: 'Sivas', lat: 39.7477, lng: 37.0179 },
  },
  {
    id: 'ankara-malatya',
    name: 'Ankara → Malatya',
    a: { placeName: 'Ankara', lat: 39.9334, lng: 32.8597 },
    b: { placeName: 'Malatya', lat: 38.3552, lng: 38.3095 },
  },
  {
    id: 'ankara-kastamonu',
    name: 'Ankara → Kastamonu',
    a: { placeName: 'Ankara', lat: 39.9334, lng: 32.8597 },
    b: { placeName: 'Kastamonu', lat: 41.3887, lng: 33.7827 },
  },
  {
    id: 'ankara-kayseri',
    name: 'Ankara → Kayseri',
    a: { placeName: 'Ankara', lat: 39.9334, lng: 32.8597 },
    b: { placeName: 'Kayseri', lat: 38.7312, lng: 35.4787 },
  },
];
