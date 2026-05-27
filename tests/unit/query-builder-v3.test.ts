/**
 * Phase 6 — clinic-scan-v3 sorgu üretici + uzmanlık tespit birim testleri.
 *
 * `buildQueries`: text + nearby + specialty array'leri üretir.
 *   - text: 8 hedefli base + mahalle çiftleri (en az 3 token kalanlar)
 *   - nearby: NearbySearch keyword (grid noktası başına tekrar edilir)
 *   - specialty: 7 dental uzmanlık × ilçe
 *
 * `isSpecialty`: dönen klinik isminden uzmanlık göstergesi çıkarır.
 */

import { describe, expect, it } from 'vitest';
import { buildQueries } from '../../supabase/functions/clinic-scan-v3/query-builder';
import {
  SPECIALTY_KEYWORDS,
  isSpecialty,
} from '../../supabase/functions/clinic-scan-v3/specialty-queries';

describe('buildQueries', () => {
  it('returns text + nearby + specialty arrays', () => {
    const q = buildQueries({
      ilceName: 'Battalgazi',
      ilName: 'Malatya',
      neighborhoods: [
        'Hamidiye',
        'Tunahan',
        'Ataköy',
        'Çamurlu',
        'Beydağı',
        'Hidayet',
        'Kiltepe',
      ],
    });
    expect(q.text.length).toBeGreaterThanOrEqual(6);
    expect(q.nearby).toContain('diş hekimi');
    expect(q.specialty).toHaveLength(SPECIALTY_KEYWORDS.length);
  });

  it('handles empty neighborhoods (uses base templates only)', () => {
    const q = buildQueries({ ilceName: 'X', ilName: 'Y', neighborhoods: [] });
    expect(q.text.length).toBeGreaterThan(0); // at least merkez + nöbetçi + ADSP queries
  });

  it('includes "Dt." prefix in nearby (kritik bireysel hekim sorgu)', () => {
    const q = buildQueries({ ilceName: 'A', ilName: 'B', neighborhoods: ['M1'] });
    expect(q.nearby.some((k) => k.includes('Dt.'))).toBe(true);
  });

  it('specialty queries include ilce name', () => {
    const q = buildQueries({ ilceName: 'Battalgazi', ilName: 'Malatya', neighborhoods: [] });
    expect(q.specialty.every((s) => s.includes('Battalgazi'))).toBe(true);
  });
});

describe('isSpecialty', () => {
  it('matches ortodonti', () => {
    expect(isSpecialty('Ortodonti Uzm. Dr.')).toBe(true);
  });
  it('matches Uzm. Dr. Dt. pattern', () => {
    expect(isSpecialty('Uzm. Dr. Dt. Ali')).toBe(true);
  });
  it('does not match generic dis hekimi', () => {
    expect(isSpecialty('Diş Hekimi Ahmet')).toBe(false);
  });
});
