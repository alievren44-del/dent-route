/**
 * SahaTaraPage — Saha personeli için DB-mod ve Taze-mod tarama.
 *
 * DB modu (default):
 *   - GPS al
 *   - Reverse geocode (mahalle/ilçe) → districts.json'dan nüfus → dynamic radius
 *   - saha_search_nearby_clinics RPC çağrısı
 *
 * Taze modu:
 *   - Preflight rate-limit check (saha_api_usage)
 *   - clinic-scan-v3 invoke (dryRun:false, kullanıcı konumu + dynamic radius)
 *   - Bittikten sonra DB refetch
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  MapPin,
  AlertCircle,
  BadgeCheck,
  Phone,
  Star,
  ShoppingCart,
  Crosshair,
} from 'lucide-react';
import { toast } from 'sonner';

import { useGeolocation } from '@features/map/hooks/useGeolocation';
import { getSupabaseClient } from '@lib/supabase';
import { mapboxReverseGeocode } from '@/lib/mapboxGeocode';
import { ScanModeToggle } from '@features/discovery/components/ScanModeToggle';
import { radiusForNufus, describeRadius } from '@features/discovery/lib/dynamic-radius';
import { getDailyUsage } from '@/lib/saha-rate-limit';
import { useRouteBasket } from '@features/routes/store/routeBasketStore';
import { DistrictPicker } from '@features/routes/components/DistrictPicker';
import districts from '@/data/tr-locations/districts.json';

const STORAGE_KEY = 'saha-scan-mode-v1';
const FRESH_DAILY_LIMIT = 5;

interface NearbyClinic {
  id: string;
  google_place_id: string | null;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  phone: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  types: string[] | null;
  distance_m: number;
  last_verified_at: string | null;
}

interface DistrictInfo {
  slug: string;
  ad: string;
  il_ad: string;
  nufus: number;
}

function slugifyTr(s: string): string {
  return String(s ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/i̇/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findDistrictByName(provinceAd: string, districtAd: string): DistrictInfo | null {
  const ps = slugifyTr(provinceAd);
  const ds = slugifyTr(districtAd);
  const list = districts as Array<{ il_ad: string; ad: string; slug: string; nufus_2023: number }>;
  for (const d of list) {
    if (slugifyTr(d.il_ad) !== ps) continue;
    if (slugifyTr(d.ad) === ds) {
      return { slug: d.slug, ad: d.ad, il_ad: d.il_ad, nufus: d.nufus_2023 };
    }
  }
  return null;
}

function freshnessLabel(iso: string | null): { text: string; warn: boolean } {
  if (!iso) return { text: 'Doğrulanmadı', warn: true };
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 7) return { text: `${days}g önce`, warn: false };
  if (days < 60) return { text: `${days}g önce`, warn: false };
  return { text: `${days}g önce — eski`, warn: true };
}

export default function SahaTaraPage() {
  const navigate = useNavigate();
  const geo = useGeolocation();

  const [mode, setMode] = useState<'db' | 'fresh'>(() => {
    if (typeof window === 'undefined') return 'db';
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'fresh' ? 'fresh' : 'db';
  });
  const [districtInfo, setDistrictInfo] = useState<DistrictInfo | null>(null);
  // Konum kaynağı: GPS (otomatik) veya manuel (il+ilçe seçimi)
  const [locationMode, setLocationMode] = useState<'gps' | 'manual'>('gps');
  const [manualProvince, setManualProvince] = useState('');
  const [manualDistrict, setManualDistrict] = useState('');
  const [clinics, setClinics] = useState<NearbyClinic[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number; remaining: number }>({
    used: 0,
    limit: FRESH_DAILY_LIMIT,
    remaining: FRESH_DAILY_LIMIT,
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (geo.status === 'idle') geo.request();
  }, [geo]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* yutulur */
    }
  }, [mode]);

  // GPS gelince reverse geocode → district info (sadece GPS modunda)
  useEffect(() => {
    if (locationMode !== 'gps' || !geo.position) return;
    const lat = geo.position.lat;
    const lng = geo.position.lng;
    void (async () => {
      try {
        const result = await mapboxReverseGeocode(lat, lng);
        if (result?.district && result?.province) {
          const info = findDistrictByName(result.province, result.district);
          if (info) setDistrictInfo(info);
        }
      } catch {
        /* yutulur */
      }
    })();
  }, [geo.position, locationMode]);

  // Manuel ilçe seçimi → districtInfo
  useEffect(() => {
    if (locationMode !== 'manual' || !manualProvince || !manualDistrict) return;
    const list = districts as Array<{
      il_ad: string;
      ad: string;
      slug: string;
      nufus_2023: number;
    }>;
    const found = list.find(
      (d) => slugifyTr(d.il_ad) === manualProvince && d.slug === manualDistrict,
    );
    if (found) {
      setDistrictInfo({
        slug: found.slug,
        ad: found.ad,
        il_ad: found.il_ad,
        nufus: found.nufus_2023,
      });
    }
  }, [locationMode, manualProvince, manualDistrict]);

  // Konum origin — GPS modunda gps.position, manuel modda ilçe centroid
  const searchOrigin = useMemo(() => {
    if (locationMode === 'gps' && geo.position) {
      return { lat: geo.position.lat, lng: geo.position.lng };
    }
    if (locationMode === 'manual' && manualProvince && manualDistrict) {
      const list = districts as Array<{
        il_ad: string;
        ad: string;
        slug: string;
        lat: number;
        lng: number;
      }>;
      const found = list.find(
        (d) => slugifyTr(d.il_ad) === manualProvince && d.slug === manualDistrict,
      );
      if (found) return { lat: found.lat, lng: found.lng };
    }
    return null;
  }, [locationMode, geo.position, manualProvince, manualDistrict]);

  // districtInfo yoksa fallback 3km (orta tier), varsa nüfusa göre dinamik.
  // Kullanıcı manuel override edebilsin diye state.
  const dynamicRadius = useMemo(
    () => (districtInfo ? radiusForNufus(districtInfo.nufus) : 3000),
    [districtInfo],
  );
  const [radiusOverride, setRadiusOverride] = useState<number | null>(null);
  const radius = radiusOverride ?? dynamicRadius;

  const loadDb = useCallback(async () => {
    if (!searchOrigin) return;
    setLoading(true);
    setErr(null);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('saha_search_nearby_clinics', {
        _lat: searchOrigin.lat,
        _lng: searchOrigin.lng,
        _radius_m: radius,
        _vertical_key: 'dental',
        _limit: 100,
      });
      if (error) throw error;
      setClinics((data ?? []) as NearbyClinic[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Klinik aranamadı');
    } finally {
      setLoading(false);
    }
  }, [searchOrigin, radius]);

  // Konum origin hazır olunca otomatik DB yükle (districtInfo opsiyonel).
  useEffect(() => {
    if (mode === 'db' && searchOrigin) {
      void loadDb();
    }
  }, [mode, searchOrigin, radius, loadDb]);

  // Fresh mode için günlük kullanım çek
  useEffect(() => {
    void getDailyUsage('clinic-scan-v3', FRESH_DAILY_LIMIT).then(setUsage);
  }, []);

  const triggerFreshScan = useCallback(async () => {
    if (!searchOrigin) {
      toast.error('Konum yok — GPS aç veya manuel ilçe seç');
      return;
    }
    if (usage.remaining <= 0) {
      toast.error('Günlük yeni tarama hakkın doldu');
      return;
    }
    setScanning(true);
    setErr(null);
    try {
      const supabase = getSupabaseClient();
      // districtInfo yoksa edge fn'a default bos slug + strictDistrict false geç
      const provinceSlug = districtInfo ? slugifyTr(districtInfo.il_ad) : 'unknown';
      const districtSlug = districtInfo?.slug ?? 'merkez';
      const { data, error } = await supabase.functions.invoke('clinic-scan-v3', {
        body: {
          lat: searchOrigin.lat,
          lng: searchOrigin.lng,
          radiusM: radius,
          provinceSlug,
          districtSlug,
          source: 'google',
          intensity: 'standard',
          includeKamu: true,
          dryRun: false,
          // districtInfo varsa strict, yoksa loose (sınır check'i pas)
          strictDistrict: Boolean(districtInfo),
        },
      });
      if (error) {
        console.error('[triggerFreshScan] invoke error:', error);
        throw error;
      }
      const result =
        (data as { status?: string; new?: number; scanned?: number; errors?: string[] }) ?? {};
      if (result.status === 'error') {
        const errMsg = result.errors?.join(', ') ?? 'tarama hatası';
        throw new Error(errMsg);
      }
      toast.success(
        `${result.new ?? 0} yeni klinik bulundu (${result.scanned ?? 0} taranan toplam)`,
      );
      // Refresh usage + DB list
      const newUsage = await getDailyUsage('clinic-scan-v3', FRESH_DAILY_LIMIT);
      setUsage(newUsage);
      await loadDb();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Tarama hatası');
    } finally {
      setScanning(false);
    }
  }, [geo.position, districtInfo, usage.remaining, radius, loadDb]);

  const addToBasket = useCallback((c: NearbyClinic) => {
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

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Saha Tarama</h1>
        <p className="text-sm text-slate-600">
          Konumundan klinikleri keşfet. Veri tabanı modu (hızlı) veya Google üzerinden taze tarama.
        </p>
      </header>

      <section className="rounded-xl bg-white p-3 shadow-sm">
        <ScanModeToggle
          mode={mode}
          onChange={setMode}
          freshDisabled={usage.remaining <= 0}
          remainingFresh={usage.remaining}
        />
      </section>

      {/* Konum kaynağı: GPS / Manuel */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <div className="mb-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setLocationMode('gps')}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition ${
              locationMode === 'gps'
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Crosshair size={14} />
            Konumum (GPS)
          </button>
          <button
            type="button"
            onClick={() => setLocationMode('manual')}
            className={`flex h-10 items-center justify-center gap-1.5 rounded-lg border text-xs font-medium transition ${
              locationMode === 'manual'
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <MapPin size={14} />
            İl + İlçe Seç
          </button>
        </div>
        {locationMode === 'manual' && (
          <DistrictPicker
            provinceSlug={manualProvince}
            districtSlug={manualDistrict}
            onChange={(p, d) => {
              setManualProvince(p);
              setManualDistrict(d);
            }}
          />
        )}
      </section>

      {districtInfo && (
        <section className="rounded-xl bg-blue-50 p-3">
          <div className="flex items-center gap-2 text-sm text-blue-900">
            <MapPin size={16} />
            <span>
              <strong>
                {districtInfo.il_ad} / {districtInfo.ad}
              </strong>{' '}
              — nüfus {(districtInfo.nufus / 1000).toFixed(0)}k
            </span>
          </div>
          <p className="mt-1 text-xs text-blue-700">{describeRadius(radius)}</p>
        </section>
      )}

      {/* Radius slider — kullanıcı manuel ayar */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600">Tarama yarıçapı</span>
          <span className="font-bold text-slate-900">{(radius / 1000).toFixed(1)} km</span>
        </div>
        <input
          type="range"
          min={500}
          max={10000}
          step={500}
          value={radius}
          onChange={(e) => setRadiusOverride(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>0.5km</span>
          <span>5km</span>
          <span>10km</span>
        </div>
      </section>

      {mode === 'fresh' && (
        <section className="rounded-xl bg-emerald-50 p-3">
          <div className="flex items-center justify-between text-sm text-emerald-900">
            <span>
              <strong>Yeni tarama:</strong> Google üzerinden yeni klinikler bul. Günlük {usage.used}
              /{usage.limit} kullanıldı.
            </span>
            <button
              type="button"
              onClick={() => void triggerFreshScan()}
              disabled={scanning || usage.remaining <= 0 || !geo.position}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {scanning ? 'Taranıyor…' : 'Yeni Tarama Yap'}
            </button>
          </div>
          {!districtInfo && (
            <p className="mt-1 text-[11px] text-emerald-700">
              İlçe tespit edilemedi — sadece koordinat bazlı tarama yapılır.
            </p>
          )}
        </section>
      )}

      {err && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertCircle size={16} className="shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{err}</p>
        </div>
      )}

      {(loading || scanning) && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      )}

      {!loading && clinics.length === 0 && geo.position && (
        <p className="text-sm text-slate-500">
          {mode === 'db'
            ? "Bu yarıçapta klinik yok. Taze tara ile Google'a sor."
            : 'Tara butonuna bas.'}
        </p>
      )}

      {clinics.length > 0 && (
        <ul className="space-y-2">
          {clinics.map((c) => {
            const fresh = freshnessLabel(c.last_verified_at);
            return (
              <li key={c.id} className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span>{(c.distance_m / 1000).toFixed(1)} km</span>
                      {c.rating != null && (
                        <span className="inline-flex items-center gap-0.5">
                          <Star size={11} className="text-amber-500" />
                          {c.rating}
                          {c.user_ratings_total != null && (
                            <span className="text-slate-400">({c.user_ratings_total})</span>
                          )}
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-0.5 ${fresh.warn ? 'text-amber-700' : 'text-emerald-700'}`}
                      >
                        <BadgeCheck size={11} />
                        {fresh.text}
                      </span>
                    </div>
                    {c.address && (
                      <div className="mt-1 text-xs text-slate-500 truncate">{c.address}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => addToBasket(c)}
                    className="shrink-0 rounded-lg bg-blue-600 p-2 text-white hover:bg-blue-700"
                    aria-label="Sepete ekle"
                  >
                    <ShoppingCart size={14} />
                  </button>
                </div>
                {c.phone && (
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`tel:${c.phone}`}
                      className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700"
                    >
                      <Phone size={11} /> {c.phone}
                    </a>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {clinics.length > 0 && (
        <button
          type="button"
          onClick={() => navigate('/routes/plan')}
          className="sticky bottom-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-md"
        >
          Sepete git → Rota planla
        </button>
      )}
    </div>
  );
}
