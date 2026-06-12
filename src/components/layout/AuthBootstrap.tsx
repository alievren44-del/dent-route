import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@core/auth/authStore';
import { initPush } from '@lib/push';

/**
 * AuthBootstrap — uygulama mount'unda session/profile yükler.
 * Tüm uygulamayı sarmalar; loading sırasında children render olur (ProtectedRoute
 * loading state'ini kendi yönetir).
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Session/profil hazır olduktan SONRA push'u başlat: initialize() session'ı
    // kurar; sonrasında initPush() içindeki saveToken user_id'yi anında bulur
    // (ilk-açılış kaydı için en güvenli nokta). Anonim açılışta token cache'lenir,
    // initPush'un kendi SIGNED_IN listener'ı login sonrası retry eder.
    // Native değilse initPush() no-op döner → web/dev'de zararsız.
    void useAuthStore
      .getState()
      .initialize()
      .finally(() => {
        void initPush();
      });
  }, []);
  return <>{children}</>;
}
