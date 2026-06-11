/**
 * detour-haversine — Mesafe & detour saf hesap testleri.
 *
 * `src/features/routes/lib/detour-calc.ts`:
 *   - haversineKm (check-in / yakınlık doğrulamada kullanılan büyük-daire mesafe)
 *   - computeDetour (A→C→B sapma km/dk)
 *   - pointToPolylineKm (klinik ana yola dik mesafe)
 *   - adaptiveCorridorParams (rota uzunluğuna göre buffer/eşik)
 *
 * Bu dosya tsp.ts içindeki haversineKm'den AYRI (routes/lib) — disjoint.
 */

import { describe, expect, it } from 'vitest';
import {
  haversineKm,
  computeDetour,
  computeDetourFromPolyline,
  pointToPolylineKm,
  adaptiveCorridorParams,
} from '@features/routes/lib/detour-calc';

describe('haversineKm — mesafe doğrulama (check-in)', () => {
  it('aynı nokta → 0', () => {
    expect(haversineKm({ lat: 39, lng: 35 }, { lat: 39, lng: 35 })).toBe(0);
  });

  it('simetrik (a→b === b→a)', () => {
    const a = { lat: 38.42, lng: 27.14 }; // İzmir
    const b = { lat: 39.93, lng: 32.85 }; // Ankara
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });

  it('İzmir↔Ankara ~520-540 km aralığında (gerçekçi)', () => {
    const izmir = { lat: 38.42, lng: 27.14 };
    const ankara = { lat: 39.93, lng: 32.85 };
    const d = haversineKm(izmir, ankara);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(560);
  });

  it('1 derece enlem ~111 km', () => {
    const d = haversineKm({ lat: 39, lng: 35 }, { lat: 40, lng: 35 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });

  it('check-in yakınlık eşiği: 50 m mesafe < 0.1 km sayılır', () => {
    // ~0.00045 derece enlem ≈ 50 m
    const a = { lat: 39.0, lng: 35.0 };
    const b = { lat: 39.00045, lng: 35.0 };
    const d = haversineKm(a, b);
    expect(d).toBeLessThan(0.1);
    expect(d).toBeGreaterThan(0.04);
  });
});

describe('computeDetour — A→C→B sapma', () => {
  it('C tam A-B doğrultusunda → sapma ≈ 0', () => {
    const a = { lat: 39.0, lng: 35.0 };
    const b = { lat: 39.0, lng: 36.0 };
    const c = { lat: 39.0, lng: 35.5 }; // tam ortada
    const { distanceKm } = computeDetour(a, c, b);
    expect(distanceKm).toBeCloseTo(0, 2);
  });

  it('C rotadan uzakta → pozitif sapma', () => {
    const a = { lat: 39.0, lng: 35.0 };
    const b = { lat: 39.0, lng: 36.0 };
    const c = { lat: 39.5, lng: 35.5 }; // kuzeye sapma
    const { distanceKm, durationMin } = computeDetour(a, c, b);
    expect(distanceKm).toBeGreaterThan(0);
    expect(durationMin).toBeGreaterThan(0);
  });

  it('sapma asla negatif değil (Math.max(0,...))', () => {
    const a = { lat: 39, lng: 35 };
    const b = { lat: 39, lng: 35 }; // baseline=0
    const c = { lat: 39.1, lng: 35.1 };
    const { distanceKm } = computeDetour(a, c, b);
    expect(distanceKm).toBeGreaterThanOrEqual(0);
  });

  it('walking profili driving-den daha uzun süre verir (5 vs 50 km/h)', () => {
    const a = { lat: 39.0, lng: 35.0 };
    const b = { lat: 39.0, lng: 36.0 };
    const c = { lat: 39.3, lng: 35.5 };
    const drive = computeDetour(a, c, b, 'driving');
    const walk = computeDetour(a, c, b, 'walking');
    expect(walk.durationMin).toBeGreaterThan(drive.durationMin);
    // aynı mesafe, farklı hız
    expect(walk.distanceKm).toBeCloseTo(drive.distanceKm, 6);
  });
});

describe('pointToPolylineKm', () => {
  it('boş polyline → Infinity', () => {
    expect(pointToPolylineKm({ lat: 39, lng: 35 }, [])).toBe(Infinity);
  });

  it('tek nokta polyline → o noktaya haversine mesafe', () => {
    const d = pointToPolylineKm({ lat: 39, lng: 35 }, [[35.0, 39.1]]);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeCloseTo(haversineKm({ lat: 39, lng: 35 }, { lat: 39.1, lng: 35 }), 1);
  });

  it('nokta segment üzerinde → ~0 km', () => {
    // [lng, lat] çiftleri; yatay segment lat=39 boyunca
    const poly: Array<[number, number]> = [
      [35.0, 39.0],
      [36.0, 39.0],
    ];
    const d = pointToPolylineKm({ lat: 39.0, lng: 35.5 }, poly);
    expect(d).toBeLessThan(0.05);
  });

  it('computeDetourFromPolyline = 2 × crossKm', () => {
    const poly: Array<[number, number]> = [
      [35.0, 39.0],
      [36.0, 39.0],
    ];
    const c = { lat: 39.2, lng: 35.5 };
    const cross = pointToPolylineKm(c, poly);
    const { distanceKm } = computeDetourFromPolyline(c, poly);
    expect(distanceKm).toBeCloseTo(2 * cross, 6);
  });
});

describe('adaptiveCorridorParams — rota uzunluğu eşikleri', () => {
  it('kısa şehir-içi (<30km) → sıkı buffer 800m, limit 25', () => {
    const p = adaptiveCorridorParams(10);
    expect(p.bufferM).toBe(800);
    expect(p.limit).toBe(25);
    expect(p.excludeStartEndKm).toBe(0.5);
  });

  it('orta (30-100km) → 2500m buffer', () => {
    expect(adaptiveCorridorParams(50).bufferM).toBe(2500);
  });

  it('uzun (300-600km) → 15000m buffer, limit 250', () => {
    const p = adaptiveCorridorParams(450);
    expect(p.bufferM).toBe(15000);
    expect(p.limit).toBe(250);
  });

  it('çok uzun (>600km) → 25000m buffer, limit 300', () => {
    const p = adaptiveCorridorParams(900);
    expect(p.bufferM).toBe(25000);
    expect(p.limit).toBe(300);
  });

  it('buffer ve limit rota uzunluğuyla monoton artar', () => {
    const a = adaptiveCorridorParams(10);
    const b = adaptiveCorridorParams(50);
    const c = adaptiveCorridorParams(200);
    const d = adaptiveCorridorParams(450);
    const e = adaptiveCorridorParams(900);
    const buffers = [a.bufferM, b.bufferM, c.bufferM, d.bufferM, e.bufferM];
    for (let i = 1; i < buffers.length; i++) {
      expect(buffers[i]!).toBeGreaterThan(buffers[i - 1]!);
    }
  });

  it('sınır-değer: tam 30 km → orta dilim (>= karşılaştırma değil < kullanılıyor)', () => {
    // routeKm < 30 false → 2. dilim
    expect(adaptiveCorridorParams(30).bufferM).toBe(2500);
    expect(adaptiveCorridorParams(29.99).bufferM).toBe(800);
  });
});
