import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { WifiOff, CloudUpload, AlertCircle, RotateCcw } from 'lucide-react';
import { listPending, listFailed, retryFailed } from '@core/offline/syncQueue';

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [retrying, setRetrying] = useState(false);
  const queryClient = useQueryClient();

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

  const { data: pending } = useQuery({
    queryKey: ['offline-pending'],
    queryFn: async () => (await listPending()).length,
    refetchInterval: 10_000,
  });

  const { data: failedCount } = useQuery({
    queryKey: ['offline-failed'],
    queryFn: async () => (await listFailed()).length,
    refetchInterval: 15_000,
  });

  async function handleRetry(): Promise<void> {
    if (retrying) return;
    setRetrying(true);
    try {
      await retryFailed();
      // Sayaçları tazele
      await queryClient.invalidateQueries({ queryKey: ['offline-pending'] });
      await queryClient.invalidateQueries({ queryKey: ['offline-failed'] });
    } finally {
      setRetrying(false);
    }
  }

  const hasPending = (pending ?? 0) > 0;
  const hasFailed = (failedCount ?? 0) > 0;

  if (isOnline && !hasPending && !hasFailed) return null;

  // Başarısız op'lar en öncelikli — kırmızı banner
  if (hasFailed) {
    return (
      <div className="px-4 py-2 text-sm font-medium text-white bg-red-600">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              {failedCount} işlem gönderilemedi
              {hasPending ? ` · ${pending} bekliyor` : ''}
            </span>
          </div>
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
            <CloudUpload className="h-4 w-4" />
            <span>{pending} işlem senkronize ediliyor...</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>
              Çevrim dışısınız
              {hasPending ? ` — ${pending} işlem bağlantı geldiğinde gönderilecek` : ' — değişiklikler bağlantı geldiğinde gönderilecek'}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
