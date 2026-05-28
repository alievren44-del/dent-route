import { offlineDB, type OfflineOp } from './db';
import { getSupabaseClient } from '@lib/supabase';

export type OpType = OfflineOp['opType'];

export async function enqueueOp(opType: OpType, payload: Record<string, unknown>): Promise<number> {
  const id = await offlineDB.ops.add({
    opType,
    payload,
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
      const { error } = await supabase.from('saha_visits').insert(op.payload);
      if (error) throw error;
      return;
    }
    case 'order.create': {
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
