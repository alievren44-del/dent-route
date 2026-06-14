/**
 * Sprint K — sipariş durum tek-kaynak (orderStatus.ts) birim testleri.
 * Saf TS; Supabase/DOM bağımlılığı yok.
 */

import { describe, it, expect } from 'vitest';
import { ORDER_STATUS, orderStatusMeta } from '../../src/features/orders/lib/orderStatus';

describe('orderStatusMeta', () => {
  it('bilinen status → kanonik label', () => {
    expect(orderStatusMeta('approved').label).toBe('Onaylandı');
    expect(orderStatusMeta('rejected').label).toBe('Reddedildi');
    expect(orderStatusMeta('approval_pending').label).toBe('Onay Bekliyor');
  });

  it('delivered → kanonik "Teslim Edildi" (eski "Teslim" tutarsızlığı giderildi)', () => {
    expect(orderStatusMeta('delivered').label).toBe('Teslim Edildi');
  });

  it('case-insensitive (UPPER/Mixed → lower lookup)', () => {
    expect(orderStatusMeta('APPROVED').label).toBe('Onaylandı');
    expect(orderStatusMeta('Delivered').label).toBe('Teslim Edildi');
  });

  it('bilinmeyen status → fallback (label=ham, gri renk)', () => {
    const meta = orderStatusMeta('weird_status');
    expect(meta.label).toBe('weird_status');
    expect(meta.color).toContain('gray');
  });

  it('her status meta hem label hem color taşır', () => {
    for (const [, meta] of Object.entries(ORDER_STATUS)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.color).toMatch(/bg-/);
      expect(meta.color).toMatch(/text-/);
    }
  });
});
