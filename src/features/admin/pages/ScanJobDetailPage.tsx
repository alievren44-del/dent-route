/**
 * ScanJobDetailPage — Tek bir batch-scan job'unun detay sayfası.
 *
 * Route: /admin/clinic-scan/jobs/:id
 *
 * Gösterir:
 *   - Job özeti (status, scope, progress, sayaçlar)
 *   - Status filtre chip'leri
 *   - İlçe bazlı paginate edilmiş tablo
 *   - Failed item'lar için "Yeniden Dene" (status'u pending'e çevirir)
 */

import { useMemo, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';

interface ScanJobRow {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  scope_type: string;
  scope_params: Record<string, unknown> | null;
  radius_km: number;
  scan_types: string[];
  scan_source: 'google' | 'osm' | 'both';
  vertical_key: string;
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

interface ScanJobItemRow {
  id: string;
  job_id: string;
  province_slug: string;
  district_slug: string | null;
  lat: number;
  lng: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  scanned_count: number;
  new_count: number;
  updated_count: number;
  filtered_out_count: number;
  google_count: number | null;
  osm_count: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const PAGE_SIZE = 50;

const STATUS_CHIPS: Array<{ key: 'all' | ScanJobItemRow['status']; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'pending', label: 'Bekliyor' },
  { key: 'running', label: 'Çalışıyor' },
  { key: 'completed', label: 'Tamam' },
  { key: 'failed', label: 'Hata' },
  { key: 'skipped', label: 'Atlandı' },
];

async function fetchJob(id: string): Promise<ScanJobRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_scan_jobs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as ScanJobRow | null) ?? null;
}

async function fetchItems(
  jobId: string,
  statusFilter: 'all' | ScanJobItemRow['status'],
  page: number,
): Promise<{ rows: ScanJobItemRow[]; total: number }> {
  const supabase = getSupabaseClient();
  let q = supabase
    .from('saha_scan_job_items')
    .select('*', { count: 'exact' })
    .eq('job_id', jobId)
    .order('created_at', { ascending: true })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  if (statusFilter !== 'all') {
    q = q.eq('status', statusFilter);
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data ?? []) as ScanJobItemRow[], total: count ?? 0 };
}

function ItemStatusIcon({ status }: { status: ScanJobItemRow['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-700" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-red-700" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-blue-700 animate-spin" />;
    case 'pending':
      return <Clock className="h-4 w-4 text-gray-500" />;
    case 'skipped':
      return <Clock className="h-4 w-4 text-gray-400" />;
  }
}

export default function ScanJobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = params.id ?? '';
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<'all' | ScanJobItemRow['status']>('all');
  const [page, setPage] = useState(0);

  // page'i filtreye reset
  useEffect(() => {
    setPage(0);
  }, [statusFilter]);

  const jobQuery = useQuery({
    queryKey: ['scan-job', jobId],
    queryFn: () => fetchJob(jobId),
    refetchInterval: 5000,
    enabled: !!jobId,
  });

  const itemsQuery = useQuery({
    queryKey: ['scan-job-items', jobId, statusFilter, page],
    queryFn: () => fetchItems(jobId, statusFilter, page),
    refetchInterval: 5000,
    enabled: !!jobId,
  });

  // Realtime
  useEffect(() => {
    if (!jobId) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`scan-job-${jobId}`)
      .on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: 'saha_scan_jobs', filter: `id=eq.${jobId}` },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['scan-job', jobId] });
        },
      )
      .on(
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table: 'saha_scan_job_items',
          filter: `job_id=eq.${jobId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: ['scan-job-items', jobId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [jobId, queryClient]);

  const retryItem = useMutation({
    mutationFn: async (itemId: string) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('saha_scan_job_items')
        .update({
          status: 'pending',
          error_message: null,
          started_at: null,
          completed_at: null,
        })
        .eq('id', itemId);
      if (error) throw error;

      // Job paused/cancelled ise running'e dön + Edge Function'ı uyandır.
      if (
        jobQuery.data &&
        (jobQuery.data.status === 'paused' ||
          jobQuery.data.status === 'completed' ||
          jobQuery.data.status === 'failed')
      ) {
        await supabase
          .from('saha_scan_jobs')
          .update({ status: 'running', completed_at: null })
          .eq('id', jobId);
      }
      try {
        await supabase.functions.invoke('batch-scan', { body: { jobId } });
      } catch {
        /* fire-and-forget */
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['scan-job', jobId] });
      void queryClient.invalidateQueries({ queryKey: ['scan-job-items', jobId] });
    },
  });

  const totalPages = useMemo(() => {
    const total = itemsQuery.data?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }, [itemsQuery.data?.total]);

  if (!jobId) {
    return <div className="p-4">Geçersiz job kimliği.</div>;
  }

  const job = jobQuery.data;
  const progressPct =
    job && job.total_items > 0 ? Math.round((job.completed_items / job.total_items) * 100) : 0;

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        <Link
          to="/admin/clinic-scan"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4 mr-1" /> Geri
        </Link>
      </div>

      <h1 className="text-2xl font-semibold">Tarama Job Detayı</h1>

      {jobQuery.isLoading && <div className="text-sm text-muted-foreground">Job yükleniyor…</div>}
      {jobQuery.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Job yüklenemedi: {(jobQuery.error as Error)?.message ?? 'unknown'}
        </div>
      )}

      {job && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Durum</div>
              <div className="font-medium">{job.status}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Kapsam</div>
              <div className="font-medium">{job.scope_type}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">İlerleme</div>
              <div className="font-medium">
                {job.completed_items}/{job.total_items} ({progressPct}%)
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Toplam Klinik</div>
              <div className="font-medium">
                {job.total_clinics_found} ({job.total_new_clinics} yeni)
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Yarıçap</div>
              <div className="font-medium">{job.radius_km} km</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Kaynak</div>
              <div className="font-medium">{job.scan_source}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Tipler</div>
              <div className="font-medium truncate">{(job.scan_types ?? []).join(',')}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Hatalı</div>
              <div className="font-medium text-red-700">{job.failed_items}</div>
            </div>
          </div>

          <div className="h-2 w-full bg-muted rounded overflow-hidden">
            <div
              className={`h-full ${job.status === 'failed' ? 'bg-red-500' : 'bg-primary'}`}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            Oluşturma: {new Date(job.created_at).toLocaleString('tr-TR')}
            {job.started_at
              ? ` · Başlangıç: ${new Date(job.started_at).toLocaleString('tr-TR')}`
              : ''}
            {job.completed_at
              ? ` · Bitiş: ${new Date(job.completed_at).toLocaleString('tr-TR')}`
              : ''}
          </div>

          {job.last_error && <div className="text-xs text-red-700">Son hata: {job.last_error}</div>}

          <div className="text-xs text-muted-foreground">
            scope_params:{' '}
            <code className="text-foreground">{JSON.stringify(job.scope_params)}</code>
          </div>
        </div>
      )}

      {/* Status filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setStatusFilter(c.key)}
            className={`px-3 h-8 rounded-full border text-xs ${
              statusFilter === c.key
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border bg-background'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Items table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted text-xs">
            <tr>
              <th className="text-left p-2">Durum</th>
              <th className="text-left p-2">İl</th>
              <th className="text-left p-2">İlçe</th>
              <th className="text-right p-2">Bulundu</th>
              <th className="text-right p-2">Yeni</th>
              <th className="text-right p-2">G/O</th>
              <th className="text-left p-2">Hata</th>
              <th className="text-right p-2">Aksiyon</th>
            </tr>
          </thead>
          <tbody>
            {itemsQuery.isLoading && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-muted-foreground">
                  Yükleniyor…
                </td>
              </tr>
            )}
            {!itemsQuery.isLoading && (itemsQuery.data?.rows.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="p-4 text-center text-muted-foreground">
                  Kayıt yok.
                </td>
              </tr>
            )}
            {(itemsQuery.data?.rows ?? []).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="p-2">
                  <ItemStatusIcon status={row.status} />
                </td>
                <td className="p-2">{row.province_slug}</td>
                <td className="p-2">{row.district_slug ?? '—'}</td>
                <td className="p-2 text-right">{row.scanned_count}</td>
                <td className="p-2 text-right text-green-700">{row.new_count}</td>
                <td className="p-2 text-right text-xs text-muted-foreground">
                  {row.google_count ?? '-'}/{row.osm_count ?? '-'}
                </td>
                <td
                  className="p-2 text-xs text-red-700 max-w-[180px] truncate"
                  title={row.error_message ?? ''}
                >
                  {row.error_message ?? ''}
                </td>
                <td className="p-2 text-right">
                  {row.status === 'failed' && (
                    <button
                      type="button"
                      onClick={() => retryItem.mutate(row.id)}
                      disabled={retryItem.isPending}
                      className="inline-flex items-center gap-1 px-2 h-7 rounded border border-border text-xs disabled:opacity-40"
                    >
                      <RefreshCw className="h-3 w-3" /> Yeniden
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs">
        <div className="text-muted-foreground">
          Sayfa {page + 1} / {totalPages} · Toplam {itemsQuery.data?.total ?? 0} kayıt
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="px-3 h-8 rounded border border-border disabled:opacity-40"
          >
            Önceki
          </button>
          <button
            type="button"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
            className="px-3 h-8 rounded border border-border disabled:opacity-40"
          >
            Sonraki
          </button>
        </div>
      </div>
    </div>
  );
}
