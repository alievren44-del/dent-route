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
import { MapPin, Loader2, AlertCircle, Search, Crosshair, ListFilter } from 'lucide-react';
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
import { getSupabaseClient } from '@lib/supabase';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import {
  useRouteBasket,
  type BasketStop,
  type BasketStopSource,
} from '@features/routes/store/routeBasketStore';

interface Origin {
  lat: number;
  lng: number;
  label: string;
}

const adapter = new SupabaseCRMAdapter();

interface SahaClinicRow {
  id: string;
  google_place_id: string;
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
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('saha_search_nearby_clinics', {
    _lat: lat,
    _lng: lng,
    _radius_m: radiusM,
    _vertical_key: verticalKey,
    _limit: 100,
  });
  if (error) throw error;
  return (data ?? []) as SahaClinicRow[];
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

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['discovery', origin?.lat, origin?.lng, radiusKm, vertical.id],
    enabled: !!origin,
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!origin) return [];

      const [sahaResult, clinicsResult] = await Promise.allSettled([
        adapter.searchNearby({ lat: origin.lat, lng: origin.lng }, radiusKm, {
          limit: 50,
        }),
        fetchSahaClinics(origin.lat, origin.lng, radiusKm * 1000, vertical.id),
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
            name: r.name,
            lat: r.lat,
            lng: r.lng,
            address: r.address ?? undefined,
            phone: r.phone ?? undefined,
            rating: r.rating ?? undefined,
            types: r.types,
          });
        }
      }

      return dedupCandidates(candidates);
    },
  });

  const showSpinner = isLoading || isFetching;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Search className="h-6 w-6" aria-hidden="true" />
          {vertical.labels.discovery}
        </h1>
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

      {/* Radius selector */}
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

      {/* Status banners */}
      {originMode === 'gps' && status === 'denied' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Konum izni reddedildi. "İl / İlçe seç" ile manuel ara veya tarayıcıdan izin ver.</span>
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

      {/* Akıllı arama */}
      {origin && data && data.length > 0 && (
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
      )}

      {/* Results */}
      {origin && data && data.length > 0 && (
        <div className="space-y-3">
          {(() => {
            const q = foldTr(searchQuery.trim());
            const qDigits = searchQuery.replace(/\D+/g, '');
            const filtered = q
              ? data.filter((c) => {
                  const hay = foldTr(`${c.name} ${c.phone ?? ''} ${c.address ?? ''}`);
                  const phoneHay = (c.phone ?? '').replace(/\D+/g, '');
                  return hay.includes(q) || (qDigits.length >= 3 && phoneHay.includes(qDigits));
                })
              : data;
            return filtered.length === 0 && q ? (
              <p className="text-sm text-muted-foreground">"{searchQuery}" için sonuç yok.</p>
            ) : null;
          })()}
          {(() => {
            const q = foldTr(searchQuery.trim());
            const qDigits = searchQuery.replace(/\D+/g, '');
            const filtered = q
              ? data.filter((c) => {
                  const hay = foldTr(`${c.name} ${c.phone ?? ''} ${c.address ?? ''}`);
                  const phoneHay = (c.phone ?? '').replace(/\D+/g, '');
                  return hay.includes(q) || (qDigits.length >= 3 && phoneHay.includes(qDigits));
                })
              : data;
            return filtered;
          })().map((c) => {
            const key = c.customerId ?? c.externalId ?? `${c.lat},${c.lng},${c.name}`;
            const isExisting = c.sources.includes('saha');
            const stopId = buildStopId(c);
            const inBasket = basketItems.some((s) => s.id === stopId);
            return (
              <ClinicCard
                key={key}
                name={c.name}
                address={c.address}
                phone={c.phone}
                lat={c.lat}
                lng={c.lng}
                distanceM={haversineMeters(origin.lat, origin.lng, c.lat, c.lng)}
                rating={c.rating}
                isExistingCustomer={isExisting}
                isInBasket={inBasket}
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
        </div>
      )}
    </div>
  );
}

export default DiscoveryPage;
