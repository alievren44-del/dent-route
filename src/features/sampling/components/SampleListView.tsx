/**
 * SampleListView — Aktif numuneler listesi.
 *
 * - Üst banner: bekleyen takip sayısı (follow_up_at <= now, status verildi/denendi)
 * - Filtre çubuğu: status select + tarih aralığı + arama (account adı)
 * - Liste: kart (mobile) + tablo (desktop)
 * - Sol kenar renk şeridi (follow_up_at gecikmesine göre)
 * - Status güncelleme menüsü (3 dot) — optimistic
 * - "Sipariş Oluştur" CTA (verildi/denendi) → /orders/new?fromSample=…
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, MoreVertical, FileText, Search } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { tr } from 'date-fns/locale';
import { getTypedClient } from '@lib/supabase';
import { useVertical } from '@core/verticals/useVertical';
import { useAuthStore } from '@core/auth/authStore';
import type { SampleStatus } from '@core/sampling/types';

export interface SampleListViewProps {
  filterRepId?: string;
  filterStatus?: SampleStatus[];
  onSampleClick?: (sampleId: string) => void;
}

interface SampleLineRow {
  id: string;
  product_name: string;
  qty: number;
  unit: string;
  unit_cost_tl: number | null;
}

interface SampleRow {
  id: string;
  account_id: string;
  given_at: string;
  follow_up_at: string;
  status: SampleStatus;
  converted_order_id: string | null;
  photo_url: string | null;
  notes: string | null;
  created_at: string;
  saha_sample_lines: SampleLineRow[];
}

interface AccountRow {
  id: string;
  name: string;
  type: string | null;
}

type DateRange = 'all' | '30d' | '90d';
type StatusFilter = 'all' | SampleStatus;

const DEFAULT_STATUSES: SampleStatus[] = ['verildi', 'denendi'];
const TERMINAL_STATUSES: SampleStatus[] = ['donusturuldu', 'red', 'kayip', 'iade'];
const ALL_STATUSES: SampleStatus[] = ['verildi', 'denendi', 'donusturuldu', 'red', 'kayip', 'iade'];

function daysFromNow(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}

function daysBetween(fromIso: string, toMs: number): number {
  return Math.floor((toMs - new Date(fromIso).getTime()) / 86400000);
}

function statusLabel(s: SampleStatus): string {
  const map: Record<SampleStatus, string> = {
    verildi: 'Verildi',
    denendi: 'Denendi',
    donusturuldu: 'Dönüştü',
    red: 'Reddedildi',
    kayip: 'Kayıp',
    iade: 'İade',
  };
  return map[s];
}

function statusColor(s: SampleStatus): string {
  const map: Record<SampleStatus, string> = {
    verildi: 'bg-blue-100 text-blue-700',
    denendi: 'bg-amber-100 text-amber-700',
    donusturuldu: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    kayip: 'bg-gray-200 text-gray-700',
    iade: 'bg-purple-100 text-purple-700',
  };
  return map[s];
}

function stripeColor(followUpAt: string, status: SampleStatus): string {
  if (TERMINAL_STATUSES.includes(status)) return '#9ca3af';
  const diff = daysFromNow(followUpAt);
  if (diff <= 0) return '#ef4444';
  if (diff <= 3) return '#eab308';
  return '#16a34a';
}

function formatGivenAt(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM yyyy', { locale: tr });
  } catch {
    return iso;
  }
}

function lineSummary(lines: SampleLineRow[]): string {
  const totalQty = lines.length;
  const totalTl = lines.reduce((acc, l) => {
    if (l.unit_cost_tl == null) return acc;
    return acc + l.unit_cost_tl * l.qty;
  }, 0);
  if (totalTl > 0) {
    return `${totalQty} ürün, ${totalTl.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL`;
  }
  return `${totalQty} ürün`;
}

function dateRangeCutoffIso(range: DateRange): string | null {
  if (range === 'all') return null;
  const days = range === '30d' ? 30 : 90;
  return new Date(Date.now() - days * 86400000).toISOString();
}

function SampleListView({
  filterRepId,
  filterStatus,
  onSampleClick,
}: SampleListViewProps): JSX.Element {
  const vertical = useVertical();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.session?.userId ?? null);
  const customerLabelPlural = vertical.labels.customer.plural;

  const effectiveRepId = filterRepId ?? currentUserId ?? undefined;
  const baseStatuses = filterStatus ?? DEFAULT_STATUSES;

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const activeStatuses: SampleStatus[] = useMemo(() => {
    if (statusFilter === 'all') return baseStatuses;
    if (baseStatuses.includes(statusFilter)) return [statusFilter];
    return [statusFilter];
  }, [statusFilter, baseStatuses]);

  const cutoffIso = dateRangeCutoffIso(dateRange);

  const samplesQuery = useQuery<SampleRow[]>({
    queryKey: ['samples', effectiveRepId ?? null, activeStatuses, cutoffIso],
    queryFn: async (): Promise<SampleRow[]> => {
      const supabase = getTypedClient();
      let q = supabase
        .from('saha_samples')
        .select(
          `
          id, account_id, given_at, follow_up_at, status, converted_order_id, photo_url, notes, created_at,
          saha_sample_lines (id, product_name, qty, unit, unit_cost_tl)
        `,
        )
        .order('given_at', { ascending: false });
      if (effectiveRepId) q = q.eq('rep_id', effectiveRepId);
      if (activeStatuses.length > 0) q = q.in('status', activeStatuses);
      if (cutoffIso) q = q.gte('given_at', cutoffIso);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as SampleRow[];
    },
    enabled: Boolean(effectiveRepId) || filterRepId === undefined,
  });

  const samples = samplesQuery.data ?? [];
  const accountIds = useMemo(() => {
    const set = new Set<string>();
    for (const row of samples) set.add(row.account_id);
    return Array.from(set);
  }, [samples]);

  const accountsQuery = useQuery<Map<string, AccountRow>>({
    queryKey: ['samples:accounts', accountIds],
    queryFn: async (): Promise<Map<string, AccountRow>> => {
      const map = new Map<string, AccountRow>();
      if (accountIds.length === 0) return map;
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('saha_clinics')
        .select('id, name, types')
        .in('id', accountIds);
      if (error) throw error;
      for (const row of (data ?? []) as Array<{
        id: string;
        name: string;
        types: string[] | null;
      }>) {
        map.set(row.id, { id: row.id, name: row.name, type: row.types?.[0] ?? null });
      }
      return map;
    },
    enabled: accountIds.length > 0,
  });

  const accountMap = accountsQuery.data ?? new Map<string, AccountRow>();

  const filteredSamples = useMemo(() => {
    const term = searchTerm.trim().toLocaleLowerCase('tr');
    if (!term) return samples;
    return samples.filter((row) => {
      const acc = accountMap.get(row.account_id);
      if (!acc) return false;
      return acc.name.toLocaleLowerCase('tr').includes(term);
    });
  }, [samples, accountMap, searchTerm]);

  const pendingFollowupCount = useMemo(() => {
    const nowMs = Date.now();
    return samples.filter((row) => {
      if (row.status !== 'verildi' && row.status !== 'denendi') return false;
      return new Date(row.follow_up_at).getTime() <= nowMs;
    }).length;
  }, [samples]);

  const updateStatus = useMutation({
    mutationFn: async (args: { sampleId: string; newStatus: SampleStatus }): Promise<void> => {
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('saha_samples')
        .update({ status: args.newStatus })
        .eq('id', args.sampleId);
      if (error) throw error;
    },
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: ['samples'] });
      const previous = queryClient.getQueryData<SampleRow[]>([
        'samples',
        effectiveRepId ?? null,
        activeStatuses,
        cutoffIso,
      ]);
      if (previous) {
        queryClient.setQueryData<SampleRow[]>(
          ['samples', effectiveRepId ?? null, activeStatuses, cutoffIso],
          previous.map((r) => (r.id === args.sampleId ? { ...r, status: args.newStatus } : r)),
        );
      }
      return { previous };
    },
    onError: (_err, _args, context) => {
      const ctx = context as { previous?: SampleRow[] } | undefined;
      if (ctx?.previous) {
        queryClient.setQueryData(
          ['samples', effectiveRepId ?? null, activeStatuses, cutoffIso],
          ctx.previous,
        );
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['samples'] });
    },
  });

  function handleStatusChange(sampleId: string, newStatus: SampleStatus): void {
    setOpenMenuId(null);
    updateStatus.mutate({ sampleId, newStatus });
  }

  function handleCreateOrder(sampleId: string): void {
    navigate(`/orders/new?fromSample=${sampleId}`);
  }

  const isLoading = samplesQuery.isLoading;
  const hasError = samplesQuery.isError;

  return (
    <div className="flex flex-col gap-3">
      {/* Banner */}
      {pendingFollowupCount > 0 && (
        <div
          className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3"
          role="alert"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-red-700">{pendingFollowupCount}</span>{' '}
            <span className="text-red-700">bekleyen takip var</span>
          </div>
          <span className="inline-flex min-w-[2rem] items-center justify-center rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
            {pendingFollowupCount}
          </span>
        </div>
      )}

      {/* Filtre çubuğu */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="h-11 min-h-tap-min rounded-xl border border-border bg-background px-3 text-sm"
          aria-label="Durum filtresi"
        >
          <option value="all">Tümü</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>

        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRange)}
          className="h-11 min-h-tap-min rounded-xl border border-border bg-background px-3 text-sm"
          aria-label="Tarih aralığı"
        >
          <option value="all">Tümü</option>
          <option value="30d">Son 30 gün</option>
          <option value="90d">Son 90 gün</option>
        </select>

        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`${customerLabelPlural} arayın`}
            className="h-11 min-h-tap-min w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm"
            aria-label="Müşteri ara"
          />
        </div>
      </div>

      {/* Liste */}
      {isLoading && (
        <div className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</div>
      )}
      {hasError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Numuneler yüklenirken bir hata oluştu.
        </div>
      )}
      {!isLoading && !hasError && filteredSamples.length === 0 && (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Gösterilecek numune yok.
        </div>
      )}

      {/* Mobile cards */}
      <div className="flex flex-col gap-3 md:hidden">
        {filteredSamples.map((row) => {
          const acc = accountMap.get(row.account_id);
          const accountName = acc?.name ?? 'Bilinmiyor';
          const accountType = acc?.type ?? null;
          const stripe = stripeColor(row.follow_up_at, row.status);
          const ageDays = Math.max(0, daysBetween(row.given_at, Date.now()));
          const canCreateOrder = row.status === 'verildi' || row.status === 'denendi';
          const menuOpen = openMenuId === row.id;
          return (
            <div
              key={row.id}
              className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div
                className="absolute inset-y-0 left-0 w-1.5"
                style={{ backgroundColor: stripe }}
                aria-hidden="true"
              />
              <button
                type="button"
                onClick={() => onSampleClick?.(row.id)}
                className="block w-full pl-5 pr-4 py-3 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-base leading-tight">
                      {accountName}
                    </h3>
                    {accountType && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{accountType}</div>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(row.status)}`}
                  >
                    {statusLabel(row.status)}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{formatGivenAt(row.given_at)}</span>
                  <span aria-hidden="true">•</span>
                  <span>{ageDays} gün önce</span>
                </div>

                <div className="mt-2 text-sm">{lineSummary(row.saha_sample_lines)}</div>
              </button>

              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
                {canCreateOrder ? (
                  <button
                    type="button"
                    onClick={() => handleCreateOrder(row.id)}
                    className="inline-flex h-10 min-h-tap-min items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Sipariş Oluştur
                  </button>
                ) : (
                  <span />
                )}

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenMenuId(menuOpen ? null : row.id)}
                    className="inline-flex h-10 w-10 min-h-tap-min items-center justify-center rounded-xl border border-border bg-background hover:bg-muted"
                    aria-label="Durumu güncelle"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                  >
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  </button>
                  {menuOpen && (
                    <StatusMenu
                      currentStatus={row.status}
                      onPick={(s) => handleStatusChange(row.id, s)}
                      onClose={() => setOpenMenuId(null)}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        {filteredSamples.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="w-1.5" aria-hidden="true" />
                  <th className="px-3 py-2">Müşteri</th>
                  <th className="px-3 py-2">Verilme</th>
                  <th className="px-3 py-2">Yaş</th>
                  <th className="px-3 py-2">Durum</th>
                  <th className="px-3 py-2">Ürünler</th>
                  <th className="px-3 py-2 text-right">İşlem</th>
                </tr>
              </thead>
              <tbody>
                {filteredSamples.map((row) => {
                  const acc = accountMap.get(row.account_id);
                  const accountName = acc?.name ?? 'Bilinmiyor';
                  const accountType = acc?.type ?? null;
                  const stripe = stripeColor(row.follow_up_at, row.status);
                  const ageDays = Math.max(0, daysBetween(row.given_at, Date.now()));
                  const canCreateOrder = row.status === 'verildi' || row.status === 'denendi';
                  const menuOpen = openMenuId === row.id;
                  return (
                    <tr key={row.id} className="border-t border-border align-top">
                      <td className="p-0">
                        <div
                          className="h-full w-1.5"
                          style={{ backgroundColor: stripe }}
                          aria-hidden="true"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => onSampleClick?.(row.id)}
                          className="text-left hover:underline"
                        >
                          <div className="font-medium">{accountName}</div>
                          {accountType && (
                            <div className="text-xs text-muted-foreground">{accountType}</div>
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{formatGivenAt(row.given_at)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">{ageDays} gün</td>
                      <td className="px-3 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(row.status)}`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-3 py-3">{lineSummary(row.saha_sample_lines)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {canCreateOrder && (
                            <button
                              type="button"
                              onClick={() => handleCreateOrder(row.id)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                            >
                              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                              Sipariş
                            </button>
                          )}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => setOpenMenuId(menuOpen ? null : row.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-background hover:bg-muted"
                              aria-label="Durumu güncelle"
                              aria-haspopup="menu"
                              aria-expanded={menuOpen}
                            >
                              <MoreVertical className="h-4 w-4" aria-hidden="true" />
                            </button>
                            {menuOpen && (
                              <StatusMenu
                                currentStatus={row.status}
                                onPick={(s) => handleStatusChange(row.id, s)}
                                onClose={() => setOpenMenuId(null)}
                              />
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface StatusMenuProps {
  currentStatus: SampleStatus;
  onPick: (s: SampleStatus) => void;
  onClose: () => void;
}

const MENU_OPTIONS: SampleStatus[] = ['denendi', 'donusturuldu', 'red', 'kayip', 'iade'];

function StatusMenu({ currentStatus, onPick, onClose }: StatusMenuProps): JSX.Element {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} aria-hidden="true" />
      <div
        role="menu"
        className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        {MENU_OPTIONS.map((s) => {
          const disabled = s === currentStatus;
          return (
            <button
              key={s}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => onPick(s)}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {statusLabel(s)}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default SampleListView;
