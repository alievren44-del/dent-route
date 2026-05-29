/**
 * TR-Seed — Türkiye'nin 27 büyük (500k+) + 50 orta (top 200-500k) ilçesini
 * tek seferde scan eden orchestrator.
 *
 * Strateji:
 *   - Hardcoded 77 lokasyon (tr-seed-list.json)
 *   - Standard intensity (Çankaya seviyesi grid /2 ~= 95 call per large)
 *   - Sırayla clinic-scan-v3 invoke (rate limit aware, 1.5sn delay)
 *   - Progress callback (real-time UI update)
 *   - Cost estimate counter ($0.032 per call avg)
 *   - Daily limit guard: saha_api_usage tablo zaten counter tutar
 *
 * Hedef maliyet $120 + $81 free credit:
 *   27 large × $3 = $81 (free credit ile karşılanır)
 *   50 mid × $2.2 = $110 (credit'ten harcanır)
 *   Buffer + overhead: ~$10
 *   Toplam: ~$201, free $200 + credit $120 = $320 budget içinde
 */

import { getSupabaseClient } from '@lib/supabase';
import seedList from './tr-seed-list.json';
import provincesRaw from '@/data/tr-locations/provinces.json';
import districtsRaw from '@/data/tr-locations/districts.json';

export interface SeedCity {
  tier: 'large' | 'mid' | 'small';
  province: string;
  district: string;
  lat: number;
  lng: number;
  nufus: number;
  intensity: 'standard' | 'deep' | 'exhaustive';
}

export const TR_SEED_LIST = seedList as SeedCity[];

interface ProvinceJson {
  plaka: number;
  slug: string;
}
interface DistrictJson {
  il_plaka: number;
  slug: string;
  lat: number;
  lng: number;
  nufus_2023: number;
}

const PROVINCE_SLUG_BY_PLAKA = new Map<number, string>(
  (provincesRaw as ProvinceJson[]).map((p) => [p.plaka, p.slug]),
);

/** Nüfusa göre tier sınıfı */
export function tierForPopulation(nufus: number): SeedCity['tier'] {
  if (nufus >= 500_000) return 'large';
  if (nufus >= 80_000) return 'mid';
  return 'small';
}

/**
 * districts.json'dan TÜM 973 ilçeyi SeedCity listesine çevir.
 * Sıralama: priorityProvinces (verilen sırada) önce → sonra nüfus azalan.
 * 5 plasiyerin çalıştığı il slug'larını priorityProvinces ver → ücretsiz
 * aylık Google tavanı önce o bölgelere harcanır (anında saha faydası).
 */
export function buildFullSeedList(
  priorityProvinces: string[] = [],
  intensity: SeedCity['intensity'] = 'standard',
): SeedCity[] {
  const priorityRank = new Map<string, number>(
    priorityProvinces.map((slug, i) => [slug.toLowerCase(), i]),
  );
  const list: SeedCity[] = [];
  for (const d of districtsRaw as DistrictJson[]) {
    const provinceSlug = PROVINCE_SLUG_BY_PLAKA.get(d.il_plaka);
    if (!provinceSlug) continue;
    list.push({
      tier: tierForPopulation(d.nufus_2023),
      province: provinceSlug,
      district: d.slug,
      lat: d.lat,
      lng: d.lng,
      nufus: d.nufus_2023,
      intensity,
    });
  }
  const RANK_NONE = priorityProvinces.length + 1;
  list.sort((a, b) => {
    const ra = priorityRank.get(a.province) ?? RANK_NONE;
    const rb = priorityRank.get(b.province) ?? RANK_NONE;
    if (ra !== rb) return ra - rb; // öncelik illeri önce, verilen sırada
    return b.nufus - a.nufus; // sonra nüfus azalan
  });
  return list;
}

/** Tahmini call sayısı (intensity=standard) */
export function estimateCallsForCity(c: SeedCity): number {
  if (c.intensity !== 'standard') {
    // Sadece standard destekleniyor şu an
    return 100;
  }
  // Grid count nüfusa göre, /2 standard'da:
  const n = c.nufus;
  let grid = 3;
  if (n >= 500_000) grid = 18;
  else if (n >= 200_000) grid = 13;
  else if (n >= 80_000) grid = 8;
  else if (n >= 20_000) grid = 4;
  // Nearby (grid × 2 keyword × ~3 page yarısı) + Text (~15 query)
  return grid * 4 + 15;
}

const COST_PER_CALL = 0.032; // USD

export interface SeedProgress {
  total: number;
  done: number;
  failed: number;
  currentCity: SeedCity | null;
  estimatedCost: number;
  newClinics: number;
  totalScanned: number;
  results: Array<{
    province: string;
    district: string;
    status: 'ok' | 'fail' | 'skipped';
    newCount?: number;
    error?: string;
  }>;
}

export interface SeedOptions {
  /** Taranacak liste — verilmezse hardcoded TR_SEED_LIST (77 ilçe). Tüm Türkiye
   *  için buildFullSeedList(priorityProvinces) sonucunu geç. */
  list?: SeedCity[];
  /** Tüm liste yerine sadece tier filtre */
  tier?: 'large' | 'mid' | 'small';
  /** Liste içinden başlangıç index (continue support) */
  startIndex?: number;
  /** Batch size — Edge fn 150s limitle çakışmasın diye */
  batchLimit?: number;
  /** Önceden taranmış (last 30 gün) ilçeleri skip */
  skipFreshDays?: number;
  /** Per-city min klinik eşiği — bu sayıdan fazla varsa skip */
  skipIfClinicCount?: number;
  /** Aylık ücretsiz Google tavanı (tahmini call). Bu run'da biriken tahmini
   *  call bunu aşacaksa döngü durur → cep $0 kalır. Pro free ~5000/ay,
   *  güvenli default 4500. Skip edilen ilçeler call saymaz. */
  monthlyCallCap?: number;
}

export async function runTrSeed(
  opts: SeedOptions,
  onProgress: (p: SeedProgress) => void,
): Promise<SeedProgress> {
  const supabase = getSupabaseClient();
  let list = (opts.list ?? TR_SEED_LIST).slice();
  if (opts.tier) list = list.filter((c) => c.tier === opts.tier);

  const startIdx = opts.startIndex ?? 0;
  const batchLimit = opts.batchLimit ?? list.length;
  const slice = list.slice(startIdx, startIdx + batchLimit);
  const monthlyCallCap = opts.monthlyCallCap ?? Infinity;
  let estimatedCalls = 0;

  const progress: SeedProgress = {
    total: slice.length,
    done: 0,
    failed: 0,
    currentCity: null,
    estimatedCost: 0,
    newClinics: 0,
    totalScanned: 0,
    results: [],
  };
  onProgress({ ...progress });

  const skipFreshDays = opts.skipFreshDays ?? 30;
  const skipIfClinics = opts.skipIfClinicCount ?? 50;

  for (const city of slice) {
    progress.currentCity = city;
    onProgress({ ...progress });

    // Skip check: son skipFreshDays gün içinde tarandıysa veya zaten klinik
    // sayısı eşiğin üstündeyse skip
    try {
      const sinceIso = new Date(Date.now() - skipFreshDays * 86400_000).toISOString();
      const { data: logs } = await supabase
        .from('saha_clinic_scan_logs')
        .select('id')
        .eq('province_slug', city.province)
        .eq('district_slug', city.district)
        .gte('performed_at', sinceIso)
        .limit(1);
      const recentlyScanned = (logs ?? []).length > 0;

      const { count: clinicCount } = await supabase
        .from('saha_clinics')
        .select('id', { count: 'exact', head: true })
        .eq('province_slug', city.province)
        .eq('district_slug', city.district)
        .eq('status', 'active');

      if (recentlyScanned && (clinicCount ?? 0) >= skipIfClinics) {
        progress.results.push({
          province: city.province,
          district: city.district,
          status: 'skipped',
        });
        progress.done += 1;
        onProgress({ ...progress });
        continue;
      }
    } catch {
      // RLS engelliyor olabilir, taramaya devam
    }

    // Aylık ücretsiz tavan guard: bu ilçeyi taramak tavanı aşacaksa dur.
    // (Skip edilen ilçeler buraya gelmez → call saymaz.)
    const callsEst = estimateCallsForCity(city);
    if (estimatedCalls + callsEst > monthlyCallCap) {
      progress.currentCity = null;
      progress.results.push({
        province: city.province,
        district: city.district,
        status: 'skipped',
        error: 'monthly_cap_reached',
      });
      onProgress({ ...progress });
      break;
    }
    estimatedCalls += callsEst;

    // Scan invoke
    try {
      const { data, error } = await supabase.functions.invoke('clinic-scan-v3', {
        body: {
          lat: city.lat,
          lng: city.lng,
          radiusM: 8000,
          provinceSlug: city.province,
          districtSlug: city.district,
          vertical: 'dental',
          // 'all' = DoktorTakvimi scrape + Google Places + OSM. Tarama akışı:
          // 1) DoktorTakvimi hekim listesi (konum + spesifik isim)
          // 2) Her hekim için Google reverse-lookup (Place ID match)
          // 3) NearbySearch grid × keyword
          // 4) TextSearch ("X ilinde diş kliniği" gibi)
          // 5) OSM nearby dental
          // 6) Dedup + filter (FORBIDDEN/REQUIRED/KAMU keywords)
          source: 'all',
          intensity: city.intensity,
          includeKamu: true,
          dryRun: false,
          strictDistrict: true,
        },
      });
      if (error) throw new Error(error.message);
      const result = data as {
        status?: string;
        new?: number;
        scanned?: number;
        committed?: number;
      };
      if (result.status === 'error') throw new Error('scan_failed');
      progress.estimatedCost += callsEst * COST_PER_CALL;
      progress.newClinics += result.new ?? result.committed ?? 0;
      progress.totalScanned += result.scanned ?? 0;
      progress.results.push({
        province: city.province,
        district: city.district,
        status: 'ok',
        newCount: result.new ?? result.committed ?? 0,
      });
    } catch (e) {
      progress.failed += 1;
      progress.results.push({
        province: city.province,
        district: city.district,
        status: 'fail',
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      progress.done += 1;
      onProgress({ ...progress });
      // Rate limit aware: 1.5sn delay
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  progress.currentCity = null;
  onProgress({ ...progress });
  return progress;
}

/** Tahmini total maliyet — UI display için */
export function estimateTotalCost(list: SeedCity[] = TR_SEED_LIST): {
  totalCalls: number;
  totalCostUsd: number;
  byTier: { large: number; mid: number; small: number };
} {
  let totalCalls = 0;
  const byTier = { large: 0, mid: 0, small: 0 };
  for (const c of list) {
    const calls = estimateCallsForCity(c);
    totalCalls += calls;
    byTier[c.tier] += calls * COST_PER_CALL;
  }
  return {
    totalCalls,
    totalCostUsd: totalCalls * COST_PER_CALL,
    byTier,
  };
}
