// ============================================================================
// grid.ts — Grid point generator for clinic-scan-v3
// ============================================================================
//
// Brief madde 5: 1.5km grid step + 900m bias radius (NearbySearch per-point
// radius). Step sabit (1500m) — yoğunluk countTarget ile ayarlanır.
//
// countTarget mapping (district-classifier ile uyumlu):
//   MEGA (>=500k)   → 35  (5×7 / 6×6 - 1)
//   Büyük (>=200k)  → 25  (5×5)
//   Orta (>=80k)    → 15  (4×4 - 1)
//   Küçük (>=20k)   → 8   (3×3 - 1 / ring + merkez)
//   ÇokKüçük (<20k) → 5   (merkez + N/S/E/W)
//
// Pragmatik algoritma:
//   side = ceil(sqrt(countTarget))
//   side×side grid (1.5km step) üret, slice(0, countTarget)
//   Sıralama: orta noktalardan dışa doğru spiraller değil — basit row-major.
//   Merkez en başta — fail-fast için (eğer grid generation buggy ise ilk
//   noktada zaten merkez bulunur).
// ============================================================================

export interface GridPoint {
  lat: number;
  lng: number;
}

const STEP_METERS = 1500; // Brief madde 5: 1.5km grid spacing

/**
 * Build a grid of `countTarget` points centered at (centerLat, centerLng).
 *
 * Step: 1.5km (sabit). Grid boyutu: ceil(sqrt(countTarget))×ceil(sqrt(countTarget))
 * sonra ilk `countTarget` nokta seçilir. Merkez nokta her zaman dahil — grid
 * row-major üretilir ama önce array içinde merkez başa konulur.
 *
 * `radiusM` argümanı imza uyumluluğu için var; step sabit olduğu için kullanılmıyor
 * (per-point bias radius EF tarafında 900m olarak sabit). Eğer countTarget grid
 * spread'i çok küçük kalırsa (ÇokKüçük: 5 nokta = 3×3 - 4) hâlâ ilçe merkezi
 * civarını kapsar, bu yeterli.
 */
export function makeGrid(
  centerLat: number,
  _centerLng: number,
  _radiusM: number,
  countTarget: number,
): GridPoint[] {
  if (!Number.isFinite(centerLat) || !Number.isFinite(_centerLng)) return [];
  const n = Math.max(1, Math.floor(countTarget));

  const latPerM = 1 / 111000;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  // Guard: cos(±90°) → 0 → division by zero. cosLat<0.01 → kutuplara çok yakın,
  // pratikte Türkiye için olmaz ama defensive.
  const safeCosLat = Math.abs(cosLat) < 0.01 ? 0.01 : cosLat;
  const lngPerM = 1 / (111000 * safeCosLat);
  const stepLat = STEP_METERS * latPerM;
  const stepLng = STEP_METERS * lngPerM;

  // Single-point case → just the center.
  if (n === 1) {
    return [{ lat: centerLat, lng: _centerLng }];
  }

  // 5 nokta özel: merkez + N/S/E/W (1.5km offset).
  if (n === 5) {
    return [
      { lat: centerLat, lng: _centerLng },
      { lat: centerLat + stepLat, lng: _centerLng },
      { lat: centerLat - stepLat, lng: _centerLng },
      { lat: centerLat, lng: _centerLng + stepLng },
      { lat: centerLat, lng: _centerLng - stepLng },
    ];
  }

  // 8 nokta özel: ring (N, NE, E, SE, S, SW, W, NW) — merkez dahil edilmiyor
  // çünkü 5'te zaten var; 8 köprü tier (Küçük) için ring + ileride 9. nokta
  // gerekirse merkez eklenir. Brief'e göre 8 = ring + merkez fakat ring
  // 8 nokta + merkez = 9 olur; tier "8" diyor → ring only, merkez ilk olarak
  // koyalım, ring'in 7'sini al → toplam 8.
  if (n === 8) {
    return [
      { lat: centerLat, lng: _centerLng }, // merkez
      { lat: centerLat + stepLat, lng: _centerLng }, // N
      { lat: centerLat + stepLat, lng: _centerLng + stepLng }, // NE
      { lat: centerLat, lng: _centerLng + stepLng }, // E
      { lat: centerLat - stepLat, lng: _centerLng + stepLng }, // SE
      { lat: centerLat - stepLat, lng: _centerLng }, // S
      { lat: centerLat - stepLat, lng: _centerLng - stepLng }, // SW
      { lat: centerLat, lng: _centerLng - stepLng }, // W
      // NW dahil edilmiyor → 8 nokta toplam
    ];
  }

  // Generic: ceil(sqrt(n))×ceil(sqrt(n)) grid, row-major, slice to n.
  // Grid origin centerLat-stepLat*(rows-1)/2, centerLng-stepLng*(cols-1)/2
  const side = Math.ceil(Math.sqrt(n));
  const originLat = centerLat - (stepLat * (side - 1)) / 2;
  const originLng = _centerLng - (stepLng * (side - 1)) / 2;

  const all: GridPoint[] = [];
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      all.push({
        lat: originLat + r * stepLat,
        lng: originLng + c * stepLng,
      });
    }
  }

  // Merkez noktayı en başa koy (fail-fast: ilk noktada her zaman merkez)
  // ve ilk N noktayı al. side*side >= n her zaman.
  // Merkez index: side odd → middle cell; side even → cell closest to center.
  const midRow = Math.floor(side / 2);
  const midCol = Math.floor(side / 2);
  const centerIdx = midRow * side + midCol;
  if (centerIdx > 0 && centerIdx < all.length) {
    const [centerCell] = all.splice(centerIdx, 1);
    all.unshift(centerCell);
  }

  return all.slice(0, n);
}
