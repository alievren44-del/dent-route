/**
 * FeedbackMount.tsx — NAV glue: debug/feedback FAB'ı app context'ine bağlar.
 * VITE_ENABLE_FEEDBACK='1' ise (beta APK) görünür. Router+Auth içinde mount edilir.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { getTypedClient } from '@/lib/supabase';
import { useAuthStore } from '@/core/auth/authStore';
import { FeedbackButton, installBreadcrumbs, recordRoute } from '@/debug/feedback';

const ENABLED = import.meta.env.VITE_ENABLE_FEEDBACK === '1';

export default function FeedbackMount() {
  const loc = useLocation();
  const profile = useAuthStore((s) => s.profile);

  useEffect(() => { if (ENABLED) installBreadcrumbs(); }, []);
  useEffect(() => { if (ENABLED) recordRoute(loc.pathname); }, [loc.pathname]);

  if (!ENABLED) return null;
  return (
    <FeedbackButton
      app="nav"
      appVersion={import.meta.env.VITE_APP_VERSION || '1.0'}
      getUser={() => ({ id: profile?.id, role: profile?.role ?? undefined })}
      supabase={getTypedClient() as unknown as Parameters<typeof FeedbackButton>[0]['supabase']}
      toast={(m, k) => { if (k === 'error') toast.error(m); else toast.success(m); }}
    />
  );
}
