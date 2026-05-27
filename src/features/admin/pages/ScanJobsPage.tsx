/**
 * ScanJobsPage — Aktif/geçmiş batch-scan job'larını listeler.
 *
 * Aynı zamanda ClinicScanPage'in 5. tab'ı içine inline render edilir.
 * 5sn TanStack Query polling + Supabase realtime channel hibrit.
 *
 * Her satır:
 *   - status badge
 *   - scope tarifi (Türkiye / Bölge / Tüm İl / Tek İlçe)
 *   - progress bar
 *   - başlangıç + ETA
 *   - aksiyonlar: Duraklat / Devam Et / İptal / Detay
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Pause,
  Play,
  X,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
} from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';

interface ScanJobRow {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  scope_type: 'single_district' | 'whole_province' | 'region' | 'whole_country';
  scope_params: Record<string, unknown> | null;
  radius_km: number;
  scan_types: string[];
  scan_source: 'google' | 'osm' | 'both';
  total_items: number;
  completed_items: number;
  failed_items: number;
  total_clinics_found: number;
  total_new_clinics: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
}

async function fetchJobs(): Promise<ScanJobRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_scan_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ScanJobRow[];
}

function scopeLabel(row: ScanJobRow): string {
  const p = row.scope_params ?? {};
  switch (row.scope_type) {
    case 'single_district':
      return `Tek İlçe: ${String((p as Record<string, unknown>).province ?? '?')} / ${String((p as Record<string, unknown>).district ?? '?')}`;
    case 'whole_province':
      return `Tüm İl: ${String((p as Record<string, unknown>).province ?? '?')}`;
    case 'region':
      return `Bölge: ${String((p as Record<string, unknown>).region ?? '?')}`;
    case 'whole_country':
      return 'Türkiye (973 ilçe)';
    default:
      return row.scope_type;
  }
}

function StatusBadge({ status }: { status: ScanJobRow['status'] }) {
  const map: Record<ScanJobRow['status'], { label: string; cls: string; icon: React.ReactNode }> = {
    pending:   { label: 'Bekliyor',  cls: 'bg-gray-100 text-gray-700',     icon: <Clock className="h-3 w-3" /> },
    running:   { label: 'Çalışıyor', cls: 'bg-blue-100 text-blue-800',     icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    paused:    { label: 'Duraklatıldı', cls: 'bg-amber-100 text-amber-800', icon: <Pause className="h-3 w-3" /> },
    completed: { label: 'Tamamlandı', cls: 'bg-green-100 text-green-800',  icon: <CheckCircle2 className="h-3 w-3" /> },
    failed:    { label: 'Hata',       cls: 'bg-red-100 text-red-800',      icon: <AlertCircle className="h-3 w-3" /> },
    cancelled: { label: 'İptal',      cls: 'bg-gray-200 text-gray-600',    icon: <X className="h-3 w-3" /> },
  };
  const meta = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${meta.cls}`}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function estimateEta(row: ScanJobRow): string {
  if (row.status !== 'running' || !row.started_at) return '—';
  const remaining = row.total_items - row.completed_items;
  if (remaining <= 0) return '—';
  const startedMs = new Date(row.started_at).getTime();
  const elapsedMs = Date.now() - startedMs;
  if (row.completed_items === 0 || elapsedMs <= 0) return '—';
  const msPerItem = elapsedMs / row.completed_items;
  const etaMs = msPerItem * remaining;
  const mins = Math.round(etaMs / 60000);
  if (mins < 1) return '<1 dk';
  if (mins < 60) return `~${mins} dk`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `~${hrs}s ${rem}dk`;
}

interface ScanJobsPageProps {
  /** Inline mod — h1 başlık ve outer padding gizlenir. */
  embedded?: boolean;
}

export default function ScanJobsPage({ embedded = false }: ScanJobsPageProps = {}) {
  const queryClient = useQueryClient();

  const jobsQuery = useQuery({
    queryKey: ['scan-jobs'],
    queryFn: fetchJobs,
    refetchInterval: 5000,
  });

  // Realtime subscription — postgres_changes invalidates query.
  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('scan-jobs')
      .on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'saha_scan_jobs' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['scan-jobs'] });
        },
      )
      .on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'saha_scan_job_items' },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['scan-jobs'] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ScanJobRow['status'] }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('saha_scan_jobs')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      // Devam Et durumunda batch-scan'i tekrar uyandır.
      if (status === 'running') {
        try {
          await supabase.functions.invoke('batch-scan', { body: { jobId: id } });
        } catch {
          /* fire-and-forget; bir sonraki polling yakalar */
        }
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scan-jobs'] });
    },
  });

  const jobs = jobsQuery.data ?? [];

  return (
    <div className={embedded ? 'space-y-3' : 'p-4 space-y-4 max-w-5xl mx-auto'}>
      {!embedded && (
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Loader2 className="h-6 w-6" /> Tarama Job'ları
        </h1>
      )}

      {jobsQuery.isLoading && (
        <div className="text-sm text-muted-foreground">Yükleniyor…</div>
      )}

      {jobsQuery.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Job'lar yüklenemedi: {(jobsQuery.error as Error)?.message ?? 'unknown'}
        </div>
      )}

      {!jobsQuery.isLoading && jobs.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Henüz tarama job'u yok. Diğer sekmelerden bir tarama başlatın.
        </div>
      )}

      <div className="space-y-2">
        {jobs.map((row) => {
          const progressPct = row.total_items > 0
            ? Math.round((row.completed_items / row.total_items) * 100)
            : 0;
          const canPause  = row.status === 'running';
          const canResume = row.status === 'paused';
          const canCancel = row.status === 'pending' || row.status === 'running' || row.status === 'paused';

          return (
            <div key={row.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusBadge status={row.status} />
                    <span className="text-sm font-medium truncate">{scopeLabel(row)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {row.completed_items}/{row.total_items} ilçe ·
                    {' '}Toplam {row.total_clinics_found} klinik ({row.total_new_clinics} yeni)
                    {row.failed_items > 0 && (
                      <span className="text-red-700"> · {row.failed_items} hata</span>
                    )}
                    {' '}· ETA {estimateEta(row)}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {row.started_at
                      ? `Başlangıç: ${new Date(row.started_at).toLocaleString('tr-TR')}`
                      : `Oluşturma: ${new Date(row.created_at).toLocaleString('tr-TR')}`}
                    {row.scan_source ? ` · Kaynak: ${row.scan_source}` : ''}
                    {Array.isArray(row.scan_types) && row.scan_types.length > 0
                      ? ` · ${row.scan_types.join(',')}`
                      : ''}
                  </div>
                </div>

                <Link
                  to={`/admin/clinic-scan/jobs/${row.id}`}
                  className="inline-flex items-center text-sm text-primary hover:underline whitespace-nowrap"
                >
                  Detay <ChevronRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="h-2 w-full bg-muted rounded overflow-hidden">
                <div
                  className={`h-full transition-all ${row.status === 'failed' ? 'bg-red-500' : 'bg-primary'}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={!canPause || updateStatus.isPending}
                  onClick={() => updateStatus.mutate({ id: row.id, status: 'paused' })}
                  className="inline-flex items-center gap-1 px-2 h-8 rounded border border-border text-xs disabled:opacity-40"
                >
                  <Pause className="h-3 w-3" /> Duraklat
                </button>
                <button
                  type="button"
                  disabled={!canResume || updateStatus.isPending}
                  onClick={() => updateStatus.mutate({ id: row.id, status: 'running' })}
                  className="inline-flex items-center gap-1 px-2 h-8 rounded border border-border text-xs disabled:opacity-40"
                >
                  <Play className="h-3 w-3" /> Devam Et
                </button>
                <button
                  type="button"
                  disabled={!canCancel || updateStatus.isPending}
                  onClick={() => {
                    if (confirm('Bu job iptal edilsin mi?')) {
                      updateStatus.mutate({ id: row.id, status: 'cancelled' });
                    }
                  }}
                  className="inline-flex items-center gap-1 px-2 h-8 rounded border border-red-200 text-red-700 text-xs disabled:opacity-40"
                >
                  <X className="h-3 w-3" /> İptal
                </button>
                {row.last_error && (
                  <span className="text-[11px] text-red-700 truncate ml-2" title={row.last_error}>
                    {row.last_error}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
