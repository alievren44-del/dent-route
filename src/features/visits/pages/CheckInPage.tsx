/**
 * CheckInPage — GPS doğrulamalı check-in ekranı.
 *
 * URL: /visits/check-in/:id   ( :id = account_id )
 *
 * Akış:
 *  1. Hedef müşteri bilgisi profiles'tan çekilir (ad + koordinat).
 *  2. useGeolocation rep konumunu alır (high accuracy).
 *  3. Haversine ile mesafe hesaplanır:
 *       <50m   : yeşil banner — "GPS doğrulandı"
 *       <200m  : yeşil/sarı   — "Yakın"
 *       <2000m : sarı uyarı   — "Hedeften uzaktasınız, yine de devam edebilirsiniz"
 *       >=2000m: kırmızı blok — check-in butonu disable
 *  4. Check-in tıklanınca saha_visits'e in_progress kayıt insert edilir,
 *     /visits/{visit_id} sayfasına yönlendirilir.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateVisitDomain } from '@lib/queryKeys';
import { toast } from 'sonner';
import { ArrowLeft, FileText, Loader2, MapPin, Navigation } from 'lucide-react';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import { haversineMeters } from '@features/discovery/dedup';
import { getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { useVertical } from '@core/verticals/useVertical';
import { enqueueOp } from '@core/offline/syncQueue';

interface AccountRow {
  id: string;
  klinik_adi: string | null;
  ad_soyad: string | null;
  email: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
}

interface DistanceTier {
  tone: 'green' | 'yellow' | 'warning' | 'red';
  label: string;
  blocked: boolean;
  /** true = klinik koordinatı yok, mesafe doğrulanamıyor; kullanıcı onayıyla geçilebilir. */
  needsOverride?: boolean;
}

/**
 * @param distanceM  - Haversine mesafesi (metre). Rep konumu yoksa veya klinik
 *                     koordinatı yoksa null gelir.
 * @param clinicHasCoords - Klinikte lat/lng kaydı var mı?
 */
function tierFor(distanceM: number | null, clinicHasCoords: boolean): DistanceTier {
  // Rep konumu henüz gelmedi (klinik koordinatından bağımsız).
  if (distanceM === null && clinicHasCoords) {
    return { tone: 'yellow', label: 'Konum bekleniyor…', blocked: true };
  }
  // Klinik koordinatı yok — mesafe doğrulaması imkansız, override ile geçilebilir.
  if (!clinicHasCoords) {
    return {
      tone: 'yellow',
      label: 'Bu kliniğin GPS konumu kayıtlı değil. Mesafe doğrulanamıyor.',
      blocked: false,
      needsOverride: true,
    };
  }
  // distanceM kesinlikle number buradan itibaren (clinicHasCoords && position her ikisi de var).
  const d = distanceM as number;
  if (d < 50) {
    return { tone: 'green', label: 'GPS doğrulandı — hedeftesiniz.', blocked: false };
  }
  if (d < 200) {
    return { tone: 'green', label: 'Hedefin çok yakınındasınız.', blocked: false };
  }
  if (d < 2000) {
    return {
      tone: 'warning',
      label: 'Hedeften uzaktasınız, yine de devam edebilirsiniz.',
      blocked: false,
    };
  }
  return {
    tone: 'red',
    label: 'Hedef 2 km uzakta — check-in engellendi.',
    blocked: true,
  };
}

function toneClasses(tone: DistanceTier['tone']): string {
  switch (tone) {
    case 'green':
      return 'bg-green-50 text-green-800 border-green-200';
    case 'yellow':
      return 'bg-yellow-50 text-yellow-800 border-yellow-200';
    case 'warning':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'red':
    default:
      return 'bg-red-50 text-red-800 border-red-200';
  }
}

function formatDistance(m: number | null): string {
  if (m === null) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

function CheckInPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const vertical = useVertical();
  const { position, status, error: geoError, request } = useGeolocation();
  const repId = useAuthStore((s) => s.session?.userId ?? null);
  const supabase = getTypedClient();
  const queryClient = useQueryClient();
  const customerLabel = vertical.labels.customer.singular;

  useEffect(() => {
    request();
  }, [request]);

  // Müşteri verisi — önce saha_clinics (modern), sonra profiles (DOCTOR rolü) fallback.
  const accountQuery = useQuery({
    queryKey: ['checkin-account', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<AccountRow | null> => {
      if (!id) return null;

      // 1) saha_clinics — Discovery / SahaTara / Atanan rota sepete clinic id yazar.
      const clinicRes = await supabase
        .from('saha_clinics')
        .select('id, name, address, lat, lng, province_slug')
        .eq('id', id)
        .maybeSingle();
      if (clinicRes.data) {
        const c = clinicRes.data as {
          id: string;
          name: string;
          address: string | null;
          lat: number | null;
          lng: number | null;
          province_slug: string | null;
        };
        return {
          id: c.id,
          klinik_adi: c.name,
          ad_soyad: null,
          email: null,
          city: c.province_slug ?? c.address,
          lat: c.lat,
          lng: c.lng,
        };
      }

      // 2) profiles fallback (DOCTOR / Parla mevcut müşterileri).
      const { data, error } = await supabase
        .from('profiles')
        .select('id, klinik_adi, ad_soyad, email, city, lat, lng')
        .eq('id', id)
        .maybeSingle();
      if (error) {
        // lat/lng kolonu yoksa kolonsuz select fallback.
        const fallback = await supabase
          .from('profiles')
          .select('id, klinik_adi, ad_soyad, email, city')
          .eq('id', id)
          .maybeSingle();
        if (fallback.error) throw fallback.error;
        const row = fallback.data as Omit<AccountRow, 'lat' | 'lng'> | null;
        if (!row) return null;
        return { ...row, lat: null, lng: null };
      }
      return (data ?? null) as AccountRow | null;
    },
  });

  const account = accountQuery.data;
  const accountName = account?.klinik_adi ?? account?.ad_soyad ?? account?.email ?? customerLabel;

  // Mesafe
  const distanceM = useMemo<number | null>(() => {
    if (!position || !account || account.lat === null || account.lng === null) {
      return null;
    }
    return haversineMeters(position.lat, position.lng, account.lat, account.lng);
  }, [position, account]);

  const clinicHasCoords = Boolean(account) && account!.lat !== null && account!.lng !== null;
  const tier = tierFor(distanceM, clinicHasCoords);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  // Override onayı — koordinatsız klinik için kullanıcı onayladıysa true.
  const [overrideConfirmed, setOverrideConfirmed] = useState(false);
  // Check-in anında hızlı not (opsiyonel) — saha_visits.notes'a yazılır.
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  async function handleCheckIn(): Promise<void> {
    if (!id || !position) {
      toast.error('Konum alınamadı.');
      return;
    }
    if (!repId) {
      // Fallback: doğrudan auth.getUser
      const { data } = await supabase.auth.getUser();
      if (!data.user?.id) {
        toast.error('Oturum bulunamadı. Lütfen tekrar giriş yapın.');
        return;
      }
    }
    if (tier.blocked) {
      toast.error(tier.label);
      return;
    }
    if (tier.needsOverride && !overrideConfirmed) {
      toast.error('Lütfen önce konum doğrulaması olmadan devam etmek istediğinizi onaylayın.');
      return;
    }
    setSubmitting(true);
    try {
      let effectiveRepId = repId;
      if (!effectiveRepId) {
        const { data } = await supabase.auth.getUser();
        effectiveRepId = data.user?.id ?? null;
      }
      if (!effectiveRepId) throw new Error('Rep ID bulunamadı.');

      const idempotencyKey =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `checkin-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const trimmedNote = note.trim();
      const payload: Record<string, unknown> = {
        account_id: id,
        rep_id: effectiveRepId,
        check_in_at: new Date().toISOString(),
        check_in_lat: position.lat,
        check_in_lng: position.lng,
        check_in_accuracy_m: position.accuracy,
        distance_to_account_m: distanceM,
        status: 'in_progress',
        idempotency_key: idempotencyKey,
        ...(trimmedNote ? { notes: trimmedNote } : {}),
      };

      // Çevrim dışıysa kuyruğa al, geçici visit id oluştur.
      if (!navigator.onLine) {
        await enqueueOp('visit.create', payload, idempotencyKey);
        toast.success('Check-in kaydedildi — bağlantı geldiğinde senkronize edilecek');
        // Offline: geçici id ile ziyaret formuna yönlendir.
        // Gerçek visit_id bağlantıda oluşacak; şimdilik history'ye yönlendir.
        navigate('/history', { replace: true });
        return;
      }

      const { data, error } = await supabase
        .from('saha_visits')
        .insert(payload as never)
        .select('id')
        .single();
      if (error) throw error;
      const visitId = (data as { id: string }).id;
      toast.success('Check-in başarılı');
      // Invalidate visit-history and calendar so lists stay fresh after check-in.
      // Fire-and-forget: navigation unmounts this page; invalidation is queued in QC.
      void invalidateVisitDomain(queryClient);
      navigate(`/visits/${visitId}`, { replace: true });
    } catch (err) {
      // Supabase/PostgREST hataları Error instance değil — düz nesne (message/details/hint).
      let msg: string;
      if (err instanceof Error) {
        msg = err.message;
      } else if (typeof err === 'object' && err !== null) {
        const e = err as { message?: string; details?: string; hint?: string };
        msg = e.message ?? e.details ?? e.hint ?? JSON.stringify(err);
      } else {
        msg = String(err);
      }
      const isNetworkError =
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        !navigator.onLine;
      if (isNetworkError) {
        try {
          let effectiveRepId2 = repId;
          if (!effectiveRepId2) {
            const { data } = await supabase.auth.getUser();
            effectiveRepId2 = data.user?.id ?? null;
          }
          const idempotencyKey2 =
            typeof crypto !== 'undefined' && 'randomUUID' in crypto
              ? crypto.randomUUID()
              : `checkin-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          await enqueueOp(
            'visit.create',
            {
              account_id: id,
              rep_id: effectiveRepId2 ?? '',
              check_in_at: new Date().toISOString(),
              check_in_lat: position.lat,
              check_in_lng: position.lng,
              check_in_accuracy_m: position.accuracy,
              distance_to_account_m: distanceM,
              status: 'in_progress',
              idempotency_key: idempotencyKey2,
              ...(note.trim() ? { notes: note.trim() } : {}),
            },
            idempotencyKey2,
          );
          toast.success('Bağlantı hatası — check-in kaydedildi, bağlantı geldiğinde gönderilecek');
          navigate('/history', { replace: true });
        } catch {
          toast.error('Check-in çevrim dışı kuyruğa eklenemedi.');
        }
        return;
      }
      toast.error(msg || 'Check-in sırasında hata oluştu.');
    } finally {
      setSubmitting(false);
    }
  }

  const showSpinner = status === 'prompting' || (status === 'idle' && !position);
  const accountLoading = accountQuery.isLoading;

  if (!id) {
    return <div className="p-6 text-center text-muted-foreground">Müşteri ID bulunamadı.</div>;
  }

  return (
    <div className="flex flex-col min-h-full pb-8">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
            aria-label="Geri"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground truncate">Check-in</h1>
            <p className="text-xs text-muted-foreground truncate">
              {accountLoading ? 'Yükleniyor…' : accountName}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 space-y-4">
        {/* Müşteri kartı */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">{customerLabel}</p>
          <p className="text-base font-semibold text-foreground mt-1 truncate">
            {accountLoading ? '...' : accountName}
          </p>
          {account?.city && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {account.city}
            </p>
          )}
        </section>

        {/* Konum durum banner */}
        <section className={`rounded-2xl border p-4 ${toneClasses(tier.tone)}`} role="status">
          <div className="flex items-start gap-3">
            <Navigation className="h-5 w-5 mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{tier.label}</p>
              <p className="text-xs mt-1">
                Mesafe: <strong>{formatDistance(distanceM)}</strong>
                {position && (
                  <>
                    {' · '}Hassasiyet: ±{Math.round(position.accuracy)} m
                  </>
                )}
              </p>

              {/* Koordinatsız klinik — override onay kutusu */}
              {tier.needsOverride && (
                <div className="mt-3 space-y-2">
                  <p className="text-xs italic">
                    Mevcut konumunuz (
                    {position
                      ? `${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`
                      : 'bekleniyor…'}
                    ) check-in kaydına eklenecek; klinik mesafesi doğrulanmayacak.
                  </p>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={overrideConfirmed}
                      onChange={(e) => setOverrideConfirmed(e.target.checked)}
                      className="h-4 w-4 rounded border-current accent-amber-700"
                    />
                    <span className="text-xs font-medium">
                      Anladım, mesafe doğrulaması olmadan check-in yapmak istiyorum.
                    </span>
                  </label>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Konum izni / hata */}
        {(status === 'denied' || status === 'unavailable') && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {geoError ?? 'Konum servisi kullanılamıyor.'}
          </div>
        )}

        {showSpinner && (
          <div className="flex items-center gap-2 rounded-2xl border border-border bg-card p-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Konum alınıyor…
          </div>
        )}

        {/* Yenile konum */}
        {position && !submitting && (
          <button
            type="button"
            onClick={() => request()}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background h-11 min-h-tap-min text-sm font-medium hover:bg-muted"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
            Konumu Yenile
          </button>
        )}

        {/* Hızlı not (opsiyonel) — check-in ile birlikte kaydedilir */}
        {!showNote ? (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-background h-11 min-h-tap-min text-sm font-medium hover:bg-muted"
          >
            <FileText className="h-4 w-4" aria-hidden="true" />
            Not Ekle
          </button>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-3 space-y-1.5">
            <label htmlFor="checkin-note" className="text-xs font-medium text-muted-foreground">
              Ziyaret notu
            </label>
            <textarea
              id="checkin-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Bu ziyaretle ilgili kısa not…"
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
            <p className="text-right text-[11px] text-muted-foreground">{note.length}/500</p>
          </div>
        )}
      </div>

      {/* Sticky bottom actions */}
      <div className="sticky bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border px-4 py-3 space-y-2 safe-area-inset">
        <button
          type="button"
          onClick={() => void handleCheckIn()}
          disabled={
            submitting ||
            !position ||
            accountLoading ||
            tier.blocked ||
            (tier.needsOverride === true && !overrideConfirmed) ||
            status === 'denied' ||
            status === 'unavailable'
          }
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold h-20 text-xl shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              Check-in…
            </>
          ) : (
            <>
              <MapPin className="h-6 w-6" aria-hidden="true" />
              Check-in Yap
            </>
          )}
        </button>
        <button
          type="button"
          onClick={() => navigate(-1)}
          disabled={submitting}
          className="w-full inline-flex items-center justify-center rounded-xl border border-border bg-background h-12 min-h-tap-min text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}

export default CheckInPage;
