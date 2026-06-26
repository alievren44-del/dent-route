/**
 * queryKeys — Typed query-key factory + domain invalidation helpers.
 *
 * Key shapes match the ACTUAL useQuery/useInfiniteQuery calls in the codebase.
 * Do NOT invent new shapes here — every constant must trace to a real useQuery.
 *
 * Usage:
 *   queryKey: QK.cariler.balance(customerId)
 *   await invalidateInvoiceDomain(queryClient, { cariId })
 */

import type { QueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Calendar domain
// ---------------------------------------------------------------------------
export const calendarKeys = {
  /** Main appointment list: ['calendar', repId | null, filterStr] */
  events: (repId: string | null, filter: unknown) => ['calendar', repId, filter] as const,
  /** Rep list for calendar assign UI: ['calendar-reps'] — staleTime 5 min */
  reps: () => ['calendar-reps'] as const,
  /** Clinic name lookups for calendar chips: ['calendar-clinic-names', joinedIds] — staleTime 5 min */
  clinicNames: (joinedIds: string) => ['calendar-clinic-names', joinedIds] as const,
  /** Assigner name lookups: ['calendar-assigner-names', joinedIds] — staleTime 5 min */
  assignerNames: (joinedIds: string) => ['calendar-assigner-names', joinedIds] as const,
  /** Attachment lookups: ['calendar-attachments', joinedIds] */
  attachments: (joinedIds: string) => ['calendar-attachments', joinedIds] as const,
  /** Assignable reps for modal: ['calendar-assignable-reps'] — staleTime 5 min */
  assignableReps: () => ['calendar-assignable-reps'] as const,
};

// ---------------------------------------------------------------------------
// Cariler (accounts / cari) domain
// ---------------------------------------------------------------------------
export const carilerKeys = {
  /** Cari list page: ['cariler', search, durum, il] */
  list: (search: string, durum: string, il: string) => ['cariler', search, durum, il] as const,
  /** Fatura sum aggregates shown in list: ['cariler-fatura-sums', ids[]] */
  faturaSums: (ids: string[]) => ['cariler-fatura-sums', ids] as const,
  /** Single cari detail: ['cari-detail', id] */
  detail: (id: string) => ['cari-detail', id] as const,
  /** Invoices for a cari: ['cari-faturalar', id] */
  faturalar: (id: string) => ['cari-faturalar', id] as const,
  /** Payments for a cari: ['cari-odemeler', id] */
  odemeler: (id: string) => ['cari-odemeler', id] as const,
  /** Cek/Senet records for a cari: ['cari-cek-senet', id] */
  cekSenet: (id: string) => ['cari-cek-senet', id] as const,
  /**
   * Running balance shown in CariBalanceCard: ['cari-balance', customerId]
   * Previously orphaned — no mutation invalidated this key.
   */
  balance: (customerId: string) => ['cari-balance', customerId] as const,
};

// ---------------------------------------------------------------------------
// Invoice domain
// ---------------------------------------------------------------------------
export const invoiceKeys = {
  /** Invoice detail: ['invoice', id] */
  detail: (id: string) => ['invoice', id] as const,
  /** Invoice line items: ['invoice-kalemler', id] */
  kalemler: (id: string) => ['invoice-kalemler', id] as const,
  /** Cari record embedded in invoice detail: ['invoice-cari', cariId | undefined] */
  cari: (cariId: string | undefined) => ['invoice-cari', cariId] as const,
  /**
   * Aging report: ['invoicing', 'aging']
   * Previously orphaned — no mutation invalidated this key.
   */
  aging: () => ['invoicing', 'aging'] as const,
};

// ---------------------------------------------------------------------------
// Orders domain
// ---------------------------------------------------------------------------
export const orderKeys = {
  /** Pending-approval list: ['order-approval-list'] */
  approvalList: () => ['order-approval-list'] as const,
  /** Rep order templates: ['order-templates', repId | null] */
  templates: (repId: string | null) => ['order-templates', repId] as const,
  /**
   * Recent orders card on customer detail: ['recent-orders', customerId, limit]
   * Previously orphaned — OrderFormPage did not invalidate after create.
   */
  recent: (customerId: string, limit: number) => ['recent-orders', customerId, limit] as const,
  /** Sales hub orders list: ['sales-hub-orders', userId, isAdmin] */
  salesHubOrders: (userId: string, isAdmin: boolean) =>
    ['sales-hub-orders', userId, isAdmin] as const,
  /** Sales hub today summary: ['sales-hub-today', userId] */
  salesHubToday: (userId: string) => ['sales-hub-today', userId] as const,
  /** Sales hub target metrics: ['sales-hub-target', userId] */
  salesHubTarget: (userId: string) => ['sales-hub-target', userId] as const,
};

// ---------------------------------------------------------------------------
// Visits domain
// ---------------------------------------------------------------------------
export const visitKeys = {
  /**
   * Visit history infinite list: ['visit-history', repId, dateTab, outcomes, search, accountFilter?]
   * Invalidate with prefix ['visit-history'] to bust all variants.
   */
  historyPrefix: () => ['visit-history'] as const,
  /** Single visit detail: ['visit-detail', id] */
  detail: (id: string) => ['visit-detail', id] as const,
  /**
   * Per-customer visit timeline component: ['customer-visit-timeline', customerId, limit]
   * Invalidate with prefix ['customer-visit-timeline'] to bust all customers.
   */
  customerTimelinePrefix: () => ['customer-visit-timeline'] as const,
};

// ---------------------------------------------------------------------------
// Cek-senetler domain
// ---------------------------------------------------------------------------
export const cekSenetKeys = {
  /** List by tab: ['cek-senetler', tab] */
  list: (tab: string) => ['cek-senetler', tab] as const,
};

// ---------------------------------------------------------------------------
// Sampling domain
// ---------------------------------------------------------------------------
export const sampleKeys = {
  /** Sample list: ['samples', repId | null, statuses[], cutoffIso] */
  list: (repId: string | null, statuses: string[], cutoffIso: string) =>
    ['samples', repId, statuses, cutoffIso] as const,
};

// ---------------------------------------------------------------------------
// Rep-ops domain
// ---------------------------------------------------------------------------
export const repTaskKeys = {
  /** Task list: ['rep-tasks', userId, date] */
  list: (userId: string, date: string) => ['rep-tasks', userId, date] as const,
};

// ---------------------------------------------------------------------------
// Convenience namespace export (QK.cariler.balance(id), etc.)
// ---------------------------------------------------------------------------
export const QK = {
  calendar: calendarKeys,
  cariler: carilerKeys,
  invoice: invoiceKeys,
  orders: orderKeys,
  visits: visitKeys,
  cekSenet: cekSenetKeys,
  samples: sampleKeys,
  repTasks: repTaskKeys,
};

// ---------------------------------------------------------------------------
// Domain invalidation helpers
// ---------------------------------------------------------------------------

/**
 * Invalidate order-related query set after an order create/approve/reject.
 * Covers: approval-list, all sales-hub-* variants (prefix match), recent-orders.
 */
export async function invalidateOrderDomain(qc: QueryClient): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: orderKeys.approvalList() }),
    // Prefix matches ['sales-hub-orders', userId, isAdmin] — all users
    qc.invalidateQueries({ queryKey: ['sales-hub-orders'] }),
    // Prefix matches ['sales-hub-today', userId] — all users
    qc.invalidateQueries({ queryKey: ['sales-hub-today'] }),
    // Prefix matches ['sales-hub-target', userId] — all users
    qc.invalidateQueries({ queryKey: ['sales-hub-target'] }),
    // Prefix matches ['recent-orders', customerId, limit] — all customers
    qc.invalidateQueries({ queryKey: ['recent-orders'] }),
  ]);
}

/**
 * Invalidate visit-related query set after a check-in or visit complete.
 * Covers: visit-history (all reps/date variants), calendar events, customer timelines.
 */
export async function invalidateVisitDomain(qc: QueryClient): Promise<void> {
  await Promise.all([
    // Prefix matches ['visit-history', repId, ...] — all reps
    qc.invalidateQueries({ queryKey: visitKeys.historyPrefix() }),
    // Prefix matches ['calendar', repId, filter] — all reps
    qc.invalidateQueries({ queryKey: ['calendar'] }),
    // Prefix matches ['customer-visit-timeline', customerId, limit] — all customers
    qc.invalidateQueries({ queryKey: visitKeys.customerTimelinePrefix() }),
  ]);
}
