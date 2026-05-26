/**
 * usePermissions — saha rolü ve izin kontrolü.
 *
 * Parla'nın RBAC sistemi (`permissions`, `role_permissions`, has_permission RPC)
 * üzerinde çalışır. Bu hook hem rol bazlı kısa devre kontrolü yapar (REP/ADMIN)
 * hem de gerektiğinde `has_permission` RPC'sini çağırır.
 */

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@lib/supabase';
import { useAuthStore } from './authStore';
import { mapParlaToSahaRole, type SahaRole } from './types';

export interface UsePermissionsResult {
  isAuthenticated: boolean;
  sahaRole: SahaRole | null;
  isAdmin: boolean;
  isSalesRep: boolean;
  hasPermission(code: string): Promise<boolean>;
  kvkkAccepted: boolean;
}

export function usePermissions(): UsePermissionsResult {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);

  const sahaRole = profile ? mapParlaToSahaRole(profile.role) : null;
  const isAdmin = sahaRole === 'admin';
  const isSalesRep = sahaRole === 'sales_rep';
  const userId = session?.userId ?? null;

  const hasPermission = useCallback(
    async (code: string): Promise<boolean> => {
      if (!userId) return false;
      if (isAdmin) return true;
      const result = await getSupabaseClient().rpc('has_permission', {
        p_user_id: userId,
        p_code: code,
      });
      if (result.error) {
        console.warn(`has_permission(${code}) RPC hatası:`, result.error.message);
        return false;
      }
      return Boolean(result.data);
    },
    [userId, isAdmin],
  );

  return {
    isAuthenticated: Boolean(session && profile),
    sahaRole,
    isAdmin,
    isSalesRep,
    kvkkAccepted: Boolean(profile?.kvkkAcceptedAt),
    hasPermission,
  };
}

/**
 * Async permission cache hook — UI'da `kullanıcı şu izne sahip mi?` sorusu için.
 *
 * @example
 *   const canCreateRoute = usePermissionCached('saha:route:create');
 *   if (canCreateRoute === null) return <Spinner />;
 *   if (!canCreateRoute) return <Forbidden />;
 */
export function usePermissionCached(code: string): boolean | null {
  const perms = usePermissions();
  const [result, setResult] = useState<boolean | null>(null);

  useEffect(() => {
    if (!perms.isAuthenticated) {
      setResult(false);
      return;
    }
    let cancelled = false;
    perms
      .hasPermission(code)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setResult(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, perms]);

  return result;
}
