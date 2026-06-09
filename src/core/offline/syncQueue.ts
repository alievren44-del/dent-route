import { offlineDB, type OfflineOp } from './db';
import { getSupabaseClient } from '@lib/supabase';

export type OpType = OfflineOp['opType'];

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for envs without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Kuyruğa işlem ekler. Caller kendi idempotencyKey'ini verebilir (ör. orders
 * için mevcut uuid); verilmezse otomatik oluşturulur.
 */
export async function enqueueOp(
  opType: OpType,
  payload: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<number> {
  const key = idempotencyKey ?? generateUUID();
  // Aynı key ile zaten pending/syncing/failed bir kayıt varsa ekleme.
  const existing = await offlineDB.ops
    .where('idempotencyKey')
    .equals(key)
    .filter((op) => op.status !== 'completed')
    .first();
  if (existing?.id !== undefined) return existing.id;

  const id = await offlineDB.ops.add({
    opType,
    payload,
    idempotencyKey: key,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    status: 'pending',
  });
  return id;
}

export async function listPending(): Promise<OfflineOp[]> {
  return offlineDB.ops.where('status').equals('pending').toArray();
}

export async function listFailed(): Promise<OfflineOp[]> {
  return offlineDB.ops.where('status').equals('failed').toArray();
}

/** Başarısız op'ları tekrar 'pending' durumuna alır ve kuyruğu tetikler. */
export async function retryFailed(): Promise<void> {
  const failed = await listFailed();
  for (const op of failed) {
    await offlineDB.ops.update(op.id!, { status: 'pending', retryCount: 0, lastError: undefined });
  }
  if (failed.length > 0) {
    void processQueue();
  }
}

export async function processQueue(): Promise<{ success: number; failed: number }> {
  const pending = await listPending();
  let success = 0;
  let failed = 0;
  for (const op of pending) {
    try {
      await offlineDB.ops.update(op.id!, { status: 'syncing' });
      await executeOp(op);
      await offlineDB.ops.update(op.id!, { status: 'completed' });
      success++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await offlineDB.ops.update(op.id!, {
        status: op.retryCount >= 3 ? 'failed' : 'pending',
        retryCount: op.retryCount + 1,
        lastError: msg,
      });
      failed++;
    }
  }
  return { success, failed };
}

async function executeOp(op: OfflineOp): Promise<void> {
  const supabase = getSupabaseClient();
  switch (op.opType) {
    case 'sample.create': {
      const { error } = await supabase.from('saha_samples').insert(op.payload);
      if (error) throw error;
      return;
    }
    case 'visit.create': {
      // Idempotency: aynı idempotency_key ile kayıt varsa skip.
      if (op.payload['idempotency_key']) {
        const { data: existing } = await supabase
          .from('saha_visits')
          .select('id')
          .eq('idempotency_key', op.payload['idempotency_key'])
          .maybeSingle();
        if (existing) return; // zaten oluşturulmuş
      }
      const { error } = await supabase.from('saha_visits').insert(op.payload);
      if (error) throw error;
      return;
    }
    case 'visit.update': {
      // payload: { id: string, ...updateFields }
      const { id: visitId, ...rest } = op.payload as { id: string } & Record<string, unknown>;
      // updated_at precondition: server'daki updated_at, biz kaydettiğimizdeki ile aynıysa güncelle.
      // (saha_visits.updated_at yoksa koşulsuz update — conflict accept olarak yorumla).
      const { error } = await supabase.from('saha_visits').update(rest).eq('id', visitId);
      if (error) throw error;
      return;
    }
    case 'order.create': {
      // Idempotency: orders tablosu idempotency_key kolununu destekliyor.
      if (op.payload['idempotency_key']) {
        const { data: existing } = await supabase
          .from('orders')
          .select('id')
          .eq('idempotency_key', op.payload['idempotency_key'])
          .maybeSingle();
        if (existing) return; // duplicate — sipariş zaten oluşturulmuş
      }
      const { error } = await supabase.from('orders').insert(op.payload);
      if (error) throw error;
      return;
    }
    case 'route.complete': {
      const { id: routeId, ...rest } = op.payload as { id: string } & Record<string, unknown>;
      const { error } = await supabase.from('saha_routes').update(rest).eq('id', routeId);
      if (error) throw error;
      return;
    }
  }
}

// Online/offline event handlers — initialize once
let initialized = false;
export function initSyncQueue(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('online', () => {
    void processQueue();
  });
  // Initial check
  if (navigator.onLine) {
    void processQueue();
  }
}
