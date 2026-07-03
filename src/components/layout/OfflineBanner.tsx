import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  WifiOff,
  CloudUpload,
  AlertCircle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react';
import { listPending, listFailed, retryFailed, removeOp } from '@core/offline/syncQueue';
import type { OfflineOp } from '@core/offline/db';

// #86: Op tipini insan-okunur kısa etikete çevir (rep ne göndermeye çalışmış görsün).
const OP_LABEL: Record<OfflineOp['opType'], string> = {
  'sample.create': 'Numune',
  'visit.create': 'Ziyaret',
  'visit.update': 'Ziyaret güncelleme',
  'order.create': 'Sipariş',
  'route.complete': 'Rota tamamlama',
  'reminder.create': 'Hatırlatma',
};

/**
 * #86: Başarısız op'un payload'undan kısa, kimlik-belirleyici bir özet çıkar.
 * Hassas alan dökmeden rep'in "hangi kayıt" diyebileceği kadar ipucu ver.
 */
function summarizePayload(op: OfflineOp): string {
  const p = op.payload;
  const pick = (k: string): string | undefined => {
    const v = p[k];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
  };
  // Sırayla en anlamlı tanımlayıcıyı seç.
  const id = pick('id') ?? pick('order_id') ?? pick('visit_id');
  const account = pick('account_name') ?? pick('customer_name') ?? pick('account_id');
  const total = pick('total') ?? pick('total_amount');
  const parts: string[] = [];
  if (id) parts.push(`#${id.length > 8 ? `${id.slice(0, 8)}…` : id}`);
  if (account) parts.push(account.length > 24 ? `${account.slice(0, 24)}…` : account);
  if (total) parts.push(`${total} ₺`);
  return parts.length > 0
    ? parts.join(' · ')
    : `oluşturulma: ${op.createdAt.slice(0, 16).replace('T', ' ')}`;
}

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [retrying, setRetrying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // #86: Mount'ta OTOMATIK retryFailed YOK (denetmen blocker): her remount'ta
  // failed→pending'e çevirip listeyi boşaltıyordu → rep hangi kaydın takıldığını
  // göremez/silemezdi + retryCount sıfırlanıp sonsuz-deneme. Banner yalnız GÖSTERİR;
  // kullanıcı "Tekrar Dene" butonuyla bilinçli retry yapar. Geçici hatalar (ağ) zaten
  // 'online' event + processQueue ile pending tarafında otomatik akar.

  // #66: Poll yerine Dexie liveQuery — IndexedDB değişim event'ine abone olur,
  // sürekli tarama (jank) kalkar. listPending/listFailed Dexie sorgusu olduğu için
  // useLiveQuery sorguyu izler ve ilgili tablo değişince otomatik yeniden çalışır.
  const pending = useLiveQuery(async () => (await listPending()).length, []);
  // #86: failed op'ların TAM listesini çek — hem sayaç hem expand detayı için.
  const failedOps = useLiveQuery(async () => listFailed(), []);
  const failedCount = failedOps?.length ?? 0;

  async function handleRetry(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    try {
      // #66: retryFailed Dexie kayıtlarını günceller; useLiveQuery sayaçları
      // otomatik tazeler — manuel invalidate gerekmez.
      await retryFailed();
    } finally {
      setRetrying(false);
    }
  }

  async function handleRemove(id: number | undefined): Promise<void> {
    // #86: Düzeltilemez (hatalı payload vb.) bir op'u kuyruktan kalıcı sil.
    // useLiveQuery listeyi otomatik günceller.
    await removeOp(id);
  }

  const hasPending = (pending ?? 0) > 0;
  const hasFailed = failedCount > 0;

  if (isOnline && !hasPending && !hasFailed) return null;

  // Başarısız op'lar en öncelikli — kırmızı banner
  if (hasFailed) {
    return (
      <div className="text-sm font-medium text-white bg-red-600">
        <div className="flex items-center justify-between gap-2 px-4 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 min-w-0 text-left"
            aria-expanded={expanded}
            aria-label={expanded ? 'Hata listesini gizle' : 'Hata listesini göster'}
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {/* #86: Failed=kırmızı rozet, pending=sarı rozet — rep ve admin sayıyı görsün */}
            <span className="inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
              {failedCount} gönderilemedi
            </span>
            {hasPending ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/90 px-2 py-0.5 text-xs font-bold text-amber-950">
                {pending} bekliyor
              </span>
            ) : null}
            {expanded ? (
              <ChevronUp className="h-4 w-4 shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 shrink-0" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={retrying || !isOnline}
            className="flex items-center gap-1 shrink-0 rounded-md bg-white/20 px-2 py-1 text-xs font-semibold disabled:opacity-50"
            aria-label="Tekrar dene"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
            {retrying ? 'Deneniyor…' : 'Tekrar Dene'}
          </button>
        </div>

        {/* #86: Açılır detay listesi — rep hangi kaydın takıldığını görsün, gerekirse silsin */}
        {expanded ? (
          <ul className="border-t border-white/20 bg-red-700/60 px-4 py-2 space-y-1">
            {failedOps?.map((op) => (
              <li key={op.id} className="flex items-start justify-between gap-2 py-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">
                      {OP_LABEL[op.opType]}
                    </span>
                    <span className="truncate text-xs text-white/90">{summarizePayload(op)}</span>
                  </div>
                  {op.lastError ? (
                    <p className="mt-0.5 truncate text-[11px] text-white/70">{op.lastError}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void handleRemove(op.id)}
                  className="inline-flex items-center gap-1 shrink-0 rounded-md bg-white/15 px-2 min-h-[44px] text-[11px] font-semibold hover:bg-white/25"
                  aria-label="Bu işlemi kuyruktan kaldır"
                  title="Kuyruktan kaldır"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Kaldır
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`px-4 py-2 text-sm font-medium text-white ${isOnline ? 'bg-blue-600' : 'bg-amber-600'}`}
    >
      <div className="flex items-center justify-center gap-2">
        {isOnline ? (
          <>
            <CloudUpload className="h-4 w-4 shrink-0" />
            {/* Bekleyen sayısı belirgin rozet — saha temsilcisi "N bekliyor" görsün. */}
            {hasPending ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
                {pending} bekliyor
              </span>
            ) : null}
            <span>senkronize ediliyor…</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4 shrink-0" />
            <span className="flex items-center gap-1">
              Çevrim dışısınız
              {hasPending ? (
                <>
                  <span className="mx-0.5 inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
                    {pending} bekliyor
                  </span>
                  — bağlantı gelince gönderilecek
                </>
              ) : (
                ' — değişiklikler bağlantı geldiğinde gönderilecek'
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
