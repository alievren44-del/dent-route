/**
 * checkUpdate.ts — OTA (over-the-air) web-bundle güncelleme.
 * @capgo/capacitor-updater + Supabase Storage self-host.
 * App açılışında manifest kontrol → yeni versiyon varsa indir+uygula (reload).
 * Best-effort: hata/manifest-yok → builtin bundle'da devam. notifyAppReady ile
 * capgo auto-rollback iptal (mevcut bundle çalışıyor onayı).
 *
 * Yayınlama (akşam fix sonrası): scripts/publish-ota.mjs — dist'i zip'le,
 * Supabase Storage 'ota/<app>/<version>.zip' + 'ota/<app>/latest.json' güncelle.
 */
import { Capacitor } from '@capacitor/core';

const SB = 'https://rranpzicmhgfupgabgbi.supabase.co';
const manifestUrl = (app: string) => `${SB}/storage/v1/object/public/ota/${app}/latest.json`;

/**
 * Yeni capgo bundle'ına geçmeden ÖNCE service-worker + workbox cache'lerini temizle.
 *
 * Sorun: capgo yeni web-bundle'ı diske yazıp set()+reload yapsa bile, ESKİ service
 * worker kayıtlı kalıyor; workbox-precache (eski index.html + asset hash'leri) ve
 * navigation-cache reload'da bayat shell'i serve ediyor → yeni sürüm cihazda hiç
 * görünmüyor. Bundle değişiminde SW'yi kaldırıp tüm cache'leri silersek, set()
 * sonrası reload yeni bundle'ı capgo yerel dosyalarından taze yükler; yeni bundle
 * SW'yi yeniden kaydeder. (Beta dersi 2026-06-19: OTA çıktı ama cihazda eski UI.)
 */
async function clearStaleShellCaches(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
    }
  } catch {
    /* best-effort — temizlenemezse set() yine de devam eder */
  }
}

export async function otaCheck(app: 'parla' | 'nav'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    // Mevcut bundle çalışıyor → capgo auto-rollback timeout'unu iptal et
    await CapacitorUpdater.notifyAppReady().catch(() => {});

    const res = await fetch(manifestUrl(app) + '?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return; // manifest yok → builtin'de kal
    const m = (await res.json()) as { version?: string; url?: string };
    if (!m?.version || !m?.url) return;

    const cur = await CapacitorUpdater.current().catch(() => null);
    const curVer = cur?.bundle?.version || 'builtin';
    if (m.version === curVer) return; // zaten güncel

    const b = await CapacitorUpdater.download({ url: m.url, version: m.version });
    // Bayat SW/precache yeni bundle'ı maskelemesin → set() reload'undan önce temizle.
    await clearStaleShellCaches();
    await CapacitorUpdater.set({ id: b.id }); // yeni bundle'a geç (reload)
  } catch (e) {
    // OTA best-effort — hata olsa builtin bundle ile devam
    console.warn('[ota] check failed', e instanceof Error ? e.message : e);
  }
}
