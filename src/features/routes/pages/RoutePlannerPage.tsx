/**
 * RoutePlannerPage — Saha rep rota planlama ekranı.
 *
 * Sepet (URL ?ids=) → Mapbox Optimize → twoOpt iyileştirme → saha_routes insert.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Trash2, MapPin, Home, Play, Sparkles } from 'lucide-react';

import { getSupabaseClient } from '@/lib/supabase';
import { getEnv } from '@config/env';
import { useGeolocation } from '@/features/map/hooks/useGeolocation';
import { useVertical } from '@core/verticals/useVertical';
import {
  resolveMarkerColor,
  type MarkerSubjectCustomer,
} from '@/features/map/marker-colors';
import { twoOpt, type Waypoint } from '@/features/routes/two-opt';

const MAX_BASKET = 12;

interface BasketItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type?: string;
}

interface RouteResult {
  order: number[];
  distanceM: number;
  durationS: number;
  geometry: string;
  twoOptSavedM: number;
}

interface AccountAddressRow {
  location: { type: 'Point'; coordinates: [number, number] } | null;
  is_primary: boolean;
}

interface AccountRow {
  id: string;
  name: string;
  type: string | null;
  account_addresses: AccountAddressRow[];
}

interface MapboxOptimizeResponse {
  code?: string;
  trips?: Array<{
    geometry: string;
    distance: number;
    duration: number;
  }>;
  waypoints?: Array<{
    waypoint_index: number;
    trips_index: number;
    location: [number, number];
  }>;
}

function decodePolyline(
  str: string,
  precision = 5,
): Array<[number, number]> {
  const factor = Math.pow(10, precision);
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coords: Array<[number, number]> = [];
  while (index < str.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}

async function fetchBasketAccounts(ids: string[]): Promise<BasketItem[]> {
  if (ids.length === 0) return [];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, type, account_addresses!inner(location, is_primary)')
    .in('id', ids);
  if (error || !data) return [];
  const rows = data as unknown as AccountRow[];
  return rows
    .map((row): BasketItem | null => {
      const addrs = row.account_addresses ?? [];
      const addr = addrs.find((a) => a.is_primary) ?? addrs[0];
      if (!addr?.location?.coordinates) return null;
      const [lng, lat] = addr.location.coordinates;
      return {
        id: row.id,
        name: row.name,
        type: row.type ?? undefined,
        lat,
        lng,
      };
    })
    .filter((x): x is BasketItem => x !== null);
}

export default function RoutePlannerPage() {
  const navigate = useNavigate();
  const vertical = useVertical();
  const geolocation = useGeolocation();
  const [searchParams] = useSearchParams();

  const idsParam = searchParams.get('ids') ?? '';
  const ids = useMemo(
    () => idsParam.split(',').map((s) => s.trim()).filter(Boolean),
    [idsParam],
  );

  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [startPoint, setStartPoint] = useState<'gps' | 'home'>('gps');
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const basketQuery = useQuery({
    queryKey: ['basket', ids],
    queryFn: () => fetchBasketAccounts(ids),
    enabled: ids.length > 0,
  });

  useEffect(() => {
    if (basketQuery.data) {
      setBasket(basketQuery.data.slice(0, MAX_BASKET));
    }
  }, [basketQuery.data]);

  useEffect(() => {
    if (startPoint === 'gps' && !geolocation.position) {
      geolocation.request();
    }
  }, [startPoint, geolocation]);

  const removeFromBasket = useCallback((id: string) => {
    setBasket((prev) => prev.filter((b) => b.id !== id));
    setRouteResult(null);
  }, []);

  const startCoord = useMemo<[number, number] | null>(() => {
    if (startPoint === 'gps' && geolocation.position) {
      return [geolocation.position.lng, geolocation.position.lat];
    }
    return null;
  }, [startPoint, geolocation.position]);

  const canOptimize = basket.length >= 2 && startCoord !== null && !optimizing;

  const handleOptimize = useCallback(async () => {
    if (!canOptimize || !startCoord) return;
    setOptimizing(true);
    setErrorMsg(null);
    try {
      const coords: Array<[number, number]> = [
        startCoord,
        ...basket.map((b) => [b.lng, b.lat] as [number, number]),
      ];

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke(
        'mapbox-optimize',
        {
          body: {
            coords,
            profile: 'driving',
            roundtrip: false,
            source: 'first',
            destination: 'last',
          },
        },
      );

      if (error) throw new Error(error.message);
      const resp = data as MapboxOptimizeResponse;
      if (resp.code && resp.code !== 'Ok') {
        throw new Error(`Mapbox: ${resp.code}`);
      }
      const trip = resp.trips?.[0];
      const waypoints = resp.waypoints;
      if (!trip || !waypoints) throw new Error('Mapbox geçersiz yanıt');

      const mapboxOrder = waypoints
        .slice()
        .sort((a, b) => a.waypoint_index - b.waypoint_index)
        .map((w) =>
          waypoints.findIndex((src) => src.waypoint_index === w.waypoint_index),
        );

      const orderedCoords: Array<[number, number]> = waypoints
        .slice()
        .sort((a, b) => a.waypoint_index - b.waypoint_index)
        .map((w) => {
          const inputIdx = waypoints.indexOf(w);
          return coords[inputIdx]!;
        });

      const waypointsForTwoOpt: Waypoint[] = orderedCoords.map(
        ([lng, lat]) => ({ lat, lng }),
      );
      const twoOptResult = twoOpt(waypointsForTwoOpt, {
        startFixed: true,
        endFixed: false,
      });

      const finalOrderInOriginal = twoOptResult.order.map(
        (idx) => mapboxOrder[idx]!,
      );

      setRouteResult({
        order: finalOrderInOriginal,
        distanceM: trip.distance,
        durationS: trip.duration,
        geometry: trip.geometry,
        twoOptSavedM: twoOptResult.savedM,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Optimize edilemedi';
      setErrorMsg(msg);
    } finally {
      setOptimizing(false);
    }
  }, [basket, canOptimize, startCoord]);

  const handleStartRoute = useCallback(async () => {
    if (!routeResult || !startCoord) return;
    setStarting(true);
    setErrorMsg(null);
    try {
      const supabase = getSupabaseClient();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error('Oturum yok');

      // saha_routes şeması: account_ids text[] (start hariç, optimize sıralı klinik ID dizisi).
      // Mapbox'tan dönen order ilk index = start, geri kalanı basket sırasına göre.
      const orderedAccountIds: string[] = [];
      for (const idx of routeResult.order) {
        if (idx === 0) continue; // start point — DB'ye yazılmaz
        const stop = basket[idx - 1];
        if (stop) orderedAccountIds.push(stop.id);
      }

      const insertRow = {
        profile_id: userData.user.id,
        status: 'active' as const,
        account_ids: orderedAccountIds,
        optimized: true,
        total_distance_km: Number((routeResult.distanceM / 1000).toFixed(2)),
        total_duration_min: Math.round(routeResult.durationS / 60),
        started_at: new Date().toISOString(),
      };

      const { data: routeRow, error: insertErr } = await supabase
        .from('saha_routes')
        .insert(insertRow)
        .select('id')
        .single();

      if (insertErr || !routeRow) throw new Error(insertErr?.message ?? 'Insert hatası');
      const inserted = routeRow as { id: string };
      navigate(`/routes/active/${inserted.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rota başlatılamadı';
      setErrorMsg(msg);
    } finally {
      setStarting(false);
    }
  }, [routeResult, startCoord, basket, navigate]);

  // Map setup
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [35.2, 39.0],
      zoom: 5,
    });
    map.on('load', () => setMapReady(true));
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Draw route + markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (map.getLayer('route-line')) map.removeLayer('route-line');
    if (map.getSource('route-src')) map.removeSource('route-src');

    if (!routeResult || !startCoord) {
      // Just show basket markers
      basket.forEach((b, i) => {
        const subject: MarkerSubjectCustomer = {
          kind: 'customer',
          customerType: b.type,
        };
        const color = resolveMarkerColor(subject, vertical).hex;
        const el = buildNumberedMarker(i + 1, color);
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([b.lng, b.lat])
          .addTo(map);
        markersRef.current.push(marker);
      });
      if (startCoord) {
        const el = buildStartMarker();
        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat(startCoord)
          .addTo(map);
        markersRef.current.push(marker);
      }
      if (basket.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        basket.forEach((b) => bounds.extend([b.lng, b.lat]));
        if (startCoord) bounds.extend(startCoord);
        map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
      }
      return;
    }

    const decoded = decodePolyline(routeResult.geometry);
    map.addSource('route-src', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: decoded,
        },
      },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': '#2563eb',
        'line-width': 5,
        'line-opacity': 0.85,
      },
    });

    // Start marker
    const startEl = buildStartMarker();
    const startMarker = new mapboxgl.Marker({ element: startEl })
      .setLngLat(startCoord)
      .addTo(map);
    markersRef.current.push(startMarker);

    // Stop markers in order
    let stopNumber = 0;
    routeResult.order.forEach((idx) => {
      if (idx === 0) return;
      stopNumber++;
      const stop = basket[idx - 1];
      if (!stop) return;
      const subject: MarkerSubjectCustomer = {
        kind: 'customer',
        customerType: stop.type,
      };
      const color = resolveMarkerColor(subject, vertical).hex;
      const el = buildNumberedMarker(stopNumber, color);
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([stop.lng, stop.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });

    if (decoded.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      decoded.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [routeResult, startCoord, basket, mapReady, vertical]);

  const orderedStops = useMemo(() => {
    if (!routeResult) return [];
    return routeResult.order
      .filter((idx) => idx !== 0)
      .map((idx) => basket[idx - 1])
      .filter((x): x is BasketItem => x !== undefined);
  }, [routeResult, basket]);

  const distanceKm = routeResult
    ? (routeResult.distanceM / 1000).toFixed(1)
    : '0';
  const durationMin = routeResult
    ? Math.round(routeResult.durationS / 60)
    : 0;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-slate-50">
      <div className="mx-auto w-full max-w-2xl space-y-4 p-3 pb-24">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">Rota Planlayıcı</h1>
          <span className="text-xs text-slate-500">
            {basket.length}/{MAX_BASKET} durak
          </span>
        </header>

        {errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* 1. Sepet */}
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Sepet</h2>
          {basketQuery.isLoading ? (
            <div className="py-4 text-center text-sm text-slate-500">
              Yükleniyor…
            </div>
          ) : basket.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-500">
              Sepet boş —{' '}
              <Link
                to="/clinics/discover"
                className="font-medium text-blue-600 underline"
              >
                keşif sayfasından klinik ekle
              </Link>
            </div>
          ) : (
            <ul className="space-y-2">
              {basket.map((b, i) => {
                const color = resolveMarkerColor(
                  { kind: 'customer', customerType: b.type },
                  vertical,
                ).hex;
                return (
                  <li
                    key={b.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-sm text-slate-800">
                      {b.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFromBasket(b.id)}
                      className="flex h-9 min-w-tap-min items-center gap-1 rounded-md px-2 text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                      Kaldır
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 2. Başlangıç noktası */}
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Başlangıç noktası
          </h2>
          <div className="space-y-2">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <input
                type="radio"
                name="startPoint"
                value="gps"
                checked={startPoint === 'gps'}
                onChange={() => setStartPoint('gps')}
                className="h-4 w-4"
              />
              <MapPin size={16} className="text-blue-600" />
              <span className="text-sm text-slate-800">Konumum (GPS)</span>
              {geolocation.status === 'prompting' && (
                <span className="ml-auto text-xs text-slate-500">
                  Aranıyor…
                </span>
              )}
              {geolocation.status === 'denied' && (
                <span className="ml-auto text-xs text-red-600">İzin yok</span>
              )}
              {geolocation.position && (
                <span className="ml-auto text-xs text-emerald-600">Hazır</span>
              )}
            </label>
            <label className="flex cursor-not-allowed items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 opacity-50">
              <input
                type="radio"
                name="startPoint"
                value="home"
                disabled
                checked={false}
                onChange={() => undefined}
                className="h-4 w-4"
              />
              <Home size={16} className="text-purple-600" />
              <span className="text-sm text-slate-800">
                Ev/Ofis (yakında)
              </span>
            </label>
          </div>
        </section>

        {/* 3. Optimize */}
        <button
          type="button"
          onClick={() => {
            void handleOptimize();
          }}
          disabled={!canOptimize}
          className="flex min-h-tap-min h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
        >
          <Sparkles size={18} />
          {optimizing ? 'Optimize ediliyor…' : 'Rotayı optimize et'}
        </button>

        {/* 4. Sonuç özeti */}
        {routeResult && (
          <section className="rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">
              Sonuç
            </h2>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs text-slate-500">Mesafe</div>
                <div className="text-base font-bold text-slate-900">
                  {distanceKm} km
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Süre</div>
                <div className="text-base font-bold text-slate-900">
                  {durationMin} dk
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">2-opt</div>
                <div className="text-base font-bold text-emerald-600">
                  -{Math.round(routeResult.twoOptSavedM)} m
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 5. Sıralı duraklar */}
        {routeResult && orderedStops.length > 0 && (
          <section className="rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">
              Sıralı duraklar
            </h2>
            <ol className="space-y-2">
              <li className="flex items-center gap-2 rounded-lg bg-purple-50 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                  ★
                </span>
                <span className="text-sm font-medium text-slate-800">
                  Başlangıç (GPS)
                </span>
              </li>
              {orderedStops.map((s, i) => {
                const color = resolveMarkerColor(
                  { kind: 'customer', customerType: s.type },
                  vertical,
                ).hex;
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-sm text-slate-800">
                      {s.name}
                    </span>
                    <span
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                      aria-hidden
                    />
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* 6. Harita */}
        <section className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div
            ref={containerRef}
            className="h-72 w-full"
            aria-label="Rota haritası"
          />
        </section>

        {/* 7. Başlat */}
        {routeResult && (
          <button
            type="button"
            onClick={() => {
              void handleStartRoute();
            }}
            disabled={starting}
            className="flex min-h-tap-min h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 disabled:opacity-50"
          >
            <Play size={18} />
            {starting ? 'Başlatılıyor…' : 'Rotayı başlat'}
          </button>
        )}
      </div>
    </div>
  );
}

function buildNumberedMarker(num: number, color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '28px';
  el.style.height = '28px';
  el.style.borderRadius = '50%';
  el.style.backgroundColor = color;
  el.style.color = '#fff';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.fontSize = '12px';
  el.style.fontWeight = '700';
  el.style.border = '2px solid #fff';
  el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
  el.textContent = String(num);
  return el;
}

function buildStartMarker(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.width = '32px';
  el.style.height = '32px';
  el.style.borderRadius = '50%';
  el.style.backgroundColor = '#a855f7';
  el.style.color = '#fff';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.fontSize = '16px';
  el.style.border = '2px solid #fff';
  el.style.boxShadow = '0 1px 4px rgba(0,0,0,0.35)';
  el.textContent = '★';
  return el;
}
