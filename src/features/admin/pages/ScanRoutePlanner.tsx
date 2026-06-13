/**
 * ScanRoutePlanner — Tarama sonrası saha rep rota planlama sayfası.
 *
 * Phase 4 (Akıllı Tarama Motoru) — hibrit NN-TSP + 2-opt sayfası.
 *
 * Akış:
 *   1. DistrictClinicsDialog (Phase 5'te hook eklenecek) → seçili klinikleri
 *      `useRoutePlanner` store'a yazar + bu sayfaya navigate eder.
 *   2. Kullanıcı başlangıç noktası seçer (GPS / kayıtlı ev-depo / manuel).
 *   3. "Optimize Et" → `optimizeRouteHybrid` (NN greedy + 2-opt).
 *   4. Harita + sıralı tablo render edilir.
 *   5. Aksiyonlar: Excel İndir (14 sütun) / Rotayı Sakla (saha_routes insert).
 *
 * Route registration (Phase 5):
 *   - `src/router.tsx`'a `/admin/route-planner` lazy route eklenmeli.
 *   - DistrictClinicsDialog'a "Rotaya Çevir" butonu eklenmeli (store doldur + navigate).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { toast } from 'sonner';
import {
  MapPin,
  Navigation,
  Sparkles,
  Download,
  Save,
  Loader2,
  Home,
  Crosshair,
  ArrowLeft,
  Phone,
} from 'lucide-react';
import { format } from 'date-fns';

import { getTypedClient } from '@lib/supabase';
import { getEnv } from '@config/env';
import { useGeolocation } from '@/features/map/hooks/useGeolocation';
import { useRoutePlanner, type RouteClinic } from '@features/admin/store/routePlannerStore';
import { optimizeRouteHybrid } from '@features/admin/lib/tsp';
import { exportClinicsToExcel, type ExportClinic } from '@features/admin/lib/clinicExcelExport';

// ─────────────────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────────────────

type StartMode = 'gps' | 'home' | 'manual';

interface OptimizeResult {
  orderedClinics: RouteClinic[];
  cumulativeKm: number[];
  totalKm: number;
  initialKm: number;
  savedKm: number;
  method: 'nn' | 'nn+2opt';
  /** km × ortalama hızdan tahmin: 30 km/h */
  estimatedDurationMin: number;
}

interface ProfileHome {
  home_lat: number | null;
  home_lng: number | null;
  ad_soyad: string | null;
}

const AVG_SPEED_KMH = 30;

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────

function recommendStrategy(count: number): {
  label: string;
  hint: string;
} {
  if (count <= 12) {
    return {
      label: 'Mapbox Optimize (kalite)',
      hint: '≤12 durak — trafik hesaba katılır',
    };
  }
  if (count <= 50) {
    return {
      label: 'Local NN+2-opt',
      hint: '12-50 durak — yerel hesap, ücretsiz',
    };
  }
  return {
    label: 'Local NN+2-opt (sampled)',
    hint: '>50 durak — büyük setlerde sample iyileştirme',
  };
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

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function slugToReadable(slug: string | null): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map((p) => (p.length === 0 ? p : p.charAt(0).toLocaleUpperCase('tr') + p.slice(1)))
    .join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ScanRoutePlanner(): JSX.Element {
  const navigate = useNavigate();
  const geolocation = useGeolocation();

  const clinics = useRoutePlanner((s) => s.clinics);
  const storedStart = useRoutePlanner((s) => s.start);
  const provinceSlug = useRoutePlanner((s) => s.provinceSlug);
  const districtSlug = useRoutePlanner((s) => s.districtSlug);
  const storedRepName = useRoutePlanner((s) => s.repName);

  // Method-selector'lar `@typescript-eslint/unbound-method` tetiklemesin diye
  // store referansı üzerinden çağırıyoruz.
  const setStartInStore = useCallback(
    (s: { lat: number; lng: number } | null) => useRoutePlanner.getState().setStart(s),
    [],
  );
  const clearStore = useCallback(() => useRoutePlanner.getState().clear(), []);

  // Lokal state
  const [startMode, setStartMode] = useState<StartMode>('gps');
  const [profileHome, setProfileHome] = useState<ProfileHome | null>(null);
  const [manualPoint, setManualPoint] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [routeResult, setRouteResult] = useState<OptimizeResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [repName, setRepName] = useState<string>(storedRepName);

  // ──────────────────────────────────────────────────────────────────────────
  // Profile + GPS
  // ──────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const supabase = getTypedClient();
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;
        const { data } = await supabase
          .from('profiles')
          .select('home_lat, home_lng, ad_soyad')
          .eq('id', userId)
          .maybeSingle();
        if (cancelled) return;
        // home_lat/home_lng kolonu opsiyonel (Phase 4'te migration eklenmemiş olabilir)
        // — yoksa null kalır, radio disabled olur.
        const row = data as Partial<ProfileHome> | null;
        setProfileHome({
          home_lat: row?.home_lat ?? null,
          home_lng: row?.home_lng ?? null,
          ad_soyad: row?.ad_soyad ?? null,
        });
        if (!storedRepName && row?.ad_soyad) {
          setRepName(row.ad_soyad);
        }
      } catch {
        // Sessiz fallback — home_lat kolonu yoksa Postgres error
        setProfileHome({ home_lat: null, home_lng: null, ad_soyad: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storedRepName]);

  useEffect(() => {
    if (startMode === 'gps' && !geolocation.position) {
      geolocation.request();
    }
  }, [startMode, geolocation]);

  // Hesaplanan başlangıç noktası
  const effectiveStart = useMemo<{ lat: number; lng: number } | null>(() => {
    if (storedStart) return storedStart;
    if (startMode === 'gps') {
      return geolocation.position
        ? { lat: geolocation.position.lat, lng: geolocation.position.lng }
        : null;
    }
    if (startMode === 'home') {
      if (
        profileHome &&
        typeof profileHome.home_lat === 'number' &&
        typeof profileHome.home_lng === 'number'
      ) {
        return { lat: profileHome.home_lat, lng: profileHome.home_lng };
      }
      return null;
    }
    return manualPoint;
  }, [storedStart, startMode, geolocation.position, profileHome, manualPoint]);

  // ──────────────────────────────────────────────────────────────────────────
  // Stats
  // ──────────────────────────────────────────────────────────────────────────

  const privateCount = useMemo(
    () => clinics.filter((c) => c.segment === 'private').length,
    [clinics],
  );
  const kamuCount = useMemo(() => clinics.filter((c) => c.segment === 'kamu').length, [clinics]);
  const strategy = useMemo(() => recommendStrategy(clinics.length), [clinics]);

  const canOptimize = !optimizing && clinics.length > 0 && effectiveStart !== null;

  // ──────────────────────────────────────────────────────────────────────────
  // Optimize
  // ──────────────────────────────────────────────────────────────────────────

  const handleOptimize = useCallback(async () => {
    if (!effectiveStart || clinics.length === 0) return;
    setOptimizing(true);
    setRouteResult(null);
    try {
      const points = clinics.map((c) => ({ lat: c.lat, lng: c.lng }));
      const result = await optimizeRouteHybrid(points, effectiveStart, {
        returnHome: false,
      });
      const orderedClinics = result.order.map((idx) => clinics[idx]!);
      const estimatedDurationMin = Math.round((result.totalDistanceKm / AVG_SPEED_KMH) * 60);
      setRouteResult({
        orderedClinics,
        cumulativeKm: result.cumulativeDistancesKm,
        totalKm: result.totalDistanceKm,
        initialKm: result.initialKm,
        savedKm: result.savedKm,
        method: result.method,
        estimatedDurationMin,
      });
      // Store'a kalıcı yaz (kullanıcı sayfayı yenilerse kaybolur — ephemeral)
      setStartInStore(effectiveStart);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Bilinmeyen hata';
      toast.error('Optimize hatası: ' + msg);
    } finally {
      setOptimizing(false);
    }
  }, [effectiveStart, clinics, setStartInStore]);

  // ──────────────────────────────────────────────────────────────────────────
  // Excel
  // ──────────────────────────────────────────────────────────────────────────

  const handleExportExcel = useCallback(() => {
    if (!routeResult) return;
    const exportRows: ExportClinic[] = routeResult.orderedClinics.map((c, i) => ({
      ordinal: i + 1,
      name: c.name,
      neighborhood: c.neighborhood,
      address: c.address,
      phone: c.phone,
      user_ratings_total: c.user_ratings_total,
      rating: c.rating,
      type_label: c.types?.[0],
      segment: c.segment,
    }));
    const today = format(new Date(), 'yyyy-MM-dd');
    const provincePart = provinceSlug || 'rota';
    const districtPart = districtSlug ? `-${districtSlug}` : '';
    const filename = `rota-${provincePart}${districtPart}-${today}.xlsx`;
    try {
      exportClinicsToExcel(exportRows, {
        filename,
        routeMeta: {
          province: slugToReadable(provinceSlug),
          district: districtSlug ? slugToReadable(districtSlug) : undefined,
          totalKm: routeResult.totalKm,
          totalDurationMin: routeResult.estimatedDurationMin,
          repName: repName || undefined,
          date: today,
        },
      });
      toast.success('Excel indirildi');
    } catch (e) {
      toast.error('Excel hatası: ' + (e instanceof Error ? e.message : 'Bilinmeyen'));
    }
  }, [routeResult, provinceSlug, districtSlug, repName]);

  // ──────────────────────────────────────────────────────────────────────────
  // Save route
  // ──────────────────────────────────────────────────────────────────────────

  const handleSaveRoute = useCallback(async () => {
    if (!routeResult) return;
    setSaving(true);
    try {
      const supabase = getTypedClient();
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error('Oturum yok');

      const orderedAccountIds: string[] = [];
      for (const c of routeResult.orderedClinics) {
        if (c.id) orderedAccountIds.push(c.id);
      }

      if (orderedAccountIds.length === 0) {
        toast.error('Hiçbir kliniğin DB kaydı yok — önce taramayı kaydet sonra rota planla');
        setSaving(false);
        return;
      }

      const totalKm = Number(routeResult.totalKm.toFixed(2));
      const insertRow = {
        profile_id: userData.user.id,
        status: 'planned' as const,
        account_ids: orderedAccountIds,
        optimized: true,
        total_distance_km: totalKm,
        total_duration_min: routeResult.estimatedDurationMin,
      };

      const { data: row, error: insertErr } = await supabase
        .from('saha_routes')
        .insert(insertRow)
        .select('id')
        .single();
      if (insertErr || !row) {
        throw new Error(insertErr?.message ?? 'Insert hatası');
      }
      const inserted = row as { id: string };
      toast.success('Rota saklandı');
      clearStore();
      navigate(`/routes/active/${inserted.id}`);
    } catch (e) {
      toast.error('Sakla hatası: ' + (e instanceof Error ? e.message : 'Bilinmeyen'));
    } finally {
      setSaving(false);
    }
  }, [routeResult, clearStore, navigate]);

  // ──────────────────────────────────────────────────────────────────────────
  // Geri
  // ──────────────────────────────────────────────────────────────────────────

  const handleBack = useCallback(() => {
    clearStore();
    navigate(-1);
  }, [clearStore, navigate]);

  // ──────────────────────────────────────────────────────────────────────────
  // Mapbox haritalar
  // ──────────────────────────────────────────────────────────────────────────

  // Manuel başlangıç için küçük harita
  const manualMapContainer = useRef<HTMLDivElement | null>(null);
  const manualMapRef = useRef<mapboxgl.Map | null>(null);
  const manualMarkerRef = useRef<mapboxgl.Marker | null>(null);

  useEffect(() => {
    if (startMode !== 'manual') return;
    if (!manualMapContainer.current || manualMapRef.current) return;
    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;
    const fallback: [number, number] = clinics[0] ? [clinics[0].lng, clinics[0].lat] : [35.2, 39.0];
    const map = new mapboxgl.Map({
      container: manualMapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: fallback,
      zoom: clinics[0] ? 11 : 5,
    });
    map.on('click', (e) => {
      const { lat, lng } = e.lngLat;
      setManualPoint({ lat, lng });
      if (manualMarkerRef.current) {
        manualMarkerRef.current.setLngLat([lng, lat]);
      } else {
        manualMarkerRef.current = new mapboxgl.Marker({ color: '#a855f7' })
          .setLngLat([lng, lat])
          .addTo(map);
      }
    });
    manualMapRef.current = map;
    return () => {
      manualMarkerRef.current?.remove();
      manualMarkerRef.current = null;
      map.remove();
      manualMapRef.current = null;
    };
  }, [startMode, clinics]);

  // Ana sonuç haritası
  const resultMapContainer = useRef<HTMLDivElement | null>(null);
  const resultMapRef = useRef<mapboxgl.Map | null>(null);
  const resultMarkersRef = useRef<mapboxgl.Marker[]>([]);
  const [resultMapReady, setResultMapReady] = useState(false);

  useEffect(() => {
    if (!resultMapContainer.current) return;
    if (resultMapRef.current) return;
    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;
    const center: [number, number] = effectiveStart
      ? [effectiveStart.lng, effectiveStart.lat]
      : clinics[0]
        ? [clinics[0].lng, clinics[0].lat]
        : [35.2, 39.0];
    const map = new mapboxgl.Map({
      container: resultMapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom: 11,
    });
    map.on('load', () => setResultMapReady(true));
    resultMapRef.current = map;
    return () => {
      resultMarkersRef.current.forEach((m) => m.remove());
      resultMarkersRef.current = [];
      map.remove();
      resultMapRef.current = null;
      setResultMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marker + polyline çiz
  useEffect(() => {
    const map = resultMapRef.current;
    if (!map || !resultMapReady) return;

    resultMarkersRef.current.forEach((m) => m.remove());
    resultMarkersRef.current = [];

    if (map.getLayer('scan-route-line')) map.removeLayer('scan-route-line');
    if (map.getSource('scan-route-src')) map.removeSource('scan-route-src');

    const renderClinics = routeResult ? routeResult.orderedClinics : clinics;

    // Klinik markerları
    renderClinics.forEach((c, i) => {
      const color = c.segment === 'kamu' ? '#9333ea' : '#2563eb';
      const el = routeResult
        ? buildNumberedMarker(i + 1, color)
        : (() => {
            // unoptimized state — küçük circle (numarasız)
            const d = document.createElement('div');
            d.style.width = '14px';
            d.style.height = '14px';
            d.style.borderRadius = '50%';
            d.style.backgroundColor = color;
            d.style.border = '2px solid #fff';
            d.style.boxShadow = '0 1px 2px rgba(0,0,0,0.3)';
            return d;
          })();
      const marker = new mapboxgl.Marker({ element: el }).setLngLat([c.lng, c.lat]).addTo(map);
      resultMarkersRef.current.push(marker);
    });

    // Start marker
    if (effectiveStart) {
      const startEl = buildStartMarker();
      const startMarker = new mapboxgl.Marker({ element: startEl })
        .setLngLat([effectiveStart.lng, effectiveStart.lat])
        .addTo(map);
      resultMarkersRef.current.push(startMarker);
    }

    // Polyline (sadece optimize sonrası)
    if (routeResult && effectiveStart && routeResult.orderedClinics.length > 0) {
      const coords: Array<[number, number]> = [
        [effectiveStart.lng, effectiveStart.lat],
        ...routeResult.orderedClinics.map((c) => [c.lng, c.lat] as [number, number]),
      ];
      map.addSource('scan-route-src', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: coords },
        },
      });
      map.addLayer({
        id: 'scan-route-line',
        type: 'line',
        source: 'scan-route-src',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#2563eb',
          'line-width': 4,
          'line-opacity': 0.8,
        },
      });
    }

    // Bounds fit
    const allPoints = [
      ...renderClinics.map((c) => [c.lng, c.lat] as [number, number]),
      ...(effectiveStart ? [[effectiveStart.lng, effectiveStart.lat] as [number, number]] : []),
    ];
    if (allPoints.length >= 1) {
      const bounds = new mapboxgl.LngLatBounds();
      allPoints.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 0 });
    }
  }, [routeResult, clinics, effectiveStart, resultMapReady]);

  // ──────────────────────────────────────────────────────────────────────────
  // Empty state
  // ──────────────────────────────────────────────────────────────────────────

  if (clinics.length === 0) {
    return (
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-3xl flex-col items-center justify-center gap-4 px-4">
        <Navigation size={48} className="text-slate-400" />
        <h1 className="text-xl font-bold text-slate-900">Rota planlamak için klinik seçilmedi</h1>
        <p className="text-center text-sm text-slate-600">
          Tarama sonucundan veya ilçe listesinden klinik seçip &quot;Rotaya Çevir&quot; butonuna
          basın.
        </p>
        <button
          type="button"
          onClick={handleBack}
          className="flex h-10 items-center gap-2 rounded-lg bg-slate-200 px-4 text-sm font-medium text-slate-800 hover:bg-slate-300"
        >
          <ArrowLeft size={16} /> Geri Dön
        </button>
      </div>
    );
  }

  const homeAvailable =
    profileHome !== null &&
    typeof profileHome.home_lat === 'number' &&
    typeof profileHome.home_lng === 'number';

  // ──────────────────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto min-h-[calc(100vh-4rem)] max-w-6xl space-y-4 bg-slate-50 p-4 pb-24">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Tarama Rota Planı</h1>
          <p className="text-xs text-slate-500">
            {slugToReadable(provinceSlug) || 'İl seçilmedi'}
            {districtSlug ? ` / ${slugToReadable(districtSlug)}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={handleBack}
          className="flex h-9 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          <ArrowLeft size={14} /> Geri
        </button>
      </header>

      {/* Üst panel — Strateji + Başlangıç */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Klinik sayısı */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Klinik Sayısı</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{clinics.length}</div>
          <div className="mt-1 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-600" />
              private: {privateCount}
            </span>
            <span className="mx-2 text-slate-300">|</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-purple-600" />
              KAMU: {kamuCount}
            </span>
          </div>
        </div>

        {/* Strateji */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Önerilen Strateji</div>
          <div className="mt-1 text-base font-semibold text-slate-900">{strategy.label}</div>
          <div className="mt-1 text-xs text-slate-500">{strategy.hint}</div>
        </div>

        {/* Başlangıç */}
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs font-semibold uppercase text-slate-500">Başlangıç Noktası</div>
          <div className="mt-2 space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="startMode"
                value="gps"
                checked={startMode === 'gps'}
                onChange={() => setStartMode('gps')}
                className="h-4 w-4"
              />
              <Crosshair size={14} className="text-blue-600" />
              <span>GPS Konumum</span>
              {startMode === 'gps' && geolocation.status === 'prompting' && (
                <span className="ml-auto text-xs text-slate-500">aranıyor…</span>
              )}
              {startMode === 'gps' && geolocation.status === 'denied' && (
                <span className="ml-auto text-xs text-red-600">izin yok</span>
              )}
              {startMode === 'gps' && geolocation.position && (
                <span className="ml-auto text-xs text-emerald-600">hazır</span>
              )}
            </label>
            <label
              className={`flex items-center gap-2 text-sm ${homeAvailable ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
            >
              <input
                type="radio"
                name="startMode"
                value="home"
                disabled={!homeAvailable}
                checked={startMode === 'home'}
                onChange={() => setStartMode('home')}
                className="h-4 w-4"
              />
              <Home size={14} className="text-purple-600" />
              <span>Profilime kayıtlı ev/depo</span>
              {!homeAvailable && <span className="ml-auto text-xs text-slate-400">tanımsız</span>}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="startMode"
                value="manual"
                checked={startMode === 'manual'}
                onChange={() => setStartMode('manual')}
                className="h-4 w-4"
              />
              <MapPin size={14} className="text-slate-600" />
              <span>Manuel (haritadan seç)</span>
              {startMode === 'manual' && manualPoint && (
                <span className="ml-auto text-xs text-emerald-600">seçildi</span>
              )}
            </label>
          </div>
          {startMode === 'manual' && (
            <div className="mt-2 overflow-hidden rounded-md border border-slate-200">
              <div
                ref={manualMapContainer}
                className="h-32 w-full"
                aria-label="Manuel başlangıç haritası"
              />
              <p className="bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                Haritaya tıklayarak başlangıç noktası seç
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Optimize butonu */}
      <button
        type="button"
        onClick={() => {
          void handleOptimize();
        }}
        disabled={!canOptimize}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-md hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {optimizing ? (
          <>
            <Loader2 size={18} className="animate-spin" />
            Optimize ediliyor… (~5 sn)
          </>
        ) : (
          <>
            <Sparkles size={18} />
            Optimize Et
          </>
        )}
      </button>

      {/* Orta panel — Sonuç */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        {optimizing && (
          <div className="flex flex-col items-center justify-center gap-3 p-8 text-slate-600">
            <Loader2 size={32} className="animate-spin text-blue-600" />
            <span className="text-sm">Optimize ediliyor… (~5 sn)</span>
          </div>
        )}

        {!optimizing && routeResult && (
          <>
            {/* Stat row */}
            <div className="grid grid-cols-2 gap-2 border-b border-slate-200 p-3 md:grid-cols-4">
              <Stat label="Toplam" value={`${routeResult.totalKm.toFixed(1)} km`} />
              <Stat label="Tahmini süre" value={`~${routeResult.estimatedDurationMin} dk`} />
              <Stat
                label="2-opt tasarrufu"
                value={
                  routeResult.savedKm > 0 ? `-${Math.round(routeResult.savedKm * 1000)} m` : '—'
                }
                accent={routeResult.savedKm > 0 ? 'green' : 'gray'}
              />
              <Stat label="Yöntem" value={routeResult.method.toUpperCase()} />
            </div>

            {/* Harita + tablo grid */}
            <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_1fr]">
              {/* Harita */}
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div
                  ref={resultMapContainer}
                  className="h-[400px] w-full"
                  aria-label="Rota haritası"
                />
              </div>

              {/* Tablo */}
              <div className="max-h-[400px] overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Sıra</th>
                      <th className="px-2 py-1.5 text-left">Klinik</th>
                      <th className="px-2 py-1.5 text-left">Mahalle</th>
                      <th className="px-2 py-1.5 text-right">Km</th>
                      <th className="px-2 py-1.5 text-left">Tel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {routeResult.orderedClinics.map((c, i) => {
                      const km = routeResult.cumulativeKm[i] ?? 0;
                      const rowBg = c.segment === 'kamu' ? 'bg-purple-50' : 'bg-white';
                      return (
                        <tr
                          key={`${c.id ?? c.place_id ?? c.name}-${i}`}
                          className={`${rowBg} border-t border-slate-100`}
                        >
                          <td className="px-2 py-1.5 font-mono text-slate-600">{i + 1}</td>
                          <td className="px-2 py-1.5 font-medium text-slate-800" title={c.name}>
                            {truncate(c.name, 28)}
                          </td>
                          <td className="px-2 py-1.5 text-slate-600">{c.neighborhood ?? '—'}</td>
                          <td className="px-2 py-1.5 text-right font-mono text-slate-700">
                            {km.toFixed(1)}
                          </td>
                          <td className="px-2 py-1.5">
                            {c.phone ? (
                              <a
                                href={`tel:${c.phone}`}
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                              >
                                <Phone size={11} />
                                {c.phone}
                              </a>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {!optimizing && !routeResult && (
          <div className="p-6 text-center text-sm text-slate-500">
            &quot;Optimize Et&quot; butonuna basın — {clinics.length} klinik için en kısa rota
            hesaplanır.
          </div>
        )}
      </section>

      {/* Alt panel — İşlemler */}
      <section className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="mb-2">
          <label htmlFor="route-planner-rep-name" className="text-xs font-medium text-slate-600">
            Temsilci adı (Excel + DB için)
          </label>
          <input
            id="route-planner-rep-name"
            type="text"
            value={repName}
            onChange={(e) => setRepName(e.target.value)}
            placeholder="örn. Ali Yılmaz"
            className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={!routeResult}
            className="flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download size={16} /> Excel İndir
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSaveRoute();
            }}
            disabled={!routeResult || saving}
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {saving ? 'Saklanıyor…' : 'Rotayı Sakla'}
          </button>
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcı componentler
// ─────────────────────────────────────────────────────────────────────────────

interface StatProps {
  label: string;
  value: string;
  accent?: 'green' | 'gray';
}

function Stat({ label, value, accent }: StatProps): JSX.Element {
  const color =
    accent === 'green'
      ? 'text-emerald-600'
      : accent === 'gray'
        ? 'text-slate-500'
        : 'text-slate-900';
  return (
    <div className="text-center">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-base font-bold ${color}`}>{value}</div>
    </div>
  );
}
