// ============================================================================
// dedup.ts — Türkçe-aware deduplication for clinic-scan-v3
// ============================================================================
//
// Brief madde 8: norm(name)[:14] eşit VEYA içerme + haversine <150m
// → aynı klinik kabul edilir.
//
// Türkçe karakter map (locale-aware lowercase + ASCII fold + alfanümerik):
//   ç→c  ğ→g  ı→i  ö→o  ş→s  ü→u  â→a  î→i  û→u
//   "İ" toLocaleLowerCase('tr-TR') ile "i" → ek map'e gerek yok.
//   Apostrof / nokta / virgül / boşluk → silinir (sadece [a-z0-9]).
//
// Earlier-wins: input array sıralı geliyor (örn. Google önce, sonra OSM,
// sonra DoktorTakvimi). İlk gelen kayıt seçilir; sonrakiler düşürülür.
// ============================================================================

const TR_MAP: Record<string, string> = {
  'ç': 'c',
  'ğ': 'g',
  'ı': 'i',
  'ö': 'o',
  'ş': 's',
  'ü': 'u',
  'â': 'a',
  'î': 'i',
  'û': 'u',
};

/**
 * Türkçe-aware lowercase + ASCII fold + alfanümerik karakter dışı her şeyi at.
 *
 * Örn: "Dt. Ali Şahin & Ortakları" → "dtalisahinveortaklari"
 *      "Özel Çağlar Diş Kliniği"  → "ozelcaglardisklinigi"
 */
export function normNameTr(s: string): string {
  if (!s) return '';
  let n = s.toLocaleLowerCase('tr-TR').trim();
  for (const [a, b] of Object.entries(TR_MAP)) {
    n = n.replaceAll(a, b);
  }
  return n.replace(/[^a-z0-9]/g, '');
}

/**
 * Haversine — iki nokta arası metre cinsinden mesafe.
 * R = 6371000m (ortalama Dünya yarıçapı).
 */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface DedupCandidate {
  key: string; // unique identifier (place_id veya synthetic)
  name: string;
  lat: number;
  lng: number;
}

const NAME_PREFIX_LEN = 14;
const DEDUP_DISTANCE_M = 150;

/**
 * Brief madde 8: normalize edilmiş isim ilk 14 karakter eşit VEYA biri diğerinin
 * içinde + haversine <150m → duplicate.
 *
 * Algoritma O(n²) — n≤500 için Edge Function wall-clock dert değil. Daha büyük
 * setler için spatial index/grid hash kurulması gerekir.
 *
 * Earlier-wins (input order). Geri dönen array input order'ı korur, sadece
 * duplicate olanları çıkarır.
 */
export function dedupClinics<T extends DedupCandidate>(items: T[]): T[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  // Pre-compute normalized names (avoid recomputation in O(n²) loop).
  const norms: string[] = items.map((it) => normNameTr(it.name).slice(0, NAME_PREFIX_LEN));

  const survivors: T[] = [];
  const survivorNorms: string[] = [];
  const survivorLats: number[] = [];
  const survivorLngs: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const cand = items[i];
    if (!cand) continue;
    const candNorm = norms[i] ?? '';

    // Empty name normaliyle (Çince/Arapça/sadece sembol vs) — yine de kabul et
    // ama distance-only dedup yap.
    let isDup = false;
    for (let j = 0; j < survivors.length; j++) {
      const sNorm = survivorNorms[j] ?? '';
      const sLat = survivorLats[j] ?? 0;
      const sLng = survivorLngs[j] ?? 0;
      // Name match: equal OR one contains the other (her ikisi de >=3 karakter
      // olduğunda — kısa isimler false-positive yapar).
      let nameMatch = false;
      if (candNorm && sNorm) {
        if (candNorm === sNorm) {
          nameMatch = true;
        } else if (
          candNorm.length >= 3 &&
          sNorm.length >= 3 &&
          (candNorm.includes(sNorm) || sNorm.includes(candNorm))
        ) {
          nameMatch = true;
        }
      }
      if (!nameMatch) continue;

      // Distance check.
      const d = haversineM(sLat, sLng, cand.lat, cand.lng);
      if (d < DEDUP_DISTANCE_M) {
        isDup = true;
        break;
      }
    }

    if (!isDup) {
      survivors.push(cand);
      survivorNorms.push(candNorm);
      survivorLats.push(cand.lat);
      survivorLngs.push(cand.lng);
    }
  }

  return survivors;
}
