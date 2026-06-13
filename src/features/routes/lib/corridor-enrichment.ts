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

import { getTypedClient } from '@lib/supabase';
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
  opts: { maxKm?: number; minPopulation?: number; maxResults?: number } = {},
): Array<Omit<CorridorDistrict, 'lastScanAt' | 'existingCount'>> {
  const maxKm = opts.maxKm ?? 15;
  const minPop = opts.minPopulation ?? 5_000;
  const maxResults = opts.maxResults ?? Infinity;

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
  return Number.isFinite(maxResults) ? out.slice(0, maxResults) : out;
}

/**
 * District'lerin DB'deki son tarama tarihi ve klinik sayısı.
 * saha_clinic_scan_logs son MAX 1000 kayıt çekilir (pratik limit).
 */
export async function enrichWithScanStatus(
  districts: Array<Omit<CorridorDistrict, 'lastScanAt' | 'existingCount'>>,
): Promise<CorridorDistrict[]> {
  if (districts.length === 0) return [];
  const supabase = getTypedClient();
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

// NOT: Eski `scanCorridorDistricts` (rota başına canlı clinic-scan-v3 → Google Places)
// kaldırıldı. Koridor artık SADECE DB'den okur (saha_clinics_near_polyline +
// enrichWithScanStatus). Taranmamış ilçeler admin toplu tarama (TR-Seed) ile doldurulur.
// Rota başına Google maliyeti = $0.

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
