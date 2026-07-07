import { offlineDB, type OfflineOp } from './db';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';

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
      const sync = (
        reg as ServiceWorkerRegistration & { sync?: { register(t: string): Promise<void> } }
      ).sync;
      return sync?.register(SYNC_TAG);
    })
    .catch(() => {
      /* register başarısız — online event fallback'i devrede, yutulur */
    });
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // Fallback for envs without crypto.randomUUID
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Yazma (insert) hatası ağ/bağlantı kaynaklı mı? OrderFormPage'deki offline-fallback
 * desenini ortak bir yardımcıya taşır: mesaj ağ-hatası işaretleri taşıyorsa veya
 * cihaz offline ise true → çağıran kaydı kuyruğa alır (veri kaybı yerine).
 */
export function isNetworkWriteError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('fetch') ||
    msg.includes('network') ||
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Load failed')
  );
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

/**
 * H4: Kesintiyle 'syncing'de kalan op'ları kurtar. processQueue bir op'u 'syncing'
 * işaretleyip executeOp arasında uygulama/sekme/native-süreç kapanırsa op kalıcı
 * 'syncing'de kalır (listPending yalnız 'pending' okur, hiçbir reaper yok) → kayıt
 * sunucuya hiç ulaşmaz = sessiz veri kaybı. Açılışta (aktif flush başlamadan =
 * güvenli) bunları 'pending'e geri al. executeOp idempotent yolları (visit upsert
 * onConflict, order.create idempotency_key) çift-insert'e karşı korur.
 */
export async function recoverStuckSyncing(): Promise<number> {
  const stuck = await offlineDB.ops.where('status').equals('syncing').toArray();
  for (const op of stuck) {
    await offlineDB.ops.update(op.id!, { status: 'pending' });
  }
  return stuck.length;
}

// M1: eşzamanlı flush kilidi. processQueue dört noktadan tetiklenir (online event,
// SW 'saha-sync-flush' mesajı, init, retryFailed). Guard yokken iki eşzamanlı çağrı
// aynı pending op'ları alıp ikisi de executeOp çalıştırır → idempotent olmayan
// insert'ler (reminder.create düz insert) çift kayıt oluşturur. İlk çağrı çalışır,
// çakışan çağrılar aynı Promise'e zincirlenir.
let _processing: Promise<{ success: number; failed: number }> | null = null;

export function processQueue(): Promise<{ success: number; failed: number }> {
  if (_processing) return _processing;
  _processing = _processQueueInner()
    .then((res) => {
      // Başarılı flush sonrası açık ekranlara haber ver → react-query cache'i sunucu
      // gerçeğiyle tazelensin (optimistik offline satırlar gerçek kayıtla değişir,
      // reconnect-refetch flicker'ı önlenir). Additive event; mevcut akışları etkilemez.
      if (res.success > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('saha-sync-completed', { detail: res }));
      }
      return res;
    })
    .finally(() => {
      _processing = null;
    });
  return _processing;
}

async function _processQueueInner(): Promise<{ success: number; failed: number }> {
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
  const supabase = getTypedClient();
  switch (op.opType) {
    case 'sample.create': {
      const { error } = await supabase.from('saha_samples').insert(op.payload as never);
      if (error) throw error;
      return;
    }
    case 'visit.create': {
      // saha_visits.idempotency_key + unique index (saha_visits_idempotency_key_uq) MEVCUT.
      // Offline replay'de aynı op tekrar yürütülürse (kısmi başarı sonrası retry) upsert
      // onConflict ignore ile çift-insert sessizce atlanır → idempotent, yanlış-"failed" yok.
      const { error } = await supabase
        .from('saha_visits')
        .upsert(op.payload as never, { onConflict: 'idempotency_key', ignoreDuplicates: true });
      if (error) throw error;
      return;
    }
    case 'visit.update': {
      // payload: { id: string, ...updateFields }
      const { id: visitId, ...rest } = op.payload as { id: string } & Record<string, unknown>;
      // updated_at precondition: server'daki updated_at, biz kaydettiğimizdeki ile aynıysa güncelle.
      // (saha_visits.updated_at yoksa koşulsuz update — conflict accept olarak yorumla).
      const { error } = await supabase
        .from('saha_visits')
        .update(rest as never)
        .eq('id', visitId);
      if (error) throw error;
      return;
    }
    case 'order.create': {
      // Replay'i ADAPTER üzerinden yap: fiyatlar DB'den yeniden hesaplanır
      // (client snapshot'una GÜVENİLMEZ — #21 offline price-validation), order_items
      // oluşturulur ve approval-status doğru set edilir. Eski hâli ham
      // orders.insert(payload) yapıyordu → payload orders kolonlarıyla uyuşmuyor +
      // price-recompute/order_items yok. Adapter idempotency_key ile duplicate'i
      // kendi içinde ele alır (getOrder döner, çift insert etmez).
      const p = op.payload;
      const adapter = new SupabaseCRMAdapter();
      await adapter.createOrder({
        customerId: p['customer_id'] as string,
        // Doğrudan cari seçimi offline kuyruğa alındıysa cari_id taşınır → cariId geç
        // (adapter clinic_id yerine cari_id gönderir). Klinik/legacy siparişte null.
        ...(p['cari_id'] ? { cariId: p['cari_id'] as string } : {}),
        items: ((p['items'] as Array<Record<string, unknown>>) ?? []).map((it) => ({
          productId: it['productId'] as string,
          quantity: it['quantity'] as number,
          // Varyant seçimi offline kuyruğa alındıysa taşı → adapter variant_id gönderir,
          // RPC v2 fiyat/sku/attribute'ları varyanttan çözer (aksi hâlde varyant kaybolur).
          ...(it['variantId'] ? { variantId: it['variantId'] as string } : {}),
          ...(it['unitPriceOverride'] !== undefined
            ? { unitPriceOverride: it['unitPriceOverride'] as number }
            : {}),
        })),
        notes: (p['notes'] as string | null) ?? undefined,
        idempotencyKey: p['idempotency_key'] as string,
        requiresApproval: p['requires_approval'] as boolean | undefined,
      });
      return;
    }
    case 'route.complete': {
      const { id: routeId, ...rest } = op.payload as { id: string } & Record<string, unknown>;
      const { error } = await supabase
        .from('saha_routes')
        .update(rest as never)
        .eq('id', routeId);
      if (error) throw error;
      return;
    }
    case 'reminder.create': {
      // Takvim manuel ekleme offline iken kuyruğa alınır → online'da insert edilir.
      // saha_reminders types.ts'de yok → untyped client (getTypedClient .from() reddeder).
      // İDEMPOTENT: payload kararlı bir client id (uuid PK) taşır → upsert onConflict 'id'
      // ignoreDuplicates ile replay (sunucuda commit + yanıt öncesi ağ koptu → retry) çift
      // kayıt oluşturmaz. Eski (id'siz) kuyruk kayıtları için idempotencyKey'i id'ye düşür
      // (o da uuid) — böylece onlar da deterministik id ile idempotent replay olur.
      const payload = { ...(op.payload as Record<string, unknown>) };
      if (!payload.id) payload.id = op.idempotencyKey;
      const { error } = await getSupabaseClient()
        .from('saha_reminders')
        .upsert(payload as never, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw error;
      return;
    }
    case 'cari.create': {
      // #P9: Offline oluşturulan cari. Payload = CariListPage insert objesi +
      // opsiyonel link_profile_id. saha_cariler'de idempotency kolonu YOK →
      // client-side üretilmiş uuid `id` payload'a gömülür; replay aynı id ile
      // insert edince pk unique_violation (23505) tetikler → BAŞARI sayılır
      // (kayıt zaten var, çift-insert yok). Bağlama (link_profile_id) idempotent
      // RPC olduğundan replay'de tekrar çağrılması sorunsuz.
      const { link_profile_id: linkProfileId, ...insertRow } = op.payload as {
        link_profile_id?: string | null;
      } & Record<string, unknown>;
      const { error } = await supabase.from('saha_cariler').insert(insertRow as never);
      // 23505 = unique_violation (pk id çakışması) → replay idempotent, başarı say.
      if (error && (error as { code?: string }).code !== '23505') throw error;

      if (linkProfileId) {
        type UntypedRpc = {
          rpc(
            fn: string,
            args: Record<string, unknown>,
          ): Promise<{ error: { message: string } | null }>;
        };
        const cariId = (insertRow as { id?: string }).id;
        if (cariId) {
          const { error: linkErr } = await (supabase as unknown as UntypedRpc).rpc(
            'saha_link_cari_to_profile',
            { p_cari_id: cariId, p_profile_id: linkProfileId },
          );
          // "cari zaten başka bir profile bağlı" gibi kalıcı-hata dışında link RPC
          // idempotenttir; hata varsa op retry/failed akışına düşer.
          if (linkErr) throw new Error(linkErr.message);
        }
      }
      return;
    }
    case 'clinic.create': {
      // #P9: Offline oluşturulan klinik. Payload = FieldAddClinicModal upsert objesi.
      // upsert onConflict 'google_place_id' zaten idempotent → replay çift-insert yapmaz.
      const { error } = await supabase
        .from('saha_clinics')
        .upsert(op.payload as never, { onConflict: 'google_place_id' });
      if (error) throw error;
      return;
    }
    case 'collection.create': {
      // Offline tahsilat (CollectionListPage). Payload = rep_collections insert objesi +
      // client-üretilmiş uuid `id`. rep_collections'ta idempotency kolonu YOK → replay aynı
      // id ile insert edince pk unique_violation (23505) tetikler → BAŞARI sayılır (çift yok).
      const { error } = await supabase.from('rep_collections').insert(op.payload as never);
      if (error && (error as { code?: string }).code !== '23505') throw error;
      return;
    }
    case 'task.create': {
      // Offline görev (TaskListPage). Payload = rep_tasks insert objesi + client-üretilmiş
      // uuid `id`. rep_tasks'ta idempotency kolonu YOK → replay aynı id ile pk 23505 →
      // başarı say (çift-insert yok).
      const { error } = await supabase.from('rep_tasks').insert(op.payload as never);
      if (error && (error as { code?: string }).code !== '23505') throw error;
      return;
    }
    case 'payment.create': {
      // Offline ödeme (PaymentFormPage). Payload = { cekSenet?: satır, odemeler: satır[] }.
      // Tüm satırlar client-üretilmiş uuid `id` taşır; saha_odemeler/saha_cek_senetler'de
      // idempotency kolonu yok → replay pk 23505'te başarı say. Çek/senet varsa ÖNCE
      // eklenir (saha_odemeler.cek_senet_id FK'sini karşılasın), sonra ödeme satırları.
      const p = op.payload as {
        cekSenet?: Record<string, unknown> | null;
        odemeler: Array<Record<string, unknown>>;
      };
      if (p.cekSenet) {
        const { error: csErr } = await supabase
          .from('saha_cek_senetler')
          .insert(p.cekSenet as never);
        if (csErr && (csErr as { code?: string }).code !== '23505') throw csErr;
      }
      // Satır-satır insert: kısmi başarı sonrası retry'de yalnız eksik satırlar 23505 yer,
      // her biri bağımsız idempotent kalır (toplu insert'te tek 23505 tüm batch'i düşürürdü).
      for (const row of p.odemeler ?? []) {
        const { error } = await supabase.from('saha_odemeler').insert(row as never);
        if (error && (error as { code?: string }).code !== '23505') throw error;
      }
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
  // H4: Açılışta kesintiyle 'syncing'de kalan op'ları önce 'pending'e geri al
  // (aktif flush yok = güvenli), sonra flush. Böylece yarıda kesilen kayıt kaybolmaz.
  // Kalıcı-failed op'lara açılışta otomatik retryCount-sıfırlama YAPMA (denetmen
  // MAJOR): her başlatmada failed→pending+retryCount:0 sonsuz-deneme döngüsü yaratıyordu.
  // Failed, kullanıcı "Tekrar Dene"ye basana kadar terminal kalır (banner görünür).
  void recoverStuckSyncing().then(() => {
    if (navigator.onLine) void processQueue();
  });
}
