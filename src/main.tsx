// EN ÖNCE: SSO hand-off hash'ini React/router mount etmeden yakala (redirect silmesin).
import '@core/auth/ssoCapture';
import '@/lib/debugLog';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

import App from './App';
import { loadSahaConfig } from '@config/loadConfig';
import { applyBranding } from '@config/branding';
import { VerticalProvider } from '@core/verticals/VerticalContext';
import { AuthBootstrap } from '@components/layout/AuthBootstrap';
import { initSyncQueue } from '@core/offline/syncQueue';
import './styles/globals.css';

// 1. Config + branding
const config = loadSahaConfig();
applyBranding(config.branding);

// 1b. Native statüs çubuğu bootstrap — yalnızca Capacitor native platformda (web build etkilenmez).
// Android 15 edge-to-edge: statik capacitor.config.ts StatusBar.backgroundColor güvenilmez;
// runtime setBackgroundColor + setOverlaysWebView zorunlu. Hatalar görmezden gelinir (eklenti yoksa).
if (Capacitor.isNativePlatform()) {
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#1F4E78' }).catch(() => {});
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {}); // Style.Dark = açık/beyaz ikonlar, koyu zemin için
}

// 2. Query client + localStorage persistence (offline-first için)

// Keys persisted to localStorage — static/lookup data safe to keep across sessions.
// All volatile lists (cariler, faturalar, calendar events, orders, balances) are
// intentionally excluded so stale money/status data is never served from cache.
const PERSIST_ALLOW_PREFIXES = new Set([
  'calendar-reps',
  'calendar-clinic-names',
  'calendar-assigner-names',
  'calendar-assignable-reps',
  'nearby-clinic-counts',
  'assigned-routes',
  'discovery',
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: 'offlineFirst', // persisted cache'i offline'da hard-error vermeden servis et
      // staleTime:0 + refetchOnMount:'always' → mount'ta her zaman yeniden fetch.
      // Failure mode "silently stale" yerine "refetch on mount" (offline-first CRM için güvenli).
      // Statik/yavaş sorgular (clinic names, reps, geo counts) kendi staleTime:5min ile override eder.
      staleTime: 0,
      refetchOnMount: 'always',
      gcTime: 24 * 60 * 60 * 1000, // 24h persist
      retry: (failureCount, error) => {
        const retryable =
          typeof error === 'object' &&
          error !== null &&
          'retryable' in error &&
          (error as { retryable: boolean }).retryable;
        return retryable && failureCount < 3;
      },
    },
  },
});

const persister = createAsyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'saha-query-cache',
});

// 4. Offline sync queue (online/offline event handler register)
initSyncQueue();

// OTA: web-bundle uzaktan güncelleme (best-effort, hata app'i etkilemez)
import('./ota/checkUpdate').then(({ otaCheck }) => otaCheck('nav')).catch(() => {});

// 3. Mount
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element bulunamadı.');

createRoot(rootEl).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 24 * 60 * 60 * 1000,
        buster: 'v0.2.0', // bumped: drops old over-persisted caches (volatile lists)
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => {
            const key = query.queryKey[0];
            if (typeof key !== 'string') return false;
            if (PERSIST_ALLOW_PREFIXES.has(key)) return true;
            // ['customers','reps'] and ['customers','active-count'] are static rep/count lookups
            if (key === 'customers') {
              const sub = query.queryKey[1];
              return sub === 'reps' || sub === 'active-count';
            }
            return false;
          },
        },
      }}
    >
      <VerticalProvider vertical={config.vertical}>
        <BrowserRouter>
          <AuthBootstrap>
            <App />
          </AuthBootstrap>
        </BrowserRouter>
      </VerticalProvider>
    </PersistQueryClientProvider>
  </StrictMode>,
);
