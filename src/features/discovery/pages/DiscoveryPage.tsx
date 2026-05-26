/**
 * DiscoveryPage — GPS-based müşteri keşfi.
 *
 * Akış: Geolocation → paralel (saha searchNearby + saha_clinics RPC)
 * → dedupCandidates → ClinicCard listesi. Vertical-aware başlık ve etiketler.
 * Live Google çağrısı YOK — klinikler admin tarafından `clinic-scan` ile önceden eklenir.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Loader2, AlertCircle, Search } from 'lucide-react';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import {
  dedupCandidates,
  haversineMeters,
  type DiscoveryCandidate,
} from '@features/discovery/dedup';
import ClinicCard from '@features/discovery/components/ClinicCard';
import { useVertical } from '@core/verticals/useVertical';
import { getSupabaseClient } from '@lib/supabase';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';

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

function DiscoveryPage(): JSX.Element {
  const vertical = useVertical();
  const { position, status, request } = useGeolocation();
  const [radiusKm, setRadiusKm] = useState<number>(5);

  useEffect(() => {
    request();
  }, [request]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['discovery', position?.lat, position?.lng, radiusKm, vertical.id],
    enabled: !!position,
    retry: false,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!position) return [];

      const [sahaResult, clinicsResult] = await Promise.allSettled([
        adapter.searchNearby({ lat: position.lat, lng: position.lng }, radiusKm, {
          limit: 50,
        }),
        fetchSahaClinics(position.lat, position.lng, radiusKm * 1000, vertical.id),
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
          onClick={() => refetch()}
          disabled={!position || showSpinner}
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
      {status === 'denied' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Konum izni reddedildi. Tarayıcı ayarlarından izin ver.</span>
        </div>
      )}

      {status === 'unavailable' && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Konum servisi mevcut değil.</span>
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

      {/* Results */}
      {position && data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((c) => {
            const key = c.customerId ?? c.externalId ?? `${c.lat},${c.lng},${c.name}`;
            const isExisting = c.sources.includes('saha');
            return (
              <ClinicCard
                key={key}
                name={c.name}
                address={c.address}
                phone={c.phone}
                distanceM={haversineMeters(position.lat, position.lng, c.lat, c.lng)}
                rating={c.rating}
                isExistingCustomer={isExisting}
                onAdd={() => {
                  // TODO: Sprint 2.5: createCustomer flow
                  // eslint-disable-next-line no-console
                  console.log('add candidate', c);
                }}
              />
            );
          })}
        </div>
      )}

      {position && data && data.length === 0 && !showSpinner && !isError && (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground space-y-2">
          <p>Bu yarıçapta klinik bulunamadı.</p>
          <p className="text-xs">
            Admin'e tarama talebinde bulun (vertical: <code>{vertical.id}</code>, konum:{' '}
            {position.lat.toFixed(4)}, {position.lng.toFixed(4)}, yarıçap: {radiusKm}km).
          </p>
        </div>
      )}
    </div>
  );
}

export default DiscoveryPage;
