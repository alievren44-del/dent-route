/**
 * CorridorRoutePage — A→B yol-üstü klinik önerileri.
 *
 * Akış:
 *   1. A = GPS (default) veya search/harita-tıklama; B = search/harita-tıklama
 *   2. mapbox-directions invoke → polyline + baseline {distanceM, durationS}
 *   3. polyline → GeoJSON LineString → saha_clinics_near_polyline RPC (buffer=2km)
 *   4. Her aday için naive detour (haversine) hesapla
 *   5. Filtre: detour ≤ 7km veya ≤ 15dk → sırala, kart liste
 *   6. "Sepete ekle" → useRouteBasket.add() → /routes/plan
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Sparkles, AlertCircle, ShoppingCart, Crosshair, Footprints, Car } from 'lucide-react';
import { toast } from 'sonner';

import { getEnv } from '@config/env';
import { getSupabaseClient } from '@lib/supabase';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import { AddressSearchInput } from '@features/routes/components/AddressSearchInput';
import { decodePolyline } from '@/lib/polyline';
import {
  computeDetourFromPolyline,
  adaptiveCorridorParams,
} from '@features/routes/lib/detour-calc';
import { useRouteBasket } from '@features/routes/store/routeBasketStore';
import type { GeocodeResult } from '@/lib/mapboxGeocode';

type Profile = 'driving' | 'walking';

interface Candidate {
  id: string;
  google_place_id: string | null;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  phone: string | null;
  clinic_segment: 'private' | 'kamu';
  province_slug: string | null;
  district_slug: string | null;
  detourKm: number;
  detourMin: number;
}

interface DirectionsResp {
  status?: string;
  geometry?: string;
  distanceM?: number;
  durationS?: number;
}

export default function CorridorRoutePage() {
  const navigate = useNavigate();
  const geo = useGeolocation();

  const [a, setA] = useState<GeocodeResult | null>(null);
  const [b, setB] = useState<GeocodeResult | null>(null);
  const [useGpsForA, setUseGpsForA] = useState(true);
  const [profile, setProfile] = useState<Profile>('driving');
  const [routeGeom, setRouteGeom] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<{ km: number; min: number } | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [computing, setComputing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (useGpsForA && geo.status === 'idle') geo.request();
  }, [useGpsForA, geo]);

  const aCoord = useMemo(() => {
    if (useGpsForA && geo.position) {
      return { lat: geo.position.lat, lng: geo.position.lng };
    }
    if (!useGpsForA && a) return { lat: a.lat, lng: a.lng };
    return null;
  }, [useGpsForA, geo.position, a]);

  const bCoord = useMemo(() => (b ? { lat: b.lat, lng: b.lng } : null), [b]);

  const handleCompute = useCallback(async () => {
    if (!aCoord || !bCoord) {
      setErr('A ve B noktası gerekli');
      return;
    }
    setComputing(true);
    setErr(null);
    setCandidates([]);
    setRouteGeom(null);
    try {
      const supabase = getSupabaseClient();

      // 1. mapbox-directions
      const { data: dirData, error: dirErr } = await supabase.functions.invoke(
        'mapbox-directions',
        {
          body: { coords: [aCoord, bCoord], profile },
        },
      );
      if (dirErr) throw new Error(dirErr.message);
      const dir = dirData as DirectionsResp;
      if (dir.status !== 'ok' || !dir.geometry) {
        throw new Error('Yol bulunamadı');
      }
      setRouteGeom(dir.geometry);
      const distKm = (dir.distanceM ?? 0) / 1000;
      const durMin = (dir.durationS ?? 0) / 60;
      setBaseline({ km: distKm, min: durMin });

      // Adaptive eşikler: rota uzun ise buffer + detour limiti büyür.
      const params = adaptiveCorridorParams(distKm);

      // 2. polyline → GeoJSON LineString (frontend decode + GeoJSON)
      const decoded = decodePolyline(dir.geometry);
      const lineGeojson = JSON.stringify({
        type: 'LineString',
        coordinates: decoded,
      });

      // 3. saha_clinics_near_polyline RPC — adaptive buffer
      const { data: nearData, error: nearErr } = await supabase.rpc('saha_clinics_near_polyline', {
        _line_geojson: lineGeojson,
        _buffer_m: params.bufferM,
        _vertical_key: 'dental',
        _limit: params.limit,
      });
      if (nearErr) throw nearErr;

      const rawList = (nearData ?? []) as Array<{
        id: string;
        google_place_id: string | null;
        name: string;
        lat: number;
        lng: number;
        address: string | null;
        phone: string | null;
        clinic_segment: 'private' | 'kamu';
        province_slug: string | null;
        district_slug: string | null;
      }>;

      // 4. detour: gerçek polyline'a dik mesafe × 2 (haversine via-C'den
      //    çok daha doğru — Mapbox rotası zaten gerçek yolu izliyor).
      const enriched: Candidate[] = [];
      for (const c of rawList) {
        const { distanceKm, durationMin } = computeDetourFromPolyline(
          { lat: c.lat, lng: c.lng },
          decoded,
          profile,
        );
        if (distanceKm > params.detourKmMax) continue;
        if (durationMin > params.detourMinMax) continue;
        enriched.push({
          ...c,
          detourKm: distanceKm,
          detourMin: durationMin,
        });
      }
      enriched.sort((x, y) => x.detourMin - y.detourMin);
      setCandidates(enriched);
      if (enriched.length === 0) {
        toast.info(
          `Yol üstünde uygun klinik yok (limit ${Math.round(params.detourMinMax)}dk / ${params.detourKmMax}km)`,
        );
      } else {
        toast.success(
          `${enriched.length} klinik bulundu (buffer ${(params.bufferM / 1000).toFixed(0)}km, detour ≤${params.detourKmMax}km/${Math.round(params.detourMinMax)}dk)`,
        );
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hesaplama hatası');
    } finally {
      setComputing(false);
    }
  }, [aCoord, bCoord, profile]);

  const addToBasket = useCallback((c: Candidate) => {
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
    else toast.error('Sepet dolu (max 12)');
  }, []);

  // Map render
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
    if (!m) return;
    markersRef.current.forEach((x) => x.remove());
    markersRef.current = [];
    if (m.getLayer('corridor-line')) m.removeLayer('corridor-line');
    if (m.getSource('corridor-src')) m.removeSource('corridor-src');

    if (routeGeom) {
      const coords = decodePolyline(routeGeom);
      m.addSource('corridor-src', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        },
      });
      m.addLayer({
        id: 'corridor-line',
        type: 'line',
        source: 'corridor-src',
        paint: { 'line-color': '#2563eb', 'line-width': 5, 'line-opacity': 0.85 },
      });
      const bounds = new mapboxgl.LngLatBounds();
      coords.forEach((c) => bounds.extend(c));
      m.fitBounds(bounds, { padding: 60, maxZoom: 13 });
    }

    if (aCoord) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:14px;height:14px;border-radius:50%;background:#10b981;border:3px solid white;box-shadow:0 0 0 2px #10b981;';
      el.title = 'A';
      const mk = new mapboxgl.Marker({ element: el }).setLngLat([aCoord.lng, aCoord.lat]).addTo(m);
      markersRef.current.push(mk);
    }
    if (bCoord) {
      const el = document.createElement('div');
      el.style.cssText =
        'width:14px;height:14px;border-radius:50%;background:#ef4444;border:3px solid white;box-shadow:0 0 0 2px #ef4444;';
      el.title = 'B';
      const mk = new mapboxgl.Marker({ element: el }).setLngLat([bCoord.lng, bCoord.lat]).addTo(m);
      markersRef.current.push(mk);
    }
    candidates.forEach((c, i) => {
      const el = document.createElement('div');
      el.style.cssText =
        'width:22px;height:22px;border-radius:50%;background:#f59e0b;color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid white;';
      el.textContent = String(i + 1);
      const mk = new mapboxgl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(m);
      markersRef.current.push(mk);
    });
  }, [routeGeom, candidates, aCoord, bCoord]);

  // Harita tıklayarak B set
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      setB({
        placeName: `Harita: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat,
        lng,
        center: [lng, lat],
        relevance: 1,
      } as GeocodeResult);
    };
    m.on('click', onClick);
    return () => {
      m.off('click', onClick);
    };
  }, [mapRef.current]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Yol Üstü Klinik Önerileri</h1>
        <p className="text-sm text-slate-600">
          A → B rotanı çiz, yolda uğrayabileceğin klinikleri gör. Detour limiti rota uzunluğuna göre
          otomatik ayarlanır (kısa rotada sıkı, uzun rotada gevşek).
        </p>
      </header>

      <section className="rounded-xl bg-white p-3 shadow-sm">
        {/* A — GPS toggle */}
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">Başlangıç (A)</span>
          <button
            type="button"
            onClick={() => setUseGpsForA((v) => !v)}
            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
          >
            <Crosshair size={11} />
            {useGpsForA ? 'GPS aktif' : 'Adres ile seç'}
          </button>
        </div>
        {useGpsForA ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            {geo.position ? (
              <span className="text-emerald-700">📍 Konumum hazır</span>
            ) : (
              <span className="text-slate-500">Konum bekleniyor…</span>
            )}
          </div>
        ) : (
          <AddressSearchInput
            placeholder="A noktası ara…"
            value={a}
            onChange={setA}
            proximity={bCoord ?? undefined}
          />
        )}

        <div className="mt-2">
          <span className="text-xs font-medium text-slate-600">Varış (B)</span>
          <AddressSearchInput
            placeholder="B noktası ara veya haritadan tıkla…"
            value={b}
            onChange={setB}
            proximity={aCoord ?? undefined}
          />
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Rota modu</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { key: 'driving', label: 'Araç', Icon: Car },
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

      <button
        type="button"
        onClick={() => void handleCompute()}
        disabled={!aCoord || !bCoord || computing}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
      >
        <Sparkles size={16} />
        {computing ? 'Yol hesaplanıyor…' : 'Yol göster + yakın klinikleri bul'}
      </button>

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle size={16} className="shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{err}</p>
        </div>
      )}

      <section
        ref={containerRef}
        className="h-[360px] w-full overflow-hidden rounded-xl border border-slate-200"
      />

      {baseline && (
        <section className="rounded-xl bg-slate-50 p-3">
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
            A → B baseline
          </h2>
          <div className="flex gap-4 text-sm">
            <span>
              <strong>{baseline.km.toFixed(1)} km</strong>
            </span>
            <span>
              <strong>{Math.round(baseline.min)} dk</strong>
            </span>
            {candidates.length > 0 && (
              <span className="ml-auto text-slate-600">{candidates.length} aday klinik</span>
            )}
          </div>
        </section>
      )}

      {candidates.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Yol üstü klinikler (detour'a göre sıralı)
          </h2>
          <ul className="space-y-2">
            {candidates.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2 rounded-lg bg-white p-3 shadow-sm">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{c.name}</div>
                  <div className="mt-0.5 text-xs text-slate-600">
                    <span className="font-medium text-amber-700">
                      +{c.detourKm.toFixed(1)} km / +{Math.round(c.detourMin)} dk
                    </span>
                    {c.address && <span className="ml-2 truncate text-slate-500">{c.address}</span>}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    c.clinic_segment === 'kamu'
                      ? 'bg-purple-100 text-purple-700'
                      : 'bg-blue-100 text-blue-700'
                  }`}
                >
                  {c.clinic_segment === 'kamu' ? 'KAMU' : 'Özel'}
                </span>
                <button
                  type="button"
                  onClick={() => addToBasket(c)}
                  className="shrink-0 rounded-lg bg-emerald-600 p-2 text-white hover:bg-emerald-700"
                  aria-label="Sepete ekle"
                >
                  <ShoppingCart size={14} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => navigate('/routes/plan')}
            className="mt-3 w-full rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white"
          >
            Sepete git → Rota planlayıcı
          </button>
        </section>
      )}

      {!candidates.length && baseline && (
        <p className="text-sm text-slate-500">
          Yol üstünde uygun klinik bulunamadı (limit otomatik). Rotayı genişlet veya farklı bir
          güzergâh dene.
        </p>
      )}

      {!aCoord && !useGpsForA && (
        <p className="text-xs text-slate-500">A için adres ara veya GPS'i aç.</p>
      )}
    </div>
  );
}
