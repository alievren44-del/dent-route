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

// 2. Query client + localStorage persistence (offline-first için)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
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

// 3. Mount
const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element bulunamadı.');

createRoot(rootEl).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000 }}
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
