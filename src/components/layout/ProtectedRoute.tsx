import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions, usePermissionCached } from '@core/auth/usePermissions';
import type { SahaRole } from '@core/auth/types';

export interface ProtectedRouteProps {
  children: ReactNode;
  requireRole?: SahaRole;
  /**
   * Permission-code bazlı kapı (örn 'saha:invoicing:access'). Admin her zaman geçer;
   * plasiyer ise admin user_permissions ile grant verdiyse geçer. requireRole'den
   * bağımsız — ikisi birlikte de verilebilir (her ikisi de sağlanmalı).
   */
  requirePermission?: string;
}

export function ProtectedRoute({ children, requireRole, requirePermission }: ProtectedRouteProps) {
  const loading = useAuthStore((s) => s.loading);
  const { isAuthenticated, kvkkAccepted, sahaRole, isAdmin } = usePermissions();
  const location = useLocation();
  // Hook koşulsuz çağrılmalı — enforcement aşağıda requirePermission set ise yapılır.
  const permResult = usePermissionCached(requirePermission ?? '');

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
      return <AccessDenied />;
    }
  }

  if (requirePermission && !isAdmin) {
    if (permResult === null) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-muted-foreground">Yetki kontrol ediliyor…</div>
        </div>
      );
    }
    if (permResult === false) {
      return <AccessDenied />;
    }
  }

  return <>{children}</>;
}

function AccessDenied() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Erişim engellendi</h1>
        <p className="mt-2 text-sm text-muted-foreground">Bu sayfa için yetkiniz yok.</p>
      </div>
    </div>
  );
}
