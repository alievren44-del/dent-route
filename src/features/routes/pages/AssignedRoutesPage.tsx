/**
 * AssignedRoutesPage — User'a atanan rotalar listesi.
 *
 * URL: /routes/assigned
 *
 * Akış:
 *   1. saha_routes WHERE assigned_to=me AND status='assigned' (sıralı)
 *   2. Kart liste: rota adı, atayan, durak sayısı, atanma zamanı, not
 *   3. "Kabul Et" → status='active', accepted_at=now → ActiveRoute'a yönlen
 *   4. "Reddet" → status='cancelled', note ekle
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  MapPin,
  User as UserIcon,
  Clock,
  CheckCircle2,
  XCircle,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';

import { getSupabaseClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';

interface AssignedRoute {
  id: string;
  name: string | null;
  account_ids: string[];
  status: string;
  total_distance_km: number | null;
  total_duration_min: number | null;
  assigned_at: string | null;
  assignment_note: string | null;
  assigned_by: string | null;
  assigner_email?: string;
}

async function fetchAssigned(userId: string): Promise<AssignedRoute[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_routes')
    .select(
      'id, name, account_ids, status, total_distance_km, total_duration_min, assigned_at, assignment_note, assigned_by',
    )
    .eq('assigned_to', userId)
    .in('status', ['assigned', 'active'])
    .order('assigned_at', { ascending: false });
  if (error) throw error;
  const list = (data ?? []) as AssignedRoute[];
  // Atayan email'i çek
  const assignerIds = Array.from(
    new Set(list.map((r) => r.assigned_by).filter(Boolean) as string[]),
  );
  if (assignerIds.length > 0) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, email, ad_soyad')
      .in('id', assignerIds);
    const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
    for (const r of list) {
      if (r.assigned_by) {
        const a = byId.get(r.assigned_by);
        if (a) r.assigner_email = a.ad_soyad || a.email;
      }
    }
  }
  return list;
}

export default function AssignedRoutesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);

  const query = useQuery<AssignedRoute[], Error>({
    queryKey: ['assigned-routes', userId],
    queryFn: () => fetchAssigned(userId!),
    enabled: !!userId,
  });

  const accept = useCallback(
    async (routeId: string) => {
      try {
        const supabase = getSupabaseClient();
        const { error } = await supabase
          .from('saha_routes')
          .update({ status: 'active', accepted_at: new Date().toISOString() })
          .eq('id', routeId);
        if (error) throw error;
        toast.success('Rota kabul edildi');
        queryClient.invalidateQueries({ queryKey: ['assigned-routes'] });
        navigate(`/routes/active/${routeId}`);
      } catch (e) {
        toast.error(`Hata: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [navigate, queryClient],
  );

  const reject = useCallback(
    async (routeId: string) => {
      if (!confirm('Bu rotayı reddediyor musun?')) return;
      try {
        const supabase = getSupabaseClient();
        const { error } = await supabase
          .from('saha_routes')
          .update({ status: 'cancelled' })
          .eq('id', routeId);
        if (error) throw error;
        toast.success('Rota reddedildi');
        queryClient.invalidateQueries({ queryKey: ['assigned-routes'] });
      } catch (e) {
        toast.error(`Hata: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [queryClient],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Bana Atanan Rotalar</h1>
        <p className="text-sm text-slate-600">
          Admin tarafından atanmış rotalar — kabul et veya reddet.
        </p>
      </header>

      {query.isLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      )}

      {query.isError && <p className="text-sm text-red-600">{query.error?.message ?? 'Hata'}</p>}

      {query.data && query.data.length === 0 && (
        <p className="text-sm text-slate-500">Atanan rota yok.</p>
      )}

      <ul className="space-y-2">
        {(query.data ?? []).map((r) => (
          <li key={r.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">
                  {r.name?.trim() || 'İsimsiz Rota'}
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1">
                    <MapPin size={11} />
                    {r.account_ids.length} durak
                  </span>
                  {r.total_distance_km != null && <span>{r.total_distance_km.toFixed(1)} km</span>}
                  {r.total_duration_min != null && <span>{r.total_duration_min} dk</span>}
                  {r.assigner_email && (
                    <span className="inline-flex items-center gap-1">
                      <UserIcon size={11} />
                      {r.assigner_email}
                    </span>
                  )}
                  {r.assigned_at && (
                    <span className="inline-flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(r.assigned_at).toLocaleString('tr-TR')}
                    </span>
                  )}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  r.status === 'assigned'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-blue-100 text-blue-800'
                }`}
              >
                {r.status === 'assigned' ? 'Bekliyor' : 'Aktif'}
              </span>
            </div>

            {r.assignment_note && (
              <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                <MessageSquare size={12} className="mt-0.5 shrink-0" />
                <span>{r.assignment_note}</span>
              </div>
            )}

            <div className="flex gap-2">
              {r.status === 'assigned' ? (
                <>
                  <button
                    type="button"
                    onClick={() => void accept(r.id)}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white"
                  >
                    <CheckCircle2 size={14} />
                    Kabul Et
                  </button>
                  <button
                    type="button"
                    onClick={() => void reject(r.id)}
                    className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-3 text-xs font-semibold text-red-600"
                  >
                    <XCircle size={14} />
                    Reddet
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate(`/routes/active/${r.id}`)}
                  className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white"
                >
                  Rotayı Aç
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
