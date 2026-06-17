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
import { slugify } from '@/data/tr-locations/geo-helpers';
import { pointToPolylineKm } from './detour-calc';

/**
 * normKey — province_slug:district_slug çiftini kararlı ASCII slug formatına
 * getirir. DB'den gelen değerlerde Türkçe karakter kalığı veya büyük harf
 * drift'i olabilir; bu fonksiyon her iki tarafı aynı normalize ederek
 * Map lookup'ın tutarlı çalışmasını garantiler.
 *
 * Örnek: 'Çankırı' + 'İlgaz' → 'cankiri:ilgaz'
 *         'cankiri'  + 'ilgaz' → 'cankiri:ilgaz'  (idempotent)
 */
function normKey(provinceSlug: string, districtSlug: string): string {
  return `${slugify(provinceSlug)}:${slugify(districtSlug)}`;
}

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
    const k = normKey(c.province_slug, c.district_slug);
    countMap.set(k, (countMap.get(k) ?? 0) + 1);
  }

  // Son tarama tarihleri (best-effort — tablo yoksa null)
  const scanMap = new Map<string, string>();
  try {
    // BUG #G fix: district_slug DB'de nullable. PostgREST .in() NULL satırları
    // eşleştirmez — province+district eşleşen loglar döner ama district_slug=NULL
    // olan (province-level / eski) taramalar filtreden düşer → lastScanAt=null → kırmızı.
    // Çözüm: iki sorgu:
    //   (a) district_slug eşleşen kayıtlar (yeni ilçe-bazlı taramalar)
    //   (b) district_slug IS NULL olan kayıtlar (province-level taramalar)
    // Her iki set birleştirilir; aynı key için en yeni performed_at tutulur.

    // (a) District-level taramalar
    const { data: logsDistrict } = await supabase
      .from('saha_clinic_scan_logs')
      .select('province_slug, district_slug, performed_at')
      .in('province_slug', provinceSlugs)
      .in('district_slug', districtSlugs)
      .order('performed_at', { ascending: false })
      .limit(1000);

    // (b) Province-level taramalar (district_slug IS NULL) — province eşleşiyorsa
    // tüm ilçeleri kapsar sayılır.
    const { data: logsProvince } = await supabase
      .from('saha_clinic_scan_logs')
      .select('province_slug, district_slug, performed_at')
      .in('province_slug', provinceSlugs)
      .is('district_slug', null)
      .order('performed_at', { ascending: false })
      .limit(500);

    // Province-level log: her eşleşen ilçe için provSlug:distSlug key'ine yaz
    // (district_slug=null → province cover → tüm ilçeler bu taramadan yararlanır)
    for (const l of (logsProvince ?? []) as Array<{
      province_slug: string;
      district_slug: string | null;
      performed_at: string;
    }>) {
      const provSlug = slugify(l.province_slug);
      // Bu province'a ait tüm districts'i bul ve map'e yaz
      for (const d of districts) {
        if (slugify(d.provinceSlug) !== provSlug) continue;
        const k = normKey(d.provinceSlug, d.districtSlug);
        // TODO(verify): Eğer bir ilçenin kendi district-level taraması varsa, onu
        // province-level tarama ile ezme — aşağıda district logları da işleniyor,
        // sadece henüz işlenmemiş key'leri doldur. Sonradan gelen district kaydı
        // override eder (döngü sırası district sonra → daha yeni olursa override).
        if (!scanMap.has(k)) scanMap.set(k, l.performed_at);
      }
    }

    // District-level loglar (district_slug NOT NULL) — sonradan işle: daha yeni
    // tarih varsa province-level kaydın üstüne yazar.
    for (const l of (logsDistrict ?? []) as Array<{
      province_slug: string;
      district_slug: string;
      performed_at: string;
    }>) {
      const k = normKey(l.province_slug, l.district_slug);
      const existing = scanMap.get(k);
      if (!existing || l.performed_at > existing) {
        scanMap.set(k, l.performed_at);
      }
    }
  } catch {
    // Tablo yok veya RLS engelliyor — boş geç
  }

  return districts.map((d) => ({
    ...d,
    lastScanAt: scanMap.get(normKey(d.provinceSlug, d.districtSlug)) ?? null,
    existingCount: countMap.get(normKey(d.provinceSlug, d.districtSlug)) ?? 0,
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
