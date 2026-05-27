/**
 * Phase 6 — Nearest-Neighbor TSP + Haversine birim testleri.
 *
 * `src/features/admin/lib/tsp.ts` saf algoritma helper'larını sınar:
 *   - haversineKm: simetri ve same-point sıfırı
 *   - nearestNeighborGreedy: tüm noktaları bir kez ziyaret + en yakın seçim
 *     + kümülatif km uzunluğu + returnHome closing leg davranışı
 */

import { describe, expect, it } from 'vitest';
import { haversineKm, nearestNeighborGreedy } from '@features/admin/lib/tsp';

describe('haversineKm', () => {
  it('zero for same point', () => {
    expect(haversineKm({ lat: 38, lng: 38 }, { lat: 38, lng: 38 })).toBe(0);
  });
  it('symmetric', () => {
    const a = { lat: 38.3, lng: 27.1 };
    const b = { lat: 39.9, lng: 32.8 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 5);
  });
});

describe('nearestNeighborGreedy', () => {
  it('visits all points exactly once', () => {
    const pts = [
      { lat: 38.0, lng: 38.0 },
      { lat: 38.1, lng: 38.1 },
      { lat: 38.2, lng: 38.2 },
    ];
    const result = nearestNeighborGreedy(pts, { lat: 38, lng: 38 });
    expect(new Set(result.order).size).toBe(3);
    expect(result.order.sort()).toEqual([0, 1, 2]);
  });

  it('chooses nearest first', () => {
    const pts = [
      { lat: 38.5, lng: 38.5 }, // far
      { lat: 38.01, lng: 38.01 }, // near
    ];
    const result = nearestNeighborGreedy(pts, { lat: 38, lng: 38 });
    expect(result.order[0]).toBe(1);
  });

  it('totalDistanceKm monotonic with more points', () => {
    const start = { lat: 38, lng: 38 };
    const small = nearestNeighborGreedy([{ lat: 38.01, lng: 38 }], start);
    const big = nearestNeighborGreedy(
      [
        { lat: 38.01, lng: 38 },
        { lat: 38.02, lng: 38 },
      ],
      start,
    );
    expect(big.totalDistanceKm).toBeGreaterThan(small.totalDistanceKm);
  });

  it('cumulativeDistancesKm length matches points length', () => {
    const pts = [
      { lat: 38.0, lng: 38.0 },
      { lat: 38.1, lng: 38.1 },
    ];
    const result = nearestNeighborGreedy(pts, { lat: 38, lng: 38 });
    expect(result.cumulativeDistancesKm).toHaveLength(2);
  });

  it('returnHome=true closes the loop', () => {
    const pts = [{ lat: 38.01, lng: 38 }];
    const start = { lat: 38, lng: 38 };
    const open = nearestNeighborGreedy(pts, start, { returnHome: false });
    const closed = nearestNeighborGreedy(pts, start, { returnHome: true });
    expect(closed.totalDistanceKm).toBeGreaterThan(open.totalDistanceKm);
  });
});
