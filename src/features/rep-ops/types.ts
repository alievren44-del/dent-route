/**
 * rep-ops types — Tahsilat + Görev + Günlük not tipleri.
 *
 * Parla shared DB tabloları (rep_*) kullanılır. Saha-prefix değil çünkü
 * Parla'nın CRM modülünden devralındı; ortak kullanım hedefli.
 */

export type CollectionMethod = 'CASH' | 'CHECK' | 'WIRE' | 'CARD';
export type CollectionStatus = 'PENDING' | 'CONFIRMED' | 'BOUNCED';

export interface RepCollection {
  id: string;
  rep_id: string;
  client_id: string;
  visit_id: string | null;
  amount: number;
  method: CollectionMethod;
  check_number: string | null;
  due_date: string | null;
  reference_no: string | null;
  status: CollectionStatus;
  created_at: string;
}

export type RepTaskType = 'visit' | 'call' | 'paperwork' | 'other';
export type RepTaskStatus = 'pending' | 'done' | 'skipped';

export interface RepTask {
  id: string;
  rep_id: string;
  title: string;
  description: string | null;
  task_type: RepTaskType;
  client_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  notes: string | null;
  status: RepTaskStatus;
  created_by: string | null;
  source_notification_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepDailyNote {
  id: string;
  rep_id: string;
  note_date: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export const COLLECTION_METHOD_LABELS: Record<CollectionMethod, string> = {
  CASH: 'Nakit',
  CHECK: 'Çek',
  WIRE: 'Havale',
  CARD: 'Kredi Kartı',
};

export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, { label: string; color: string }> = {
  PENDING: { label: 'Beklemede', color: 'bg-yellow-100 text-yellow-700' },
  CONFIRMED: { label: 'Onaylandı', color: 'bg-green-100 text-green-700' },
  BOUNCED: { label: 'İade', color: 'bg-red-100 text-red-700' },
};

export const TASK_TYPE_LABELS: Record<RepTaskType, string> = {
  visit: 'Ziyaret',
  call: 'Arama',
  paperwork: 'Evrak',
  other: 'Diğer',
};

export const TASK_STATUS_LABELS: Record<RepTaskStatus, { label: string; color: string }> = {
  pending: { label: 'Bekliyor', color: 'bg-yellow-100 text-yellow-700' },
  done: { label: 'Tamamlandı', color: 'bg-emerald-100 text-emerald-700' },
  skipped: { label: 'Atlandı', color: 'bg-slate-100 text-slate-500' },
};
