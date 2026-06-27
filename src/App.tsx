import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
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

/**
 * AndroidBackButtonBridge — donanım geri tuşunu SPA navigasyonuna bağlar.
 * KÖK SORUN: Capacitor'da backButton listener'ı YOKKEN, donanım geri tuşu
 * doğrudan uygulamayı kapatır → kullanıcı herhangi bir detay/alt ekrandan
 * geri bastığında tüm uygulamadan ani çıkış (saha kullanıcısı için kötü UX).
 * ÇÖZÜM: canGoBack ise router geçmişinde geri git (window.history.back →
 * popstate → BrowserRouter), kök ekranda ise uygulamayı arka plana al.
 * Listener mount'ta bir kez kurulur, unmount'ta kaldırılır (leak yok; addListener
 * Promise döndüğü için unmount-yarışına karşı `active` bayrağı ile korunur).
 */
function AndroidBackButtonBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let active = true;
    let handle: { remove: () => void } | undefined;
    void CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        void CapacitorApp.exitApp();
      }
    }).then((h) => {
      if (active) handle = h;
      else void h.remove();
    });
    return () => {
      active = false;
      handle?.remove();
    };
  }, []);
  return null;
}

function App() {
  // Vertical erişilebilir mi smoke check (Sprint 1 sonu acceptance criteria)
  const vertical = useVertical();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PushNavigateBridge />
      <AndroidBackButtonBridge />
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
