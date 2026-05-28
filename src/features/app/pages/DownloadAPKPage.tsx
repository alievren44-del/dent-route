/**
 * DownloadAPKPage — Saha Navigasyon Android APK direct indirme.
 *
 * URL: /apk veya /indir
 *
 * Akış:
 *   1. version.json fetch et (build script'i public/apk/version.json üretir)
 *   2. Buton: APK İndir → /apk/saha-latest.apk
 *   3. SHA256 doğrulama bilgisi göster
 *   4. "Bilinmeyen kaynaklara izin ver" yardım metni
 */

import { useEffect, useState } from 'react';
import { Download, Shield, AlertCircle, CheckCircle2, Smartphone } from 'lucide-react';

interface AppVersion {
  version: string;
  url: string;
  sha256: string;
  released_at: string;
}

export default function DownloadAPKPage() {
  const [version, setVersion] = useState<AppVersion | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/apk/version.json', { cache: 'no-cache' });
        if (!r.ok) throw new Error('version.json yüklenemedi');
        const j = (await r.json()) as AppVersion;
        setVersion(j);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Bilinmeyen hata');
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header className="text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100">
          <Smartphone size={32} className="text-blue-600" />
        </div>
        <h1 className="text-2xl font-semibold">Saha Navigasyon — Android Uygulaması</h1>
        <p className="mt-1 text-sm text-slate-600">
          Saha plasiyer için offline-uyumlu, GPS destekli mobil uygulama.
        </p>
      </header>

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertCircle size={16} className="shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700">
            APK henüz yüklenmemiş. Build için:{' '}
            <code className="rounded bg-amber-100 px-1">bash scripts/build-apk.sh</code>
          </p>
        </div>
      )}

      {version && (
        <section className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">Sürüm</div>
              <div className="text-lg font-bold">v{version.version}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-500">Yayınlandı</div>
              <div className="text-sm">
                {new Date(version.released_at).toLocaleDateString('tr-TR', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </div>
            </div>
          </div>
          <a
            href={version.url}
            download
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-700"
          >
            <Download size={18} />
            APK İndir (Android)
          </a>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Shield size={11} />
              SHA-256: <code className="break-all">{version.sha256.slice(0, 32)}…</code>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl bg-amber-50 p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900">
          <AlertCircle size={14} />
          Kurulum Adımları
        </h2>
        <ol className="space-y-1.5 text-xs text-amber-900">
          <li>
            <strong>1.</strong> APK'yı telefonuna indir
          </li>
          <li>
            <strong>2.</strong> Ayarlar → Güvenlik → <em>"Bilinmeyen Kaynaklara İzin Ver"</em> aktif
            et (Android 8+: Chrome veya dosya yöneticisi için tek tek aktif edilir)
          </li>
          <li>
            <strong>3.</strong> İndirilen APK'ya dokun → Yükle
          </li>
          <li>
            <strong>4.</strong> Uygulamayı aç → şirket e-posta hesabınla giriş yap
          </li>
        </ol>
      </section>

      <section className="rounded-xl bg-slate-50 p-4">
        <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
          <CheckCircle2 size={14} />
          Sistem Gereksinimleri
        </h2>
        <ul className="space-y-1 text-xs text-slate-600">
          <li>• Android 7.0 (Nougat) veya üstü</li>
          <li>• ~50 MB depolama alanı</li>
          <li>• GPS sensörü (rota ve klinik bulma)</li>
          <li>• İnternet bağlantısı (ilk login + tarama)</li>
          <li>• Kamera (ziyaret fotoğrafları)</li>
        </ul>
      </section>

      <p className="text-center text-xs text-slate-400">
        Sorun yaşıyorsan yöneticinle iletişime geç.
      </p>
    </div>
  );
}
