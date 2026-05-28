/**
 * RouteExportPanel — rota dışa aktarım paneli.
 *
 * Sunduğu aksiyonlar:
 *  1. Google Maps'te aç (URL → yeni sekme / Capacitor Browser)
 *  2. QR kod göster (modal — telefon-laptop arası transfer)
 *  3. Paylaş (Capacitor Share native; fallback Web Share API; fallback clipboard)
 *  4. Kopyala (clipboard)
 *
 * Uzun rotalar (10+ nokta) Google Maps URL'sine sığmadığından parça parça
 * üretilir; ilk URL açılır, kullanıcıya uyarı toast'ı atılır.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Share2, QrCode, Copy, ExternalLink, Check, X } from 'lucide-react';
import {
  buildAppleMapsUrl,
  buildGoogleMapsUrls,
  buildYandexMapsUrl,
  type RoutePoint,
} from '@core/routing/exporters';

interface ExportStop extends RoutePoint {
  name: string;
}

export interface RouteExportPanelProps {
  start: RoutePoint;
  stops: ExportStop[];
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Capacitor Share native + Web Share API fallback + clipboard fallback.
 * Capacitor modülünü dinamik import ile yüklüyoruz ki web build'de
 * Capacitor olmasa bile bundle bozulmasın.
 */
async function tryShare(
  title: string,
  text: string,
  url: string,
): Promise<'native' | 'web' | 'copy'> {
  // 1. Capacitor native
  try {
    const cap = await import('@capacitor/core');
    if (cap.Capacitor.isNativePlatform()) {
      const shareMod = await import('@capacitor/share');
      await shareMod.Share.share({ title, text, url, dialogTitle: title });
      return 'native';
    }
  } catch {
    // Capacitor yok / native değil → devam
  }

  // 2. Web Share API
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'web';
    } catch {
      // user dismissed veya unsupported → fallback
    }
  }

  // 3. Clipboard fallback
  const ok = await copyToClipboard(url);
  if (!ok) throw new Error('Paylaşım başarısız');
  return 'copy';
}

async function loadQrDataUrl(text: string): Promise<string> {
  const qr = await import('qrcode');
  return qr.toDataURL(text, { width: 300, margin: 2 });
}

export function RouteExportPanel({ start, stops }: RouteExportPanelProps): JSX.Element {
  const [qrOpen, setQrOpen] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState<boolean>(false);

  const googleUrls = useMemo(() => buildGoogleMapsUrls(start, stops), [start, stops]);
  const appleUrl = useMemo(() => buildAppleMapsUrl(start, stops), [start, stops]);
  const yandexUrl = useMemo(() => buildYandexMapsUrl(start, stops), [start, stops]);

  const primaryUrl = googleUrls[0] ?? '';
  const hasStops = stops.length > 0;
  const isChunked = googleUrls.length > 1;

  const handleOpenGoogle = (): void => {
    if (!primaryUrl) return;
    if (isChunked) {
      toast.info(`Rota uzun, ${googleUrls.length} parçaya bölündü.`, {
        description: 'İlk parça açılıyor. Sıradakini durağa varınca aç.',
      });
    }
    window.open(primaryUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenQr = async (): Promise<void> => {
    if (!primaryUrl) return;
    setQrOpen(true);
    if (qrDataUrl) return;
    setQrLoading(true);
    try {
      const data = await loadQrDataUrl(primaryUrl);
      setQrDataUrl(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'QR üretilemedi';
      toast.error(msg);
      setQrOpen(false);
    } finally {
      setQrLoading(false);
    }
  };

  const handleShare = async (): Promise<void> => {
    if (!primaryUrl) return;
    try {
      const channel = await tryShare(
        'Rota',
        `${stops.length} durak${isChunked ? ` (${googleUrls.length} parça)` : ''}`,
        primaryUrl,
      );
      if (channel === 'copy') toast.success('Bağlantı kopyalandı');
      else toast.success('Paylaşıldı');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Paylaşılamadı';
      toast.error(msg);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!primaryUrl) return;
    const ok = await copyToClipboard(primaryUrl);
    if (ok) toast.success('Bağlantı kopyalandı');
    else toast.error('Kopyalanamadı');
  };

  return (
    <section className="rounded-xl bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">Dışa aktar</h2>
        {isChunked && <span className="text-[11px] text-amber-700">{googleUrls.length} parça</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button
          type="button"
          onClick={handleOpenGoogle}
          disabled={!hasStops}
          className="flex min-h-tap-min h-11 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          Google Maps
        </button>

        <button
          type="button"
          onClick={() => {
            void handleOpenQr();
          }}
          disabled={!hasStops}
          className="flex min-h-tap-min h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <QrCode className="h-4 w-4" aria-hidden="true" />
          QR Kod
        </button>

        <button
          type="button"
          onClick={() => {
            void handleShare();
          }}
          disabled={!hasStops}
          className="flex min-h-tap-min h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <Share2 className="h-4 w-4" aria-hidden="true" />
          Paylaş
        </button>

        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          disabled={!hasStops}
          className="flex min-h-tap-min h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          Kopyala
        </button>
      </div>

      {/* Alternatif harici linkler */}
      {hasStops && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
          <a
            href={appleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline hover:text-slate-800"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Apple Maps
          </a>
          <a
            href={yandexUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline hover:text-slate-800"
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            Yandex Maps
          </a>
        </div>
      )}

      {/* QR Modal */}
      {qrOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="qr-modal-title"
        >
          {/* Overlay (click-to-dismiss) — button olarak işaretliyoruz ki a11y kuralları geçsin */}
          <button
            type="button"
            aria-label="Modalı kapat"
            tabIndex={-1}
            onClick={() => setQrOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-transparent"
          />
          <div className="relative w-full max-w-xs rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 id="qr-modal-title" className="text-base font-semibold text-slate-900">
                Rota QR Kodu
              </h3>
              <button
                type="button"
                onClick={() => setQrOpen(false)}
                className="rounded p-1 hover:bg-slate-100"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex flex-col items-center gap-3">
              {qrLoading && (
                <div className="flex h-[300px] w-[300px] items-center justify-center text-sm text-slate-500">
                  QR oluşturuluyor…
                </div>
              )}
              {!qrLoading && qrDataUrl && (
                <img
                  src={qrDataUrl}
                  alt="Rota QR kodu"
                  width={300}
                  height={300}
                  className="rounded-lg border border-slate-200"
                />
              )}
              <p className="text-center text-xs text-slate-600">
                Telefonunla taratıp Google Maps&apos;te aç.
              </p>
              {isChunked && (
                <p className="text-center text-[11px] text-amber-700">
                  Bu QR sadece ilk parçayı içeriyor — toplam {googleUrls.length} parça var.
                </p>
              )}
              <button
                type="button"
                onClick={() => {
                  void handleCopy();
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 h-9 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Bağlantıyı kopyala
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default RouteExportPanel;
