/// <reference lib="webworker" />

import { precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare const self: ServiceWorkerGlobalScope & typeof globalThis;

// Bump bu sürümü her deploy'da; eski cache'ler activate'te temizlenir.
const SW_VERSION = 'v3';
const NAV_CACHE = `saha-navigations-${SW_VERSION}`;
const API_CACHE = `saha-api-${SW_VERSION}`;
const KNOWN_CACHES = new Set([NAV_CACHE, API_CACHE]);

// ─── Precache (Vite injectManifest tarafından doldurulur) ────
precacheAndRoute(self.__WB_MANIFEST);

// ─── Navigation routing — SPA fallback ───────────────────────
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: NAV_CACHE,
      networkTimeoutSeconds: 3,
    }),
  ),
);

// ─── REST GET — stale-while-revalidate ──────────────────
// Edge fn'leri (/functions/v1/) ASLA cache'leme — POST + non-idempotent.
// Routing/clinic-scan response cache'lenirse stale data döner (550km vs 685km
// gibi). Sadece /rest/v1/ GET PostgREST select için cache.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.pathname.includes('/rest/v1/'),
  new StaleWhileRevalidate({
    cacheName: API_CACHE,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 24 * 60 * 60, // 1 gün
      }),
    ],
  }),
);

// ─── Background Sync için event hook (#49/#55/#74) ──────────
// Dexie kuyruğu Supabase client ile flush'lanır; ancak bizim Supabase
// client'ımız `window.fetch` + `window.localStorage` (persistSession) kullanır
// ve SW context'inde `window` YOKTUR. Bu yüzden flush'ı doğrudan SW'de
// çalıştırmak yerine, açık olan client(ler)e mesaj atıp orada processQueue'yu
// tetikliyoruz (güvenli/minimal yaklaşım). Hiç client açık değilse, client
// bir sonraki açılışında 'online' event'i + initSyncQueue zaten flush eder.
const SYNC_TAG = 'saha-sync-queue';

async function flushSyncQueue(): Promise<void> {
  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  if (clientList.length === 0) {
    // Açık pencere yok — kuyruk client açılışında flush edilecek.
    console.info('[SW] sync: açık client yok, flush ertelendi:', SYNC_TAG);
    return;
  }
  for (const client of clientList) {
    client.postMessage({ type: 'saha-sync-flush', tag: SYNC_TAG });
  }
}

interface SyncEvent extends Event {
  readonly tag: string;
  waitUntil(p: Promise<unknown>): void;
}
self.addEventListener('sync', ((event: SyncEvent) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(flushSyncQueue());
  }
}) as EventListener);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(
            (k) =>
              !KNOWN_CACHES.has(k) &&
              (k.startsWith('saha-navigations-') || k.startsWith('saha-api-')),
          )
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

declare global {
  interface ServiceWorkerGlobalScope {
    __WB_MANIFEST: Array<PrecacheEntry | string>;
  }
}
