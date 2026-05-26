import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@core/auth/authStore';

/**
 * AuthBootstrap — uygulama mount'unda session/profile yükler.
 * Tüm uygulamayı sarmalar; loading sırasında children render olur (ProtectedRoute
 * loading state'ini kendi yönetir).
 */
export function AuthBootstrap({ children }: { children: ReactNode }) {
  useEffect(() => {
    void useAuthStore.getState().initialize();
  }, []);
  return <>{children}</>;
}
