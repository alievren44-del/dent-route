/**
 * CustomerDetailPage — Müşteri detay ekranı.
 *
 * URL: /clinics/:id
 * Header: müşteri adı + tip badge + telefon/WA + Sipariş Oluştur CTA
 * Bakiye kartı: getBalance() + yenile butonu
 * Tablar: Siparişler / Ziyaretler / Numuneler (her biri son 10)
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Phone,
  MessageCircle,
  ShoppingCart,
  ArrowLeft,
  CalendarPlus,
  Receipt,
} from 'lucide-react';
import { getSupabaseClient } from '@lib/supabase';

import CariBalanceCard from '@features/invoicing/components/CariBalanceCard';
import CustomerVisitTimeline from '@features/visits/components/CustomerVisitTimeline';
import RecentOrdersCard from '@features/orders/components/RecentOrdersCard';

type TabKey = 'overview' | 'visits' | 'samples';

interface ProfileRow {
  id: string;
  ad_soyad: string | null;
  email: string | null;
  telefon: string | null;
  klinik_adi: string | null;
  city: string | null;
  role: string | null;
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
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

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

      {/* Cari bakiye + kredi limit kartı */}
      <div className="px-4 pt-4">
        <CariBalanceCard customerId={id} />
      </div>

      {/* Hızlı aksiyonlar */}
      <div className="px-4 py-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => navigate(`/orders/new?customerId=${id}`)}
          className="flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-xl border border-border bg-card hover:bg-muted/40 min-h-tap-min"
        >
          <ShoppingCart className="h-5 w-5 text-primary" />
          <span className="text-[11px] font-medium text-foreground">Yeni Sipariş</span>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/visits/check-in/${id}`)}
          className="flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-xl border border-border bg-card hover:bg-muted/40 min-h-tap-min"
        >
          <CalendarPlus className="h-5 w-5 text-primary" />
          <span className="text-[11px] font-medium text-foreground">Yeni Ziyaret</span>
        </button>
        <button
          type="button"
          onClick={() => navigate(`/invoicing/fatura/yeni?profile_id=${id}`)}
          className="flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-xl border border-border bg-card hover:bg-muted/40 min-h-tap-min"
        >
          <Receipt className="h-5 w-5 text-primary" />
          <span className="text-[11px] font-medium text-foreground">Fatura Kes</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-background sticky top-[60px] z-[5]">
        {(
          [
            { key: 'overview' as const, label: 'Özet' },
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
      <div className="flex-1 px-4 py-3 space-y-3">
        {activeTab === 'overview' && (
          <>
            <RecentOrdersCard customerId={id} limit={5} />
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground mb-3">
                Ziyaret Geçmişi
              </h3>
              <CustomerVisitTimeline customerId={id} hideHeader limit={5} />
            </section>
          </>
        )}
        {activeTab === 'visits' && (
          <CustomerVisitTimeline customerId={id} limit={20} />
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
