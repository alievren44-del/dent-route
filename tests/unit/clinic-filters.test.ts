/**
 * Sprint 2 — PROMPT-3
 * Dental kategori filtresi birim testleri.
 *
 * Filter modülü `supabase/functions/clinic-scan/filters.ts` altında — Deno
 * Edge Function ve Node (vitest) tarafından paylaşılır. Saf TypeScript,
 * platform-spesifik import içermez, bu yüzden vitest doğrudan import
 * edebilir (no duplication).
 */

import { describe, it, expect } from 'vitest';
import {
  isValidDentalClinic,
  getFilterForVertical,
} from '../../supabase/functions/clinic-scan/filters';

describe('isValidDentalClinic', () => {
  it('rejects "Güzellik Salonu Funda" (forbidden keyword: güzellik/salon)', () => {
    const r = isValidDentalClinic('Güzellik Salonu Funda', [], '');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/forbidden_keyword/);
  });

  it('accepts "Diş Hekimi Ahmet" by dental keyword in name', () => {
    const r = isValidDentalClinic('Diş Hekimi Ahmet', [], '');
    expect(r.valid).toBe(true);
  });

  it('accepts "XYZ" when Google types include "dentist"', () => {
    const r = isValidDentalClinic('XYZ', ['dentist'], '');
    expect(r.valid).toBe(true);
  });

  it('rejects "Prakter" with types ["health"] (no dental signal)', () => {
    const r = isValidDentalClinic('Prakter', ['health'], '');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('no_dental_signal');
  });

  it('rejects "Ortopedi Merkezi" (forbidden keyword: ortopedi)', () => {
    const r = isValidDentalClinic('Ortopedi Merkezi', [], '');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/forbidden_keyword:ortopedi/);
  });

  it('rejects "Eczane Merkez" (forbidden keyword: eczane)', () => {
    const r = isValidDentalClinic('Eczane Merkez', [], '');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/forbidden_keyword:eczane/);
  });

  it('rejects "Pediatri Polikliniği" (forbidden keyword: pediatri)', () => {
    const r = isValidDentalClinic('Pediatri Polikliniği', [], '');
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/forbidden_keyword:pediatri/);
  });

  it('accepts "Dental Klinik" by dental keyword (no types)', () => {
    const r = isValidDentalClinic('Dental Klinik', [], '');
    expect(r.valid).toBe(true);
  });

  it('accepts when dental keyword is in the address', () => {
    const r = isValidDentalClinic('Doktor Merkezi', [], 'Diş Sokak No 5');
    expect(r.valid).toBe(true);
  });

  it('rejects empty name', () => {
    const r = isValidDentalClinic('', ['dentist'], '');
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('empty_name');
  });

  it('dentist type tag varsa forbidden tek başına reddetmez (recall-fix)', () => {
    // Recall-fix (8393aa2): 'göz'/'berber' gibi alt-dize çakışmaları GERÇEK
    // hekimleri elemesin diye forbidden YALNIZ dental sinyal YOKSA veto eder.
    // dentist type tag güçlü dental sinyaldir → forbidden tek başına reddetmez
    // (bilinçli recall>precision; saha taramada Ayrancı filtered_out 46→3).
    const r = isValidDentalClinic('Kuyumcu Diş Pırlanta', ['dentist'], '');
    expect(r.valid).toBe(true);
  });
});

describe('getFilterForVertical', () => {
  it('returns dental filter for "dental"', () => {
    const f = getFilterForVertical('dental');
    expect(f('Diş Kliniği', [], '').valid).toBe(true);
  });

  it('falls back to dental filter for unknown vertical', () => {
    const f = getFilterForVertical('made-up-vertical');
    expect(f('Diş Kliniği', [], '').valid).toBe(true);
  });
});
