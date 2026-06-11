import { offlineDB, type OfflineOp } from './db';
import { getSupabaseClient } from '@lib/supabase';

export type OpType = OfflineOp['opType'];

/** Background Sync tag — SW (#49/#55/#74) ile aynı olmalı. */
const SYNC_TAG = 'saha-sync-queue';

/**
 * #55: Op enqueue olunca Background Sync tag'ini register et. Tarayıcı offline'da
 * iken bile, bağlantı dönünce SW 'sync' event'i tetiklenir → açık client'a
 * postMessage → processQueue. SyncManager yoksa (iOS Safari) sessizce atlanır;
 * 'online' event handler (initSyncQueue) zaten fallback flush yapar.
 */
function registerBackgroundSync(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  // 'SyncManager' guard — desteklenmeyen tarayıcıda no-op.
  if (typeof (globalThis as { SyncManager?: unknown }).SyncManager === 'undefined') return;
  void navigator.serviceWorker.ready
    .then((reg) => {
      const sync = (reg as ServiceWorkerRegistration & { sync?: { register(t: string): Promise<void> } })
        .sync;
      return sync?.register(SYNC_TAG);
    })
    .catch(() => {
      /* register başarısız — online event fallback'i devrede, yutulur */
    });
}

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
  // #55: yeni op için Background Sync tag register et (bağlantı dönünce flush).
  registerBackgroundSync();
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

/**
 * #86: Tek bir op'u kuyruktan kalıcı olarak siler. Rep, düzeltilemez (ör. hatalı
 * payload) bir failed kaydı UI'dan elle kaldırabilsin diye eklendi. Yalnızca
 * tamamlanmamış/başarısız kayıtların manuel temizliği içindir; flush mantığına
 * dokunmaz. id'siz (henüz persist edilmemiş) op için no-op.
 */
export async function removeOp(id: number | undefined): Promise<void> {
  if (id === undefined) return;
  await offlineDB.ops.delete(id);
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
  // #49/#55/#74: SW 'sync' event'i flush'ı doğrudan SW'de yapamaz (Supabase
  // client window'a bağımlı). SW postMessage ile bizi uyarır; biz client
  // context'te processQueue çalıştırırız.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === 'saha-sync-flush') {
        void processQueue();
      }
    });
  }
  // Initial check
  if (navigator.onLine) {
    // Açılışta yalnız PENDING'i flush et. Kalıcı-failed op'lara açılışta otomatik
    // retryCount-sıfırlama YAPMA (denetmen MAJOR): her başlatmada failed→pending+
    // retryCount:0 sonsuz-deneme döngüsü + bozuk insert yükü yaratıyordu. Failed,
    // kullanıcı "Tekrar Dene"ye basana kadar terminal kalır (banner kırmızı, görünür).
    void processQueue();
  }
}
