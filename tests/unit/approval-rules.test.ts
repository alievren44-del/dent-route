/**
 * Sprint 2 / PROMPT-15
 * Sipariş onay eşik kurallarının birim testleri.
 *
 * Saf TypeScript — Supabase / DOM bağımlılığı yok, vitest doğrudan koşar.
 */

import { describe, it, expect } from 'vitest';
import {
  APPROVAL_THRESHOLDS,
  needsApproval,
  nextApproverRole,
  thresholdFor,
} from '../../src/features/orders/lib/approvalRules';

describe('needsApproval', () => {
  it('USER → 0 limit, herhangi bir pozitif tutar onay ister', () => {
    expect(needsApproval(1, 'USER')).toBe(true);
    expect(needsApproval(0, 'USER')).toBe(false);
  });

  it('REP → 5000 limit', () => {
    expect(needsApproval(4999, 'REP')).toBe(false);
    expect(needsApproval(5000, 'REP')).toBe(false);
    expect(needsApproval(5001, 'REP')).toBe(true);
  });

  it('MANAGER → 50000 limit', () => {
    expect(needsApproval(49000, 'MANAGER')).toBe(false);
    expect(needsApproval(50001, 'MANAGER')).toBe(true);
  });

  it('ADMIN → limitsiz, hiç onay istemez', () => {
    expect(needsApproval(1_000_000, 'ADMIN')).toBe(false);
    expect(needsApproval(Number.MAX_SAFE_INTEGER, 'ADMIN')).toBe(false);
  });

  it('Tanınmayan rol → 0 limit (her tutar onay ister)', () => {
    expect(needsApproval(1, 'GUEST')).toBe(true);
    expect(needsApproval(0, 'GUEST')).toBe(false);
  });

  it('Case-insensitive', () => {
    expect(needsApproval(10000, 'rep')).toBe(true);
    expect(needsApproval(10000, 'Rep')).toBe(true);
    expect(needsApproval(10000, 'manager')).toBe(false);
  });
});

describe('nextApproverRole', () => {
  it('USER/REP → MANAGER', () => {
    expect(nextApproverRole('USER')).toBe('MANAGER');
    expect(nextApproverRole('REP')).toBe('MANAGER');
    expect(nextApproverRole('sales_rep')).toBe('MANAGER');
  });

  it('MANAGER → ADMIN', () => {
    expect(nextApproverRole('MANAGER')).toBe('ADMIN');
  });

  it('ADMIN → null', () => {
    expect(nextApproverRole('ADMIN')).toBeNull();
  });

  it('Bilinmeyen rol → null', () => {
    expect(nextApproverRole('XYZ')).toBeNull();
    expect(nextApproverRole('')).toBeNull();
  });
});

describe('thresholdFor', () => {
  it('Doğru eşikleri döner', () => {
    expect(thresholdFor('USER')).toBe(0);
    expect(thresholdFor('REP')).toBe(5000);
    expect(thresholdFor('MANAGER')).toBe(50000);
    expect(thresholdFor('ADMIN')).toBe(Number.POSITIVE_INFINITY);
  });

  it('Bilinmeyen rol → 0', () => {
    expect(thresholdFor('UNKNOWN')).toBe(0);
  });
});

describe('APPROVAL_THRESHOLDS sabitleri', () => {
  it('Tüm beklenen roller tanımlı', () => {
    expect(APPROVAL_THRESHOLDS.USER).toBe(0);
    expect(APPROVAL_THRESHOLDS.REP).toBe(5000);
    expect(APPROVAL_THRESHOLDS.MANAGER).toBe(50000);
    expect(APPROVAL_THRESHOLDS.ADMIN).toBe(Number.POSITIVE_INFINITY);
  });
});
