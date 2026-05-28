/**
 * approvalRules — Sipariş onay eşikleri (saf yardımcı fonksiyonlar).
 *
 * Sprint 2 / PROMPT-15
 *
 * Roller UPPERCASE (Parla user_role enum ile uyumlu):
 *   USER     → otomatik onay yok (her sipariş onay ister)
 *   REP      → 5.000 TL'ye kadar self-approve
 *   MANAGER  → 50.000 TL'ye kadar self-approve
 *   ADMIN    → limitsiz
 *
 * Test edilebilirlik için DI yok — pure functions.
 */

export const APPROVAL_THRESHOLDS: Record<string, number> = {
  USER: 0,
  REP: 5000,
  MANAGER: 50000,
  ADMIN: Number.POSITIVE_INFINITY,
};

/**
 * Verilen toplam tutarın onay gerektirip gerektirmediğini döner.
 *
 * @param totalAmount KDV dahil grand total (TL)
 * @param userRole Kullanıcı rolü (case-insensitive)
 * @returns true → onay gerek, false → otomatik onay
 *
 * @example
 *   needsApproval(10000, 'REP')    // true (5000 limitini aşıyor)
 *   needsApproval(3000, 'REP')     // false
 *   needsApproval(999999, 'ADMIN') // false (limit yok)
 */
export function needsApproval(totalAmount: number, userRole: string): boolean {
  const role = String(userRole ?? '')
    .trim()
    .toUpperCase();
  const limit = APPROVAL_THRESHOLDS[role] ?? 0;
  return totalAmount > limit;
}

/**
 * Bir rolden bir sonraki onaylayıcı role.
 *
 * USER/REP        → MANAGER
 * MANAGER         → ADMIN
 * ADMIN ve diğer  → null (artık üst yok)
 */
export function nextApproverRole(currentRole: string): 'MANAGER' | 'ADMIN' | null {
  const role = String(currentRole ?? '')
    .trim()
    .toUpperCase();
  if (role === 'USER' || role === 'REP' || role === 'SALES_REP') return 'MANAGER';
  if (role === 'MANAGER') return 'ADMIN';
  return null;
}

/**
 * Eşiği döner — UI'da "X TL > Y TL eşiği" mesajı için kullanılır.
 * Rol tanımlı değilse 0 döner.
 */
export function thresholdFor(userRole: string): number {
  const role = String(userRole ?? '')
    .trim()
    .toUpperCase();
  const limit = APPROVAL_THRESHOLDS[role];
  if (limit === undefined) return 0;
  if (limit === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  return limit;
}
