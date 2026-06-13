/**
 * OrderHistoryPage — Sipariş geçmişi.
 *
 * URL: /orders/history?customer_id=&status=&rep=
 *
 * Filtreler:
 *  - status chips
 *  - tarih aralığı (from / to)
 *  - rep_id (sadece MANAGER/ADMIN için)
 *  - müşteri (customer_id query param ya da text arama)
 *
 * Sayfalama: pageSize=20 + "Daha Fazla" butonu (CustomerListPage pattern).
 * XLSX export: customerExport.ts stiline benzer SheetJS.
 * Per-row Detay: modal (router'a yeni rota eklemiyoruz).
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { ArrowLeft, Calendar, FileSpreadsheet, Filter, Search, X } from 'lucide-react';
import { toast } from 'sonner';

import { getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { mapParlaToSahaRole } from '@core/auth/types';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'pending', label: 'Beklemede' },
  { value: 'approval_pending', label: 'Onay Bekliyor' },
  { value: 'approved', label: 'Onaylandı' },
  { value: 'confirmed', label: 'Onaylandı' },
  { value: 'rejected', label: 'Reddedildi' },
  { value: 'shipped', label: 'Kargoda' },
  { value: 'delivered', label: 'Teslim' },
  { value: 'cancelled', label: 'İptal' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-700',
  pending: 'bg-amber-100 text-amber-800',
  approval_pending: 'bg-purple-100 text-purple-800',
  approved: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((s) => [s.value, s.label]),
);

interface OrderHistoryRow {
  id: string;
  order_number: string | null;
  user_id: string | null;
  sales_rep_id: string | null;
  status: string | null;
  // #46/#103 — sipariş zaten faturalandıysa "Faturaya Gönder" butonunu gizlemek için gerekli.
  invoice_status: string | null;
  total: number | string | null;
  total_amount: number | string | null;
  shipping_status: string | null;
  tracking_number: string | null;
  notes: string | null;
  created_at: string | null;
  customer?: {
    id: string;
    ad_soyad: string | null;
    klinik_adi: string | null;
    email: string | null;
  } | null;
  cari?: {
    id: string;
    fatura_unvani: string | null;
  } | null;
  rep?: {
    id: string;
    ad_soyad: string | null;
    email: string | null;
  } | null;
}

interface RepOption {
  id: string;
  label: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function customerName(r: Pick<OrderHistoryRow, 'customer' | 'cari'>): string {
  const c = r.customer;
  if (c) return c.klinik_adi ?? c.ad_soyad ?? c.email ?? c.id.slice(0, 8);
  if (r.cari?.fatura_unvani) return r.cari.fatura_unvani;
  return '—';
}

function repName(r: OrderHistoryRow['rep']): string {
  if (!r) return '—';
  return r.ad_soyad ?? r.email ?? r.id.slice(0, 8);
}

function exportOrdersToXlsx(rows: OrderHistoryRow[]): void {
  const header: string[] = [
    'Sipariş No',
    'Tarih',
    'Müşteri',
    'Temsilci',
    'Tutar',
    'Durum',
    'Kargo Durumu',
    'Takip No',
  ];
  const aoa: (string | number)[][] = [header];
  for (const r of rows) {
    aoa.push([
      r.order_number ?? r.id.slice(0, 8),
      formatDate(r.created_at),
      customerName(r),
      repName(r.rep ?? null),
      Number(r.total ?? r.total_amount ?? 0),
      STATUS_LABELS[String(r.status ?? '').toLowerCase()] ?? r.status ?? '',
      r.shipping_status ?? '',
      r.tracking_number ?? '',
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 12 },
    { wch: 30 },
    { wch: 22 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Siparişler');
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `siparisler_${today}.xlsx`);
}

function OrderHistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const profile = useAuthStore((s) => s.profile);
  const sahaRole = mapParlaToSahaRole(profile?.role);
  const isPrivileged = sahaRole === 'admin';

  const initialCustomerId = searchParams.get('customer_id') ?? '';
  const initialStatus = searchParams.get('status') ?? '';

  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [repId, setRepId] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [showFilters, setShowFilters] = useState<boolean>(false);
  const [detailFor, setDetailFor] = useState<OrderHistoryRow | null>(null);

  // URL sync — customer_id ve status
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (statusFilter) {
      next.set('status', statusFilter);
    } else {
      next.delete('status');
    }
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  // Sales reps (sadece privileged)
  const { data: reps } = useQuery({
    queryKey: ['order-history-reps'],
    enabled: isPrivileged,
    queryFn: async (): Promise<RepOption[]> => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, ad_soyad, email, role')
        .in('role', ['REP', 'SALES_REP', 'ADMIN', 'MANAGER'])
        .order('ad_soyad');
      if (error) return [];
      return (data ?? []).map(
        (r: { id: string; ad_soyad: string | null; email: string | null }) => ({
          id: r.id,
          label: r.ad_soyad ?? r.email ?? r.id.slice(0, 8),
        }),
      );
    },
  });

  const queryKey = useMemo(
    () => [
      'order-history',
      statusFilter,
      initialCustomerId,
      customerSearch,
      dateFrom,
      dateTo,
      repId,
      page,
    ],
    [statusFilter, initialCustomerId, customerSearch, dateFrom, dateTo, repId, page],
  );

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: async (): Promise<{ rows: OrderHistoryRow[]; total: number }> => {
      const supabase = getTypedClient();
      const baseSelect = `id, order_number, user_id, cari_id, clinic_id, sales_rep_id, status, invoice_status, total, total_amount,
         shipping_status, tracking_number, notes, created_at,
         customer:profiles!orders_user_id_profiles_fkey (id, ad_soyad, klinik_adi, email),
         cari:saha_cariler!orders_cari_id_fkey (id, fatura_unvani),
         rep:profiles!orders_sales_rep_id_profiles_fkey (id, ad_soyad, email)`;

      const buildQuery = (selectStr: string) => {
        let q = supabase
          .from('orders')
          .select(selectStr, { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(0, page * PAGE_SIZE - 1);

        if (statusFilter) q = q.eq('status', statusFilter);
        if (initialCustomerId) q = q.eq('user_id', initialCustomerId);
        if (repId) q = q.eq('sales_rep_id', repId);
        if (dateFrom) q = q.gte('created_at', dateFrom);
        if (dateTo) {
          const end = new Date(dateTo);
          end.setDate(end.getDate() + 1);
          q = q.lt('created_at', end.toISOString().slice(0, 10));
        }
        return q;
      };

      const initial = await buildQuery(baseSelect);
      const { error } = initial;
      let rows = initial.data;
      let count = initial.count;
      if (error) {
        // FK alias hatası olursa sade select ile dene
        const fallback = await buildQuery(
          'id, order_number, user_id, sales_rep_id, status, invoice_status, total, total_amount, shipping_status, tracking_number, notes, created_at',
        );
        if (fallback.error) throw fallback.error;
        rows = fallback.data;
        count = fallback.count;
      }

      let typed = (rows ?? []) as unknown as OrderHistoryRow[];

      // Client-side customer name search (varsa)
      const term = customerSearch.trim().toLowerCase();
      if (term) {
        typed = typed.filter((r) => {
          const name = customerName(r).toLowerCase();
          return name.includes(term);
        });
      }

      return { rows: typed, total: count ?? typed.length };
    },
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const hasMore = rows.length < total && rows.length >= PAGE_SIZE;

  function resetFilters(): void {
    setStatusFilter('');
    setCustomerSearch('');
    setDateFrom('');
    setDateTo('');
    setRepId('');
    setPage(1);
  }

  function handleExport(): void {
    if (rows.length === 0) {
      toast.info('Dışa aktarılacak sipariş yok.');
      return;
    }
    exportOrdersToXlsx(rows);
    toast.success(`${rows.length} sipariş dışa aktarıldı.`);
  }

  // Faturaya gönder — siparişi parla fatura kuyruğuna (saha_invoice_requests) ekler.
  const [invoicingId, setInvoicingId] = useState<string | null>(null);
  async function requestInvoice(o: OrderHistoryRow): Promise<void> {
    setInvoicingId(o.id);
    try {
      const supabase = getTypedClient();
      const { error: rpcErr } = await supabase.rpc('request_order_invoice', { p_order_id: o.id });
      if (rpcErr) throw rpcErr;
      toast.success('Sipariş faturaya gönderildi (parla kuyruğu).');
      setDetailFor(null);
    } catch (err) {
      // #46/#103 — backend (request_order_invoice) çift-fatura denemesinde
      // 'already_invoiced' exception atıyor; kullanıcıya anlamlı mesaj göster.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already_invoiced')) {
        toast.info('Bu sipariş zaten faturalandı.');
        setDetailFor(null);
      } else {
        toast.error(err instanceof Error ? err.message : 'Faturaya gönderilemedi.');
      }
    } finally {
      setInvoicingId(null);
    }
  }

  return (
    <div className="flex flex-col min-h-full pb-20">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
            aria-label="Geri"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-lg font-semibold text-foreground flex-1">Sipariş Geçmişi</h1>
          <button
            type="button"
            onClick={handleExport}
            className="p-2 rounded-lg hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
            aria-label="Dışa aktar"
            title="Excel'e aktar"
          >
            <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={`p-2 rounded-lg min-h-tap-min min-w-tap-min flex items-center justify-center ${
              showFilters ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
            }`}
            aria-label="Filtreler"
          >
            <Filter className="h-5 w-5" />
          </button>
        </div>

        {/* Status chips */}
        <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
          <button
            type="button"
            onClick={() => {
              setStatusFilter('');
              setPage(1);
            }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium min-h-tap-min ${
              statusFilter === ''
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            Tümü
          </button>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                setStatusFilter(s.value);
                setPage(1);
              }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium min-h-tap-min ${
                statusFilter === s.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="mt-3 space-y-2 pt-3 border-t border-border">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Müşteri adı ara…"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              {customerSearch && (
                <button
                  type="button"
                  onClick={() => setCustomerSearch('')}
                  aria-label="Temizle"
                  className="p-1 min-h-tap-min min-w-tap-min flex items-center justify-center"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(1);
                  }}
                  className="flex-1 bg-transparent text-xs outline-none"
                  aria-label="Başlangıç"
                />
              </label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(1);
                  }}
                  className="flex-1 bg-transparent text-xs outline-none"
                  aria-label="Bitiş"
                />
              </label>
            </div>

            {isPrivileged && (reps ?? []).length > 0 && (
              <select
                value={repId}
                onChange={(e) => {
                  setRepId(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm outline-none"
              >
                <option value="">Tüm Temsilciler</option>
                {(reps ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={resetFilters}
              className="w-full px-3 py-2 rounded-lg border border-border text-xs font-medium min-h-tap-min hover:bg-muted"
            >
              Filtreleri Temizle
            </button>
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 px-4 py-3">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {isError && <p className="text-sm text-red-600 py-6 text-center">Liste yüklenemedi.</p>}

        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground py-12 text-center">Sipariş bulunamadı.</p>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((o) => {
              const status = String(o.status ?? '').toLowerCase();
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setDetailFor(o)}
                    className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-muted/40 min-h-tap-min"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {o.order_number ?? `#${o.id.slice(0, 8)}`}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {customerName(o)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatDate(o.created_at)}
                          {o.shipping_status && ` · ${o.shipping_status}`}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <span className="text-sm font-bold text-foreground">
                          {formatTRY(Number(o.total ?? o.total_amount ?? 0))}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                            STATUS_STYLES[status] ?? 'bg-gray-200 text-gray-700'
                          }`}
                        >
                          {STATUS_LABELS[status] ?? o.status}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="w-full mt-3 px-3 py-2.5 rounded-lg border border-border text-sm font-medium min-h-tap-min hover:bg-muted"
          >
            Daha Fazla ({total - rows.length})
          </button>
        )}
      </div>

      {/* Detay modal */}
      {detailFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-md rounded-2xl bg-background p-4 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-2 mb-3">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-foreground">
                  {detailFor.order_number ?? `#${detailFor.id.slice(0, 8)}`}
                </h2>
                <p className="text-xs text-muted-foreground">{formatDate(detailFor.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailFor(null)}
                className="p-2 -mr-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <dl className="text-sm space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Müşteri</dt>
                <dd className="text-right text-foreground">{customerName(detailFor)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Temsilci</dt>
                <dd className="text-right text-foreground">{repName(detailFor.rep ?? null)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Tutar</dt>
                <dd className="text-right font-semibold text-foreground">
                  {formatTRY(Number(detailFor.total ?? detailFor.total_amount ?? 0))}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Durum</dt>
                <dd className="text-right text-foreground">
                  {STATUS_LABELS[String(detailFor.status ?? '').toLowerCase()] ?? detailFor.status}
                </dd>
              </div>
              {/* #46/#103 — fatura durumu privileged kullanıcıya gösterilir (buton gizliyse neden). */}
              {isPrivileged &&
                ['invoiced', 'invoice_requested'].includes(
                  String(detailFor.invoice_status ?? '').toLowerCase(),
                ) && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Fatura</dt>
                    <dd className="text-right text-foreground">
                      {String(detailFor.invoice_status).toLowerCase() === 'invoiced'
                        ? 'Faturalandı'
                        : 'Fatura kuyruğunda'}
                    </dd>
                  </div>
                )}
              {detailFor.shipping_status && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Kargo</dt>
                  <dd className="text-right text-foreground">{detailFor.shipping_status}</dd>
                </div>
              )}
              {detailFor.tracking_number && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Takip No</dt>
                  <dd className="text-right text-foreground">{detailFor.tracking_number}</dd>
                </div>
              )}
              {detailFor.notes && (
                <div>
                  <dt className="text-muted-foreground text-xs mb-0.5">Notlar</dt>
                  <dd className="text-xs whitespace-pre-wrap text-foreground">{detailFor.notes}</dd>
                </div>
              )}
            </dl>

            {isPrivileged &&
              ['approved', 'confirmed', 'shipped', 'delivered'].includes(
                String(detailFor.status ?? '').toLowerCase(),
              ) &&
              // #46/#103 — zaten faturalanmış / fatura kuyruğuna alınmış siparişte
              // butonu gizle (çift-fatura denemesi backend exception veriyordu).
              !['invoiced', 'invoice_requested'].includes(
                String(detailFor.invoice_status ?? '').toLowerCase(),
              ) && (
                <button
                  type="button"
                  disabled={invoicingId === detailFor.id}
                  onClick={() => void requestInvoice(detailFor)}
                  className="w-full mt-4 px-3 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium min-h-tap-min disabled:opacity-50"
                >
                  {invoicingId === detailFor.id ? 'Gönderiliyor…' : 'Faturaya Gönder'}
                </button>
              )}

            <button
              type="button"
              onClick={() => setDetailFor(null)}
              className="w-full mt-2 px-3 py-2.5 rounded-lg border border-border text-sm font-medium min-h-tap-min"
            >
              Kapat
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrderHistoryPage;
