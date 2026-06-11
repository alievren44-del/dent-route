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

// ────────────────────────────────────────────────────────────────────────
// GENİŞLETME — #70 client-mantık eşik sınır-değer + zincir + savunmacı girdi
// ────────────────────────────────────────────────────────────────────────

describe('needsApproval — REP eşik sınır-değer (#70)', () => {
  it('REP tam 5000 → onay GEREKMEZ (limit dahil, > kullanılıyor)', () => {
    // Kaynak: totalAmount > limit  →  5000 > 5000 = false
    expect(needsApproval(5000, 'REP')).toBe(false);
  });

  it('REP 5000.01 → onay GEREKİR (kuruş üstü)', () => {
    expect(needsApproval(5000.01, 'REP')).toBe(true);
  });

  it('REP 4999.99 → onay GEREKMEZ', () => {
    expect(needsApproval(4999.99, 'REP')).toBe(false);
  });
});

describe('needsApproval — MANAGER eşik sınır-değer (#70)', () => {
  it('MANAGER tam 50000 → onay GEREKMEZ', () => {
    expect(needsApproval(50000, 'MANAGER')).toBe(false);
  });

  it('MANAGER 50000.01 → onay GEREKİR', () => {
    expect(needsApproval(50000.01, 'MANAGER')).toBe(true);
  });

  it('MANAGER 49999.99 → onay GEREKMEZ', () => {
    expect(needsApproval(49999.99, 'MANAGER')).toBe(false);
  });
});

describe('needsApproval — ADMIN sınırsız (#70)', () => {
  it('ADMIN tam Number.MAX_SAFE_INTEGER → onay GEREKMEZ', () => {
    expect(needsApproval(Number.MAX_SAFE_INTEGER, 'ADMIN')).toBe(false);
  });
  it('ADMIN POSITIVE_INFINITY tutar bile → onay GEREKMEZ (Infinity > Infinity = false)', () => {
    expect(needsApproval(Number.POSITIVE_INFINITY, 'ADMIN')).toBe(false);
  });
});

describe('needsApproval — savunmacı girdi (boşluk/null/undefined)', () => {
  it('Baştaki/sondaki boşluk trim edilir', () => {
    expect(needsApproval(6000, '  REP  ')).toBe(true);
    expect(needsApproval(4000, '  REP  ')).toBe(false);
  });

  it('null/undefined rol → 0 limit (her pozitif tutar onay ister)', () => {
    expect(needsApproval(1, null as unknown as string)).toBe(true);
    expect(needsApproval(1, undefined as unknown as string)).toBe(true);
    expect(needsApproval(0, null as unknown as string)).toBe(false);
  });

  it('Negatif tutar → asla onay istemez (limit her zaman ≥ 0)', () => {
    expect(needsApproval(-100, 'USER')).toBe(false);
    expect(needsApproval(-1, 'REP')).toBe(false);
  });
});

describe('nextApproverRole — onay zinciri (#70)', () => {
  it('Tam zincir: USER → MANAGER → ADMIN → null', () => {
    const first = nextApproverRole('USER');
    expect(first).toBe('MANAGER');
    const second = nextApproverRole(first as string);
    expect(second).toBe('ADMIN');
    const third = nextApproverRole(second as string);
    expect(third).toBeNull();
  });

  it('SALES_REP de MANAGER zincirine girer', () => {
    expect(nextApproverRole('SALES_REP')).toBe('MANAGER');
    expect(nextApproverRole('sales_rep')).toBe('MANAGER');
  });

  it('null/undefined/boşluk → null', () => {
    expect(nextApproverRole(null as unknown as string)).toBeNull();
    expect(nextApproverRole(undefined as unknown as string)).toBeNull();
    expect(nextApproverRole('   ')).toBeNull();
  });
});

describe('thresholdFor — Infinity ve case-insensitive', () => {
  it('ADMIN → POSITIVE_INFINITY (UI "sınırsız" göstergesi)', () => {
    expect(thresholdFor('admin')).toBe(Number.POSITIVE_INFINITY);
    expect(thresholdFor('  ADMIN  ')).toBe(Number.POSITIVE_INFINITY);
  });
  it('Lowercase roller doğru eşik döner', () => {
    expect(thresholdFor('rep')).toBe(5000);
    expect(thresholdFor('manager')).toBe(50000);
  });
});
