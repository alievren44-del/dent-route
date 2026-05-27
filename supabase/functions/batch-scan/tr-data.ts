// deno-lint-ignore-file
// ============================================================================
// Saha Navigasyon — Türkiye İl/İlçe Veri Modülü (Edge Function)
// ============================================================================
// Bu modül batch-scan Edge Function tarafından kullanılır. Veri kaynağı
// repo'daki `src/data/tr-locations/provinces.json` ve `districts.json`
// dosyalarının BIREBIR KOPYASIDIR (deploy sırasında bu klasöre kopyalandı).
//
// 81 il + 611 ilçe (bazı illerde tüm ilçeler değil; merkez + büyük ilçeler).
// İlçe verisi tam değil; eksik ilçeler için `getDistrictsByProvinceSlug` boş
// liste döner ve batch-scan o ili "skipped" olarak işaretler.
// ============================================================================

import provincesData from './provinces.json' with { type: 'json' };
import districtsData from './districts.json' with { type: 'json' };

export interface ProvinceRow {
  plaka: number;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus: number;
  bolge: string;
}

export interface DistrictRow {
  il_plaka: number;
  il_ad: string;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus_2023: number;
}

const PROVINCES = provincesData as ProvinceRow[];
const DISTRICTS = districtsData as DistrictRow[];

// ----------------------------------------------------------------------------
// Region (bölge) → province plaka listesi.
// 7 coğrafi bölge: marmara / ege / akdeniz / ic_anadolu / karadeniz /
// dogu_anadolu / guneydogu.
// ----------------------------------------------------------------------------
export type RegionSlug =
  | 'marmara'
  | 'ege'
  | 'akdeniz'
  | 'ic_anadolu'
  | 'karadeniz'
  | 'dogu_anadolu'
  | 'guneydogu';

const BOLGE_TO_SLUG: Record<string, RegionSlug> = {
  'Marmara': 'marmara',
  'Ege': 'ege',
  'Akdeniz': 'akdeniz',
  'İç Anadolu': 'ic_anadolu',
  'Karadeniz': 'karadeniz',
  'Doğu Anadolu': 'dogu_anadolu',
  'Güneydoğu Anadolu': 'guneydogu',
};

export const PROVINCES_BY_REGION: Record<RegionSlug, string[]> = (() => {
  const out: Record<RegionSlug, string[]> = {
    marmara: [],
    ege: [],
    akdeniz: [],
    ic_anadolu: [],
    karadeniz: [],
    dogu_anadolu: [],
    guneydogu: [],
  };
  for (const p of PROVINCES) {
    const r = BOLGE_TO_SLUG[p.bolge];
    if (r) out[r].push(p.slug);
  }
  return out;
})();

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function getProvinces(): Array<{
  plaka: number;
  slug: string;
  name: string;
  lat: number;
  lng: number;
  bolge: string;
}> {
  return PROVINCES.map((p) => ({
    plaka: p.plaka,
    slug: p.slug,
    name: p.ad,
    lat: p.lat,
    lng: p.lng,
    bolge: p.bolge,
  }));
}

export function getProvinceByPlaka(plaka: number): ProvinceRow | undefined {
  return PROVINCES.find((p) => p.plaka === plaka);
}

export function getProvinceBySlug(slug: string): ProvinceRow | undefined {
  return PROVINCES.find((p) => p.slug === slug);
}

export function getDistrictsByProvince(plaka: number): Array<{
  slug: string;
  name: string;
  lat: number;
  lng: number;
}> {
  return DISTRICTS
    .filter((d) => d.il_plaka === plaka)
    .map((d) => ({ slug: d.slug, name: d.ad, lat: d.lat, lng: d.lng }));
}

export function getDistrictsByProvinceSlug(provinceSlug: string): Array<{
  slug: string;
  name: string;
  lat: number;
  lng: number;
}> {
  const prov = getProvinceBySlug(provinceSlug);
  if (!prov) return [];
  return getDistrictsByProvince(prov.plaka);
}

export function getDistrictBySlugs(
  provinceSlug: string,
  districtSlug: string,
): { slug: string; name: string; lat: number; lng: number } | undefined {
  const prov = getProvinceBySlug(provinceSlug);
  if (!prov) return undefined;
  const d = DISTRICTS.find(
    (x) => x.il_plaka === prov.plaka && x.slug === districtSlug,
  );
  if (!d) return undefined;
  return { slug: d.slug, name: d.ad, lat: d.lat, lng: d.lng };
}

export function getProvincesByRegion(region: RegionSlug): ProvinceRow[] {
  const slugs = PROVINCES_BY_REGION[region] ?? [];
  return slugs
    .map((s) => getProvinceBySlug(s))
    .filter((p): p is ProvinceRow => !!p);
}

export function isRegion(value: unknown): value is RegionSlug {
  return typeof value === 'string' && value in PROVINCES_BY_REGION;
}
