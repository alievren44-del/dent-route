/**
 * RoutePlannerPage — Saha rep rota planlama ekranı.
 *
 * Sepet (zustand routeBasketStore) → Mapbox Optimize → twoOpt iyileştirme → saha_routes insert.
 *
 * NOT: Eski `?ids=` URL parametresi desteği kaldırıldı; sepet artık kalıcı
 * (localStorage) zustand store'da tutuluyor. Discovery sayfası doğrudan store'a yazıyor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Trash2, MapPin, Home, Play, Sparkles, Car, Footprints, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { usePermissions } from '@core/auth/usePermissions';
import { AssignRouteModal } from '@features/routes/components/AssignRouteModal';
import { AddressSearchInput } from '@features/routes/components/AddressSearchInput';
import type { GeocodeResult } from '@/lib/mapboxGeocode';

import { getTypedClient } from '@/lib/supabase';
import { getEnv } from '@config/env';
import { useGeolocation } from '@/features/map/hooks/useGeolocation';
import { useVertical } from '@core/verticals/useVertical';
import { resolveMarkerColor, type MarkerSubjectCustomer } from '@/features/map/marker-colors';
import { twoOpt, type Waypoint, haversineMeters } from '@/features/routes/two-opt';

/** Sıralı duraklar üstünden toplam haversine km (kuşbakışı baseline) */
function baselineSequenceKm(
  startLng: number,
  startLat: number,
  stops: Array<{ lat: number; lng: number }>,
): number {
  let total = 0;
  let prev: Waypoint = { lat: startLat, lng: startLng };
  for (const s of stops) {
    total += haversineMeters(prev, s);
    prev = s;
  }
  return total / 1000;
}
import { optimizeRouteHybrid } from '@/features/admin/lib/tsp';
import { MAX_BASKET, useRouteBasket } from '@/features/routes/store/routeBasketStore';
import { RouteExportPanel } from '@/features/routes/components/RouteExportPanel';

type RouteProfile = 'driving' | 'driving-traffic' | 'walking';

const PROFILE_STORAGE_KEY = 'route-profile-v1';
const WALKING_MAX_WAYPOINTS = 6;
const WALKING_AVG_KMH = 5;
// Mapbox Optimization API toplam 12 coord — start dahil. Klinik = 11 max.
const DRIVING_MAX_STOPS = 11;

interface BasketItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type?: string;
}

interface RouteResult {
  order: number[];
  /** Sepet sırası ile gidilseydi toplam km (kuşbakışı, geriye uyumluluk) */
  baselineKm: number;
  /** Sepet sırası ile Mapbox yol mesafesi (apples-to-apples kıyas için) — null ise haversine fallback */
  baselineRoadKm: number | null;
  /** Sepet sırası ile Mapbox yol süresi dk */
  baselineDurationMin: number | null;
  distanceM: number;
  durationS: number;
  geometry: string;
  twoOptSavedM: number;
}

function decodePolyline(str: string, precision = 5): Array<[number, number]> {
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

export default function RoutePlannerPage() {
  const navigate = useNavigate();
  const vertical = useVertical();
  const geolocation = useGeolocation();

  const basketItems = useRouteBasket((s) => s.items);
  // Method-selector'lar `@typescript-eslint/unbound-method` tetiklemesin diye
  // doğrudan store referansı üzerinden çağırıyoruz (store fonksiyonları stabil).
  const basketRemove = useCallback((id: string) => useRouteBasket.getState().remove(id), []);
  const basketClear = useCallback(() => useRouteBasket.getState().clear(), []);

  const basket = useMemo<BasketItem[]>(
    () =>
      basketItems.slice(0, MAX_BASKET).map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        type: s.customerType,
      })),
    [basketItems],
  );

  // #64: GPS reddedilirse tüm sayfa kullanılamaz hâle geliyordu. 'manual'
  // seçeneği AddressSearchInput ile geocode edilen bir başlangıç noktası verir.
  const [startPoint, setStartPoint] = useState<'gps' | 'manual'>('gps');
  const [manualStart, setManualStart] = useState<GeocodeResult | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const { isAdmin } = usePermissions();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Profil seçimi (localStorage persist)
  const [profile, setProfileState] = useState<RouteProfile>(() => {
    if (typeof window === 'undefined') return 'driving';
    const stored = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    return stored === 'driving' || stored === 'driving-traffic' || stored === 'walking'
      ? stored
      : 'driving';
  });
  const setProfile = useCallback((p: RouteProfile) => {
    setProfileState(p);
    try {
      window.localStorage.setItem(PROFILE_STORAGE_KEY, p);
    } catch {
      /* yutulur */
    }
    setRouteResult(null);
  }, []);

  // Sepet değişince eski optimize sonucu geçersiz olur
  useEffect(() => {
    setRouteResult(null);
  }, [basketItems]);

  useEffect(() => {
    if (startPoint === 'gps' && !geolocation.position) {
      geolocation.request();
    }
  }, [startPoint, geolocation]);

  // #64: GPS izni reddedildiyse otomatik 'manual' moduna geç ki kullanıcı
  // adres yazarak başlangıç noktası belirleyebilsin (sayfa kilitlenmesin).
  useEffect(() => {
    if (startPoint === 'gps' && geolocation.status === 'denied') {
      setStartPoint('manual');
    }
  }, [startPoint, geolocation.status]);

  const removeFromBasket = useCallback(
    (id: string) => {
      basketRemove(id);
      setRouteResult(null);
    },
    [basketRemove],
  );

  const startCoord = useMemo<[number, number] | null>(() => {
    if (startPoint === 'gps' && geolocation.position) {
      return [geolocation.position.lng, geolocation.position.lat];
    }
    // #64: manuel adres modunda geocode sonucu [lng, lat] başlangıç olur.
    if (startPoint === 'manual' && manualStart) {
      return [manualStart.lng, manualStart.lat];
    }
    return null;
  }, [startPoint, geolocation.position, manualStart]);

  const canOptimize = basket.length >= 1 && startCoord !== null && !optimizing;

  const handleOptimize = useCallback(async () => {
    if (!canOptimize || !startCoord) return;
    setOptimizing(true);
    setErrorMsg(null);
    try {
      // Yaya modu — local NN+2-opt, Mapbox YOK (sıfır ücret, kuşbakışı)
      if (profile === 'walking') {
        const trimmed = basket.slice(0, WALKING_MAX_WAYPOINTS);
        const startPt = { lat: startCoord[1], lng: startCoord[0] };
        const points = trimmed.map((b) => ({ lat: b.lat, lng: b.lng }));
        const baselineKm = baselineSequenceKm(startCoord[0], startCoord[1], points);
        const result = await optimizeRouteHybrid(points, startPt, { returnHome: false });

        const order = [0, ...result.order.map((i) => i + 1)];
        const distanceM = result.totalDistanceKm * 1000;
        const durationS = (result.totalDistanceKm / WALKING_AVG_KMH) * 3600;

        setRouteResult({
          order,
          baselineKm,
          baselineRoadKm: null,
          baselineDurationMin: null,
          distanceM,
          durationS,
          geometry: '',
          twoOptSavedM: result.savedKm * 1000,
        });
        return;
      }

      // Araç modu — Mapbox Optimize edge fn
      // Edge fn toplam 12 coord limit (start dahil) → klinik 11 max
      const drivingBasket = basket.slice(0, DRIVING_MAX_STOPS);
      const coordsForFn: Array<{ lat: number; lng: number }> = [
        { lat: startCoord[1], lng: startCoord[0] },
        ...drivingBasket.map((b) => ({ lat: b.lat, lng: b.lng })),
      ];
      // Lokal coords (tuple) — UI map drawing için
      const coords: Array<[number, number]> = [
        startCoord,
        ...drivingBasket.map((b) => [b.lng, b.lat] as [number, number]),
      ];

      const supabase = getTypedClient();
      const { data, error } = await supabase.functions.invoke('mapbox-optimize', {
        body: {
          coords: coordsForFn,
          profile,
          roundtrip: false,
          source: 'first',
          destination: 'last',
        },
      });

      if (error) throw new Error(error.message);
      // Edge fn döndürür: {status, order:number[], distanceM, durationS, geometry, legs}
      const resp = data as {
        status: string;
        order: number[];
        distanceM: number;
        durationS: number;
        geometry: string;
      };
      if (resp.status !== 'ok' || !Array.isArray(resp.order)) {
        throw new Error(`Mapbox: ${resp.status}`);
      }

      // Baseline (kuşbakışı, fallback)
      const baselineKm = baselineSequenceKm(
        startCoord[0],
        startCoord[1],
        drivingBasket.map((b) => ({ lat: b.lat, lng: b.lng })),
      );

      // Baseline (gerçek yol) — sepet sırasıyla Mapbox Directions çağır.
      // Best-effort: fail edersek haversine baseline ile devam et.
      let baselineRoadKm: number | null = null;
      let baselineDurationMin: number | null = null;
      try {
        const { data: baseData, error: baseErr } = await supabase.functions.invoke(
          'mapbox-directions',
          {
            body: { coords: coordsForFn, profile },
          },
        );
        if (!baseErr && baseData) {
          const baseResp = baseData as { status: string; distanceM?: number; durationS?: number };
          if (baseResp.status === 'ok') {
            baselineRoadKm = (baseResp.distanceM ?? 0) / 1000;
            baselineDurationMin = (baseResp.durationS ?? 0) / 60;
          }
        }
      } catch {
        // Yutulur — baselineRoadKm null kalır, UI haversine'e düşer
      }

      // Mapbox sırasına göre koord dizisi (start=0 dahil)
      const orderedCoords: Array<[number, number]> = resp.order.map((idx) => coords[idx]!);
      const waypointsForTwoOpt: Waypoint[] = orderedCoords.map(([lng, lat]) => ({ lat, lng }));
      const twoOptResult = twoOpt(waypointsForTwoOpt, {
        startFixed: true,
        endFixed: false,
      });

      const finalOrderInOriginal = twoOptResult.order.map((i) => resp.order[i]!);

      setRouteResult({
        order: finalOrderInOriginal,
        baselineKm,
        baselineRoadKm,
        baselineDurationMin,
        distanceM: resp.distanceM,
        durationS: resp.durationS,
        geometry: resp.geometry,
        twoOptSavedM: twoOptResult.savedM,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Optimize edilemedi';
      setErrorMsg(msg);
    } finally {
      setOptimizing(false);
    }
  }, [basket, canOptimize, startCoord, profile]);

  const handleStartRoute = useCallback(async () => {
    if (!routeResult) {
      toast.error('Önce "Rotayı optimize et" butonuna bas');
      return;
    }
    if (!startCoord) {
      toast.error('Başlangıç noktası yok (GPS izni?)');
      return;
    }
    setStarting(true);
    setErrorMsg(null);
    try {
      const supabase = getTypedClient();
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

      if (insertErr) {
        throw new Error(`${insertErr.code ?? ''} ${insertErr.message}`.trim());
      }
      if (!routeRow) throw new Error('Insert satırı dönmedi');
      const inserted = routeRow as { id: string };
      basketClear();
      navigate(`/routes/active/${inserted.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rota başlatılamadı';
      console.error('[handleStartRoute] fail:', err);
      setErrorMsg(msg);
      toast.error(`Rota başlatılamadı: ${msg}`);
    } finally {
      setStarting(false);
    }
  }, [routeResult, startCoord, basket, navigate, basketClear]);

  // Map setup
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [drawTrigger, setDrawTrigger] = useState(0);

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
    // Style HMR/transition durumlarında henüz hazır değilse 'idle' event'inde
    // tekrar render edilsin (drawTrigger state'i toggle).
    if (!map.isStyleLoaded()) {
      map.once('idle', () => setDrawTrigger((v) => v + 1));
      return;
    }

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    try {
      if (map.getLayer('route-line')) map.removeLayer('route-line');
      if (map.getSource('route-src')) map.removeSource('route-src');
    } catch {
      /* yutulur */
    }

    if (!routeResult || !startCoord) {
      // Just show basket markers
      basket.forEach((b, i) => {
        const subject: MarkerSubjectCustomer = {
          kind: 'customer',
          customerType: b.type,
        };
        const color = resolveMarkerColor(subject, vertical).hex;
        const el = buildNumberedMarker(i + 1, color);
        const marker = new mapboxgl.Marker({ element: el }).setLngLat([b.lng, b.lat]).addTo(map);
        markersRef.current.push(marker);
      });
      if (startCoord) {
        const el = buildStartMarker();
        const marker = new mapboxgl.Marker({ element: el }).setLngLat(startCoord).addTo(map);
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

    // Yaya modu polyline yok → sıralı duraklar üstünden düz çizgi LineString.
    // Araç modu Mapbox encoded polyline'ı decode edilir.
    let lineCoords: Array<[number, number]>;
    if (routeResult.geometry) {
      lineCoords = decodePolyline(routeResult.geometry);
    } else {
      lineCoords = [startCoord];
      for (const idx of routeResult.order) {
        if (idx === 0) continue;
        const stop = basket[idx - 1];
        if (stop) lineCoords.push([stop.lng, stop.lat]);
      }
    }
    try {
      map.addSource('route-src', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: lineCoords },
        },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-src',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': profile === 'walking' ? '#16a34a' : '#2563eb',
          'line-width': 5,
          'line-opacity': 0.85,
          ...(profile === 'walking' ? { 'line-dasharray': [2, 2] as unknown as number[] } : {}),
        },
      });
    } catch (e) {
      // Style not loaded race — idle event'inde retry tetiklenir
      console.warn('[map] addSource/Layer race, retry pending:', e);
      map.once('idle', () => setDrawTrigger((v) => v + 1));
      return;
    }

    // Start marker
    const startEl = buildStartMarker();
    const startMarker = new mapboxgl.Marker({ element: startEl }).setLngLat(startCoord).addTo(map);
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

    if (lineCoords.length > 0) {
      const bounds = new mapboxgl.LngLatBounds();
      lineCoords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    }
  }, [routeResult, startCoord, basket, mapReady, vertical, profile, drawTrigger]);

  const orderedStops = useMemo(() => {
    if (!routeResult) return [];
    return routeResult.order
      .filter((idx) => idx !== 0)
      .map((idx) => basket[idx - 1])
      .filter((x): x is BasketItem => x !== undefined);
  }, [routeResult, basket]);

  const distanceKm = routeResult ? (routeResult.distanceM / 1000).toFixed(1) : '0';
  const durationMin = routeResult ? Math.round(routeResult.durationS / 60) : 0;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-slate-50">
      <div className="mx-auto w-full max-w-2xl space-y-4 p-3 pb-24">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900">Rota Planlayıcı</h1>
          <span className="text-xs text-slate-500">
            {basket.length}/{MAX_BASKET} durak
          </span>
        </header>

        {/* Hızlı erişim — diğer rota modları */}
        <div className="grid grid-cols-3 gap-1.5">
          <Link
            to="/routes/auto"
            className="flex flex-col items-center justify-center rounded-lg border border-blue-200 bg-blue-50 p-2 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
          >
            <Sparkles size={16} />
            <span className="mt-0.5">İlçe Otomatik</span>
          </Link>
          <Link
            to="/routes/corridor"
            className="flex flex-col items-center justify-center rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] font-medium text-amber-700 hover:bg-amber-100"
          >
            <MapPin size={16} />
            <span className="mt-0.5">Yol Üstü</span>
          </Link>
          <Link
            to="/saha/tara"
            className="flex flex-col items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
          >
            <Home size={16} />
            <span className="mt-0.5">Saha Tarama</span>
          </Link>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMsg}
          </div>
        )}

        {/* 1. Sepet */}
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Sepet</h2>
          {basket.length === 0 ? (
            <div className="py-4 text-center text-sm text-slate-500">
              Rota sepeti boş —{' '}
              <Link to="/clinics/discover" className="font-medium text-blue-600 underline">
                Keşif sayfasına git
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
                    <span className="flex-1 truncate text-sm text-slate-800">{b.name}</span>
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

        {/* 2a. Rota modu (Araç / Trafik / Yaya) */}
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Rota modu</h2>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                { key: 'driving', label: 'Araç', Icon: Car },
                { key: 'driving-traffic', label: 'Trafik', Icon: Activity },
                { key: 'walking', label: 'Yaya', Icon: Footprints },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setProfile(key)}
                className={`flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition ${
                  profile === key
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          {profile === 'walking' && basket.length > WALKING_MAX_WAYPOINTS && (
            <p className="mt-2 text-xs text-amber-700">
              Yaya modunda en fazla {WALKING_MAX_WAYPOINTS} durak optimize edilir; sepetin{' '}
              {basket.length} klinikten ilk {WALKING_MAX_WAYPOINTS}'sı kullanılacak.
            </p>
          )}
          {profile !== 'walking' && basket.length > DRIVING_MAX_STOPS && (
            <p className="mt-2 text-xs text-amber-700">
              Araç modunda en fazla {DRIVING_MAX_STOPS} durak (Mapbox API limiti); sepetin{' '}
              {basket.length} klinikten ilk {DRIVING_MAX_STOPS}'i kullanılacak.
            </p>
          )}
          {profile === 'walking' && (
            <p className="mt-1 text-xs text-slate-500">
              Tahmini yürüyüş süresi {WALKING_AVG_KMH} km/sa ortalama hıza göre hesaplanır.
            </p>
          )}
        </section>

        {/* 2b. Başlangıç noktası */}
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Başlangıç noktası</h2>
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
                <span className="ml-auto text-xs text-slate-500">Aranıyor…</span>
              )}
              {geolocation.status === 'denied' && (
                <span className="ml-auto text-xs text-red-600">İzin yok</span>
              )}
              {geolocation.position && (
                <span className="ml-auto text-xs text-emerald-600">Hazır</span>
              )}
            </label>
            {/* #64: Manuel adres — GPS reddedildiğinde/yoksa fallback başlangıç. */}
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <input
                type="radio"
                name="startPoint"
                value="manual"
                checked={startPoint === 'manual'}
                onChange={() => setStartPoint('manual')}
                className="h-4 w-4"
              />
              <Home size={16} className="text-purple-600" />
              <span className="text-sm text-slate-800">Adres gir (manuel)</span>
              {startPoint === 'manual' && manualStart && (
                <span className="ml-auto text-xs text-emerald-600">Hazır</span>
              )}
            </label>
            {startPoint === 'manual' && (
              <div className="pl-1">
                <AddressSearchInput
                  placeholder="Başlangıç adresi veya klinik ara…"
                  value={manualStart}
                  onChange={setManualStart}
                  proximity={
                    geolocation.position
                      ? { lat: geolocation.position.lat, lng: geolocation.position.lng }
                      : undefined
                  }
                />
                {geolocation.status === 'denied' && (
                  <p className="mt-1 text-xs text-amber-700">
                    Konum izni reddedildi — başlangıç noktasını adres yazarak seç.
                  </p>
                )}
              </div>
            )}
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

        {/* #D: Başlangıç konumu eksikse kullanıcıya görünür yardım mesajı.
            Sepette en az 1 klinik var ama startCoord null → buton disabled ve kullanıcı neden
            bilmiyor. Basket boşken veya optimize edilirken bu blok görünmez. */}
        {basket.length >= 1 && startCoord === null && !optimizing && (
          <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800">Rota için başlangıç konumu gerekli</p>
            {startPoint === 'gps' && geolocation.status !== 'denied' && (
              <button
                type="button"
                onClick={() => {
                  geolocation.request();
                }}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-400 bg-white px-3 text-sm font-medium text-amber-900 hover:bg-amber-100"
              >
                <MapPin size={15} />
                Konumumu kullan (GPS)
              </button>
            )}
            {startPoint === 'gps' && geolocation.status === 'denied' && (
              <p className="text-xs text-amber-700">
                GPS izni reddedildi — "Adres gir (manuel)" seçeneğini kullanabilirsin.
              </p>
            )}
            {startPoint === 'manual' && (
              <p className="text-xs text-amber-700">
                Başlangıç adresi seç veya yukarıdaki arama kutusuna adres yaz.
              </p>
            )}
          </div>
        )}

        {/* 4. Sonuç özeti */}
        {routeResult && (
          <section className="rounded-xl bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Sonuç</h2>
              {profile === 'walking' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <Footprints size={11} /> Yürüyüş — kuşbakışı tahmin
                </span>
              )}
              {profile === 'driving-traffic' && (
                <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                  Canlı trafikli
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-xs text-slate-500">Mesafe</div>
                <div className="text-base font-bold text-slate-900">{distanceKm} km</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">
                  {profile === 'walking' ? 'Yürüyüş süresi' : 'Süre'}
                </div>
                <div className="text-base font-bold text-slate-900">{durationMin} dk</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">
                  {profile === 'walking' ? 'NN+2-opt' : '2-opt'}
                </div>
                <div className="text-base font-bold text-emerald-600">
                  -{Math.round(routeResult.twoOptSavedM)} m
                </div>
              </div>
            </div>

            {/* Baseline kıyas — apples-to-apples (gerçek yol vs gerçek yol) */}
            {(() => {
              const optimizedKm = routeResult.distanceM / 1000;
              const optimizedMin = routeResult.durationS / 60;
              // Araç modunda baselineRoadKm yoksa anlamlı kıyas yok — gizle.
              const useRoad =
                profile !== 'walking' &&
                routeResult.baselineRoadKm !== null &&
                routeResult.baselineRoadKm > 0;
              const baselineKm = useRoad ? routeResult.baselineRoadKm! : routeResult.baselineKm;
              const baselineMin = useRoad ? (routeResult.baselineDurationMin ?? 0) : 0;
              const savedKm = Math.max(0, baselineKm - optimizedKm);
              const savedMin = useRoad ? Math.max(0, baselineMin - optimizedMin) : 0;
              const pct = baselineKm > 0 ? (savedKm / baselineKm) * 100 : 0;
              return (
                <div className="mt-3 rounded-lg bg-slate-50 p-2 text-xs">
                  <div className="mb-1 font-semibold text-slate-700">
                    Tasarruf kıyası {useRoad ? '(gerçek yol)' : '(kuşbakışı)'}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-slate-500">Sepet sırası</div>
                      <div className="font-bold text-slate-700">{baselineKm.toFixed(1)} km</div>
                      {useRoad && (
                        <div className="text-[10px] text-slate-500">
                          {Math.round(baselineMin)} dk
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-slate-500">Optimize</div>
                      <div className="font-bold text-blue-700">{optimizedKm.toFixed(1)} km</div>
                      {useRoad && (
                        <div className="text-[10px] text-slate-500">
                          {Math.round(optimizedMin)} dk
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-slate-500">Tasarruf</div>
                      <div className="font-bold text-emerald-700">
                        {savedKm.toFixed(1)} km (%{pct.toFixed(0)})
                      </div>
                      {useRoad && savedMin > 0 && (
                        <div className="text-[10px] font-medium text-emerald-700">
                          -{Math.round(savedMin)} dk
                        </div>
                      )}
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] text-slate-500">
                    {profile === 'walking'
                      ? 'Yaya: kuşbakışı haversine. Mapbox API çağrısı yok.'
                      : useRoad
                        ? 'İki rota da Mapbox yol mesafesi — adil karşılaştırma.'
                        : 'Baseline yol mesafesi alınamadı; haversine kuşbakışı gösteriliyor.'}
                  </p>
                </div>
              );
            })()}
          </section>
        )}

        {/* 5. Sıralı duraklar */}
        {routeResult && orderedStops.length > 0 && (
          <section className="rounded-xl bg-white p-3 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Sıralı duraklar</h2>
            <ol className="space-y-2">
              <li className="flex items-center gap-2 rounded-lg bg-purple-50 px-3 py-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                  ★
                </span>
                <span className="text-sm font-medium text-slate-800">Başlangıç (GPS)</span>
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
                    <span className="flex-1 truncate text-sm text-slate-800">{s.name}</span>
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
          <div ref={containerRef} className="h-72 w-full" aria-label="Rota haritası" />
        </section>

        {/* 7. Dışa aktar (Google Maps / QR / Paylaş / Kopyala) */}
        {routeResult && startCoord && orderedStops.length > 0 && (
          <RouteExportPanel
            start={{ lat: startCoord[1], lng: startCoord[0] }}
            stops={orderedStops.map((s) => ({
              lat: s.lat,
              lng: s.lng,
              name: s.name,
            }))}
          />
        )}

        {/* 8. Başlat + (admin için) Plasiyere Ata */}
        {routeResult && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                void handleStartRoute();
              }}
              disabled={starting}
              className="flex min-h-tap-min h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 disabled:opacity-50"
            >
              <Play size={18} />
              {starting ? 'Başlatılıyor…' : 'Kendim Başlat'}
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setAssignOpen(true)}
                disabled={starting}
                className="flex min-h-tap-min h-12 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-purple-700 disabled:opacity-50"
              >
                <Play size={18} />
                Plasiyere Ata
              </button>
            )}
          </div>
        )}
      </div>

      {/* Assign modal */}
      {routeResult && (
        <AssignRouteModal
          open={assignOpen}
          onClose={() => setAssignOpen(false)}
          payload={{
            account_ids: (() => {
              const ids: string[] = [];
              for (const idx of routeResult.order) {
                if (idx === 0) continue;
                const stop = basket[idx - 1];
                if (stop) ids.push(stop.id);
              }
              return ids;
            })(),
            total_distance_km: Number((routeResult.distanceM / 1000).toFixed(2)),
            total_duration_min: Math.round(routeResult.durationS / 60),
          }}
        />
      )}
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
