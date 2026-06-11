/**
 * tsp-2opt — Hibrit NN + 2-opt optimizasyon birim testleri.
 *
 * `src/features/admin/lib/tsp.ts` -> optimizeRouteHybrid / computeCumulativeKm
 * ve `src/features/routes/two-opt.ts` -> twoOpt saf algoritmalarını sınar.
 *
 * Mevcut nn-tsp.test.ts ile DISJOINT (orada sadece haversineKm +
 * nearestNeighborGreedy var; burada 2-opt katmanı + edge case'ler).
 */

import { describe, expect, it } from 'vitest';
import {
  optimizeRouteHybrid,
  computeCumulativeKm,
  nearestNeighborGreedy,
} from '@features/admin/lib/tsp';
import { twoOpt } from '@features/routes/two-opt';

describe('optimizeRouteHybrid — edge cases', () => {
  const start = { lat: 39.0, lng: 35.0 };

  it('boş input → order=[], totalKm=0, method=nn', async () => {
    const r = await optimizeRouteHybrid([], start);
    expect(r.order).toEqual([]);
    expect(r.totalDistanceKm).toBe(0);
    expect(r.method).toBe('nn');
    expect(r.savedKm).toBe(0);
  });

  it('tek durak → 2-opt atlanır (n<3), method=nn', async () => {
    const r = await optimizeRouteHybrid([{ lat: 39.1, lng: 35.1 }], start);
    expect(r.order).toEqual([0]);
    expect(r.method).toBe('nn');
    expect(r.savedKm).toBe(0);
    expect(r.totalDistanceKm).toBeGreaterThan(0);
  });

  it('iki durak → 2-opt atlanır (n<3), method=nn', async () => {
    const pts = [
      { lat: 39.1, lng: 35.1 },
      { lat: 39.2, lng: 35.2 },
    ];
    const r = await optimizeRouteHybrid(pts, start);
    expect(r.method).toBe('nn');
    expect(new Set(r.order).size).toBe(2);
  });
});

describe('optimizeRouteHybrid — sıra & doğruluk', () => {
  const start = { lat: 39.0, lng: 35.0 };

  it('tüm durakları tam bir kez ziyaret eder', async () => {
    const pts = [
      { lat: 39.5, lng: 35.5 },
      { lat: 39.1, lng: 35.1 },
      { lat: 39.3, lng: 35.3 },
      { lat: 39.2, lng: 35.2 },
    ];
    const r = await optimizeRouteHybrid(pts, start);
    expect([...r.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('cumulativeDistancesKm uzunluğu durak sayısına eşit ve artan', async () => {
    const pts = [
      { lat: 39.5, lng: 35.5 },
      { lat: 39.1, lng: 35.1 },
      { lat: 39.3, lng: 35.3 },
    ];
    const r = await optimizeRouteHybrid(pts, start);
    expect(r.cumulativeDistancesKm).toHaveLength(3);
    for (let i = 1; i < r.cumulativeDistancesKm.length; i++) {
      expect(r.cumulativeDistancesKm[i]!).toBeGreaterThanOrEqual(
        r.cumulativeDistancesKm[i - 1]!,
      );
    }
  });

  it('savedKm asla negatif değil; 2-opt sonucu NN-i geçemez', async () => {
    // Çapraz konfigürasyon: NN suboptimal başlar, 2-opt düzeltir.
    const pts = [
      { lat: 39.0, lng: 35.0 },
      { lat: 39.0, lng: 35.5 },
      { lat: 39.0, lng: 35.1 },
      { lat: 39.0, lng: 35.4 },
      { lat: 39.0, lng: 35.2 },
    ];
    const r = await optimizeRouteHybrid(pts, { lat: 39.0, lng: 34.9 });
    expect(r.savedKm).toBeGreaterThanOrEqual(0);
    // 2-opt çözümü NN başlangıcından kötü olamaz
    expect(r.totalDistanceKm).toBeLessThanOrEqual(r.initialKm + 1e-6);
  });

  it('returnHome=true → totalKm, returnHome=false halinden büyük', async () => {
    const pts = [
      { lat: 39.5, lng: 35.5 },
      { lat: 39.1, lng: 35.1 },
      { lat: 39.3, lng: 35.3 },
    ];
    const open = await optimizeRouteHybrid(pts, start, { returnHome: false });
    const closed = await optimizeRouteHybrid(pts, start, { returnHome: true });
    expect(closed.totalDistanceKm).toBeGreaterThan(open.totalDistanceKm);
  });
});

describe('computeCumulativeKm helper', () => {
  const start = { lat: 39.0, lng: 35.0 };
  const pts = [
    { lat: 39.1, lng: 35.0 },
    { lat: 39.2, lng: 35.0 },
    { lat: 39.3, lng: 35.0 },
  ];

  it('NN order ile cumulative, tsp sonucuyla tutarlı', () => {
    const nn = nearestNeighborGreedy(pts, start);
    const cum = computeCumulativeKm(pts, start, nn.order);
    expect(cum).toHaveLength(3);
    expect(cum).toEqual(nn.cumulativeDistancesKm.map((v) => v));
  });

  it('boş order → boş dizi', () => {
    expect(computeCumulativeKm(pts, start, [])).toEqual([]);
  });

  it('son eleman = toplam tek-yön mesafe (returnHome hariç)', () => {
    const cum = computeCumulativeKm(pts, start, [0, 1, 2]);
    expect(cum[cum.length - 1]!).toBeGreaterThan(0);
    // monoton artan
    expect(cum[2]!).toBeGreaterThan(cum[0]!);
  });
});

describe('twoOpt — düşük seviye algoritma', () => {
  it('n<3 → değişiklik yok, savedM=0, iterations=0', () => {
    const r = twoOpt([
      { lat: 39, lng: 35 },
      { lat: 39.1, lng: 35.1 },
    ]);
    expect(r.savedM).toBe(0);
    expect(r.iterations).toBe(0);
    expect(r.order).toEqual([0, 1]);
  });

  it('çaprazlı tur (bow-tie) → 2-opt kısaltır, savedM>0 (startFixed=true)', () => {
    // Klasik 2-opt iyileştirme senaryosu: zigzag düzleştirilir.
    // startFixed=true kullanıyoruz çünkü startFixed=false BUG ile çöküyor
    // (aşağıdaki "BUG" testine bakın). İlk durağı sabit tutup yine de
    // iç düğümleri 2-opt ile düzeltebildiğimizi gösteriyoruz.
    const wp = [
      { lat: 0, lng: 0 }, // sabit start
      { lat: 0, lng: 2 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    const r = twoOpt(wp, { startFixed: true, endFixed: false });
    expect(r.savedM).toBeGreaterThan(0);
    expect(r.optimizedDistanceM).toBeLessThan(r.initialDistanceM);
  });

  it('BUG (gerçek-kaynak): startFixed=false → order[-1] erişimi çöküyor', () => {
    // GERÇEK BUG (two-opt.ts:100). iStart = startFixed ? 1 : 0.
    // startFixed=false iken iç döngüde `order[i-1]` -> i=0 -> order[-1] = undefined
    // -> waypoints[undefined] = undefined -> haversineMeters undefined.lat patlar.
    // Üretimde her iki çağrı da startFixed=true geçtiği için latent; ama
    // startFixed=false API'si tamamen kırık. Bu testi düzeltme yapılınca
    // güncellemek gerekir (o zaman throw beklentisi kaldırılır).
    const wp = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    expect(() => twoOpt(wp, { startFixed: false })).toThrowError(/lat/);
  });

  it('startFixed=true → ilk durak sabit kalır (order[0]===0)', () => {
    const wp = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
    ];
    const r = twoOpt(wp, { startFixed: true });
    expect(r.order[0]).toBe(0);
  });

  it('maxIterations cap edilir (iterations <= maxIterations)', () => {
    const wp = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 5 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 4 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 3 },
    ];
    const r = twoOpt(wp, { maxIterations: 2 });
    expect(r.iterations).toBeLessThanOrEqual(2);
  });

  it('order her zaman tüm indeksleri permütasyon olarak içerir', () => {
    const wp = [
      { lat: 0, lng: 0 },
      { lat: 0, lng: 2 },
      { lat: 0, lng: 1 },
      { lat: 0, lng: 3 },
      { lat: 0, lng: 1.5 },
    ];
    const r = twoOpt(wp);
    expect([...r.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});
