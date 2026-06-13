import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Inbox } from 'lucide-react';
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

type TabKey = 'all' | 'unread';

async function fetchAll(userId: string): Promise<NotificationRow[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('saha_notifications')
    .select('id, type, title, body, payload, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

type GroupKey = 'today' | 'yesterday' | 'this_week' | 'older';

const GROUP_LABELS: Record<GroupKey, string> = {
  today: 'Bugün',
  yesterday: 'Dün',
  this_week: 'Bu hafta',
  older: 'Eski',
};

function bucketOf(iso: string): GroupKey {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 7);

  const created = new Date(iso);
  if (created >= today) return 'today';
  if (created >= yesterday) return 'yesterday';
  if (created >= weekStart) return 'this_week';
  return 'older';
}

export default function NotificationsPage() {
  const userId = useAuthStore((s) => s.session?.userId);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', 'list', userId],
    enabled: !!userId,
    queryFn: () => fetchAll(userId!),
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('saha_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('saha_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('read_at', null);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const filtered = useMemo<NotificationRow[]>(() => {
    const rows = data ?? [];
    if (tab === 'unread') return rows.filter((n) => !n.read_at);
    return rows;
  }, [data, tab]);

  const grouped = useMemo(() => {
    const buckets: Record<GroupKey, NotificationRow[]> = {
      today: [],
      yesterday: [],
      this_week: [],
      older: [],
    };
    for (const n of filtered) {
      buckets[bucketOf(n.created_at)].push(n);
    }
    return buckets;
  }, [filtered]);

  const unreadCount = (data ?? []).filter((n) => !n.read_at).length;

  if (!userId) {
    return (
      <div className="mx-auto max-w-2xl p-4">
        <p className="text-sm text-muted-foreground">Oturum yok.</p>
      </div>
    );
  }

  const groupOrder: GroupKey[] = ['today', 'yesterday', 'this_week', 'older'];

  return (
    <div className="mx-auto max-w-2xl px-4 py-4">
      <header className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Bildirimler</h1>
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={unreadCount === 0 || markAllRead.isPending}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Hepsini okundu işaretle
        </button>
      </header>

      <div className="mb-4 flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => setTab('all')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tab === 'all' ? 'bg-card shadow-sm' : 'text-muted-foreground'
          }`}
        >
          Tümü
        </button>
        <button
          type="button"
          onClick={() => setTab('unread')}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            tab === 'unread' ? 'bg-card shadow-sm' : 'text-muted-foreground'
          }`}
        >
          Okunmamış {unreadCount > 0 && <span className="ml-1 text-red-500">({unreadCount})</span>}
        </button>
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Inbox className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {tab === 'unread' ? 'Okunmamış bildirim yok' : 'Bildirim yok'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groupOrder.map((key) => {
            const rows = grouped[key];
            if (rows.length === 0) return null;
            return (
              <section key={key}>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {GROUP_LABELS[key]}
                </h2>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                  {rows.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (!n.read_at) markRead.mutate(n.id);
                        }}
                        className={`w-full text-left p-3 hover:bg-muted ${
                          !n.read_at ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm">{n.title}</span>
                          {!n.read_at && (
                            <span
                              className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-blue-500"
                              aria-hidden="true"
                            />
                          )}
                        </div>
                        {n.body && <p className="mt-1 text-xs text-muted-foreground">{n.body}</p>}
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {new Date(n.created_at).toLocaleString('tr-TR')}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
