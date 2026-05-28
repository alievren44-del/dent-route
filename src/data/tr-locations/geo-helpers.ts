import provinces from './provinces.json';
import districts from './districts.json';

export interface Province {
  plaka: number;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus: number;
  bolge: string;
}

export interface District {
  il_plaka: number;
  il_ad: string;
  ad: string;
  slug: string;
  lat: number;
  lng: number;
  nufus_2023: number;
}

const COLLATOR = new Intl.Collator('tr-TR');

const PROVINCES = [...(provinces as Province[])].sort((a, b) => COLLATOR.compare(a.ad, b.ad));
const DISTRICTS = [...(districts as District[])].sort((a, b) => {
  const byProv = COLLATOR.compare(a.il_ad, b.il_ad);
  if (byProv !== 0) return byProv;
  return COLLATOR.compare(a.ad, b.ad);
});

const TR_MAP: Record<string, string> = {
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ş: 's',
  Ş: 'S',
  ü: 'u',
  Ü: 'U',
};

export function slugify(text: string): string {
  if (!text) return '';
  let out = '';
  for (const ch of text) {
    out += TR_MAP[ch] ?? ch;
  }
  return out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalize(text: string): string {
  return slugify(text).replace(/-/g, ' ').trim();
}

export function getProvinces(): Province[] {
  return PROVINCES;
}

export function getDistrictsByProvince(provinceAdOrPlaka: string | number): District[] {
  const list =
    typeof provinceAdOrPlaka === 'number'
      ? DISTRICTS.filter((d) => d.il_plaka === provinceAdOrPlaka)
      : DISTRICTS.filter((d) => normalize(d.il_ad) === normalize(provinceAdOrPlaka));
  return [...list].sort((a, b) => COLLATOR.compare(a.ad, b.ad));
}

export function getProvince(adOrPlaka: string | number): Province | undefined {
  if (typeof adOrPlaka === 'number') {
    return PROVINCES.find((p) => p.plaka === adOrPlaka);
  }
  const q = normalize(adOrPlaka);
  return PROVINCES.find((p) => normalize(p.ad) === q || p.slug === slugify(adOrPlaka));
}

export function getDistrict(provinceAd: string, districtAd: string): District | undefined {
  const pq = normalize(provinceAd);
  const dq = normalize(districtAd);
  return DISTRICTS.find((d) => normalize(d.il_ad) === pq && normalize(d.ad) === dq);
}

export function searchProvinces(query: string): Province[] {
  const q = normalize(query);
  if (!q) return [];
  return PROVINCES.filter((p) => normalize(p.ad).includes(q) || p.slug.includes(slugify(query)));
}

export function searchDistricts(query: string, provinceAd?: string): District[] {
  const q = normalize(query);
  if (!q && !provinceAd) return [];
  const pq = provinceAd ? normalize(provinceAd) : undefined;
  return DISTRICTS.filter((d) => {
    if (pq && normalize(d.il_ad) !== pq) return false;
    if (!q) return true;
    return normalize(d.ad).includes(q) || d.slug.includes(slugify(query));
  });
}

export function getDistrictBbox(
  provinceAd: string,
  districtAd: string,
  radiusKm = 5,
): { minLat: number; maxLat: number; minLng: number; maxLng: number } | undefined {
  const d = getDistrict(provinceAd, districtAd);
  if (!d) return undefined;
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((d.lat * Math.PI) / 180));
  return {
    minLat: d.lat - latDelta,
    maxLat: d.lat + latDelta,
    minLng: d.lng - lngDelta,
    maxLng: d.lng + lngDelta,
  };
}
