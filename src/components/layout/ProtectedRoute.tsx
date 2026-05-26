import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions } from '@core/auth/usePermissions';
import type { SahaRole } from '@core/auth/types';

export interface ProtectedRouteProps {
  children: ReactNode;
  requireRole?: SahaRole;
}

export function ProtectedRoute({ children, requireRole }: ProtectedRouteProps) {
  const loading = useAuthStore((s) => s.loading);
  const { isAuthenticated, kvkkAccepted, sahaRole, isAdmin } = usePermissions();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground">Yükleniyor…</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!kvkkAccepted) {
    return <Navigate to="/onboarding/kvkk" replace />;
  }

  if (requireRole) {
    const allowed = sahaRole === requireRole || (requireRole === 'sales_rep' && isAdmin);
    if (!allowed) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8 text-center">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Erişim engellendi</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Bu sayfa için yetkiniz yok.
            </p>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
