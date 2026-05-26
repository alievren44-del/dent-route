/**
 * Sprint 1 smoke test — vertical loader doğru çalışıyor mu?
 * Sprint 2+ buraya gerçek unit testler eklenecek.
 */

import { describe, it, expect } from 'vitest';
import { listAvailableVerticals, loadBaseVertical } from '@core/verticals/VerticalLoader';

describe('VerticalLoader', () => {
  it('lists all 13 vertical templates', () => {
    const verticals = listAvailableVerticals();
    expect(verticals.length).toBe(13);
    expect(verticals).toContain('dental');
    expect(verticals).toContain('pharmacy');
    expect(verticals).toContain('generic');
  });

  it('loads dental vertical with valid schema', () => {
    const v = loadBaseVertical('dental');
    expect(v.id).toBe('dental');
    expect(v.displayName).toBe('Diş Hekimliği');
    expect(v.labels.customer.singular).toBe('Klinik');
    expect(v.customerTypes.length).toBeGreaterThan(0);
    expect(v.googlePlacesTypes).toContain('dentist');
  });

  it('throws on missing vertical', () => {
    expect(() => loadBaseVertical('nonexistent')).toThrow(/not found/);
  });
});
