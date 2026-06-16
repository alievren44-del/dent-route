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
    await CapacitorUpdater.set({ id: b.id }); // yeni bundle'a geç (reload)
  } catch (e) {
    // OTA best-effort — hata olsa builtin bundle ile devam
    console.warn('[ota] check failed', e instanceof Error ? e.message : e);
  }
}
