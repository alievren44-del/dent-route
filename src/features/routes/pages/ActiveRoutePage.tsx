/**
 * ActiveRoutePage — aktif rota görüntüleme + tamamlama akışı.
 *
 * URL: /routes/active/:id
 *
 * NOT (Sprint 2 iterasyonu):
 *  - `saha_routes` tablosu (migration 20260525000001) sadece `account_ids text[]`
 *    tutuyor; rota geometry/koordinatı saklamıyor. Bu yüzden harita üzerinde
 *    polyline çizilmiyor — durak sıralı liste olarak gösteriliyor.
 *  - Sprint 4 (visit check-in) DB tarafında stop bazlı güncelleme açacak; burada
 *    "Durağı Tamamla" sadece UI state ilerletir.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  ArrowRight,
  CheckCircle2,
  Flag,
  Loader2,
  MapPin,
  Navigation,
  X,
  StickyNote,
  Phone,
  Sparkles,
  ShoppingCart,
} from 'lucide-react';
import { toast } from 'sonner';
import { decodePolyline } from '@/lib/polyline';
import { computeDetour } from '@features/routes/lib/detour-calc';
import { useRouteBasket } from '@features/routes/store/routeBasketStore';

import { getSupabaseClient } from '@lib/supabase';
import { getEnv } from '@config/env';
import { useAuthStore } from '@core/auth/authStore';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import { resolveMarkerColor } from '@features/map/marker-colors';
import { RouteExportPanel } from '@features/routes/components/RouteExportPanel';

type RouteStatus = 'planned' | 'active' | 'completed' | 'cancelled';

interface SahaRouteRow {
  id: string;
  profile_id: string;
  name: string | null;
  account_ids: string[];
  status: RouteStatus;
  is_recurring: boolean;
  recurrence_rule: string | null;
  optimized: boolean;
  total_distance_km: number | null;
  total_duration_min: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

async function fetchRoute(id: string): Promise<SahaRouteRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_routes')
    .select('*')
    .eq('id', id)
    .single<SahaRouteRow>();
  if (error || !data) {
    throw error ?? new Error('route_not_found');
  }
  return data;
}

interface RouteStopCoord {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
}

async function fetchStopCoords(accountIds: string[]): Promise<RouteStopCoord[]> {
  if (accountIds.length === 0) return [];
  const supabase = getSupabaseClient();

  // saha_clinics tek kaynak: Discovery / SahaTara / DistrictAutoRoute / Corridor
  // sepete saha_clinics.id (uuid) yazıyor. (accounts tablosu Parla DB'de yok.)
  const clinicRes = await supabase
    .from('saha_clinics')
    .select('id, name, lat, lng, address, phone')
    .in('id', accountIds);

  const byId = new Map<string, RouteStopCoord>();
  if (clinicRes.data) {
    for (const row of clinicRes.data as Array<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      address: string | null;
      phone: string | null;
    }>) {
      if (byId.has(row.id)) continue;
      byId.set(row.id, {
        id: row.id,
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        address: row.address ?? undefined,
        phone: row.phone ?? undefined,
      });
    }
  }
  // Rotadaki sırayı koru
  const ordered: RouteStopCoord[] = [];
  for (const aid of accountIds) {
    const stop = byId.get(aid);
    if (stop) ordered.push(stop);
  }
  return ordered;
}

interface CompleteRoutePayload {
  routeId: string;
  profileId: string;
  actualKm: number;
  durationMin: number | null;
  fuelLiters: number | null;
  fuelCostTl: number | null;
}

async function completeRoute(payload: CompleteRoutePayload): Promise<void> {
  const supabase = getSupabaseClient();
  const completedAt = new Date().toISOString();

  const { error: routeErr } = await supabase
    .from('saha_routes')
    .update({
      status: 'completed',
      completed_at: completedAt,
      total_distance_km: payload.actualKm,
    })
    .eq('id', payload.routeId);
  if (routeErr) throw routeErr;

  const { error: logErr } = await supabase.from('saha_mileage_logs').insert({
    route_id: payload.routeId,
    profile_id: payload.profileId,
    log_date: completedAt.slice(0, 10),
    distance_km: payload.actualKm,
    duration_min: payload.durationMin,
    estimated_fuel_l: payload.fuelLiters,
    estimated_fuel_cost: payload.fuelCostTl,
  });
  if (logErr) throw logErr;
}

function formatDuration(totalMin: number | null): string {
  if (totalMin === null || !Number.isFinite(totalMin) || totalMin <= 0) {
    return '—';
  }
  const h = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  if (h === 0) return `${m} dk`;
  if (m === 0) return `${h} sa`;
  return `${h} sa ${m} dk`;
}

function formatKm(km: number | null): string {
  if (km === null || !Number.isFinite(km)) return '—';
  return `${km.toFixed(1)} km`;
}

export default function ActiveRoutePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const [currentStopIndex, setCurrentStopIndex] = useState<number>(0);
  const [showFinishModal, setShowFinishModal] = useState<boolean>(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [notingStop, setNotingStop] = useState<RouteStopCoord | null>(null);
  const [noteText, setNoteText] = useState<string>('');
  const [savingNote, setSavingNote] = useState<boolean>(false);

  // Yol-üstü dinamik öneri state
  const [corridorOpen, setCorridorOpen] = useState(false);
  const [corridorCandidates, setCorridorCandidates] = useState<
    Array<{
      id: string;
      name: string;
      lat: number;
      lng: number;
      address: string | null;
      phone: string | null;
      clinic_segment: 'private' | 'kamu';
      detourKm: number;
      detourMin: number;
    }>
  >([]);
  const [corridorLoading, setCorridorLoading] = useState(false);

  const {
    data: route,
    isLoading,
    isError,
    error,
  } = useQuery<SahaRouteRow, Error>({
    queryKey: ['active-route', id],
    queryFn: () => {
      if (!id) throw new Error('missing_route_id');
      return fetchRoute(id);
    },
    enabled: !!id,
  });

  // Export panel için durak koordinatlarını ayrı sorguda çek
  const stopCoordsQuery = useQuery<RouteStopCoord[], Error>({
    queryKey: ['active-route-stops', id, route?.account_ids ?? []],
    queryFn: () => fetchStopCoords(route?.account_ids ?? []),
    enabled: !!route && (route?.account_ids?.length ?? 0) > 0,
  });

  // Export için başlangıç noktası = kullanıcının canlı GPS konumu
  const geolocation = useGeolocation();
  useEffect(() => {
    if (route && !geolocation.position && geolocation.status !== 'denied') {
      geolocation.request();
    }
  }, [route, geolocation]);

  const totalStops = route?.account_ids.length ?? 0;
  const stopsVisited = Math.min(currentStopIndex, totalStops);
  const progressPct =
    totalStops > 0 ? Math.round((stopsVisited / totalStops) * 100) : 0;

  // Yol-üstü dinamik öneri — şu anki konum → sıradaki durak rotasındaki klinikleri öner.
  const fetchCorridor = useCallback(async () => {
    if (!geolocation.position) {
      toast.error('GPS gerekli');
      return;
    }
    if (!stopCoordsQuery.data || !route) return;
    const accountId = route.account_ids[currentStopIndex];
    if (!accountId) return;
    const nextStop = stopCoordsQuery.data.find((s) => s.id === accountId);
    if (!nextStop) {
      toast.error('Sıradaki durak bulunamadı');
      return;
    }
    setCorridorLoading(true);
    try {
      const supabase = getSupabaseClient();
      const a = { lat: geolocation.position.lat, lng: geolocation.position.lng };
      const b = { lat: nextStop.lat, lng: nextStop.lng };
      const { data: dirData, error: dirErr } = await supabase.functions.invoke('mapbox-directions', {
        body: { coords: [a, b], profile: 'driving' },
      });
      if (dirErr) throw new Error(dirErr.message);
      const dir = dirData as { status: string; geometry?: string };
      if (dir.status !== 'ok' || !dir.geometry) throw new Error('Yol bulunamadı');
      const decoded = decodePolyline(dir.geometry);
      const lineGeojson = JSON.stringify({ type: 'LineString', coordinates: decoded });
      const { data: nearData, error: nearErr } = await supabase.rpc('saha_clinics_near_polyline', {
        _line_geojson: lineGeojson,
        _buffer_m: 2000,
        _vertical_key: 'dental',
        _limit: 30,
      });
      if (nearErr) throw nearErr;
      const raw = (nearData ?? []) as Array<{
        id: string;
        name: string;
        lat: number;
        lng: number;
        address: string | null;
        phone: string | null;
        clinic_segment: 'private' | 'kamu';
      }>;
      const enriched = raw
        .filter((c) => c.id !== accountId)
        .map((c) => {
          const { distanceKm, durationMin } = computeDetour(a, { lat: c.lat, lng: c.lng }, b, 'driving');
          return { ...c, detourKm: distanceKm, detourMin: durationMin };
        })
        .filter((c) => c.detourKm <= 7 && c.detourMin <= 15)
        .sort((x, y) => x.detourMin - y.detourMin);
      setCorridorCandidates(enriched);
      setCorridorOpen(true);
      if (enriched.length === 0) toast.info('Yol üstünde uygun klinik yok');
    } catch (e) {
      toast.error(`Hata: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCorridorLoading(false);
    }
  }, [geolocation.position, stopCoordsQuery.data, route, currentStopIndex]);

  const addCandidateToBasket = useCallback(
    (c: { id: string; name: string; lat: number; lng: number; address: string | null; phone: string | null }) => {
      const basket = useRouteBasket.getState();
      const res = basket.add({
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        source: 'saha',
        address: c.address ?? undefined,
        phone: c.phone ?? undefined,
      });
      if (res.ok) toast.success(`${c.name} sepete eklendi`);
      else if (res.reason === 'duplicate') toast.info('Zaten sepette');
      else toast.error('Sepet dolu');
    },
    [],
  );

  const isOwner = useMemo<boolean>(() => {
    if (!route || !session) return false;
    return route.profile_id === session.userId;
  }, [route, session]);

  const [actualKmInput, setActualKmInput] = useState<string>('');
  const [fuelLitersInput, setFuelLitersInput] = useState<string>('');
  const [fuelCostInput, setFuelCostInput] = useState<string>('');

  useEffect(() => {
    if (route && actualKmInput === '' && route.total_distance_km !== null) {
      setActualKmInput(route.total_distance_km.toString());
    }
  }, [route, actualKmInput]);

  // Mapbox init
  useEffect(() => {
    if (!containerRef.current || !route) return;

    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [35.2, 39.0],
      zoom: 5,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [route]);

  const finishMutation = useMutation<void, Error, CompleteRoutePayload>({
    mutationFn: completeRoute,
    onSuccess: async () => {
      setShowFinishModal(false);
      setFinishError(null);
      await queryClient.invalidateQueries({ queryKey: ['active-route', id] });
    },
    onError: (err: Error) => {
      setFinishError(err.message || 'Bilinmeyen hata');
    },
  });

  const handleAdvanceStop = (): void => {
    if (currentStopIndex < totalStops - 1) {
      setCurrentStopIndex((idx) => idx + 1);
    } else if (currentStopIndex === totalStops - 1) {
      setCurrentStopIndex(totalStops);
    }
  };

  const handleOpenGoogleMaps = (): void => {
    if (!route || !stopCoordsQuery.data) return;
    const accountId = route.account_ids[currentStopIndex];
    if (!accountId) return;
    const stop = stopCoordsQuery.data.find((s) => s.id === accountId);
    if (!stop) {
      toast.error('Bu durağın koordinatı bulunamadı');
      return;
    }
    // Google Maps directions URL — kullanıcı konumundan stop'a navigasyon
    const origin = geolocation.position
      ? `${geolocation.position.lat},${geolocation.position.lng}`
      : '';
    const dest = `${stop.lat},${stop.lng}`;
    const url = origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`
      : `https://www.google.com/maps/search/?api=1&query=${dest}`;
    window.open(url, '_blank', 'noopener');
  };

  const handleSubmitFinish = (): void => {
    if (!route || !session) return;
    const km = parseFloat(actualKmInput);
    if (!Number.isFinite(km) || km < 0) {
      setFinishError('Geçerli bir mesafe gir.');
      return;
    }
    const fuelL = fuelLitersInput.trim() === '' ? null : parseFloat(fuelLitersInput);
    const fuelTl = fuelCostInput.trim() === '' ? null : parseFloat(fuelCostInput);
    if (fuelL !== null && (!Number.isFinite(fuelL) || fuelL < 0)) {
      setFinishError('Geçerli bir yakıt litresi gir.');
      return;
    }
    if (fuelTl !== null && (!Number.isFinite(fuelTl) || fuelTl < 0)) {
      setFinishError('Geçerli bir yakıt maliyeti gir.');
      return;
    }

    finishMutation.mutate({
      routeId: route.id,
      profileId: session.userId,
      actualKm: km,
      durationMin: route.total_duration_min,
      fuelLiters: fuelL,
      fuelCostTl: fuelTl,
    });
  };

  if (!id) {
    return (
      <div className="p-6 text-sm text-red-700">Geçersiz rota linki.</div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Rota yükleniyor…
      </div>
    );
  }

  if (isError || !route) {
    return (
      <div className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Rota bulunamadı.
        {error?.message ? <div className="mt-1 text-xs">{error.message}</div> : null}
      </div>
    );
  }

  if (!isOwner && profile?.role !== 'ADMIN') {
    return (
      <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Bu rotayı görüntüleme yetkin yok.
      </div>
    );
  }

  const isStale = route.status !== 'active';
  const isCompleted = route.status === 'completed';

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] w-full">
      {/* Status banner */}
      {isStale && (
        <div
          className={`px-4 py-2 text-sm font-medium ${
            isCompleted
              ? 'bg-emerald-100 text-emerald-900'
              : 'bg-amber-100 text-amber-900'
          }`}
        >
          {isCompleted
            ? 'Bu rota tamamlandı.'
            : 'Bu rota artık aktif değil.'}
        </div>
      )}

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-3 border-b border-border bg-card p-3 text-center">
        <div>
          <div className="text-xs text-muted-foreground">Mesafe</div>
          <div className="text-sm font-semibold">
            {formatKm(route.total_distance_km)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Süre</div>
          <div className="text-sm font-semibold">
            {formatDuration(route.total_duration_min)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">İlerleme</div>
          <div className="text-sm font-semibold">
            {stopsVisited}/{totalStops} ({progressPct}%)
          </div>
        </div>
      </div>

      {/* Export panel — durak koordinatları yüklendiyse + GPS aktifse */}
      {geolocation.position &&
        stopCoordsQuery.data &&
        stopCoordsQuery.data.length > 0 && (
          <div className="border-b border-border bg-slate-50 p-3">
            <RouteExportPanel
              start={{
                lat: geolocation.position.lat,
                lng: geolocation.position.lng,
              }}
              stops={stopCoordsQuery.data.map((s) => ({
                lat: s.lat,
                lng: s.lng,
                name: s.name,
              }))}
            />
          </div>
        )}

      {/* Map + Stops */}
      <div className="flex flex-1 flex-col md:flex-row min-h-0">
        <div ref={containerRef} className="relative h-64 w-full md:h-auto md:flex-1" />

        <aside className="w-full max-h-[50vh] overflow-y-auto border-t border-border bg-background md:max-h-none md:w-80 md:border-l md:border-t-0">
          <div className="border-b border-border p-3">
            <h2 className="text-sm font-semibold">
              {route.name?.trim() ? route.name : 'Rota'}
            </h2>
            <div className="mt-1 text-xs text-muted-foreground">
              {totalStops} durak
            </div>
          </div>

          <ol className="divide-y divide-border">
            {route.account_ids.map((accountId, idx) => {
              const isCurrent = idx === currentStopIndex && !isStale;
              const isDone = idx < currentStopIndex;
              const color = resolveMarkerColor({
                kind: 'customer',
                isPending: !isDone,
              });
              const stop = stopCoordsQuery.data?.find((s) => s.id === accountId);
              return (
                <li
                  key={`${accountId}-${idx}`}
                  className={`flex items-start gap-3 p-3 ${
                    isCurrent ? 'bg-blue-50' : ''
                  }`}
                >
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: isDone ? '#16a34a' : color.hex }}
                    aria-label={color.label}
                  >
                    {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm font-medium">
                      {stop?.name ?? accountId.slice(0, 8)}
                    </div>
                    {stop?.address && (
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        <MapPin className="mr-0.5 inline h-3 w-3" />
                        {stop.address}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-[11px]">
                      <span className={isDone ? 'text-emerald-600' : isCurrent ? 'text-blue-600 font-semibold' : 'text-muted-foreground'}>
                        {isDone ? 'Tamamlandı' : isCurrent ? '● Şu anki' : 'Bekliyor'}
                      </span>
                      {stop?.phone && (
                        <a
                          href={`tel:${stop.phone}`}
                          className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Phone className="h-2.5 w-2.5" />
                          Ara
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setNotingStop(stop ?? { id: accountId, name: accountId, lat: 0, lng: 0 })}
                        className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 hover:bg-amber-200"
                      >
                        <StickyNote className="h-2.5 w-2.5" />
                        Not Yaz
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      {/* Action bar */}
      {!isStale && (
        <div className="grid grid-cols-1 gap-2 border-t border-border bg-card p-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={handleOpenGoogleMaps}
            disabled={currentStopIndex >= totalStops}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 h-11 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
          >
            <Navigation className="h-4 w-4" aria-hidden="true" />
            Sıradaki Durağa Git
          </button>
          <button
            type="button"
            onClick={handleAdvanceStop}
            disabled={currentStopIndex >= totalStops}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 h-11 text-sm font-semibold hover:bg-muted disabled:opacity-50"
          >
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            Durağı Tamamla
          </button>
          <button
            type="button"
            onClick={() => setShowFinishModal(true)}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 h-11 text-sm font-semibold text-white shadow hover:bg-emerald-700"
          >
            <Flag className="h-4 w-4" aria-hidden="true" />
            Rotayı Bitir
          </button>
        </div>
      )}

      {/* Yol üstü dinamik öneri */}
      {!isStale && (
        <div className="border-t border-border bg-amber-50 p-3">
          <button
            type="button"
            onClick={() => void fetchCorridor()}
            disabled={corridorLoading || currentStopIndex >= totalStops}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 h-10 text-sm font-semibold text-white shadow hover:bg-amber-700 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {corridorLoading ? 'Yol üstü klinikler aranıyor…' : 'Yol Üstü Klinik Öner'}
          </button>
          {corridorOpen && corridorCandidates.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {corridorCandidates.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="text-[11px] text-amber-700">
                      +{c.detourKm.toFixed(1)} km / +{Math.round(c.detourMin)} dk uzatma
                    </div>
                    {c.address && (
                      <div className="truncate text-[11px] text-slate-500">{c.address}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => addCandidateToBasket(c)}
                    className="shrink-0 rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-700"
                    aria-label="Sepete ekle"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Not yaz modal */}
      {notingStop && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => {
            if (!savingNote) {
              setNotingStop(null);
              setNoteText('');
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl bg-background p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{notingStop.name}</h3>
              <button
                type="button"
                onClick={() => {
                  setNotingStop(null);
                  setNoteText('');
                }}
                disabled={savingNote}
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {notingStop.address && (
              <p className="mb-2 text-xs text-muted-foreground">{notingStop.address}</p>
            )}
            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Ziyaret notu, görüşülen kişi, sonraki adım…"
              className="w-full rounded-lg border border-border bg-background p-2 text-sm"
              rows={5}
              disabled={savingNote}
            />
            <button
              type="button"
              disabled={savingNote || !noteText.trim()}
              onClick={async () => {
                if (!notingStop || !session?.userId) return;
                setSavingNote(true);
                try {
                  const supabase = getSupabaseClient();
                  const gpsLat = geolocation.position?.lat ?? null;
                  const gpsLng = geolocation.position?.lng ?? null;
                  const { error: insErr } = await supabase.from('saha_visits').insert({
                    account_id: notingStop.id,
                    rep_id: session.userId,
                    route_id: route?.id ?? null,
                    check_in_at: new Date().toISOString(),
                    check_in_lat: gpsLat,
                    check_in_lng: gpsLng,
                    status: 'completed',
                    notes: noteText.trim(),
                    custom_fields: {},
                  });
                  if (insErr) throw insErr;
                  toast.success('Not kaydedildi');
                  setNotingStop(null);
                  setNoteText('');
                } catch (e) {
                  toast.error('Not kaydedilemedi: ' + (e instanceof Error ? e.message : String(e)));
                } finally {
                  setSavingNote(false);
                }
              }}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {savingNote ? 'Kaydediliyor…' : 'Notu Kaydet'}
            </button>
          </div>
        </div>
      )}

      {/* Finish modal */}
      {showFinishModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="finish-route-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-background p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 id="finish-route-title" className="text-base font-semibold">
                Rotayı tamamla
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowFinishModal(false);
                  setFinishError(null);
                }}
                className="rounded p-1 hover:bg-muted"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <label className="block">
                <span className="mb-1 block font-medium">Gerçek mesafe (km)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.1"
                  value={actualKmInput}
                  onChange={(e) => setActualKmInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 h-10 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block font-medium">
                  Yakıt tüketimi (L) — opsiyonel
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={fuelLitersInput}
                  onChange={(e) => setFuelLitersInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 h-10 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block font-medium">
                  Yakıt maliyeti (TL) — opsiyonel
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={fuelCostInput}
                  onChange={(e) => setFuelCostInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 h-10 text-sm"
                />
              </label>

              {finishError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">
                  {finishError}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowFinishModal(false);
                  setFinishError(null);
                }}
                className="rounded-lg border border-border bg-background px-4 h-10 text-sm font-medium hover:bg-muted"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSubmitFinish}
                disabled={finishMutation.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 h-10 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {finishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                )}
                Onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
