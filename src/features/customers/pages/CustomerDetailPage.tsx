/**
 * CustomerDetailPage — Müşteri detay ekranı.
 *
 * URL: /clinics/:id
 * Header: müşteri adı + tip badge + telefon/WA + Sipariş Oluştur CTA
 * Bakiye kartı: getBalance() + yenile butonu
 * Tablar: Siparişler / Ziyaretler / Numuneler (her biri son 10)
 */

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Phone, MessageCircle, ShoppingCart, RefreshCw, ArrowLeft } from 'lucide-react';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import { getSupabaseClient } from '@lib/supabase';
import type { Order } from '@core/adapters/types';

const adapter = new SupabaseCRMAdapter();

type TabKey = 'orders' | 'visits' | 'samples';

interface ProfileRow {
  id: string;
  ad_soyad: string | null;
  email: string | null;
  telefon: string | null;
  klinik_adi: string | null;
  city: string | null;
  role: string | null;
}

interface VisitRow {
  id: string;
  visited_at: string | null;
  status: string | null;
  notes: string | null;
  outcome: string | null;
}

interface SampleRow {
  id: string;
  given_at: string | null;
  status: string | null;
  follow_up_at: string | null;
  notes: string | null;
}

const SAMPLE_STATUS_STYLES: Record<string, string> = {
  verildi: 'bg-blue-100 text-blue-800',
  denendi: 'bg-amber-100 text-amber-800',
  donusturuldu: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  kayip: 'bg-gray-200 text-gray-700',
  iade: 'bg-gray-200 text-gray-700',
};

const ORDER_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-700',
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-blue-100 text-blue-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  pending: 'Beklemede',
  confirmed: 'Onaylandı',
  shipped: 'Kargoda',
  delivered: 'Teslim Edildi',
  cancelled: 'İptal',
};

function formatTL(n: number): string {
  return n.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function CustomerDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>('orders');
  const [refreshTick, setRefreshTick] = useState(0);

  const { data: customerData, isLoading: custLoading } = useQuery({
    queryKey: ['customer-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<ProfileRow | null> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, ad_soyad, email, telefon, klinik_adi, city, role')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ProfileRow | null;
    },
  });

  const { data: balance, isFetching: balanceLoading, refetch: refetchBalance } = useQuery({
    queryKey: ['balance', id, refreshTick],
    enabled: !!id,
    queryFn: () => adapter.getBalance(id!, { forceFresh: refreshTick > 0 }),
  });

  const { data: ordersPage, isLoading: ordersLoading } = useQuery({
    queryKey: ['customer-orders', id],
    enabled: !!id && activeTab === 'orders',
    queryFn: () => adapter.listOrders(id!, { limit: 10 }),
  });

  const { data: visits, isLoading: visitsLoading } = useQuery({
    queryKey: ['customer-visits', id],
    enabled: !!id && activeTab === 'visits',
    queryFn: async (): Promise<VisitRow[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('rep_visits')
        .select('id, visited_at, status, notes, outcome, account_id, client_id')
        .or(`account_id.eq.${id},client_id.eq.${id}`)
        .order('visited_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as VisitRow[];
    },
  });

  const { data: samples, isLoading: samplesLoading } = useQuery({
    queryKey: ['customer-samples', id],
    enabled: !!id && activeTab === 'samples',
    queryFn: async (): Promise<SampleRow[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_samples')
        .select('id, given_at, status, follow_up_at, notes')
        .eq('account_id', id!)
        .order('given_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as SampleRow[];
    },
  });

  const name =
    customerData?.klinik_adi ?? customerData?.ad_soyad ?? customerData?.email ?? 'Müşteri';
  const phone = customerData?.telefon ?? '';
  const customerType = customerData?.role ?? '';

  function handleRefreshBalance(): void {
    setRefreshTick((t) => t + 1);
    void refetchBalance();
  }

  if (!id) {
    return (
      <div className="p-6 text-center text-muted-foreground">Müşteri ID bulunamadı.</div>
    );
  }

  return (
    <div className="flex flex-col min-h-full pb-24">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3 mb-3">
          <Link
            to="/clinics"
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
            aria-label="Geri"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground truncate">
              {custLoading ? 'Yükleniyor…' : name}
            </h1>
            {customerData?.city && (
              <p className="text-xs text-muted-foreground truncate">{customerData.city}</p>
            )}
          </div>
          {customerType && (
            <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {customerType}
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {phone && (
            <>
              <a
                href={`tel:${phone}`}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-border text-sm font-medium min-h-tap-min hover:bg-muted"
              >
                <Phone className="h-4 w-4" />
                Ara
              </a>
              <a
                href={`https://wa.me/${phone.replace(/[^0-9]/g, '')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-border text-sm font-medium min-h-tap-min hover:bg-muted"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
            </>
          )}
        </div>
      </div>

      {/* Bakiye kartı */}
      <div className="px-4 py-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Toplam Bakiye</p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {balance ? formatTL(balance.balance) : '—'}
              </p>
              {balance?.lastMovementAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Son hareket: {formatDate(balance.lastMovementAt)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleRefreshBalance}
              disabled={balanceLoading}
              className="p-2 rounded-full hover:bg-muted disabled:opacity-50 min-h-tap-min min-w-tap-min flex items-center justify-center"
              aria-label="Bakiyeyi yenile"
            >
              <RefreshCw className={`h-5 w-5 ${balanceLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-background sticky top-[60px] z-[5]">
        {(
          [
            { key: 'orders' as const, label: 'Siparişler' },
            { key: 'visits' as const, label: 'Ziyaretler' },
            { key: 'samples' as const, label: 'Numuneler' },
          ]
        ).map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 px-3 py-3 min-h-tap-min text-sm font-medium ${
                isActive
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 px-4 py-3">
        {activeTab === 'orders' && (
          <OrdersTab loading={ordersLoading} orders={ordersPage?.items ?? []} />
        )}
        {activeTab === 'visits' && (
          <VisitsTab loading={visitsLoading} visits={visits ?? []} />
        )}
        {activeTab === 'samples' && (
          <SamplesTab loading={samplesLoading} samples={samples ?? []} />
        )}
      </div>

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-16 left-0 right-0 px-4 pb-3 pt-2 bg-gradient-to-t from-background via-background to-transparent z-20">
        <Link
          to={`/orders/new?customerId=${id}`}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg min-h-tap-min"
        >
          <ShoppingCart className="h-5 w-5" />
          Sipariş Oluştur
        </Link>
      </div>
    </div>
  );
}

function OrdersTab({
  loading,
  orders,
}: {
  loading: boolean;
  orders: Order[];
}): JSX.Element {
  if (loading) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Yükleniyor…</p>;
  }
  if (orders.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Sipariş yok.</p>;
  }
  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <Link
          key={o.id}
          to={`/orders/${o.id}`}
          className="block p-3 rounded-lg border border-border bg-card hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-sm text-foreground truncate">
                {o.externalId ?? o.id.slice(0, 8)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatDate(o.createdAt)}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  ORDER_STATUS_STYLES[o.status] ?? 'bg-gray-200 text-gray-700'
                }`}
              >
                {ORDER_STATUS_LABELS[o.status] ?? o.status}
              </span>
              <span className="text-sm font-semibold text-foreground">
                {formatTL(o.totalAmount)}
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function VisitsTab({
  loading,
  visits,
}: {
  loading: boolean;
  visits: VisitRow[];
}): JSX.Element {
  if (loading) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Yükleniyor…</p>;
  }
  if (visits.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Ziyaret yok.</p>;
  }
  return (
    <div className="space-y-2">
      {visits.map((v) => (
        <div key={v.id} className="p-3 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {formatDate(v.visited_at)}
            </p>
            {v.status && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                {v.status}
              </span>
            )}
          </div>
          {v.outcome && (
            <p className="text-xs text-muted-foreground mt-1">Sonuç: {v.outcome}</p>
          )}
          {v.notes && (
            <p className="text-xs text-foreground mt-1 line-clamp-2">{v.notes}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function SamplesTab({
  loading,
  samples,
}: {
  loading: boolean;
  samples: SampleRow[];
}): JSX.Element {
  if (loading) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Yükleniyor…</p>;
  }
  if (samples.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Numune yok.</p>;
  }
  return (
    <div className="space-y-2">
      {samples.map((s) => {
        const status = String(s.status ?? '').toLowerCase();
        const style = SAMPLE_STATUS_STYLES[status] ?? 'bg-gray-200 text-gray-700';
        return (
          <div key={s.id} className="p-3 rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {formatDate(s.given_at)}
              </p>
              {status && (
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${style}`}
                >
                  {status}
                </span>
              )}
            </div>
            {s.follow_up_at && (
              <p className="text-xs text-muted-foreground mt-1">
                Takip: {formatDate(s.follow_up_at)}
              </p>
            )}
            {s.notes && (
              <p className="text-xs text-foreground mt-1 line-clamp-2">{s.notes}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default CustomerDetailPage;
