/**
 * corridor-enrichment — Rota boyunca taranmamış ilçeleri tespit ve auto-scan.
 *
 * Akış:
 *   1. Polyline'a yakın TR ilçelerini bul (districts.json + haversine)
 *   2. saha_clinic_scan_logs tablosundan her ilçenin son tarama tarihini çek
 *   3. Son 14 gün taranmamış (veya hiç taranmamış) ilçeleri sırala
 *   4. Top N ilçe için clinic-scan-v3 parallel invoke (Google Places çek)
 *   5. Her tarama: saha_clinics tablosuna upsert → DB zenginleşir
 *   6. Tamamlanınca refetch trigger
 */

import { getSupabaseClient } from '@lib/supabase';
import provinces from '@/data/tr-locations/provinces.json';
import districtsRaw from '@/data/tr-locations/districts.json';
import { pointToPolylineKm } from './detour-calc';

interface ProvinceJson {
  plaka: number;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus: number;
  bolge: string;
}

interface DistrictJson {
  il_plaka: number;
  il_ad: string;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus_2023: number;
}

const PROVINCES = provinces as ProvinceJson[];
const DISTRICTS = districtsRaw as DistrictJson[];

export interface CorridorDistrict {
  provinceSlug: string;
  provinceName: string;
  districtSlug: string;
  districtName: string;
  lat: number;
  lng: number;
  populationK: number;
  distFromPolylineKm: number;
  /** Son tarama tarihi ISO — null = hiç taranmamış */
  lastScanAt: string | null;
  /** Bu ilçede DB'de kaç klinik var */
  existingCount: number;
}

/**
 * Polyline'a maxKm uzaklıktaki tüm il+ilçe centroid'lerini bul.
 * Nüfus filtresi opsiyonel (min 5k → tüm köylerin elenmesi için).
 */
export function districtsAlongPolyline(
  polyline: Array<[number, number]>,
  opts: { maxKm?: number; minPopulation?: number } = {},
): Array<Omit<CorridorDistrict, 'lastScanAt' | 'existingCount'>> {
  const maxKm = opts.maxKm ?? 15;
  const minPop = opts.minPopulation ?? 5_000;

  const provinceBySlug = new Map<string, ProvinceJson>();
  for (const p of PROVINCES) {
    provinceBySlug.set(p.slug.toLowerCase(), p);
  }

  const out: Array<Omit<CorridorDistrict, 'lastScanAt' | 'existingCount'>> = [];
  for (const d of DISTRICTS) {
    if (d.nufus_2023 < minPop) continue;
    const dist = pointToPolylineKm({ lat: d.lat, lng: d.lng }, polyline);
    if (dist > maxKm) continue;
    const provSlug = PROVINCES.find((p) => p.plaka === d.il_plaka)?.slug ?? '';
    if (!provSlug) continue;
    out.push({
      provinceSlug: provSlug,
      provinceName: d.il_ad,
      districtSlug: d.slug,
      districtName: d.ad,
      lat: d.lat,
      lng: d.lng,
      populationK: Math.round(d.nufus_2023 / 1000),
      distFromPolylineKm: dist,
    });
  }
  // Polyline'a yakın olanlar önce
  out.sort((a, b) => a.distFromPolylineKm - b.distFromPolylineKm);
  return out;
}

/**
 * District'lerin DB'deki son tarama tarihi ve klinik sayısı.
 * saha_clinic_scan_logs son MAX 1000 kayıt çekilir (pratik limit).
 */
export async function enrichWithScanStatus(
  districts: Array<Omit<CorridorDistrict, 'lastScanAt' | 'existingCount'>>,
): Promise<CorridorDistrict[]> {
  if (districts.length === 0) return [];
  const supabase = getSupabaseClient();
  const provinceSlugs = Array.from(new Set(districts.map((d) => d.provinceSlug)));
  const districtSlugs = Array.from(new Set(districts.map((d) => d.districtSlug)));

  // Klinik sayısı per (province, district)
  const { data: clinicsData } = await supabase
    .from('saha_clinics')
    .select('province_slug, district_slug')
    .eq('status', 'active')
    .eq('vertical_key', 'dental')
    .in('province_slug', provinceSlugs)
    .in('district_slug', districtSlugs);

  const countMap = new Map<string, number>();
  for (const c of (clinicsData ?? []) as Array<{
    province_slug: string;
    district_slug: string;
  }>) {
    const k = `${c.province_slug}:${c.district_slug}`;
    countMap.set(k, (countMap.get(k) ?? 0) + 1);
  }

  // Son tarama tarihleri (best-effort — tablo yoksa null)
  const scanMap = new Map<string, string>();
  try {
    const { data: logs } = await supabase
      .from('saha_clinic_scan_logs')
      .select('province_slug, district_slug, performed_at')
      .in('province_slug', provinceSlugs)
      .in('district_slug', districtSlugs)
      .order('performed_at', { ascending: false })
      .limit(1000);
    for (const l of (logs ?? []) as Array<{
      province_slug: string;
      district_slug: string;
      performed_at: string;
    }>) {
      const k = `${l.province_slug}:${l.district_slug}`;
      if (!scanMap.has(k)) scanMap.set(k, l.performed_at);
    }
  } catch {
    // Tablo yok veya RLS engelliyor — boş geç
  }

  return districts.map((d) => ({
    ...d,
    lastScanAt: scanMap.get(`${d.provinceSlug}:${d.districtSlug}`) ?? null,
    existingCount: countMap.get(`${d.provinceSlug}:${d.districtSlug}`) ?? 0,
  }));
}

export interface ScanFilterOpts {
  /** En son N gün içinde taranmışsa skip */
  freshDays?: number;
  /** Min klinik eşiği — bu sayıdan az ise mutlak tara */
  minClinicThreshold?: number;
  /** Max kaç ilçe tarayalım (rate limit + maliyet) */
  maxToScan?: number;
}

/**
 * Taranmaya değer ilçeleri filtrele:
 *  - Hiç taranmamış (lastScanAt null) → öncelik 1
 *  - >freshDays gün öncesi taranmış AND klinik az → öncelik 2
 *  - Aksi halde skip
 */
export function pickDistrictsToScan(
  districts: CorridorDistrict[],
  opts: ScanFilterOpts = {},
): CorridorDistrict[] {
  const freshDays = opts.freshDays ?? 14;
  const minClinics = opts.minClinicThreshold ?? 15;
  const maxToScan = opts.maxToScan ?? 5;
  const nowMs = Date.now();

  const candidates = districts.filter((d) => {
    if (d.lastScanAt === null) return true;
    const scanMs = new Date(d.lastScanAt).getTime();
    if (Number.isNaN(scanMs)) return true;
    const ageDays = (nowMs - scanMs) / 86400_000;
    if (ageDays > freshDays * 2) return true; // çok eski tarama
    if (ageDays > freshDays && d.existingCount < minClinics) return true; // eski + az klinik
    return false;
  });
  // Polyline'a en yakın + nüfusu yüksek olanları önce
  candidates.sort((a, b) => {
    if (a.distFromPolylineKm !== b.distFromPolylineKm) {
      return a.distFromPolylineKm - b.distFromPolylineKm;
    }
    return b.populationK - a.populationK;
  });
  return candidates.slice(0, maxToScan);
}

export interface ScanProgress {
  total: number;
  done: number;
  currentDistrict: string | null;
  scannedClinics: number;
  newClinics: number;
  errors: Array<{ district: string; message: string }>;
}

/**
 * District listesini clinic-scan-v3 ile sırayla tara.
 * Parallel 2 (her ilçe ~30sn). Toast/UI için onProgress callback.
 */
export async function scanCorridorDistricts(
  districts: CorridorDistrict[],
  onProgress: (p: ScanProgress) => void,
): Promise<ScanProgress> {
  const supabase = getSupabaseClient();
  const progress: ScanProgress = {
    total: districts.length,
    done: 0,
    currentDistrict: null,
    scannedClinics: 0,
    newClinics: 0,
    errors: [],
  };
  onProgress({ ...progress });

  // Sıralı işle — clinic-scan-v3 Google rate limit, paralel risky
  for (const d of districts) {
    progress.currentDistrict = `${d.provinceName} / ${d.districtName}`;
    onProgress({ ...progress });
    try {
      const { data, error } = await supabase.functions.invoke('clinic-scan-v3', {
        body: {
          lat: d.lat,
          lng: d.lng,
          radiusM: 8000,
          provinceSlug: d.provinceSlug,
          districtSlug: d.districtSlug,
          vertical: 'dental',
          // 'all' = DoktorTakvimi scrape + Google Places (NearbySearch + TextSearch
          // keyword) + OSM. DoktorTakvimi hekim listesi konuma göre reverse-lookup.
          source: 'all',
          intensity: 'standard',
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
      progress.scannedClinics += result.scanned ?? 0;
      progress.newClinics += result.new ?? result.committed ?? 0;
    } catch (e) {
      progress.errors.push({
        district: `${d.provinceName}/${d.districtName}`,
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      progress.done += 1;
      onProgress({ ...progress });
    }
  }
  progress.currentDistrict = null;
  onProgress({ ...progress });
  return progress;
}

/**
 * Eksik kalsa da rota planlama için DB hangi ilçelerde klinik var topla.
 */
export function summarizeCorridorCoverage(districts: CorridorDistrict[]): {
  totalDistricts: number;
  coveredDistricts: number;
  staleDistricts: number;
  untouchedDistricts: number;
} {
  const total = districts.length;
  const covered = districts.filter((d) => d.existingCount > 0).length;
  const untouched = districts.filter((d) => d.lastScanAt === null).length;
  const stale = districts.filter((d) => {
    if (!d.lastScanAt) return false;
    const days = (Date.now() - new Date(d.lastScanAt).getTime()) / 86400_000;
    return days > 14;
  }).length;
  return {
    totalDistricts: total,
    coveredDistricts: covered,
    staleDistricts: stale,
    untouchedDistricts: untouched,
  };
}
