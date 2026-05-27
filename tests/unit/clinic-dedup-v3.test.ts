/**
 * Phase 6 — clinic-scan-v3 dedup birim testleri.
 *
 * Türkçe-aware normalize (TR lowercase + ASCII fold + alfanümerik),
 * haversine metre cinsi mesafe ve isim+koordinat tabanlı dedup
 * fonksiyonlarının davranışını doğrular.
 *
 * Edge Function modülü saf TypeScript olduğundan vitest doğrudan import edebilir.
 */

import { describe, expect, it } from 'vitest';
import {
  normNameTr,
  haversineM,
  dedupClinics,
} from '../../supabase/functions/clinic-scan-v3/dedup';

describe('normNameTr', () => {
  it('lowers Turkish + folds diacritics', () => {
    expect(normNameTr('Dİş Hekımı Ahmet')).toMatch(/^dishekimiahmet$/);
  });
  it('strips non-alphanumeric', () => {
    expect(normNameTr('Dt. Funda Demir, Ankara')).toMatch(/^dtfundademirankara$/);
  });
  it('handles empty', () => {
    expect(normNameTr('')).toBe('');
  });
});

describe('haversineM', () => {
  it('zero for same point', () => {
    expect(haversineM(38.3, 38.3, 38.3, 38.3)).toBe(0);
  });
  it('~111km per degree latitude', () => {
    expect(haversineM(0, 0, 1, 0)).toBeGreaterThan(110_000);
    expect(haversineM(0, 0, 1, 0)).toBeLessThan(112_000);
  });
  it('~150m threshold check', () => {
    const d = haversineM(38.3, 38.3, 38.3 + 0.0013, 38.3); // ~145m
    expect(d).toBeGreaterThan(140);
    expect(d).toBeLessThan(160);
  });
});

describe('dedupClinics', () => {
  it('removes duplicate name+close coords', () => {
    const items = [
      { key: 'p1', name: 'Dent Bağdat', lat: 38.3, lng: 38.3 },
      { key: 'p2', name: 'Dent Bağdat', lat: 38.3001, lng: 38.3001 }, // 14m
      { key: 'p3', name: 'Aydent Polikliniği', lat: 38.31, lng: 38.31 },
    ];
    const result = dedupClinics(items);
    expect(result).toHaveLength(2);
    expect(result[0]?.key).toBe('p1');
  });

  it('keeps similar names if far apart', () => {
    const items = [
      { key: 'p1', name: 'Diş Hekimi A', lat: 38.3, lng: 38.3 },
      { key: 'p2', name: 'Diş Hekimi A', lat: 38.4, lng: 38.4 }, // ~14km
    ];
    expect(dedupClinics(items)).toHaveLength(2);
  });

  it('substring name match within 150m collapses', () => {
    const items = [
      { key: 'p1', name: 'Dent', lat: 38.3, lng: 38.3 },
      { key: 'p2', name: 'Dent Bağdat', lat: 38.3, lng: 38.3 },
    ];
    expect(dedupClinics(items)).toHaveLength(1);
  });
});
