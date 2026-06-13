/**
 * NearbyProvincesPage — Kullanıcı konumundan 50km içine düşen illeri listeler.
 *
 * Akış:
 *   1. useGeolocation → GPS al (kullanıcı request eder)
 *   2. getNearbyProvinces (haversine, 81 il filtre)
 *   3. RPC saha_clinics_count_by_province → her ilin aktif klinik sayısı
 *   4. ProvinceCard liste — tıklama → /clinics/discover?province=X
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Locate, Loader2, AlertCircle } from 'lucide-react';

import { useGeolocation } from '@features/map/hooks/useGeolocation';
import { getTypedClient } from '@lib/supabase';
import { getNearbyProvinces, type NearbyProvince } from '@features/discovery/lib/nearby-provinces';
import { ProvinceCard } from '@features/discovery/components/ProvinceCard';

const MAX_KM = 50;
const VERTICAL_KEY = 'dental';

async function fetchClinicCounts(slugs: string[]): Promise<Record<string, number>> {
  if (slugs.length === 0) return {};
  const supabase = getTypedClient();
  const { data, error } = await supabase.rpc('saha_clinics_count_by_province', {
    _slugs: slugs,
    _vertical_key: VERTICAL_KEY,
  });
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ province_slug: string; count: number }>) {
    out[row.province_slug] = Number(row.count);
  }
  return out;
}

export default function NearbyProvincesPage() {
  const navigate = useNavigate();
  const { position, error: geoErr, status, request } = useGeolocation();
  const [provinces, setProvinces] = useState<NearbyProvince[]>([]);

  useEffect(() => {
    if (status === 'idle') request();
  }, [status, request]);

  useEffect(() => {
    if (!position) return;
    const list = getNearbyProvinces(position.lat, position.lng, MAX_KM);
    setProvinces(list);
  }, [position]);

  const slugs = provinces.map((p) => p.slug);
  const countsQuery = useQuery({
    queryKey: ['nearby-clinic-counts', slugs],
    queryFn: () => fetchClinicCounts(slugs),
    enabled: slugs.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Yakınımdaki İller</h1>
        <p className="text-sm text-muted-foreground">
          Konumundan {MAX_KM} km içine düşen iller. Tıkla → o ilin kliniklerini keşfet.
        </p>
      </header>

      {status === 'idle' || status === 'prompting' ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card p-6 text-center">
          <Locate className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm">Yakın illeri görmek için konum izni gerekiyor.</p>
          <button
            type="button"
            onClick={request}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Konumumu Paylaş
          </button>
        </div>
      ) : status === 'denied' || status === 'unavailable' ? (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">Konum alınamadı</p>
            <p className="text-xs text-muted-foreground">
              {geoErr ?? 'Tarayıcı konum izni yok veya GPS kapalı.'}
            </p>
          </div>
        </div>
      ) : provinces.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Hesaplanıyor…
        </div>
      ) : (
        <div className="space-y-2">
          {countsQuery.isLoading && (
            <p className="text-xs text-muted-foreground">Klinik sayıları yükleniyor…</p>
          )}
          {provinces.map((p) => (
            <ProvinceCard
              key={p.slug}
              name={p.ad}
              distanceKm={p.distanceKm}
              clinicCount={countsQuery.data?.[p.slug] ?? 0}
              nufus={p.nufus}
              bolge={p.bolge}
              onClick={() => navigate(`/routes/auto?province=${p.slug}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
