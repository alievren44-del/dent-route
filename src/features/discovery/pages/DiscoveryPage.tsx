/**
 * DiscoveryPage — GPS-based müşteri keşfi.
 *
 * Akış: Geolocation → paralel (saha searchNearby + saha_clinics RPC)
 * → dedupCandidates → ClinicCard listesi. Vertical-aware başlık ve etiketler.
 * Live Google çağrısı YOK — klinikler admin tarafından `clinic-scan` ile önceden eklenir.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MapPin, Loader2, AlertCircle, Search, Crosshair, ListFilter, PlusCircle } from 'lucide-react';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import {
  dedupCandidates,
  haversineMeters,
  type DiscoveryCandidate,
} from '@features/discovery/dedup';
import ClinicCard from '@features/discovery/components/ClinicCard';
import { DistrictPicker } from '@features/routes/components/DistrictPicker';
import { getDistrictsByProvince } from '@/data/tr-locations/geo-helpers';
import { useVertical } from '@core/verticals/useVertical';
import { getTypedClient } from '@lib/supabase';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import {
  useRouteBasket,
  type BasketStop,
  type BasketStopSource,
} from '@features/routes/store/routeBasketStore';
import FieldAddClinicModal from '@features/discovery/components/FieldAddClinicModal';

interface Origin {
  lat: number;
  lng: number;
  label: string;
}

const adapter = new SupabaseCRMAdapter();

interface SahaClinicRow {
  id: string;
  google_place_id: string | null;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  phone: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  types: string[];
  province_slug: string | null;
  district_slug: string | null;
  distance_m: number;
}

async function fetchSahaClinics(
  lat: number,
  lng: number,
  radiusM: number,
  verticalKey: string,
): Promise<SahaClinicRow[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase.rpc('saha_search_nearby_clinics', {
    _lat: lat,
    _lng: lng,
    _radius_m: radiusM,
    _vertical_key: verticalKey,
    _limit: 3000,
  });
  if (error) throw error;
  return (data ?? []) as SahaClinicRow[];
}

/**
 * İlçe seçildiğinde: radius değil, o ilçenin TÜM aktif kliniklerini getir.
 * (Çankaya gibi büyük ilçelerde centroid+radius çoğunu kaçırır.) Mesafe
 * client-side haversine ile origin'e göre hesaplanır.
 */
async function fetchClinicsByDistrict(
  provinceSlug: string,
  districtSlug: string,
  verticalKey: string,
): Promise<SahaClinicRow[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('saha_clinics')
    .select(
      'id, google_place_id, name, lat, lng, address, phone, rating, user_ratings_total, types, province_slug, district_slug',
    )
    .eq('province_slug', provinceSlug)
    .eq('district_slug', districtSlug)
    .eq('status', 'active')
    .eq('vertical_key', verticalKey)
    .limit(1000);
  if (error) throw error;
  return ((data ?? []) as Omit<SahaClinicRow, 'distance_m'>[]).map((r) => ({
    ...r,
    distance_m: 0,
  }));
}

const RADIUS_OPTIONS: number[] = [1, 2, 5, 10];

function buildStopId(c: DiscoveryCandidate): string {
  if (c.customerId) return c.customerId;
  if (c.externalId) return `temp_${c.externalId}`;
  return `temp_${c.name}`;
}

function DiscoveryPage(): JSX.Element {
  const vertical = useVertical();
  const navigate = useNavigate();
  const { position, status, request } = useGeolocation();
  const [radiusKm, setRadiusKm] = useState<number>(5);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [originMode, setOriginMode] = useState<'gps' | 'manual'>('gps');
  const [provinceSlug, setProvinceSlug] = useState<string>('');
  const [districtSlug, setDistrictSlug] = useState<string>('');
  const basketAdd = useRouteBasket((s) => s.add);
  const basketItems = useRouteBasket((s) => s.items);
  const [fieldModalOpen, setFieldModalOpen] = useState(false);

  // Manuel origin: seçili ilçe centroid'i (GPS yoksa / planlama için)
  const manualOrigin = useMemo<Origin | null>(() => {
    if (originMode !== 'manual' || !provinceSlug || !districtSlug) return null;
    const d = getDistrictsByProvince(provinceSlug).find((x) => x.slug === districtSlug);
    if (!d) return null;
    return { lat: d.lat, lng: d.lng, label: `${d.ad} / ${d.il_ad}` };
  }, [originMode, provinceSlug, districtSlug]);

  // Etkin origin: manuel seçim veya GPS konumu
  const origin = useMemo<Origin | null>(() => {
    if (originMode === 'manual') return manualOrigin;
    if (position) return { lat: position.lat, lng: position.lng, label: 'Konumum' };
    return null;
  }, [originMode, manualOrigin, position]);

  // Türkçe accent-fold + lowercase
  const foldTr = (s: string) =>
    s
      .toLocaleLowerCase('tr')
      .replace(/ç/g, 'c')
      .replace(/ğ/g, 'g')
      .replace(/ı/g, 'i')
      .replace(/i̇/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ş/g, 's')
      .replace(/ü/g, 'u');

  useEffect(() => {
    if (originMode === 'gps') request();
  }, [request, originMode]);

  const isDistrictMode = originMode === 'manual' && !!provinceSlug && !!districtSlug;

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: [
      'discovery',
      origin?.lat,
      origin?.lng,
      isDistrictMode ? `district:${provinceSlug}/${districtSlug}` : `radius:${radiusKm}`,
      vertical.id,
    ],
    enabled: !!origin,
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!origin) return [];

      // İlçe modunda: o ilçenin tüm klinikleri + geniş radius'ta saha müşteri.
      // GPS modunda: kullanıcının seçtiği radius.
      const sahaRadiusKm = isDistrictMode ? 30 : radiusKm;
      const clinicsFetch = isDistrictMode
        ? fetchClinicsByDistrict(provinceSlug, districtSlug, vertical.id).then((rows) =>
            // Slug eşleşmezse (eski scan farklı slug) 0 dönebilir → 25km radius fallback
            rows.length > 0 ? rows : fetchSahaClinics(origin.lat, origin.lng, 25_000, vertical.id),
          )
        : fetchSahaClinics(origin.lat, origin.lng, radiusKm * 1000, vertical.id);
      const [sahaResult, clinicsResult] = await Promise.allSettled([
        adapter.searchNearby({ lat: origin.lat, lng: origin.lng }, sahaRadiusKm, {
          limit: 3000,
        }),
        clinicsFetch,
      ]);

      const candidates: DiscoveryCandidate[] = [];

      if (sahaResult.status === 'fulfilled') {
        for (const c of sahaResult.value) {
          const addr = c.addresses[0];
          const loc = addr?.location;
          if (!loc) continue;
          candidates.push({
            source: 'saha',
            customerId: c.id,
            name: c.name,
            lat: loc.lat,
            lng: loc.lng,
            phone: c.phone,
            address: addr?.addressLine,
          });
        }
      }

      if (clinicsResult.status === 'fulfilled') {
        for (const r of clinicsResult.value) {
          candidates.push({
            source: 'google_places',
            externalId: r.google_place_id,
            // Carry the saha_clinics UUID so we can auto-create a cari on tap.
            sahaClinicId: r.id,
            name: r.name,
            lat: r.lat,
            lng: r.lng,
            address: r.address ?? undefined,
            phone: r.phone ?? undefined,
            rating: r.rating ?? undefined,
            types: r.types,
            // Carry review count through for ClinicCard display (not part of the
            // DiscoveryCandidate type, but survives dedup spread).
            user_ratings_total: r.user_ratings_total,
          } as DiscoveryCandidate);
        }
      }

      const deduped = dedupCandidates(candidates);
      // En yakın önce — ilçe modunda da merkez (centroid) bazlı sırala
      deduped.sort(
        (a, b) =>
          haversineMeters(origin.lat, origin.lng, a.lat, a.lng) -
          haversineMeters(origin.lat, origin.lng, b.lat, b.lng),
      );
      return deduped;
    },
  });

  const showSpinner = isLoading || isFetching;

  // GENİŞ ARAMA: arama yazıldığında seçili ilçe/yarıçapla SINIRLI kalmasın.
  // Kayıtlı/ziyaret edilmiş klinik başka ilçede olabilir (ör. ZDK=mamak,
  // kullanıcı Çankaya'da arıyor) → ad ile TÜM aktif klinikleri ara (limit 40).
  const searchTrim = searchQuery.trim();
  const globalSearchEnabled = searchTrim.length >= 2;
  // PostgREST filtre-injection önle: özel karakterleri boşlukla değiştir.
  const safeTerm = searchTrim.replace(/[,()%_*]/g, ' ').trim();
  const { data: globalSearchData, isLoading: isSearchLoading } = useQuery({
    queryKey: ['discovery-search', safeTerm, vertical.id],
    enabled: globalSearchEnabled && safeTerm.length >= 2,
    staleTime: 60 * 1000,
    retry: false,
    queryFn: async (): Promise<Omit<SahaClinicRow, 'distance_m'>[]> => {
      const supabase = getTypedClient();
      // Use saha_search_clinics RPC for Turkish-diacritic/İ-insensitive name search.
      // Replaces the accent-blind .ilike() that missed "irem yilmaz" → "İrem Yılmaz" etc.
      const { data: rows, error } = await supabase.rpc('saha_search_clinics', {
        _q: safeTerm,
        _vertical_key: vertical.id,
        _limit: 40,
      });
      if (error) throw error;
      // RPC does not return google_place_id or types — fill with nulls so the
      // existing filteredData mapper still compiles and works correctly.
      return ((rows ?? []) as Array<{
        id: string;
        name: string;
        lat: number;
        lng: number;
        address: string | null;
        phone: string | null;
        rating: number | null;
        user_ratings_total: number | null;
        province_slug: string | null;
        district_slug: string | null;
      }>).map((r) => ({
        ...r,
        google_place_id: null,
        types: [] as string[],
      }));
    },
  });

  // Akıllı aramaya göre filtrelenmiş liste (tek hesap — sayaç + render paylaşır)
  const filteredData = useMemo(() => {
    const q = foldTr(searchQuery.trim());
    const qDigits = searchQuery.replace(/\D+/g, '');

    // Yakın-alan modu (arama yok): origin + data gerekli.
    // BUG #07 FIX: GPS modunda sonuçları client-side yarıçap filtresiyle kes.
    // RPC radius'u sunucu tarafında uygular ancak adapter.searchNearby sonuçları
    // (saha müşterileri) dedupCandidates sonrası birleştiğinden farklı radius
    // seçildiğinde cache'den yanlış veri görünebiliyordu. Kesin güvence için
    // her durumda haversine ≤ radiusKm * 1000 kontrolü uygula.
    // İlçe modunda radius filtresi UYGULANMAZ — tüm ilçe gösterilir.
    if (!q) {
      if (!data || !origin) return [];
      return !isDistrictMode
        ? data.filter(
            (c) => haversineMeters(origin.lat, origin.lng, c.lat, c.lng) <= radiusKm * 1000,
          )
        : data;
    }

    // Arama modu: origin olmasa bile globalSearchData (RPC) sonuçlarını göster (SC-4).
    const matchFn = (c: DiscoveryCandidate) => {
      const hay = foldTr(`${c.name} ${c.phone ?? ''} ${c.address ?? ''}`);
      const phoneHay = (c.phone ?? '').replace(/\D+/g, '');
      return hay.includes(q) || (qDigits.length >= 3 && phoneHay.includes(qDigits));
    };

    let scopedMatches: DiscoveryCandidate[] = [];
    if (data && origin) {
      const radiusFiltered = !isDistrictMode
        ? data.filter(
            (c) => haversineMeters(origin.lat, origin.lng, c.lat, c.lng) <= radiusKm * 1000,
          )
        : data;
      scopedMatches = radiusFiltered.filter(matchFn);
    }

    // Geniş arama (il/ilçe-bağımsız ad araması) sonuçlarını ekle → kayıtlı ama
    // başka ilçedeki klinikler (ZDK=mamak vb.) de bulunur. dedup + mesafe sırala.
    const globalCandidates: DiscoveryCandidate[] = (globalSearchData ?? []).map(
      (r) =>
        ({
          source: 'google_places',
          externalId: r.google_place_id ?? undefined,
          // Carry saha_clinics.id so auto-create works for globally-searched clinics too.
          sahaClinicId: r.id,
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          address: r.address ?? undefined,
          phone: r.phone ?? undefined,
          rating: r.rating ?? undefined,
          types: r.types,
          user_ratings_total: r.user_ratings_total,
        }) as DiscoveryCandidate,
    );
    const merged = dedupCandidates([...scopedMatches, ...globalCandidates]);
    if (origin) {
      merged.sort(
        (a, b) =>
          haversineMeters(origin.lat, origin.lng, a.lat, a.lng) -
          haversineMeters(origin.lat, origin.lng, b.lat, b.lng),
      );
    }
    return merged;
  }, [data, searchQuery, origin, isDistrictMode, radiusKm, globalSearchData]);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Search className="h-6 w-6" aria-hidden="true" />
          {vertical.labels.discovery}
        </h1>
        <div className="flex items-center gap-2">
          {originMode === 'gps' && !!position && (
            <button
              type="button"
              onClick={() => setFieldModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 h-10 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
              title="GPS konumuna yeni klinik ekle"
            >
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Yeni klinik</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void refetch();
            }}
            disabled={!origin || showSpinner}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 h-10 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            {showSpinner ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}
            Yenile
          </button>
        </div>
      </div>

      {/* Origin mode: GPS konumu veya il/ilçe seçimi */}
      <div className="space-y-2 rounded-xl border border-border bg-card p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setOriginMode('gps')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 h-9 text-sm font-medium ${
              originMode === 'gps'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            }`}
          >
            <Crosshair className="h-4 w-4" aria-hidden="true" />
            Konumum
          </button>
          <button
            type="button"
            onClick={() => setOriginMode('manual')}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 h-9 text-sm font-medium ${
              originMode === 'manual'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            }`}
          >
            <ListFilter className="h-4 w-4" aria-hidden="true" />
            İl / İlçe seç
          </button>
        </div>
        {originMode === 'manual' && (
          <DistrictPicker
            provinceSlug={provinceSlug}
            districtSlug={districtSlug}
            onChange={(p, d) => {
              setProvinceSlug(p);
              setDistrictSlug(d);
            }}
          />
        )}
        {origin && (
          <p className="text-xs text-muted-foreground">
            Merkez: <span className="font-medium text-foreground">{origin.label}</span>
          </p>
        )}
      </div>

      {/* Radius selector — sadece GPS modunda (ilçe modu tüm ilçeyi getirir) */}
      {originMode === 'gps' && (
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm text-muted-foreground">Yarıçap:</span>
          <div className="flex gap-1">
            {RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadiusKm(r)}
                className={`rounded-lg px-3 h-9 text-sm font-medium border ${
                  radiusKm === r
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-muted'
                }`}
              >
                {r}km
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Status banners */}
      {originMode === 'gps' && status === 'denied' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Konum izni reddedildi. "İl / İlçe seç" ile manuel ara veya tarayıcıdan izin ver.
          </span>
        </div>
      )}

      {originMode === 'gps' && status === 'unavailable' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Konum servisi mevcut değil. "İl / İlçe seç" ile manuel ara.</span>
        </div>
      )}

      {originMode === 'manual' && !origin && (
        <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
          <ListFilter className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Yukarıdan il ve ilçe seç — o bölgeye yakın klinikler listelenir.</span>
        </div>
      )}

      {showSpinner && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Aranıyor...</span>
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Hata oluştu, yenile.</span>
        </div>
      )}

      {/* Akıllı arama — GPS gerektirmez: RPC ile origin olmadan da çalışır (SC-4) */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Akıllı arama: ad, telefon, adres…"
          className="w-full rounded-xl border border-border bg-background pl-9 pr-9 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
            aria-label="Temizle"
          >
            <AlertCircle className="h-4 w-4 rotate-45" />
          </button>
        )}
      </div>

      {/* Sonuç sayacı — teyit için */}
      {((origin && data && data.length > 0) || filteredData.length > 0) && (
        <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <span className="font-medium text-foreground">
            {searchQuery.trim()
              ? origin && data
                ? `${filteredData.length} / ${data.length} klinik`
                : `${filteredData.length} klinik`
              : `${filteredData.length} klinik`}
          </span>
          <span className="text-xs text-muted-foreground">{origin?.label ?? ''}</span>
        </div>
      )}

      {/* Arama yapıldı ama sonuç yok (origin olmadan arama dahil) */}
      {globalSearchEnabled && filteredData.length === 0 && !showSpinner && !isSearchLoading && (
        <p className="text-sm text-muted-foreground">"{searchQuery}" için sonuç yok.</p>
      )}

      {/* Results — origin olmasa bile arama sonuçları gösterilir (SC-4) */}
      {filteredData.length > 0 && (
        <div className="space-y-3">
          {filteredData.map((c) => {
            const key = c.customerId ?? c.externalId ?? `${c.lat},${c.lng},${c.name}`;
            const isExisting = c.sources.includes('saha');
            const stopId = buildStopId(c);
            const inBasket = basketItems.some((s) => s.id === stopId);
            // Bug E fix: clinics that exist in saha_clinics but have no account
            // yet also get action buttons. CheckInPage + CustomerDetailPage both
            // resolve :id as a saha_clinics id (account_id), so navigate directly
            // with that id — same as the customerId path. Pure Google-Places
            // candidates (no sahaClinicId, no customerId) remain inert as before.
            const clinicNavId = c.customerId ?? c.sahaClinicId;
            // user_ratings_total is carried on the source saha_clinics rows but is
            // not part of the DedupedCandidate type; read it tolerantly for display.
            const reviewsTotal = (c as { user_ratings_total?: number | null }).user_ratings_total;
            const openDetail = clinicNavId ? () => navigate(`/clinics/${clinicNavId}`) : undefined;
            const openVisit = clinicNavId
              ? () => navigate(`/visits/check-in/${clinicNavId}`)
              : undefined;
            return (
              <ClinicCard
                key={key}
                name={c.name}
                address={c.address}
                phone={c.phone}
                lat={c.lat}
                lng={c.lng}
                distanceM={origin ? haversineMeters(origin.lat, origin.lng, c.lat, c.lng) : undefined}
                rating={c.rating}
                userRatingsTotal={reviewsTotal}
                isExistingCustomer={isExisting}
                isInBasket={inBasket}
                onOpenDetail={openDetail}
                onStartVisit={openVisit}
                onAdd={() => {
                  const source: BasketStopSource = c.sources.includes('saha')
                    ? 'saha'
                    : 'google_places';
                  const stop: Omit<BasketStop, 'addedAt'> = {
                    id: stopId,
                    name: c.name,
                    lat: c.lat,
                    lng: c.lng,
                    source,
                    address: c.address,
                    phone: c.phone,
                  };
                  const result = basketAdd(stop);
                  if (result.ok) {
                    toast.success(`${c.name} sepete eklendi`, {
                      action: {
                        label: 'Rota',
                        onClick: () => navigate('/routes/plan'),
                      },
                    });
                  } else if (result.reason === 'duplicate') {
                    toast.info('Bu durak zaten sepette');
                  } else if (result.reason === 'full') {
                    toast.error('Sepet dolu (maks 12 durak)');
                  }
                }}
              />
            );
          })}
        </div>
      )}

      {origin && data && data.length === 0 && !showSpinner && !isError && (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground space-y-2">
          <p>Bu yarıçapta klinik bulunamadı.</p>
          <p className="text-xs">
            Admin'e tarama talebinde bulun (vertical: <code>{vertical.id}</code>, konum:{' '}
            {origin.lat.toFixed(4)}, {origin.lng.toFixed(4)}, yarıçap: {radiusKm}km).
          </p>
          {originMode === 'gps' && !!position && (
            <button
              type="button"
              onClick={() => setFieldModalOpen(true)}
              className="mx-auto mt-1 inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 h-10 text-sm font-medium text-emerald-700 hover:bg-emerald-100"
            >
              <PlusCircle className="h-4 w-4" aria-hidden="true" />
              Bu konuma yeni klinik ekle
            </button>
          )}
        </div>
      )}

      {/* Saha temsilcisi mevcut GPS konumuna yeni klinik ekler */}
      {originMode === 'gps' && !!position && (
        <FieldAddClinicModal
          open={fieldModalOpen}
          onClose={() => setFieldModalOpen(false)}
          lat={position.lat}
          lng={position.lng}
          verticalKey={vertical.id}
          onCreated={(newId) => {
            setFieldModalOpen(false);
            navigate(`/visits/check-in/${newId}`);
          }}
        />
      )}
    </div>
  );
}

export default DiscoveryPage;
