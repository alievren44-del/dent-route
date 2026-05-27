/**
 * tsp.ts — Nearest-Neighbor greedy TSP + 2-opt hybrid optimizasyon.
 *
 * Phase 4 (Akıllı Tarama Motoru) — `ScanRoutePlanner` için saf algoritma helper.
 * React/DOM bağımlılığı yok; sadece pure compute.
 *
 * Hibrit yaklaşım:
 *   1) `nearestNeighborGreedy` → O(n²) hızlı başlangıç çözümü
 *   2) `twoOpt` (mevcut `src/features/routes/two-opt.ts`) → %5-10 iyileştirme
 *
 * Mevcut `src/features/routes/two-opt.ts`'yi dinamik import ile kullanır
 * (bundle coupling olmaması için).
 */

export interface TspPoint {
  lat: number;
  lng: number;
}

export interface TspResult {
  /** Input dizisindeki sıralı index'ler — başlangıç noktası DÂHİL DEĞİL */
  order: number[];
  /** Toplam km mesafe (start → 1. → 2. → ... → son [+ start, returnHome=true]) */
  totalDistanceKm: number;
  /**
   * Adım adım kümülatif mesafe.
   *  - `cumulativeDistancesKm[0]` = start → order[0]
   *  - `cumulativeDistancesKm[k]` = start → ... → order[k] (start dahil k+1 leg)
   *  - returnHome=true ise son leg start'a dönüş eklidir.
   */
  cumulativeDistancesKm: number[];
}

const EARTH_RADIUS_KM = 6371;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Haversine km mesafe. İki coğrafi noktanın büyük daire mesafesi.
 */
export function haversineKm(a: TspPoint, b: TspPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/**
 * Nearest-Neighbor greedy: her adımda en yakın ziyaret edilmemiş noktaya git.
 *
 * - Boş input → order=[], totalKm=0
 * - returnHome=true ise toplam mesafeye start'a dönüş ekler.
 *
 * @complexity O(n²)
 */
export function nearestNeighborGreedy(
  points: TspPoint[],
  start: TspPoint,
  options: { returnHome?: boolean } = {},
): TspResult {
  const returnHome = options.returnHome ?? false;
  const n = points.length;
  if (n === 0) {
    return { order: [], totalDistanceKm: 0, cumulativeDistancesKm: [] };
  }

  const visited = new Array<boolean>(n).fill(false);
  const order: number[] = [];
  const cumulative: number[] = [];

  let current: TspPoint = start;
  let totalKm = 0;

  for (let step = 0; step < n; step++) {
    let bestIdx = -1;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const p = points[i]!;
      const d = haversineKm(current, p);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    // bestIdx > -1 garanti (henüz ziyaret edilmemiş eleman var)
    visited[bestIdx] = true;
    order.push(bestIdx);
    totalKm += bestDist;
    cumulative.push(totalKm);
    current = points[bestIdx]!;
  }

  if (returnHome) {
    const back = haversineKm(current, start);
    totalKm += back;
    // cumulative son entry'ye dönüş ayrı bir leg olarak eklenmez (table render'da rep son durağı görüyor)
    // ama totalDistanceKm'e dahil ediliyor.
  }

  return {
    order,
    totalDistanceKm: totalKm,
    cumulativeDistancesKm: cumulative,
  };
}

/**
 * Verilen waypoint dizisi (indeksli) için toplam tour mesafesi (km).
 * Tour: waypoints[0] → waypoints[1] → ... → waypoints[n-1]
 */
function tourDistanceKm(waypoints: TspPoint[]): number {
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    total += haversineKm(waypoints[i]!, waypoints[i + 1]!);
  }
  return total;
}

/**
 * Hibrit optimizer: NN greedy + 2-opt refinement.
 *
 * 1. NN greedy ile başlangıç sıralaması üret.
 * 2. `[start, ...orderedPoints]` array'ini 2-opt'a ver (startFixed=true).
 * 3. Sonuçtan start hariç order'ı recover et + km cumulative hesapla.
 *
 * `twoOpt` mevcut implementasyon (`src/features/routes/two-opt.ts`) dinamik import edilir,
 * bundle coupling oluşmaz.
 *
 * @returns NN-only sonuca ek olarak `initialKm` (NN), `savedKm` (NN→2-opt iyileştirmesi)
 *          ve `method` ('nn' veya 'nn+2opt') alanlarını döner.
 */
export async function optimizeRouteHybrid(
  points: TspPoint[],
  start: TspPoint,
  options: { returnHome?: boolean } = {},
): Promise<
  TspResult & { initialKm: number; savedKm: number; method: 'nn' | 'nn+2opt' }
> {
  const returnHome = options.returnHome ?? false;
  const nnResult = nearestNeighborGreedy(points, start, { returnHome });

  if (points.length < 3) {
    // 2-opt için anlamlı geliştirme yok (n=0,1,2)
    return {
      ...nnResult,
      initialKm: nnResult.totalDistanceKm,
      savedKm: 0,
      method: 'nn',
    };
  }

  // 2-opt için: [start, ...orderedPoints (NN sırasıyla)]
  const orderedPoints: TspPoint[] = nnResult.order.map((i) => points[i]!);
  const sequence: TspPoint[] = [start, ...orderedPoints];

  try {
    const mod = await import('@/features/routes/two-opt');
    const result = mod.twoOpt(sequence, {
      startFixed: true,
      endFixed: returnHome,
      maxIterations: 60,
    });

    // 2-opt order: sequence içindeki indeksler (0=start dahil).
    // Bizim final order: result.order'dan 0'ı çıkart, kalanını orderedPoints
    // üzerinden orijinal `points` index'ine çevir.
    const finalIndicesInOriginal: number[] = [];
    for (const seqIdx of result.order) {
      if (seqIdx === 0) continue; // start
      const orderedIdx = seqIdx - 1; // orderedPoints içinde
      const originalIdx = nnResult.order[orderedIdx]!;
      finalIndicesInOriginal.push(originalIdx);
    }

    // Kümülatif km'i baştan hesapla (2-opt sonrası optimal sıraya göre)
    const finalWaypoints: TspPoint[] = [
      start,
      ...finalIndicesInOriginal.map((i) => points[i]!),
    ];
    const cumulativeKm: number[] = [];
    let running = 0;
    for (let i = 1; i < finalWaypoints.length; i++) {
      running += haversineKm(finalWaypoints[i - 1]!, finalWaypoints[i]!);
      cumulativeKm.push(running);
    }
    let totalKm = running;
    if (returnHome && finalWaypoints.length > 0) {
      const last = finalWaypoints[finalWaypoints.length - 1]!;
      totalKm += haversineKm(last, start);
    }

    const initialKm = nnResult.totalDistanceKm;
    // savedKm: NN ile 2-opt sonrası fark (her ikisi de returnHome dahil/hariç tutarlı)
    const savedKmRaw = initialKm - totalKm;
    const savedKm = savedKmRaw > 0 ? savedKmRaw : 0;

    return {
      order: finalIndicesInOriginal,
      totalDistanceKm: totalKm,
      cumulativeDistancesKm: cumulativeKm,
      initialKm,
      savedKm,
      method: savedKm > 0 ? 'nn+2opt' : 'nn',
    };
  } catch {
    // 2-opt yüklenemediyse NN sonucunu döndür (defensive)
    return {
      ...nnResult,
      initialKm: nnResult.totalDistanceKm,
      savedKm: 0,
      method: 'nn',
    };
  }
}

/**
 * Helper: verilen index sırasına göre `[start, ...points[order]]` için
 * kümülatif km dizisi üret. UI'de tablo render için kullanılır.
 *
 * (optimizeRouteHybrid bunu zaten döner ama dışarıdan da çağrılabilsin.)
 */
export function computeCumulativeKm(
  points: TspPoint[],
  start: TspPoint,
  order: number[],
): number[] {
  const result: number[] = [];
  let prev: TspPoint = start;
  let running = 0;
  for (const idx of order) {
    const cur = points[idx]!;
    running += haversineKm(prev, cur);
    result.push(running);
    prev = cur;
  }
  return result;
}

// Internal helper exported only for diagnostics/tests.
export const __internal = { tourDistanceKm };
