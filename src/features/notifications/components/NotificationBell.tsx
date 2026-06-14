import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';

interface NotificationRow {
  id: string;
  type:
    | 'sample_follow_up'
    | 'order_approval'
    | 'order_status_change'
    | 'mileage_reminder'
    | 'system';
  title: string;
  body: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

async function fetchRecent(userId: string): Promise<NotificationRow[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('saha_notifications')
    .select('id, type, title, body, payload, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

export function NotificationBell() {
  const userId = useAuthStore((s) => s.session?.userId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  // Escape ile kapat
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    // Popup açıldığında ilk odaklanılabilir öğeye focus ver
    const firstFocusable = popupRef.current?.querySelector<HTMLElement>(
      'a, button, [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const { data } = useQuery({
    queryKey: ['notifications', userId],
    enabled: !!userId,
    queryFn: () => fetchRecent(userId!),
    refetchInterval: 60_000,
  });

  const unreadCount = (data ?? []).filter((n) => !n.read_at).length;

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('saha_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!userId) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full hover:bg-muted"
        aria-label="Bildirimler"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            ref={popupRef}
            className="absolute right-0 top-12 z-30 w-80 max-w-[90vw] rounded-xl border border-border bg-card shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Bildirimler paneli"
          >
            <div className="border-b border-border p-3 flex items-center justify-between">
              <h2 className="font-semibold text-sm">Bildirimler</h2>
              <Link
                to="/notifications"
                onClick={() => setOpen(false)}
                className="text-xs text-primary hover:underline"
              >
                Tümü
              </Link>
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-border" aria-live="polite" aria-atomic="false">
              {(data ?? []).length === 0 ? (
                <div className="p-6 text-center text-sm text-muted-foreground">Bildirim yok</div>
              ) : (
                (data ?? []).map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      if (!n.read_at) markRead.mutate(n.id);
                      setOpen(false);
                    }}
                    className={`w-full text-left p-3 hover:bg-muted ${!n.read_at ? 'bg-blue-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-sm">{n.title}</span>
                      {!n.read_at && (
                        <span
                          className="mt-1 inline-block h-2 w-2 rounded-full bg-blue-500"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    {n.body && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {new Date(n.created_at).toLocaleString('tr-TR')}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
