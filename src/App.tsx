import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppRouter } from './router';
import { useVertical } from '@core/verticals/useVertical';
import '@/lib/debugLog';
import { DebugOverlay } from '@/components/debug/DebugOverlay';
import FeedbackMount from '@/components/FeedbackMount';
import { setPushNavigate } from '@lib/push';

/**
 * PushNavigateBridge — push tap-yönlendirmesini SPA-içi (reload'suz) yapar.
 * App `<BrowserRouter>` içinde olduğundan burada `useNavigate` geçerlidir; gerçek
 * navigate fn'i push modülüne kaydeder (PARLA setPushNavigate pattern'i, NAV'ın
 * deklaratif router'ına uyarlanmış mount noktası). Ayrıca push init Router
 * mount'undan önce çalışmışsa biriken `saha:push-navigate` event'lerini tüketir.
 */
function PushNavigateBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setPushNavigate((path: string) => navigate(path));
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string }>).detail;
      if (detail?.path) navigate(detail.path);
    };
    window.addEventListener('saha:push-navigate', onEvent);
    return () => {
      setPushNavigate(null);
      window.removeEventListener('saha:push-navigate', onEvent);
    };
  }, [navigate]);
  return null;
}

function App() {
  // Vertical erişilebilir mi smoke check (Sprint 1 sonu acceptance criteria)
  const vertical = useVertical();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PushNavigateBridge />
      {/* Geliştirme aşamasında: aktif vertical göstergesi */}
      {import.meta.env.DEV && (
        <div className="bg-primary px-4 py-2 text-xs text-white">
          Saha App — vertical: <strong>{vertical.id}</strong> ({vertical.displayName})
        </div>
      )}
      <AppRouter />
      <Toaster position="top-center" richColors />
      {import.meta.env.DEV && <DebugOverlay />}
      <FeedbackMount />
    </div>
  );
}

export default App;
