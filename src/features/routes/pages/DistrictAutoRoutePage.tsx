/**
 * DistrictAutoRoutePage — İlçe seç → kullanıcı konumundan başlayan NN-TSP rota.
 *
 * Strateji:
 *   N ≤ 12  → Mapbox Optimize edge fn (driving) + 2-opt
 *   12 < N ≤ 30 → local optimizeRouteHybrid (Mapbox YOK, kuşbakışı)
 *   N > 30  → start'a en yakın 12 (uyarı)
 *
 * "Sepete aktar" → useRouteBasket.add() → /routes/plan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Sparkles,
  MapPin,
  Loader2,
  AlertCircle,
  ShoppingCart,
  Footprints,
  Car,
  Activity,
} from 'lucide-react';
import { toast } from 'sonner';

import { getEnv } from '@config/env';
import { getTypedClient } from '@lib/supabase';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import { optimizeRouteHybrid } from '@features/admin/lib/tsp';
import { decodePolyline } from '@/lib/polyline';
import { DistrictPicker } from '@features/routes/components/DistrictPicker';
import { useRouteBasket, MAX_BASKET } from '@features/routes/store/routeBasketStore';
import { getProvince } from '@/data/tr-locations/geo-helpers';

// Mapbox Optimization API toplam 12 coord — start dahil. Klinik = 11 max.
// N > 11 olunca local NN+2-opt'a düş (haversine, hepsini dahil eder).
const MAPBOX_MAX = 11;

type RouteProfile = 'driving' | 'driving-traffic' | 'walking';

interface ClinicRow {
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
  clinic_segment: 'private' | 'kamu';
}

interface RouteState {
  ordered: ClinicRow[];
  cumulativeKm: number[];
  totalKm: number;
  durationMin: number;
  method: 'mapbox' | 'local-nn-2opt';
  geometryEncoded?: string;
  truncated: boolean;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function DistrictAutoRoutePage() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const geo = useGeolocation();

  const [provinceSlug, setProvinceSlug] = useState(params.province ?? search.get('province') ?? '');
  const [districtSlug, setDistrictSlug] = useState(params.district ?? search.get('district') ?? '');
  const [profile, setProfile] = useState<RouteProfile>('driving');

  const [clinics, setClinics] = useState<ClinicRow[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(false);
  const [routeState, setRouteState] = useState<RouteState | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (geo.status === 'idle') geo.request();
  }, [geo]);

  // İlçe değişince klinikleri yükle
  useEffect(() => {
    if (!provinceSlug || !districtSlug) {
      setClinics([]);
      setRouteState(null);
      return;
    }
    void (async () => {
      setLoadingClinics(true);
      setErr(null);
      try {
        const supabase = getTypedClient();
        const { data, error } = await supabase.rpc('saha_clinics_by_district', {
          _province_slug: provinceSlug,
          _district_slug: districtSlug,
          _vertical_key: 'dental',
          _limit: 200,
        });
        if (error) throw error;
        setClinics((data ?? []) as ClinicRow[]);
        setRouteState(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Klinik listesi alınamadı');
      } finally {
        setLoadingClinics(false);
      }
    })();
  }, [provinceSlug, districtSlug]);

  const start = useMemo(() => {
    if (geo.position) return { lat: geo.position.lat, lng: geo.position.lng };
    return null;
  }, [geo.position]);

  const handleOptimize = useCallback(async () => {
    if (!start || clinics.length === 0) return;
    setOptimizing(true);
    setErr(null);
    try {
      // Hepsi dahil — N > MAPBOX_MAX olursa local NN+2-opt yapılacak.
      const toOptimize: ClinicRow[] = clinics;
      const truncated = false;

      // Yaya modu veya N > 12 → local
      if (profile === 'walking' || toOptimize.length > MAPBOX_MAX) {
        const points = toOptimize.map((c) => ({ lat: c.lat, lng: c.lng }));
        const r = await optimizeRouteHybrid(points, start, { returnHome: false });
        const ordered: ClinicRow[] = [];
        for (const i of r.order) {
          const c = toOptimize[i];
          if (!c) throw new Error(`Geçersiz rota index: ${i}/${toOptimize.length}`);
          ordered.push(c);
        }
        const avgKmh = profile === 'walking' ? 5 : 30;
        const durationMin = (r.totalDistanceKm / avgKmh) * 60;
        setRouteState({
          ordered,
          cumulativeKm: r.cumulativeDistancesKm,
          totalKm: r.totalDistanceKm,
          durationMin,
          method: 'local-nn-2opt',
          truncated,
        });
        return;
      }

      // N ≤ 12 → Mapbox Optimize
      const coordsForFn: Array<{ lat: number; lng: number }> = [
        { lat: start.lat, lng: start.lng },
        ...toOptimize.map((c) => ({ lat: c.lat, lng: c.lng })),
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
      // Edge fn: {status, order:number[], distanceM, durationS, geometry}
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

      const ordered: ClinicRow[] = [];
      const cumulative: number[] = [];
      let running = 0;
      let prev = start;
      for (const idx of resp.order) {
        if (idx === 0) continue; // start
        const c = toOptimize[idx - 1];
        if (!c) throw new Error(`Mapbox order range hata: ${idx}/${toOptimize.length}`);
        ordered.push(c);
        running += haversineKm(prev, c);
        cumulative.push(running);
        prev = c;
      }
      setRouteState({
        ordered,
        cumulativeKm: cumulative,
        totalKm: resp.distanceM / 1000,
        durationMin: resp.durationS / 60,
        method: 'mapbox',
        geometryEncoded: resp.geometry,
        truncated,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Optimize hatası');
    } finally {
      setOptimizing(false);
    }
  }, [start, clinics, profile]);

  const sendToBasket = useCallback(() => {
    if (!routeState) return;
    const basket = useRouteBasket.getState();
    // TÜM sıralı klinikleri kuyruğa al (12+ dahil) — fazlası kaybolmasın,
    // sonraki batch'lerde devralınsın.
    basket.setDistrictQueue(
      routeState.ordered.map((c) => ({
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        source: 'saha' as const,
        customerType: c.clinic_segment,
        address: c.address ?? undefined,
        phone: c.phone ?? undefined,
      })),
    );
    // İlk batch'i seed et: sepeti temizleyip ilk MAX_BASKET kliniği doldur.
    basket.clear();
    basket.loadNextDistrictBatch();
    const seeded = Math.min(routeState.ordered.length, MAX_BASKET);
    const remaining = Math.max(0, routeState.ordered.length - MAX_BASKET);
    toast.success(
      remaining > 0
        ? `${seeded} klinik sepete eklendi (${remaining} klinik sonraki gruplarda)`
        : `${seeded} klinik sepete eklendi`,
    );
    navigate('/routes/plan');
  }, [routeState, navigate]);

  // Map
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  useEffect(() => {
    if (!containerRef.current) return;
    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;
    const m = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [35.2, 39.0],
      zoom: 5,
    });
    mapRef.current = m;
    return () => {
      markersRef.current.forEach((x) => x.remove());
      markersRef.current = [];
      m.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !routeState) return;
    markersRef.current.forEach((x) => x.remove());
    markersRef.current = [];
    if (m.getLayer('route-line')) m.removeLayer('route-line');
    if (m.getSource('route-src')) m.removeSource('route-src');

    let lineCoords: Array<[number, number]>;
    if (routeState.geometryEncoded) {
      lineCoords = decodePolyline(routeState.geometryEncoded);
    } else if (start) {
      lineCoords = [
        [start.lng, start.lat],
        ...routeState.ordered.map((c) => [c.lng, c.lat] as [number, number]),
      ];
    } else {
      lineCoords = routeState.ordered.map((c) => [c.lng, c.lat] as [number, number]);
    }
    m.addSource('route-src', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: lineCoords },
      },
    });
    m.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route-src',
      paint: {
        'line-color': profile === 'walking' ? '#16a34a' : '#2563eb',
        'line-width': 4,
      },
    });

    if (start) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:14px;height:14px;border-radius:50%;background:#a855f7;border:3px solid white;box-shadow:0 0 0 2px #a855f7;';
      const sm = new mapboxgl.Marker({ element: el }).setLngLat([start.lng, start.lat]).addTo(m);
      markersRef.current.push(sm);
    }
    routeState.ordered.forEach((c, i) => {
      const el = document.createElement('div');
      el.style.cssText =
        'width:24px;height:24px;border-radius:50%;background:#2563eb;color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid white;';
      el.textContent = String(i + 1);
      const mark = new mapboxgl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(m);
      markersRef.current.push(mark);
    });

    const bounds = new mapboxgl.LngLatBounds();
    lineCoords.forEach((c) => bounds.extend(c));
    if (start) bounds.extend([start.lng, start.lat]);
    m.fitBounds(bounds, { padding: 60, maxZoom: 13 });
  }, [routeState, start, profile]);

  const provReadable = useMemo(() => {
    if (!provinceSlug) return '';
    return getProvince(provinceSlug)?.ad ?? provinceSlug;
  }, [provinceSlug]);

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header>
        <h1 className="text-2xl font-semibold">İlçe Otomatik Rota</h1>
        <p className="text-sm text-slate-600">
          İl + ilçe seç → konumundan başlayıp tasarruflu rota üret.
        </p>
      </header>

      <section className="rounded-xl bg-white p-3 shadow-sm">
        <DistrictPicker
          provinceSlug={provinceSlug}
          districtSlug={districtSlug}
          onChange={(p, d) => {
            setProvinceSlug(p);
            setDistrictSlug(d);
            setSearch({ province: p, district: d });
          }}
        />
      </section>

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
      </section>

      {loadingClinics ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 size={14} className="animate-spin" /> Klinikler yükleniyor…
        </div>
      ) : provinceSlug && districtSlug ? (
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                {provReadable} / {districtSlug}
              </h2>
              <p className="text-xs text-slate-500">{clinics.length} aktif klinik</p>
            </div>
            <button
              type="button"
              onClick={() => void handleOptimize()}
              disabled={!start || optimizing || clinics.length === 0}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
            >
              <Sparkles size={16} />
              {optimizing ? 'Hesaplanıyor…' : 'Rotayı oluştur'}
            </button>
          </div>
          {clinics.length > MAPBOX_MAX && (
            <p className="text-xs text-slate-500">
              ℹ {clinics.length} klinik — Mapbox limiti {MAPBOX_MAX} üstü. Hepsi local NN+2-opt ile
              rotalanır (kuşbakışı km, polyline yok).
            </p>
          )}
        </section>
      ) : (
        <p className="text-sm text-slate-500">Başlamak için il + ilçe seç.</p>
      )}

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle size={16} className="shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{err}</p>
        </div>
      )}

      <section
        ref={containerRef}
        className="h-[400px] w-full overflow-hidden rounded-xl border border-slate-200"
      />

      {routeState && (
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Rota sonucu</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
              {routeState.method === 'mapbox' ? 'Mapbox' : 'NN+2-opt (kuşbakışı)'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-slate-500">Durak</div>
              <div className="text-base font-bold">{routeState.ordered.length}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Mesafe</div>
              <div className="text-base font-bold">{routeState.totalKm.toFixed(1)} km</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Süre</div>
              <div className="text-base font-bold">{Math.round(routeState.durationMin)} dk</div>
            </div>
          </div>
          <button
            type="button"
            onClick={sendToBasket}
            className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white shadow-md hover:bg-emerald-700"
          >
            <ShoppingCart size={16} />
            Sepete aktar + Rota planlayıcıya geç (ilk{' '}
            {Math.min(routeState.ordered.length, MAX_BASKET)})
          </button>
          <ol className="mt-3 space-y-1.5">
            {routeState.ordered.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-sm"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {routeState.cumulativeKm[i]?.toFixed(1) ?? '?'} km kümülatif
                    {c.phone && <span className="ml-2">📞 {c.phone}</span>}
                  </div>
                </div>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] ${
                    c.clinic_segment === 'kamu'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {c.clinic_segment === 'kamu' ? 'KAMU' : 'Özel'}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!start && geo.status !== 'prompting' && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <MapPin size={16} />
          Rota için konum izni gerekli.
          <button
            type="button"
            onClick={geo.request}
            className="ml-auto rounded bg-amber-600 px-2 py-1 text-xs font-medium text-white"
          >
            Konumumu al
          </button>
        </div>
      )}
    </div>
  );
}
