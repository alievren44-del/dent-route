/**
 * CorridorRoutePage v2 — Google Maps tarzı alternatif rotalar.
 *
 * Akış:
 *   1. A = GPS (default) veya search/harita; B = search/harita
 *   2. Provider seçimi (Mapbox default, Google fallback)
 *   3. Manuel waypoint ekleme (harita tıkla veya şehir search)
 *   4. routing-adapter.computeRouteAlternatives → 1-3 RouteOption
 *   5. Her route için ayrı candidates (cross-track polyline filter)
 *   6. UI: RouteCard listesi, harita 3-renk, klinik detay sayfası
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { Sparkles, AlertCircle, Crosshair, Footprints, Car, X, Plus } from 'lucide-react';
import { toast } from 'sonner';

import { getEnv } from '@config/env';
import { getTypedClient } from '@lib/supabase';
import { useGeolocation } from '@features/map/hooks/useGeolocation';
import { AddressSearchInput } from '@features/routes/components/AddressSearchInput';
import { decodePolyline } from '@/lib/polyline';
import {
  computeDetourFromPolyline,
  adaptiveCorridorParams,
  haversineKm,
} from '@features/routes/lib/detour-calc';
import {
  computeRouteAlternatives,
  type RouteOption as AdapterRoute,
  type RouteProvider,
} from '@features/routes/lib/routing-adapter';
import { selectVariationCities, type CityVariation } from '@features/routes/lib/city-variations';
import { CORRIDOR_PRESETS, type CorridorPreset } from '@features/routes/data/corridor-presets';
import { RouteCard } from '@features/routes/components/RouteCard';
import {
  districtsAlongPolyline,
  enrichWithScanStatus,
  type CorridorDistrict,
} from '@features/routes/lib/corridor-enrichment';
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

interface RouteWithCandidates extends AdapterRoute {
  candidates: Candidate[];
}

const ROUTE_COLORS = ['#2563eb', '#10b981', '#f59e0b'] as const;

export default function CorridorRoutePage() {
  const navigate = useNavigate();
  const geo = useGeolocation();

  const [a, setA] = useState<GeocodeResult | null>(null);
  const [b, setB] = useState<GeocodeResult | null>(null);
  const [useGpsForA, setUseGpsForA] = useState(true);
  const [profile, setProfile] = useState<Profile>('driving');
  // Google Routes API kaldırıldı (ücretsiz mod). Hardcoded Mapbox.
  const [provider] = useState<RouteProvider>('mapbox');
  const [manualWaypoints, setManualWaypoints] = useState<CityVariation[]>([]);
  const [routes, setRoutes] = useState<RouteWithCandidates[]>([]);
  const [selectedRouteIdx, setSelectedRouteIdx] = useState<number>(0);
  const [computing, setComputing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Corridor district coverage (read-only — DB'den okur, canlı tarama YOK)
  const [corridorDistricts, setCorridorDistricts] = useState<CorridorDistrict[]>([]);
  // Hazır rota seçilince A/B set edilir, bu flag bir kez auto-compute tetikler
  const [pendingPresetCompute, setPendingPresetCompute] = useState(false);

  useEffect(() => {
    if (useGpsForA && geo.status === 'idle') geo.request();
  }, [useGpsForA, geo]);

  const loadPreset = useCallback((preset: CorridorPreset) => {
    setUseGpsForA(false);
    setManualWaypoints([]);
    setA({
      placeName: preset.a.placeName,
      lat: preset.a.lat,
      lng: preset.a.lng,
      center: [preset.a.lng, preset.a.lat],
      relevance: 1,
    } as GeocodeResult);
    setB({
      placeName: preset.b.placeName,
      lat: preset.b.lat,
      lng: preset.b.lng,
      center: [preset.b.lng, preset.b.lat],
      relevance: 1,
    } as GeocodeResult);
    setPendingPresetCompute(true);
  }, []);

  const aCoord = useMemo(() => {
    if (useGpsForA && geo.position) {
      return { lat: geo.position.lat, lng: geo.position.lng };
    }
    if (!useGpsForA && a) return { lat: a.lat, lng: a.lng };
    return null;
  }, [useGpsForA, geo.position, a]);

  const bCoord = useMemo(() => (b ? { lat: b.lat, lng: b.lng } : null), [b]);

  // A→B değişince otomatik aday şehirleri öneri olarak göster
  const autoSuggestedCities = useMemo<CityVariation[]>(() => {
    if (!aCoord || !bCoord) return [];
    return selectVariationCities(aCoord, bCoord, { maxCities: 4 });
  }, [aCoord, bCoord]);

  const addManualWaypoint = (city: CityVariation): void => {
    setManualWaypoints((prev) => {
      if (prev.some((p) => p.slug === city.slug)) return prev;
      return [...prev, city];
    });
  };

  const removeManualWaypoint = (slug: string): void => {
    setManualWaypoints((prev) => prev.filter((p) => p.slug !== slug));
  };

  const handleCompute = useCallback(async () => {
    if (!aCoord || !bCoord) {
      setErr('A ve B noktası gerekli');
      return;
    }
    setComputing(true);
    setErr(null);
    setRoutes([]);
    setSelectedRouteIdx(0);
    try {
      // 1. RoutingAdapter alternatives üret (provider seçimine göre)
      const alts = await computeRouteAlternatives({
        a: aCoord,
        b: bCoord,
        profile,
        provider,
        manualWaypoints,
        autoVariations: provider === 'mapbox', // Google zaten alternatif veriyor
        maxRoutes: 3,
      });

      if (alts.length === 0) throw new Error('Yol bulunamadı');

      // 2. Her rota için saha_clinics_near_polyline + detour filter
      const supabase = getTypedClient();
      const resolved: RouteWithCandidates[] = [];
      for (const r of alts) {
        const distKm = r.distanceM / 1000;
        const params = adaptiveCorridorParams(distKm);
        const decoded = decodePolyline(r.geometry);
        const lineGeojson = JSON.stringify({
          type: 'LineString',
          coordinates: decoded,
        });

        const { data: nearData, error: nearErr } = await supabase.rpc(
          'saha_clinics_near_polyline',
          {
            _line_geojson: lineGeojson,
            _buffer_m: params.bufferM,
            _vertical_key: 'dental',
            _limit: params.limit,
          },
        );
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

        const enriched: Candidate[] = [];
        for (const c of rawList) {
          // Başlangıç + bitiş zone'larındaki klinikleri ele — rota başında
          // değil yol üstünde olanlar lazım.
          if (aCoord && params.excludeStartEndKm > 0) {
            const dA = haversineKm({ lat: c.lat, lng: c.lng }, aCoord);
            if (dA < params.excludeStartEndKm) continue;
          }
          if (bCoord && params.excludeStartEndKm > 0) {
            const dB = haversineKm({ lat: c.lat, lng: c.lng }, bCoord);
            if (dB < params.excludeStartEndKm) continue;
          }

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

        resolved.push({ ...r, candidates: enriched });
      }

      setRoutes(resolved);
      setSelectedRouteIdx(0);
      toast.success(
        `${resolved.length} rota bulundu (${resolved.reduce(
          (s, r) => s + r.candidates.length,
          0,
        )} toplam klinik)`,
      );

      // Selected route'un polyline'ı için rota üstü ilçeleri renkli liste
      // (yeşil=fresh, turuncu=stale, kırmızı=untouched). Read-only DB coverage.
      // Buffer + cap rota uzunluğuna göre adaptif — Ankara→Malatya'da 222 ilçe
      // yerine makul sayı (uzun rotada dar buffer + count cap).
      if (resolved[0]) {
        const decoded = decodePolyline(resolved[0].geometry);
        const routeKm = resolved[0].distanceM / 1000;
        // Uzun rota → dar koridor (yoldan çok sapma istemeyiz) + sıkı min nüfus
        const maxKm = routeKm > 400 ? 12 : routeKm > 150 ? 18 : 25;
        const minPopulation = routeKm > 400 ? 15_000 : routeKm > 150 ? 10_000 : 5_000;
        const maxResults = 60;
        const nearbyDistricts = districtsAlongPolyline(decoded, {
          maxKm,
          minPopulation,
          maxResults,
        });
        try {
          const enrichedDistricts = await enrichWithScanStatus(nearbyDistricts);
          setCorridorDistricts(enrichedDistricts);
        } catch {
          setCorridorDistricts(
            nearbyDistricts.map((d) => ({
              ...d,
              lastScanAt: null,
              existingCount: 0,
            })),
          );
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Hesaplama hatası');
    } finally {
      setComputing(false);
    }
  }, [aCoord, bCoord, profile, provider, manualWaypoints]);

  // Hazır rota seçildiğinde A/B set olunca bir kez otomatik hesapla
  useEffect(() => {
    if (pendingPresetCompute && aCoord && bCoord) {
      setPendingPresetCompute(false);
      void handleCompute();
    }
  }, [pendingPresetCompute, aCoord, bCoord, handleCompute]);

  const selectedRoute = routes[selectedRouteIdx] ?? null;

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
    for (let i = 0; i < 3; i++) {
      if (m.getLayer(`corridor-line-${i}`)) m.removeLayer(`corridor-line-${i}`);
      if (m.getSource(`corridor-src-${i}`)) m.removeSource(`corridor-src-${i}`);
    }

    if (routes.length > 0) {
      const allBounds = new mapboxgl.LngLatBounds();
      routes.forEach((r, idx) => {
        const coords = decodePolyline(r.geometry);
        m.addSource(`corridor-src-${idx}`, {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: coords },
          },
        });
        const isActive = idx === selectedRouteIdx;
        m.addLayer({
          id: `corridor-line-${idx}`,
          type: 'line',
          source: `corridor-src-${idx}`,
          paint: {
            'line-color': ROUTE_COLORS[idx] ?? '#64748b',
            'line-width': isActive ? 6 : 3,
            'line-opacity': isActive ? 0.95 : 0.45,
          },
        });
        coords.forEach((c) => allBounds.extend(c));
      });
      m.fitBounds(allBounds, { padding: 60, maxZoom: 13 });
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
    // Sadece seçili rota'nın klinikleri pin
    if (selectedRoute) {
      selectedRoute.candidates.forEach((c, i) => {
        const el = document.createElement('div');
        el.style.cssText =
          'width:22px;height:22px;border-radius:50%;background:#f59e0b;color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;border:2px solid white;';
        el.textContent = String(i + 1);
        const mk = new mapboxgl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(m);
        markersRef.current.push(mk);
      });
    }
    // Waypoint chip'leri haritada
    manualWaypoints.forEach((wp) => {
      const el = document.createElement('div');
      el.style.cssText =
        'width:18px;height:18px;border-radius:50%;background:#8b5cf6;border:2px solid white;box-shadow:0 0 0 2px #8b5cf6;';
      el.title = wp.name;
      const mk = new mapboxgl.Marker({ element: el }).setLngLat([wp.lng, wp.lat]).addTo(m);
      markersRef.current.push(mk);
    });
  }, [routes, selectedRouteIdx, aCoord, bCoord, manualWaypoints, selectedRoute]);

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

  const handleDetail = (idx: number) => {
    const r = routes[idx];
    if (!r) return;
    navigate('/routes/corridor/clinics', {
      state: {
        route: {
          km: r.distanceM / 1000,
          durationMin: Math.round(r.durationS / 60),
          viaCity: r.viaCity?.name ?? null,
          provider: r.provider,
        },
        candidates: r.candidates,
        a: aCoord
          ? { lat: aCoord.lat, lng: aCoord.lng, name: useGpsForA ? 'Konum' : a?.placeName }
          : null,
        b: bCoord ? { lat: bCoord.lat, lng: bCoord.lng, name: b?.placeName } : null,
        routeName: r.viaCity?.name ? `${r.viaCity.name} üzerinden` : 'Yol üstü rota',
      },
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Yol Üstü Klinik Önerileri</h1>
        <p className="text-sm text-slate-600">
          A → B rotanı çiz, alternatif yolları kıyasla. Her rota üzerindeki klinikleri detaylı gör.
        </p>
      </header>

      {/* Hazır rotalar — çizmeden seç */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Hazır rotalar
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {CORRIDOR_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => loadPreset(p)}
              disabled={computing}
              className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-blue-600 hover:text-white disabled:opacity-50"
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white p-3 shadow-sm">
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

      {/* Waypoint sugestion + manual */}
      {provider === 'mapbox' && autoSuggestedCities.length > 0 && (
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold text-slate-600 uppercase tracking-wide">
            Ara nokta önerileri (üzerinden geçirmek için tıkla)
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {autoSuggestedCities.map((c) => {
              const added = manualWaypoints.some((w) => w.slug === c.slug);
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => (added ? removeManualWaypoint(c.slug) : addManualWaypoint(c))}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                    added
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {added ? <X size={10} /> : <Plus size={10} />}
                  {c.name}
                </button>
              );
            })}
          </div>
          {manualWaypoints.length > 0 && (
            <p className="mt-1.5 text-[10px] text-purple-700">
              {manualWaypoints.length} ara nokta seçildi. Hesapla butonuna tıkla.
            </p>
          )}
        </section>
      )}

      <button
        type="button"
        onClick={() => void handleCompute()}
        disabled={!aCoord || !bCoord || computing}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-700 disabled:opacity-50"
      >
        <Sparkles size={16} />
        {computing ? 'Yol hesaplanıyor…' : 'Yol göster + alternatif rotaları bul'}
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

      {/* Corridor enrichment panel — TÜM rota ilçeleri + renk kodu (yeşil/turuncu/kırmızı) */}
      {routes.length > 0 && corridorDistricts.length > 0 && (
        <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Rota üstündeki ilçeler ({corridorDistricts.length})
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-500">
                {(() => {
                  const fresh = corridorDistricts.filter(
                    (d) =>
                      d.lastScanAt &&
                      (Date.now() - new Date(d.lastScanAt).getTime()) / 86400_000 <= 14,
                  ).length;
                  const stale = corridorDistricts.filter((d) => {
                    if (!d.lastScanAt) return false;
                    const days = (Date.now() - new Date(d.lastScanAt).getTime()) / 86400_000;
                    return days > 14;
                  }).length;
                  const untouched = corridorDistricts.length - fresh - stale;
                  return `🟢 ${fresh} güncel · 🟠 ${stale} eski · 🔴 ${untouched} taranmamış`;
                })()}
              </p>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1 max-h-44 overflow-y-auto">
            {corridorDistricts.map((d) => {
              let cls = 'bg-rose-100 text-rose-800 border-rose-300';
              let label = 'yeni';
              if (d.lastScanAt) {
                const days = (Date.now() - new Date(d.lastScanAt).getTime()) / 86400_000;
                if (days <= 14) {
                  cls = 'bg-emerald-100 text-emerald-800 border-emerald-300';
                  label = `${Math.round(days)}g`;
                } else {
                  cls = 'bg-amber-100 text-amber-800 border-amber-300';
                  label = `${Math.round(days)}g eski`;
                }
              }
              return (
                <span
                  key={`${d.provinceSlug}-${d.districtSlug}`}
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}
                  title={`${d.provinceName} / ${d.districtName} — ${d.existingCount} klinik`}
                >
                  {d.districtName}
                  <span className="opacity-70">·{d.existingCount}</span>
                  <span className="opacity-50">({label})</span>
                </span>
              );
            })}
          </div>

          <p className="mt-2 text-[10px] text-slate-400">
            Kapsam DB'den okunur (canlı tarama yok, maliyet $0). Taranmamış ilçeleri admin toplu
            tarama ile doldurur.
          </p>
        </section>
      )}

      {routes.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            {routes.length === 1 ? 'Rota' : `${routes.length} alternatif rota`}
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {routes.map((r, idx) => {
              const km = r.distanceM / 1000;
              const min = Math.round(r.durationS / 60);
              const ref0 = routes[0]!;
              return (
                <RouteCard
                  key={idx}
                  index={idx}
                  isSelected={idx === selectedRouteIdx}
                  color={ROUTE_COLORS[idx] ?? '#64748b'}
                  km={km}
                  durationMin={min}
                  clinicCount={r.candidates.length}
                  deltaKm={km - ref0.distanceM / 1000}
                  deltaMin={min - Math.round(ref0.durationS / 60)}
                  viaCity={r.viaCity?.name ?? null}
                  provider={r.provider}
                  onSelect={() => setSelectedRouteIdx(idx)}
                  onDetail={() => handleDetail(idx)}
                />
              );
            })}
          </div>
        </section>
      )}

      {!aCoord && !useGpsForA && (
        <p className="text-xs text-slate-500">A için adres ara veya GPS'i aç.</p>
      )}
    </div>
  );
}
