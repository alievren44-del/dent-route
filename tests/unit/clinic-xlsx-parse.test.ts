/**
 * clinicXlsxParser unit tests (PROMPT-2).
 *
 * - inferColumnMapping heuristic
 * - mapRows + sheet → type inference
 * - validateRows skip kuralları (name yok, lat NaN)
 */

import { describe, expect, it } from 'vitest';

import {
  inferColumnMapping,
  mapRows,
  validateRows,
  syntheticPlaceId,
} from '@/features/admin/lib/clinicXlsxParser';

describe('inferColumnMapping', () => {
  it('maps standard Türkçe/EN headers', () => {
    const headers = ['Klinik', 'Adres', 'Telefon', 'Lat', 'Lng'];
    const m = inferColumnMapping(headers);
    expect(m).toEqual({
      name: 'Klinik',
      address: 'Adres',
      phone: 'Telefon',
      lat: 'Lat',
      lng: 'Lng',
    });
  });

  it('handles mahalle/neighborhood + EN aliases', () => {
    const headers = ['name', 'phone', 'neighborhood', 'enlem', 'boylam'];
    const m = inferColumnMapping(headers);
    expect(m.name).toBe('name');
    expect(m.phone).toBe('phone');
    expect(m.neighborhood).toBe('neighborhood');
    expect(m.lat).toBe('enlem');
    expect(m.lng).toBe('boylam');
  });

  it('returns empty object when no headers match', () => {
    const m = inferColumnMapping(['foo', 'bar', 'baz']);
    expect(m).toEqual({});
  });
});

describe('mapRows', () => {
  it('infers type=public_hospital from sheet name "KAMU+Hastane"', () => {
    const rows = [{ Klinik: 'X Devlet Hastanesi', Lat: 39.7, Lng: 37.0 }];
    const mapping = { name: 'Klinik', lat: 'Lat', lng: 'Lng' };
    const out = mapRows(rows, mapping, 'KAMU+Hastane');
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe('public_hospital');
    expect(out[0]!.name).toBe('X Devlet Hastanesi');
    expect(out[0]!.lat).toBe(39.7);
  });

  it('infers type=private_clinic from non-hospital sheet name', () => {
    const rows = [{ Klinik: 'Y Diş Polikliniği', Lat: 39.7, Lng: 37.0 }];
    const mapping = { name: 'Klinik', lat: 'Lat', lng: 'Lng' };
    const out = mapRows(rows, mapping, 'Ana liste');
    expect(out[0]!.type).toBe('private_clinic');
  });

  it('parses lat/lng strings with comma decimals', () => {
    const rows = [{ Klinik: 'Z', Lat: '39,7477', Lng: '37,0179' }];
    const mapping = { name: 'Klinik', lat: 'Lat', lng: 'Lng' };
    const out = mapRows(rows, mapping);
    expect(out[0]!.lat).toBeCloseTo(39.7477, 4);
    expect(out[0]!.lng).toBeCloseTo(37.0179, 4);
  });
});

describe('validateRows', () => {
  it('drops row with empty name', () => {
    const { valid, skipped } = validateRows([
      { name: '', lat: 39.7, lng: 37.0 },
      { name: 'OK', lat: 39.7, lng: 37.0 },
    ]);
    expect(valid).toHaveLength(1);
    expect(valid[0]!.name).toBe('OK');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/name/);
  });

  it('drops row with NaN lat', () => {
    const { valid, skipped } = validateRows([
      { name: 'A', lat: Number.NaN, lng: 37.0 },
    ]);
    expect(valid).toHaveLength(0);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toMatch(/koordinat/);
  });

  it('drops row with missing lng', () => {
    const { valid, skipped } = validateRows([{ name: 'A', lat: 39.7 }]);
    expect(valid).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it('keeps fully-valid rows', () => {
    const { valid, skipped } = validateRows([
      { name: 'A', lat: 39.7, lng: 37.0, address: 'X cad.' },
    ]);
    expect(valid).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
});

describe('syntheticPlaceId', () => {
  it('is deterministic for same name+address', () => {
    const a = syntheticPlaceId({ name: 'Diş Hekimi X', address: 'A cad.' });
    const b = syntheticPlaceId({ name: 'Diş Hekimi X', address: 'A cad.' });
    expect(a).toBe(b);
    expect(a).toMatch(/^legacy_sivas_/);
  });

  it('differs when name differs', () => {
    const a = syntheticPlaceId({ name: 'X', address: 'A' });
    const b = syntheticPlaceId({ name: 'Y', address: 'A' });
    expect(a).not.toBe(b);
  });

  it('is case-insensitive', () => {
    const a = syntheticPlaceId({ name: 'X', address: 'A' });
    const b = syntheticPlaceId({ name: 'x', address: 'a' });
    expect(a).toBe(b);
  });
});
