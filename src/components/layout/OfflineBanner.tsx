import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WifiOff, CloudUpload } from 'lucide-react';
import { listPending } from '@core/offline/syncQueue';

export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true);

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

  if (isOnline && (pending ?? 0) === 0) return null;

  return (
    <div className={`px-4 py-2 text-sm font-medium text-white ${isOnline ? 'bg-blue-600' : 'bg-amber-600'}`}>
      <div className="flex items-center justify-center gap-2">
        {isOnline ? (
          <>
            <CloudUpload className="h-4 w-4" />
            <span>{pending} işlem senkronize ediliyor...</span>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <span>Çevrim dışısınız — değişiklikler bağlantı geldiğinde gönderilecek</span>
          </>
        )}
      </div>
    </div>
  );
}
