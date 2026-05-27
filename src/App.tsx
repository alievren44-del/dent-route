import { Toaster } from 'sonner';
import { AppRouter } from './router';
import { useVertical } from '@core/verticals/useVertical';
import '@/lib/debugLog';
import { DebugOverlay } from '@/components/debug/DebugOverlay';

function App() {
  // Vertical erişilebilir mi smoke check (Sprint 1 sonu acceptance criteria)
  const vertical = useVertical();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Geliştirme aşamasında: aktif vertical göstergesi */}
      {import.meta.env.DEV && (
        <div className="bg-primary px-4 py-2 text-xs text-white">
          Saha App — vertical: <strong>{vertical.id}</strong> ({vertical.displayName})
        </div>
      )}
      <AppRouter />
      <Toaster position="top-center" richColors />
      <DebugOverlay />
    </div>
  );
}

export default App;
