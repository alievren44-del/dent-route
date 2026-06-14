/**
 * AuditLogPage — Admin denetim izi listeleme.
 *
 * URL: /admin/audit-logs
 * Sprint: 2, PROMPT-14
 *
 * Basit sayfalı (PAGE_SIZE=50, "Daha Fazla") liste; aksiyon ve tarih aralığı
 * filtresi. admin_audit_logs.created_at DESC sıralı.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, RefreshCw } from 'lucide-react';

import { getTypedClient } from '@/lib/supabase';

const PAGE_SIZE = 50;

interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogJoined extends AuditLogRow {
  actorLabel: string;
}

async function fetchAuditLogs(input: {
  action: string;
  from: string;
  to: string;
  limit: number;
}): Promise<AuditLogJoined[]> {
  const supabase = getTypedClient();
  let q = supabase
    .from('admin_audit_logs')
    .select('id, actor_id, action, target_table, target_id, details, created_at')
    .order('created_at', { ascending: false })
    .limit(input.limit);

  if (input.action) q = q.eq('action', input.action);
  if (input.from) q = q.gte('created_at', new Date(input.from).toISOString());
  if (input.to) {
    const toEnd = new Date(input.to);
    toEnd.setHours(23, 59, 59, 999);
    q = q.lte('created_at', toEnd.toISOString());
  }

  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as AuditLogRow[];

  // Actor adlarını join et — profiles.ad_soyad / email
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x)));
  const actorMap = new Map<string, { ad_soyad: string | null; email: string | null }>();
  if (actorIds.length > 0) {
    const { data: profs, error: profErr } = await supabase
      .from('profiles')
      .select('id, ad_soyad, email')
      .in('id', actorIds);
    if (!profErr && profs) {
      for (const p of profs as Array<{
        id: string;
        ad_soyad: string | null;
        email: string | null;
      }>) {
        actorMap.set(p.id, { ad_soyad: p.ad_soyad, email: p.email });
      }
    }
  }

  return rows.map<AuditLogJoined>((r) => {
    const actor = r.actor_id ? actorMap.get(r.actor_id) : undefined;
    const actorLabel = actor
      ? (actor.ad_soyad ?? actor.email ?? r.actor_id ?? 'sistem')
      : (r.actor_id ?? 'sistem');
    return { ...r, actorLabel };
  });
}

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Tüm Eylemler' },
  { value: 'create_user', label: 'Kullanıcı oluştur' },
  { value: 'change_role', label: 'Rol değiştir' },
  { value: 'reset_password', label: 'Şifre sıfırla' },
  { value: 'deactivate_user', label: 'Kullanıcı deaktive' },
  { value: 'activate_user', label: 'Kullanıcı aktive' },
  { value: 'assign_region', label: 'Bölge ata' },
];

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AuditLogPage(): JSX.Element {
  const [actionFilter, setActionFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);

  const logsQuery = useQuery({
    queryKey: ['admin', 'audit-logs', actionFilter, from, to, limit],
    queryFn: () => fetchAuditLogs({ action: actionFilter, from, to, limit }),
  });

  const rows = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);
  const reachedEnd = rows.length < limit;

  const detailsPreview = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        preview: r.details ? JSON.stringify(r.details) : '—',
      })),
    [rows],
  );

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 space-y-2 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
              <ClipboardList className="h-5 w-5" />
              Denetim İzi
            </h1>
            <p className="text-xs text-slate-500">
              {logsQuery.isLoading ? 'Yükleniyor…' : `${rows.length} kayıt gösteriliyor`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void logsQuery.refetch();
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${logsQuery.isFetching ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            aria-label="Eylem filtresi"
          >
            {ACTION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <label className="text-xs text-slate-500" htmlFor="al-from">
            Başl:
          </label>
          <input
            id="al-from"
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
          <label className="text-xs text-slate-500" htmlFor="al-to">
            Bit:
          </label>
          <input
            id="al-to"
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setLimit(PAGE_SIZE);
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
          />
        </div>
      </header>

      <main className="flex-1 px-2 py-3 sm:px-4">
        {logsQuery.isError && (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Denetim izi yüklenemedi: {(logsQuery.error as Error | null)?.message ?? 'bilinmiyor'}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Zaman</th>
                <th className="px-3 py-2 text-left font-medium">Kim</th>
                <th className="px-3 py-2 text-left font-medium">Eylem</th>
                <th className="px-3 py-2 text-left font-medium">Hedef</th>
                <th className="px-3 py-2 text-left font-medium">Detay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, idx) => (
                <tr key={r.id} className="align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {formatDateTime(r.created_at)}
                  </td>
                  <td className="px-3 py-2 text-slate-700">{r.actorLabel}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {r.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.target_table ? (
                      <span className="font-mono text-xs">
                        {r.target_table}
                        {r.target_id ? `:${r.target_id.slice(0, 8)}` : ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="max-w-xs truncate px-3 py-2 font-mono text-xs text-slate-500">
                    {detailsPreview[idx]?.preview ?? '—'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !logsQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm text-slate-500">
                    Denetim kaydı yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!reachedEnd && rows.length > 0 && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Daha Fazla
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
