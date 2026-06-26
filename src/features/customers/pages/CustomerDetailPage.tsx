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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Phone,
  MessageCircle,
  ShoppingCart,
  ArrowLeft,
  CalendarPlus,
  Receipt,
  Navigation,
} from 'lucide-react';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { googleMapsDirectionsUrl } from '@lib/maps';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissionCached } from '@core/auth/usePermissions';

import CariBalanceCard from '@features/invoicing/components/CariBalanceCard';
import CustomerVisitTimeline from '@features/visits/components/CustomerVisitTimeline';
import RecentOrdersCard from '@features/orders/components/RecentOrdersCard';
import CustomerActivityTimeline from '@features/customers/components/CustomerActivityTimeline';

type TabKey = 'overview' | 'activity' | 'visits' | 'samples' | 'notes';

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

interface AccountNoteRow {
  id: string;
  account_id: string;
  rep_id: string;
  body: string;
  created_at: string;
}

interface LastReminderRow {
  id: string;
  type: string | null;
  outcome: string | null;
  completion_note: string | null;
  completed_at: string | null;
}

const REMINDER_OUTCOME_LABEL: Record<string, string> = {
  met: 'Görüşüldü',
  callback: 'Tekrar Aranacak',
  no_meeting: 'Görüşülemedi',
  order_taken: 'Sipariş Alındı',
  sample_given: 'Numune Verildi',
  tahsil_edildi: 'Tahsil Edildi',
  soz_verildi: 'Söz Verildi',
  odenmedi: 'Ödenmedi',
};

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
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.session?.userId ?? null);
  // Admin + faturalama izni olan plasiyerler (usePermissionCached admin için true döner;
  // yüklenirken null → false varsay).
  const canInvoice = usePermissionCached('saha:invoicing:access') === true;
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  const { data: customerData, isLoading: custLoading } = useQuery({
    queryKey: ['customer-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<ProfileRow | null> => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('id, ad_soyad, email, telefon, klinik_adi, city, role')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      if (data) return data as ProfileRow;
      // Kayıtlı profil yok → keşfedilmiş saha_clinics kaydı (id = account_id).
      // Başlık/telefon "Müşteri" generic fallback'ine düşmesin.
      const { data: clinic } = await supabase
        .from('saha_clinics')
        .select('id, name, phone, province_slug')
        .eq('id', id!)
        .maybeSingle();
      if (!clinic) return null;
      return {
        id: clinic.id,
        ad_soyad: null,
        email: null,
        telefon: clinic.phone,
        klinik_adi: clinic.name,
        city: clinic.province_slug,
        role: 'klinik',
      } as ProfileRow;
    },
  });

  const { data: samples, isLoading: samplesLoading } = useQuery({
    queryKey: ['customer-samples', id],
    enabled: !!id && activeTab === 'samples',
    queryFn: async (): Promise<SampleRow[]> => {
      const supabase = getTypedClient();
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

  const { data: notes, isLoading: notesLoading } = useQuery({
    queryKey: ['customer-notes', id],
    enabled: !!id && activeTab === 'notes',
    queryFn: async (): Promise<AccountNoteRow[]> => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('saha_account_notes')
        .select('*')
        .eq('account_id', id!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as AccountNoteRow[];
    },
  });

  // R2 — Özet'te "Son Görüşme" kartı: en son tamamlanmış randevu notu.
  // saha_reminders types.ts'de yok → untyped client.
  const { data: lastReminder } = useQuery({
    queryKey: ['customer-last-reminder', id],
    enabled: !!id && activeTab === 'overview',
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async (): Promise<LastReminderRow | null> => {
      const sb = getSupabaseClient();
      const { data } = await sb
        .from('saha_reminders')
        .select('id, type, outcome, completion_note, completed_at')
        .eq('account_id', id!)
        .eq('status', 'done')
        .not('completion_note', 'is', null)
        .order('completed_at', { ascending: false, nullsFirst: false })
        .limit(1);
      const row = ((data ?? []) as LastReminderRow[])[0];
      return row ?? null;
    },
  });

  // Klinik koordinat + potansiyel — her iki path (profile + raw saha_clinics) için tek sorgu.
  const { data: clinicGeo } = useQuery({
    queryKey: ['customer-clinic-geo', id],
    enabled: !!id,
    // Potansiyel rozeti check-out sonrası taze görünsün (mount'ta yeniden çek).
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const supabase = getTypedClient();
      const { data } = await supabase
        .from('saha_clinics')
        .select('id, lat, lng, potential')
        .eq('id', id!)
        .maybeSingle();
      return data ?? null;
    },
  });

  // İlk Görüşme affordance: klinike daha önce hiç ziyaret yapılmadıysa true.
  const { data: visitCountData } = useQuery({
    queryKey: ['customer-visit-count', id],
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const supabase = getTypedClient();
      const { count } = await supabase
        .from('saha_visits')
        .select('*', { count: 'exact', head: true })
        .eq('account_id', id!);
      return count ?? null;
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async (body: string): Promise<void> => {
      const supabase = getTypedClient();
      let repId = currentUserId;
      if (!repId) {
        const { data } = await supabase.auth.getUser();
        repId = data.user?.id ?? null;
      }
      if (!repId) throw new Error('Oturum bulunamadı. Lütfen tekrar giriş yapın.');
      const { error } = await supabase
        .from('saha_account_notes')
        .insert({ account_id: id!, rep_id: repId, body });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Not eklendi');
      void queryClient.invalidateQueries({ queryKey: ['customer-notes', id] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Not eklenirken hata oluştu.');
    },
  });

  const name =
    customerData?.klinik_adi ?? customerData?.ad_soyad ?? customerData?.email ?? 'Müşteri';
  const phone = customerData?.telefon ?? '';
  const customerType = customerData?.role ?? '';

  // Klinik coğrafi verileri
  const clinicLat = typeof clinicGeo?.lat === 'number' ? clinicGeo.lat : null;
  const clinicLng = typeof clinicGeo?.lng === 'number' ? clinicGeo.lng : null;
  const clinicPotential = clinicGeo?.potential ?? null;
  const directionsHref =
    clinicLat != null && clinicLng != null
      ? googleMapsDirectionsUrl(clinicLat, clinicLng, name)
      : null;

  // İlk görüşme: saha_visits sayısı 0 ise
  const isFirstContact = visitCountData === 0;

  if (!id) {
    return <div className="p-6 text-center text-muted-foreground">Müşteri ID bulunamadı.</div>;
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
          {clinicPotential != null && (
            <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">
              Puan: {clinicPotential}/10
            </span>
          )}
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
          {directionsHref && (
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-border text-sm font-medium min-h-tap-min hover:bg-muted"
              aria-label="Yol Tarifi"
            >
              <Navigation className="h-4 w-4" />
              Yol Tarifi
            </a>
          )}
        </div>
      </div>

      {/* Cari bakiye + kredi limit kartı */}
      <div className="px-4 pt-4">
        <CariBalanceCard customerId={id} />
      </div>

      {/* Hızlı aksiyonlar */}
      <div className={`px-4 py-3 grid gap-2 ${canInvoice ? 'grid-cols-3' : 'grid-cols-2'}`}>
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
          <span className="text-[11px] font-medium text-foreground">
            {isFirstContact ? 'İlk Görüşme' : 'Yeni Ziyaret'}
          </span>
        </button>
        {canInvoice && (
          <button
            type="button"
            onClick={() => {
              // Klinik id'sinden cari'yi çöz (yoksa oluştur) → fatura formuna cari_id ile git.
              // Eski hâli ?profile_id=<klinik_id> gönderiyordu; InvoiceFormPage ?cari_id okuyor
              // → cari boş açılıyordu. RPC clinic_id ile cariyi get-or-create eder.
              void (async () => {
                try {
                  const sb = getTypedClient();
                  const { data: cariId, error } = await sb.rpc(
                    'saha_get_or_create_cari_for_clinic',
                    {
                      p_clinic_id: id,
                    },
                  );
                  if (error || !cariId) {
                    toast.error('Cari çözülemedi: ' + (error?.message ?? 'bilinmeyen hata'));
                    return;
                  }
                  navigate(`/invoicing/fatura/yeni?cari_id=${cariId}`);
                } catch {
                  toast.error('Cari çözülemedi.');
                }
              })();
            }}
            className="flex flex-col items-center justify-center gap-1 px-2 py-3 rounded-xl border border-border bg-card hover:bg-muted/40 min-h-tap-min"
          >
            <Receipt className="h-5 w-5 text-primary" />
            <span className="text-[11px] font-medium text-foreground">Fatura Kes</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-background sticky top-[60px] z-[5]">
        {[
          { key: 'overview' as const, label: 'Özet' },
          { key: 'activity' as const, label: 'Zaman Çizelgesi' },
          { key: 'visits' as const, label: 'Ziyaretler' },
          { key: 'samples' as const, label: 'Numuneler' },
          { key: 'notes' as const, label: 'Notlar' },
        ].map((t) => {
          const isActive = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex-1 px-3 py-3 min-h-tap-min text-sm font-medium ${
                isActive ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'
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
            {lastReminder && (
              <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm">
                <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <CalendarPlus className="h-4 w-4 text-indigo-600" />
                  Son Görüşme
                </h3>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(lastReminder.completed_at)}
                  {lastReminder.outcome &&
                    ` · ${REMINDER_OUTCOME_LABEL[lastReminder.outcome] ?? lastReminder.outcome}`}
                </p>
                {lastReminder.completion_note && (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">
                    {lastReminder.completion_note}
                  </p>
                )}
              </section>
            )}
            <RecentOrdersCard customerId={id} limit={5} />
            <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-foreground mb-3">Ziyaret Geçmişi</h3>
              <CustomerVisitTimeline customerId={id} hideHeader limit={5} />
            </section>
          </>
        )}
        {activeTab === 'activity' && (
          <CustomerActivityTimeline accountId={id} active={activeTab === 'activity'} />
        )}
        {activeTab === 'visits' && <CustomerVisitTimeline customerId={id} limit={20} />}
        {activeTab === 'samples' && <SamplesTab loading={samplesLoading} samples={samples ?? []} />}
        {activeTab === 'notes' && (
          <NotesTab
            loading={notesLoading}
            notes={notes ?? []}
            onAdd={(body) => addNoteMutation.mutate(body)}
            submitting={addNoteMutation.isPending}
          />
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

function SamplesTab({ loading, samples }: { loading: boolean; samples: SampleRow[] }): JSX.Element {
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
              <p className="text-sm font-medium text-foreground">{formatDate(s.given_at)}</p>
              {status && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${style}`}>
                  {status}
                </span>
              )}
            </div>
            {s.follow_up_at && (
              <p className="text-xs text-muted-foreground mt-1">
                Takip: {formatDate(s.follow_up_at)}
              </p>
            )}
            {s.notes && <p className="text-xs text-foreground mt-1 line-clamp-2">{s.notes}</p>}
          </div>
        );
      })}
    </div>
  );
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function NotesTab({
  loading,
  notes,
  onAdd,
  submitting,
}: {
  loading: boolean;
  notes: AccountNoteRow[];
  onAdd: (body: string) => void;
  submitting: boolean;
}): JSX.Element {
  const [body, setBody] = useState('');

  const handleSubmit = (): void => {
    const trimmed = body.trim();
    if (!trimmed) {
      toast.error('Lütfen bir not girin.');
      return;
    }
    onAdd(trimmed);
    setBody('');
  };

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Not ekle…"
          rows={3}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold min-h-tap-min disabled:opacity-60"
        >
          {submitting ? 'Ekleniyor…' : 'Not Ekle'}
        </button>
      </section>

      {loading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Yükleniyor…</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Not yok.</p>
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="p-3 rounded-lg border border-border bg-card">
              <p className="text-sm text-foreground whitespace-pre-wrap">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-2">{formatDateTime(n.created_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CustomerDetailPage;
