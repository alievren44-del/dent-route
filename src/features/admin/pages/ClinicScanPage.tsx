/**
 * ClinicScanPage — Admin klinik tarama merkezi.
 *
 * 5 tab:
 *   1. Tek İlçe   — Manuel tek nokta tarama (clinic-scan direct).
 *   2. Tüm İl     — Bir ilin TÜM ilçelerini batch-scan ile tara.
 *   3. Bölge      — Coğrafi bölgedeki TÜM ilçeleri batch-scan ile tara.
 *   4. Türkiye    — 81 il + tüm ilçeler (UYARI).
 *   5. Aktif Job'lar — ScanJobsPage embed.
 *
 * Tek İlçe sekmesi PROMPT-3+7 ile eklenen Kaynak (google/osm/both) radio'sunu
 * ve filtered_out / google_count / osm_count gösterimini KORUR.
 */

import { useState, useMemo, useRef } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, MapPin, CheckCircle2, AlertCircle, Loader2,
  Layers, Globe, Map as MapIcon, ListChecks, AlertTriangle,
} from 'lucide-react';
import { getProvinces, getDistrictsByProvince } from '@/data/tr-locations/geo-helpers';
import { getSupabaseClient } from '@lib/supabase';
import ScanJobsPage from './ScanJobsPage';
import ScanPreviewDialog from '@features/admin/components/ScanPreviewDialog';
import DistrictClinicsDialog from '@features/admin/components/DistrictClinicsDialog';
import ManualAddClinicModal from '@features/admin/components/ManualAddClinicModal';
import EditClinicModal, { type SahaClinicRow as EditClinicTarget } from '@features/admin/components/EditClinicModal';
import {
  useScanPreview,
  type ScanPreviewClinic,
} from '@features/admin/store/scanPreviewStore';

// ============================================================================
// Types
// ============================================================================

type SourceMode = 'google' | 'osm' | 'both' | 'doktor_takvimi' | 'all';
type TabKey = 'single' | 'province' | 'region' | 'country' | 'jobs';
type RegionSlug =
  | 'marmara' | 'ege' | 'akdeniz' | 'ic_anadolu'
  | 'karadeniz' | 'dogu_anadolu' | 'guneydogu';

interface ScanResult {
  status: string;
  scanned: number;
  new: number;
  updated: number;
  errors?: string[];
  filtered_out?: number;
  filtered_reasons?: Array<{ name: string; reason: string }>;
  google_count?: number;
  osm_count?: number;
  /** v2 dryRun yanıtında dolu — preview için kliniklerin tam listesi. */
  clinics?: ScanPreviewClinic[];
}

type ScanInput = {
  lat: number;
  lng: number;
  radiusM: number;
  provinceSlug: string;
  districtSlug?: string;
  types: string[];
  source: SourceMode;
  intensity?: ScanIntensity;
  scanMode?: ScanMode;
  dryRun?: boolean;
  placeIdsAllowlist?: string[];
};

const TYPE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'dentist',  label: 'Diş Hekimi' },
  { key: 'doctor',   label: 'Doktor' },
  { key: 'hospital', label: 'Hastane' },
];

const RADIUS_OPTIONS = [5, 10, 15, 20] as const;

const SOURCE_OPTIONS: Array<{ key: SourceMode; label: string }> = [
  { key: 'google', label: 'Google (kapsamlı, ücretli)' },
  { key: 'osm',    label: 'OSM (ücretsiz)' },
  { key: 'both',   label: 'Her ikisi (önerilen)' },
];

/** v3 motoru için ek kaynak seçenekleri (mahalle + DoktorTakvimi crawl). */
const SOURCE_OPTIONS_V3: Array<{ key: SourceMode; label: string }> = [
  { key: 'google',         label: 'Google (kapsamlı, ücretli)' },
  { key: 'osm',            label: 'OSM (ücretsiz)' },
  { key: 'both',           label: 'Google + OSM' },
  { key: 'doktor_takvimi', label: 'DoktorTakvimi (web crawl, ücretsiz)' },
  { key: 'all',            label: 'Hepsi (Google + OSM + DoktorTakvimi — önerilen)' },
];

const REGION_OPTIONS: Array<{ key: RegionSlug; label: string }> = [
  { key: 'marmara',      label: 'Marmara' },
  { key: 'ege',          label: 'Ege' },
  { key: 'akdeniz',      label: 'Akdeniz' },
  { key: 'ic_anadolu',   label: 'İç Anadolu' },
  { key: 'karadeniz',    label: 'Karadeniz' },
  { key: 'dogu_anadolu', label: 'Doğu Anadolu' },
  { key: 'guneydogu',    label: 'Güneydoğu Anadolu' },
];

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'single',   label: 'Tek İlçe',     icon: <MapPin className="h-4 w-4" /> },
  { key: 'province', label: 'Tüm İl',       icon: <MapIcon className="h-4 w-4" /> },
  { key: 'region',   label: 'Bölge',        icon: <Layers className="h-4 w-4" /> },
  { key: 'country',  label: 'Türkiye',      icon: <Globe className="h-4 w-4" /> },
  { key: 'jobs',     label: "Aktif Job'lar", icon: <ListChecks className="h-4 w-4" /> },
];

// ============================================================================
// API helpers
// ============================================================================

// v1/v2 yoğunluk: standard|high|max
// v3 yoğunluk: standard|deep|exhaustive
type ScanIntensity = 'standard' | 'high' | 'max' | 'deep' | 'exhaustive';
type ScanMode = 'v1' | 'v2' | 'v3';

async function callScan(input: ScanInput): Promise<ScanResult> {
  const supabase = getSupabaseClient();
  const fnName =
    input.scanMode === 'v3' ? 'clinic-scan-v3'
    : input.scanMode === 'v2' ? 'clinic-scan-v2'
    : 'clinic-scan';
  // v2: intensity → gridSize + useTextSearch eşlemesi
  //   standard → 9 grid, text kapalı  (~60-90sn, ~$3-5)
  //   high     → 13 grid, text kapalı (~90-120sn, ~$5-8)
  //   max      → 13 grid + textsearch (~120-140sn, ~$8-12)
  // 25 grid çıkarıldı: 150sn EF wall limit aşıyor. Kullanıcı CLI ile özel param geçebilir.
  // v2 ek param: dryRun (commit'ten önce preview), placeIdsAllowlist (commit aşamasında)
  //
  // v3: Akıllı motor — mahalle + uzmanlık + 9 keyword + DoktorTakvimi web crawl.
  //   intensity: 'standard' | 'deep' | 'exhaustive'
  //   source:    'google' | 'osm' | 'both' | 'doktor_takvimi' | 'all'
  //   includeKamu: true → kamu klinikleri de dahil edilir.
  let body: Record<string, unknown>;
  if (input.scanMode === 'v3') {
    body = {
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      provinceSlug: input.provinceSlug,
      districtSlug: input.districtSlug,
      source: input.source,
      intensity: input.intensity ?? 'standard',
      includeKamu: true,
      dryRun: input.dryRun ?? false,
      // İl+ilçe seçildiyse adresi başka ilçeye düşen sonuçlar reddedilsin.
      // Edge fn enum-neighborhoods'tan mahalle çekip o listede olanları yine kabul eder.
      strictDistrict: Boolean(input.districtSlug),
      ...(input.placeIdsAllowlist ? { placeIdsAllowlist: input.placeIdsAllowlist } : {}),
    };
  } else if (input.scanMode === 'v2') {
    body = {
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      provinceSlug: input.provinceSlug,
      districtSlug: input.districtSlug,
      source: input.source,
      gridSize: input.intensity === 'standard' ? 9 : 13,
      useTextSearch: input.intensity === 'max',
      dryRun: input.dryRun ?? false,
      ...(input.placeIdsAllowlist ? { placeIdsAllowlist: input.placeIdsAllowlist } : {}),
    };
  } else {
    body = input;
  }
  const { data, error } = await supabase.functions.invoke(fnName, { body });
  if (error) throw error;
  return data as ScanResult;
}

interface CreateBatchJobInput {
  scope_type: 'whole_province' | 'region' | 'whole_country';
  scope_params: Record<string, unknown>;
  radius_km: number;
  scan_types: string[];
  scan_source: SourceMode;
  scan_intensity?: ScanIntensity;
  vertical_key?: string;
}

async function createBatchJob(input: CreateBatchJobInput): Promise<{ id: string }> {
  const supabase = getSupabaseClient();
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id ?? null;

  const { data, error } = await supabase
    .from('saha_scan_jobs')
    .insert({
      scope_type: input.scope_type,
      scope_params: input.scope_params,
      radius_km: input.radius_km,
      scan_types: input.scan_types,
      scan_source: input.scan_source,
      scan_intensity: input.scan_intensity ?? 'standard',
      vertical_key: input.vertical_key ?? 'dental',
      status: 'pending',
      created_by: userId,
    })
    .select('id')
    .single();

  if (error) throw error;
  const jobId = (data as { id: string }).id;

  // Fire-and-forget: batch-scan'i tetikle.
  try {
    void supabase.functions.invoke('batch-scan', { body: { jobId } });
  } catch {
    /* Yutulur — job kaydı durur, sonra elle tekrar çağrılabilir */
  }

  return { id: jobId };
}

async function fetchScanStats() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_clinics')
    .select('province_slug, district_slug, last_verified_at')
    .order('last_verified_at', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  const byKey = new Map<string, { province: string; district: string | null; count: number; lastVerified: string | null }>();
  for (const row of (data ?? []) as Array<{ province_slug: string | null; district_slug: string | null; last_verified_at: string | null }>) {
    const key = `${row.province_slug ?? '-'}|${row.district_slug ?? '-'}`;
    const ex = byKey.get(key);
    if (ex) {
      ex.count++;
      if (row.last_verified_at && (!ex.lastVerified || row.last_verified_at > ex.lastVerified)) {
        ex.lastVerified = row.last_verified_at;
      }
    } else {
      byKey.set(key, {
        province: row.province_slug ?? '',
        district: row.district_slug,
        count: 1,
        lastVerified: row.last_verified_at,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count);
}

// ============================================================================
// Shared form controls
// ============================================================================

interface SharedScanOpts {
  radiusKm: number;
  setRadiusKm: (v: number) => void;
  selectedTypes: Set<string>;
  setSelectedTypes: (s: Set<string>) => void;
  source: SourceMode;
  setSource: (s: SourceMode) => void;
  intensity: ScanIntensity;
  setIntensity: (v: ScanIntensity) => void;
  scanMode: ScanMode;
  setScanMode: (m: ScanMode) => void;
}

function SharedOptsBox(props: SharedScanOpts) {
  // v3 modunda kaynak listesi DoktorTakvimi + 'all' opsiyonlarını içerir.
  // v3 modunda intensity v3-spesifik (standard/deep/exhaustive) seçenekleri kullanır.
  const isV3 = props.scanMode === 'v3';
  const sourceList = isV3 ? SOURCE_OPTIONS_V3 : SOURCE_OPTIONS;
  const intensityList = isV3 ? INTENSITY_OPTIONS_V3 : INTENSITY_OPTIONS;
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div>
        <label className="text-sm font-medium block mb-1">Yarıçap</label>
        <div className="flex gap-2 flex-wrap">
          {RADIUS_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => props.setRadiusKm(r)}
              className={`px-3 h-9 rounded-lg border text-sm ${
                props.radiusKm === r
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border bg-background'
              }`}
            >
              {r} km
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">Tip</label>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((t) => {
            const checked = props.selectedTypes.has(t.key);
            return (
              <label
                key={t.key}
                className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border cursor-pointer ${
                  checked ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(props.selectedTypes);
                    if (checked) next.delete(t.key); else next.add(t.key);
                    props.setSelectedTypes(next);
                  }}
                  className="sr-only"
                />
                <span className="text-sm">{t.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">Kaynak</label>
        <div className="flex flex-col gap-1.5">
          {sourceList.map((s) => (
            <label
              key={s.key}
              className={`inline-flex items-center gap-2 px-3 h-10 rounded-lg border cursor-pointer ${
                props.source === s.key ? 'bg-primary/10 border-primary' : 'border-border bg-background'
              }`}
            >
              <input
                type="radio"
                name="scan-source"
                value={s.key}
                checked={props.source === s.key}
                onChange={() => props.setSource(s.key)}
              />
              <span className="text-sm">{s.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">
          Tarama Motoru
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (v3 = akıllı; mahalle + uzmanlık + DoktorTakvimi)
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          <label className={`inline-flex items-center gap-2 px-3 h-10 rounded-lg border cursor-pointer ${props.scanMode === 'v1' ? 'bg-primary/10 border-primary' : 'border-border bg-background'}`}>
            <input type="radio" name="scan-mode" value="v1" checked={props.scanMode === 'v1'} onChange={() => props.setScanMode('v1')} />
            <span className="text-sm">v1 — Hızlı (1-13 nokta, ~$0.5-3/ilçe)</span>
          </label>
          <label className={`inline-flex items-center gap-2 px-3 h-10 rounded-lg border cursor-pointer ${props.scanMode === 'v2' ? 'bg-primary/10 border-primary' : 'border-border bg-background'}`}>
            <input type="radio" name="scan-mode" value="v2" checked={props.scanMode === 'v2'} onChange={() => props.setScanMode('v2')} />
            <span className="text-sm">v2 — Yüksek Kapsam (25 grid + 9 keyword + TextSearch, ~$10-25/ilçe)</span>
          </label>
          <label className={`inline-flex items-center gap-2 px-3 h-10 rounded-lg border cursor-pointer ${props.scanMode === 'v3' ? 'bg-primary/10 border-primary' : 'border-border bg-background'}`}>
            <input type="radio" name="scan-mode" value="v3" checked={props.scanMode === 'v3'} onChange={() => props.setScanMode('v3')} />
            <span className="text-sm">v3 — Akıllı (mahalle + uzmanlık + 9 keyword + DoktorTakvimi, ~$3-8/ilçe)</span>
          </label>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-2">
          Tarama Yoğunluğu
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {isV3
              ? '(v3: standard/deep/exhaustive)'
              : '(v1/v2: yüksek = daha fazla klinik, daha çok maliyet)'}
          </span>
        </label>
        <div className="flex flex-col gap-1.5">
          {intensityList.map((opt) => (
            <label
              key={opt.key}
              className={`inline-flex items-center gap-2 px-3 h-10 rounded-lg border cursor-pointer ${
                props.intensity === opt.key ? 'bg-primary/10 border-primary' : 'border-border bg-background'
              }`}
            >
              <input
                type="radio"
                name="scan-intensity"
                value={opt.key}
                checked={props.intensity === opt.key}
                onChange={() => props.setIntensity(opt.key)}
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

const INTENSITY_OPTIONS: { key: ScanIntensity; label: string }[] = [
  { key: 'standard', label: 'Standart (tek tür, ~$0.5/ilçe)' },
  { key: 'high', label: 'Yüksek (+2 keyword, ~$1.5/ilçe)' },
  { key: 'max', label: 'Maksimum (+4 keyword, ~$3/ilçe)' },
];

/** v3 motoru için yoğunluk seçenekleri. */
const INTENSITY_OPTIONS_V3: { key: ScanIntensity; label: string }[] = [
  { key: 'standard',   label: 'Standart (~$3/ilçe, mahalle + 9 keyword)' },
  { key: 'deep',       label: 'Derin (~$5/ilçe, + uzmanlık varyantları)' },
  { key: 'exhaustive', label: 'Eksiksiz (~$8/ilçe, + DoktorTakvimi crawl + TextSearch)' },
];

// ============================================================================
// Tab content components
// ============================================================================

function SingleDistrictTab(props: SharedScanOpts & {
  statsRefetcher: { current: (() => void) | null };
  onDrillDown?: (row: { province: string; district: string | null }) => void;
}) {
  const [provinceSlug, setProvinceSlug] = useState<string>('');
  const [districtSlug, setDistrictSlug] = useState<string>('');
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);

  const provinces = getProvinces();
  const selectedProvince = provinceSlug ? provinces.find((p) => p.slug === provinceSlug) : undefined;
  const districts = selectedProvince ? getDistrictsByProvince(selectedProvince.plaka) : [];
  const selectedDistrict = districtSlug ? districts.find((d) => d.slug === districtSlug) : undefined;

  const statsQuery = useQuery({ queryKey: ['clinic-scan-stats'], queryFn: fetchScanStats });
  // Expose refetcher to page root so commit handler can refresh stats after upsert.
  props.statsRefetcher.current = () => { void statsQuery.refetch(); };

  const openPreview = useScanPreview((s) => s.openPreview);

  const scanMutation = useMutation({
    mutationFn: callScan,
    onSuccess: (data, variables) => {
      // v2/v3 + dryRun → preview dialog. Direct commit path (v1) eskisi gibi.
      if (
        variables.dryRun &&
        data.clinics &&
        (variables.scanMode === 'v2' || variables.scanMode === 'v3')
      ) {
        openPreview({
          clinics: data.clinics,
          filteredReasons: data.filtered_reasons ?? [],
          scanInput: variables as unknown as Record<string, unknown>,
        });
        // dryRun yanıtında scanned/new/updated 0 — eski summary panelini kirletmemek için
        // lastResult'ı set ETMİYORUZ; dialog kapanıp commit gelince refetch tetiklenir.
        return;
      }
      setLastResult(data);
      void statsQuery.refetch();
    },
    onError: (err: unknown) => {
      setLastResult({
        status: 'error',
        scanned: 0, new: 0, updated: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    },
  });

  const canScan = !!selectedProvince && props.selectedTypes.size > 0 && !scanMutation.isPending;

  const handleScan = () => {
    if (!selectedProvince) return;
    const target = selectedDistrict ?? selectedProvince;
    // PLAN kararı 1: tek-ilçe v2/v3 taraması default olarak PREVIEW ister.
    // v1 modu eski davranışı korur (direct commit).
    const useDryRun = props.scanMode === 'v2' || props.scanMode === 'v3';
    scanMutation.mutate({
      lat: target.lat,
      lng: target.lng,
      radiusM: props.radiusKm * 1000,
      provinceSlug: selectedProvince.slug,
      ...(selectedDistrict ? { districtSlug: selectedDistrict.slug } : {}),
      types: Array.from(props.selectedTypes),
      source: props.source,
      intensity: props.intensity,
      scanMode: props.scanMode,
      dryRun: useDryRun,
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Öncelikli iller:</strong> Malatya, Mardin, Sivas — bu illeri ilk tarayın.
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">İl</label>
          <select
            value={provinceSlug}
            onChange={(e) => { setProvinceSlug(e.target.value); setDistrictSlug(''); }}
            className="w-full h-11 rounded-lg border border-border bg-background px-3"
          >
            <option value="">İl seç…</option>
            {provinces.map((p) => (
              <option key={p.slug} value={p.slug}>{p.ad} ({p.bolge})</option>
            ))}
          </select>
        </div>

        {selectedProvince && (
          <div>
            <label className="text-sm font-medium block mb-1">İlçe (opsiyonel)</label>
            <select
              value={districtSlug}
              onChange={(e) => setDistrictSlug(e.target.value)}
              className="w-full h-11 rounded-lg border border-border bg-background px-3"
            >
              <option value="">Tüm il (merkez)</option>
              {districts.map((d) => (
                <option key={d.slug} value={d.slug}>{d.ad}</option>
              ))}
            </select>
          </div>
        )}

        <button
          type="button"
          onClick={handleScan}
          disabled={!canScan}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
        >
          {scanMutation.isPending ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Taranıyor…
            </span>
          ) : 'Tarama Başlat'}
        </button>
      </div>

      {lastResult && (
        <div className={`rounded-xl border p-4 ${lastResult.status === 'ok' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {lastResult.status === 'ok' ? (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-700 mt-0.5" />
              <div className="text-sm">
                <strong>Tarama tamam</strong>
                <ul className="mt-1 space-y-0.5">
                  <li>Toplam: <strong>{lastResult.scanned}</strong> klinik bulundu</li>
                  <li>Yeni: <strong className="text-green-700">{lastResult.new}</strong></li>
                  <li>Güncellendi: <strong>{lastResult.updated}</strong></li>
                  {typeof lastResult.google_count === 'number' && (
                    <li>Google: <strong>{lastResult.google_count}</strong></li>
                  )}
                  {typeof lastResult.osm_count === 'number' && (
                    <li>OSM: <strong>{lastResult.osm_count}</strong></li>
                  )}
                </ul>
                {typeof lastResult.filtered_out === 'number' && lastResult.filtered_out > 0 && (
                  <p className="mt-2 text-amber-800">
                    <strong>{lastResult.filtered_out}</strong> kayıt alakasız kategoride filtrelendi
                    {lastResult.filtered_reasons && lastResult.filtered_reasons.length > 0 && (
                      <span className="block text-xs text-muted-foreground mt-1">
                        Örnekler: {lastResult.filtered_reasons.slice(0, 3).map((r) => r.name).join(', ')}
                      </span>
                    )}
                  </p>
                )}
                {lastResult.errors && lastResult.errors.length > 0 && (
                  <p className="mt-2 text-amber-700">Uyarılar: {lastResult.errors.join(', ')}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-700 mt-0.5" />
              <div className="text-sm text-red-800">
                <strong>Hata:</strong> {lastResult.errors?.join(', ') ?? 'unknown'}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mt-4 mb-2 flex items-center gap-1">
          <MapPin className="h-5 w-5" /> Mevcut Veritabanı
        </h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">İl</th>
                <th className="text-left p-2">İlçe</th>
                <th className="text-right p-2">Klinik</th>
                <th className="text-left p-2">Son Tarama</th>
              </tr>
            </thead>
            <tbody>
              {(statsQuery.data ?? []).slice(0, 50).map((row) => (
                <tr
                  key={`${row.province}|${row.district ?? '-'}`}
                  className="border-t border-border cursor-pointer hover:bg-muted/50"
                  onClick={() => props.onDrillDown?.({ province: row.province, district: row.district })}
                >
                  <td className="p-2">{row.province}</td>
                  <td className="p-2">{row.district ?? '—'}</td>
                  <td className="text-right p-2 font-medium">{row.count}</td>
                  <td className="p-2 text-muted-foreground text-xs">
                    {row.lastVerified ? new Date(row.lastVerified).toLocaleString('tr-TR') : '—'}
                  </td>
                </tr>
              ))}
              {(!statsQuery.data || statsQuery.data.length === 0) && (
                <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Henüz tarama yok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WholeProvinceTab(props: SharedScanOpts & { onJobCreated: () => void }) {
  const [provinceSlug, setProvinceSlug] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);

  const provinces = getProvinces();
  const selectedProvince = provinceSlug ? provinces.find((p) => p.slug === provinceSlug) : undefined;
  const districtCount = selectedProvince ? getDistrictsByProvince(selectedProvince.plaka).length : 0;

  const createJob = useMutation({
    mutationFn: createBatchJob,
    onSuccess: () => {
      setMessage('Job başlatıldı. "Aktif Job\'lar" sekmesinden takip edebilirsiniz.');
      props.onJobCreated();
    },
    onError: (err: unknown) => {
      setMessage(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const canStart = !!selectedProvince && districtCount > 0 && props.selectedTypes.size > 0 && !createJob.isPending;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">İl</label>
          <select
            value={provinceSlug}
            onChange={(e) => { setProvinceSlug(e.target.value); setMessage(null); }}
            className="w-full h-11 rounded-lg border border-border bg-background px-3"
          >
            <option value="">İl seç…</option>
            {provinces.map((p) => (
              <option key={p.slug} value={p.slug}>{p.ad} ({p.bolge})</option>
            ))}
          </select>
          {selectedProvince && (
            <p className="text-xs text-muted-foreground mt-1">
              {districtCount > 0
                ? `Bu il için ${districtCount} ilçe taranacak.`
                : 'UYARI: Bu il için ilçe verisi eksik. Tek İlçe sekmesini kullanın.'}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (!selectedProvince) return;
            createJob.mutate({
              scope_type: 'whole_province',
              scope_params: { province: selectedProvince.slug },
              radius_km: props.radiusKm,
              scan_types: Array.from(props.selectedTypes),
              scan_source: props.source,
              scan_intensity: props.intensity,
            });
          }}
          disabled={!canStart}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
        >
          {createJob.isPending ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Job oluşturuluyor…
            </span>
          ) : `Bu il'in tüm ilçelerini tara`}
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
          {message}
        </div>
      )}
    </div>
  );
}

function RegionTab(props: SharedScanOpts & { onJobCreated: () => void }) {
  const [region, setRegion] = useState<RegionSlug | ''>('');
  const [message, setMessage] = useState<string | null>(null);

  const provinces = getProvinces();
  const provinceCount = useMemo(() => {
    if (!region) return 0;
    return provinces.filter((p) => {
      const map: Record<string, RegionSlug> = {
        'Marmara': 'marmara',
        'Ege': 'ege',
        'Akdeniz': 'akdeniz',
        'İç Anadolu': 'ic_anadolu',
        'Karadeniz': 'karadeniz',
        'Doğu Anadolu': 'dogu_anadolu',
        'Güneydoğu Anadolu': 'guneydogu',
      };
      return map[p.bolge] === region;
    }).length;
  }, [region, provinces]);

  const createJob = useMutation({
    mutationFn: createBatchJob,
    onSuccess: () => {
      setMessage('Job başlatıldı. "Aktif Job\'lar" sekmesinden takip edebilirsiniz.');
      props.onJobCreated();
    },
    onError: (err: unknown) => {
      setMessage(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const canStart = !!region && props.selectedTypes.size > 0 && !createJob.isPending;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">Bölge</label>
          <select
            value={region}
            onChange={(e) => { setRegion(e.target.value as RegionSlug); setMessage(null); }}
            className="w-full h-11 rounded-lg border border-border bg-background px-3"
          >
            <option value="">Bölge seç…</option>
            {REGION_OPTIONS.map((r) => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          {region && (
            <p className="text-xs text-muted-foreground mt-1">
              Bu bölgede {provinceCount} il var. Her ilin tüm ilçeleri taranacak.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (!region) return;
            createJob.mutate({
              scope_type: 'region',
              scope_params: { region },
              radius_km: props.radiusKm,
              scan_types: Array.from(props.selectedTypes),
              scan_source: props.source,
              scan_intensity: props.intensity,
            });
          }}
          disabled={!canStart}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
        >
          {createJob.isPending ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Job oluşturuluyor…
            </span>
          ) : 'Bu bölgedeki tüm illeri tara'}
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{message}</div>
      )}
    </div>
  );
}

function WholeCountryTab(props: SharedScanOpts & { onJobCreated: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const createJob = useMutation({
    mutationFn: createBatchJob,
    onSuccess: () => {
      setMessage('Türkiye taraması başlatıldı. Bu işlem 1-2 gün sürebilir.');
      props.onJobCreated();
      setConfirmed(false);
    },
    onError: (err: unknown) => {
      setMessage(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const canStart = confirmed && props.selectedTypes.size > 0 && !createJob.isPending;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-red-200 bg-red-50 p-4 space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-5 w-5 text-red-700 mt-0.5 shrink-0" />
          <div className="text-sm text-red-900 space-y-1">
            <p className="font-semibold">UYARI — Tüm Türkiye Taraması</p>
            <ul className="list-disc ml-5 space-y-0.5">
              <li>~973 ilçe işlenecek (mevcut veride ~611 ilçe — bazı iller eksik).</li>
              <li>Her ilçe ortalama 3-5 saniye + 3 sn rate delay → toplam <strong>1-2 gün</strong>.</li>
              <li>Google Places API maliyeti: ilçe başı ~$0.10 → toplam <strong>~$60-100</strong>.</li>
              <li>OSM kaynağı seçerseniz Google maliyeti olmaz.</li>
              <li>Job'u istediğiniz zaman duraklatıp devam ettirebilirsiniz.</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm">
            Yukarıdaki uyarıları okudum. Tüm Türkiye taraması başlatmak istiyorum.
          </span>
        </label>

        <button
          type="button"
          onClick={() => {
            createJob.mutate({
              scope_type: 'whole_country',
              scope_params: {},
              radius_km: props.radiusKm,
              scan_types: Array.from(props.selectedTypes),
              scan_source: props.source,
              scan_intensity: props.intensity,
            });
          }}
          disabled={!canStart}
          className="w-full h-12 rounded-xl bg-red-600 text-white font-semibold disabled:opacity-50"
        >
          {createJob.isPending ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Job oluşturuluyor…
            </span>
          ) : 'TÜRKIYE TARAMASINI BAŞLAT'}
        </button>
      </div>

      {message && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">{message}</div>
      )}
    </div>
  );
}

// ============================================================================
// Main page
// ============================================================================

export default function ClinicScanPage() {
  const [tab, setTab] = useState<TabKey>('single');

  // Shared form state — taşınabilir tab'lar arasında.
  // Default: v3 — akıllı motor (mahalle + uzmanlık + DoktorTakvimi).
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(['dentist']));
  const [source, setSource] = useState<SourceMode>('google');
  const [intensity, setIntensity] = useState<ScanIntensity>('standard');
  const [scanMode, setScanMode] = useState<ScanMode>('v3');

  // Motor değişince intensity / source uyumsuz değer kalmasın → güvenli default'a sıfırla.
  const setScanModeSafe = (mode: ScanMode) => {
    setScanMode(mode);
    if (mode === 'v3') {
      // v1/v2 intensity ('high'|'max') v3'te geçersiz; 'standard'a düş.
      if (intensity !== 'standard' && intensity !== 'deep' && intensity !== 'exhaustive') {
        setIntensity('standard');
      }
      // v1/v2 source 'doktor_takvimi'/'all' destekler değil; tersi de geçerli.
      // Şuanda mevcut source v3 listesindeki bir değer mi kontrol et — değilse 'all'a düş.
    } else {
      // v1/v2 intensity 'deep'|'exhaustive' geçersiz; 'standard'a düş.
      if (intensity === 'deep' || intensity === 'exhaustive') {
        setIntensity('standard');
      }
      // v1/v2 source 'doktor_takvimi'/'all' desteklemiyor; 'both'a düş.
      if (source === 'doktor_takvimi' || source === 'all') {
        setSource('both');
      }
    }
  };

  const sharedOpts: SharedScanOpts = {
    radiusKm, setRadiusKm,
    selectedTypes, setSelectedTypes,
    source, setSource,
    intensity, setIntensity,
    scanMode, setScanMode: setScanModeSafe,
  };

  // SingleDistrictTab statsQuery'sine commit sonrası refresh atmak için
  // mutable bir refetcher köprüsü kur. Tab unmount olursa null'a düşer.
  const statsRefetcher = useRef<(() => void) | null>(null);
  const closePreview = useScanPreview((s) => s.close);

  // Mevcut Veritabanı satırına tıklayınca açılan ilçe-detay dialog'u.
  const [drillDown, setDrillDown] = useState<{ province: string; district: string | null } | null>(null);

  // Manuel klinik ekleme modal'ı.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSeed, setManualSeed] = useState<{ provinceSlug?: string; districtSlug?: string }>({});

  // Düzenleme modal'ı (ScanPreview veya DistrictDialog'dan tetiklenir).
  const [editClinic, setEditClinic] = useState<EditClinicTarget | null>(null);

  async function openEditFromPlaceId(placeId: string, fallbackName: string): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_clinics')
        .select('*')
        .eq('google_place_id', placeId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        toast.error(`Henüz kayıtlı değil: ${fallbackName} — önce kaydet, sonra düzenle`);
        return;
      }
      setEditClinic(data as EditClinicTarget);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Düzenleme açılamadı: ${msg}`);
    }
  }

  async function handleCommitSelected(
    selectedIds: string[],
    lastInput: Record<string, unknown>,
  ): Promise<void> {
    try {
      // v3 commit-only fast path: tarama atla, preview'dan seçilenleri direkt upsert et.
      // Eski yol (placeIdsAllowlist + dryRun:false) 2. invoke YİNE tüm Google
      // taramasını tetikliyordu → 504 timeout. commitOnly path saniyeler içinde döner.
      const previewClinics = useScanPreview.getState().clinics;
      const idSet = new Set(selectedIds);
      const commitClinics = previewClinics
        .filter((c) => idSet.has(c.place_id))
        .map((c) => ({
          place_id: c.place_id,
          name: c.name,
          lat: c.lat,
          lng: c.lng,
          address: c.address ?? null,
          phone: c.phone ?? null,
          rating: c.rating ?? null,
          user_ratings_total: c.user_ratings_total ?? null,
          types: c.types,
          segment: c.segment ?? 'private',
          sources: c.sources,
        }));

      if (commitClinics.length === 0) {
        toast.error('Kayıt için seçili klinik yok.');
        return;
      }

      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke('clinic-scan-v3', {
        body: {
          // commitOnly path yine de bazı zorunlu alanlar ister:
          lat: (lastInput as ScanInput).lat,
          lng: (lastInput as ScanInput).lng,
          radiusM: (lastInput as ScanInput).radiusM,
          provinceSlug: (lastInput as ScanInput).provinceSlug,
          districtSlug: (lastInput as ScanInput).districtSlug,
          vertical: 'dental',
          commitOnly: true,
          commitClinics,
        },
      });
      if (error) throw error;

      const result = (data as { new?: number; updated?: number; committed?: number }) ?? {};
      const newCount = result.new ?? 0;
      const updatedCount = result.updated ?? 0;
      toast.success(`${newCount} yeni klinik kaydedildi (${updatedCount} güncellendi)`);
      closePreview();
      statsRefetcher.current?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Kayıt başarısız: ${msg}`);
      // Dialog'u açık bırak — kullanıcı tekrar denesin.
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Search className="h-6 w-6" /> Klinik Tarama
      </h1>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 px-3 h-10 text-sm whitespace-nowrap border-b-2 -mb-px ${
              tab === t.key
                ? 'border-primary text-primary font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Shared opts visible on all batch tabs (mass-scan inputs).
          Tek İlçe sekmesinde de yarıçap/tip/kaynak ortak — burada bir kere göster. */}
      {tab !== 'jobs' && <SharedOptsBox {...sharedOpts} />}

      {/* Tab content */}
      {tab === 'single' && (
        <SingleDistrictTab
          {...sharedOpts}
          statsRefetcher={statsRefetcher}
          onDrillDown={(row) => setDrillDown(row)}
        />
      )}
      {tab === 'province' && <WholeProvinceTab {...sharedOpts} onJobCreated={() => setTab('jobs')} />}
      {tab === 'region' && <RegionTab {...sharedOpts} onJobCreated={() => setTab('jobs')} />}
      {tab === 'country' && <WholeCountryTab {...sharedOpts} onJobCreated={() => setTab('jobs')} />}
      {tab === 'jobs' && <ScanJobsPage embedded />}

      {/* Preview dialog — store'a bağlı, sadece `open === true` iken render olur. */}
      <ScanPreviewDialog
        onCommit={handleCommitSelected}
        onEditClinic={(c) => {
          void openEditFromPlaceId(c.place_id, c.name);
        }}
        onManualAdd={() => {
          setManualSeed({});
          setManualOpen(true);
        }}
      />

      {/* Mevcut Veritabanı satırı tıklandığında açılır — Phase D */}
      {drillDown && (
        <DistrictClinicsDialog
          open={true}
          onClose={() => setDrillDown(null)}
          provinceSlug={drillDown.province}
          districtSlug={drillDown.district}
          onChanged={() => statsRefetcher.current?.()}
          onManualAdd={() => {
            setManualSeed({
              provinceSlug: drillDown.province,
              districtSlug: drillDown.district ?? undefined,
            });
            setManualOpen(true);
          }}
          onEditClinic={(clinic) => setEditClinic(clinic as EditClinicTarget)}
        />
      )}

      {/* Manuel ekleme — Phase E */}
      <ManualAddClinicModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        initialProvinceSlug={manualSeed.provinceSlug}
        initialDistrictSlug={manualSeed.districtSlug}
        onAdded={() => {
          setManualOpen(false);
          statsRefetcher.current?.();
          toast.success('Klinik eklendi');
        }}
      />

      {/* Düzenleme — Phase F */}
      {editClinic && (
        <EditClinicModal
          clinic={editClinic}
          open={true}
          onClose={() => setEditClinic(null)}
          onSaved={() => {
            setEditClinic(null);
            statsRefetcher.current?.();
          }}
          onDeleted={() => {
            setEditClinic(null);
            statsRefetcher.current?.();
          }}
        />
      )}
    </div>
  );
}
