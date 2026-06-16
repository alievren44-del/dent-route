// ============================================================================
// filters-v3.ts — Genişletilmiş filter + KAMU segment detect + ilçe sınırı
// ============================================================================
//
// Brief madde 9 + 10:
//   1) KAMU keyword'ler önce kontrol edilir — eşleşirse segment='kamu' olarak
//      kabul edilir (filtrelenmez, ayrı segmentte tutulur).
//   2) v3 ekstra forbidden list (eczane, optisyen, fizyoterapi vs.) — v1
//      base filter'a ek.
//   3) v1 base filter (isValidDentalClinic) çağrılır — forbidden keyword,
//      dental signal, Dr./Dt. fallback.
//   4) İlçe sınırı check — opsiyonel ve SOFT: adres elimizdeyse ve target
//      ilçe ismi adres içinde yoksa, kabul et ama reason='district_mismatch'
//      ile flag'le (UI gösterir, kullanıcı manuel doğrular).
// ============================================================================

import { isValidDentalClinic } from '../clinic-scan/filters.ts';

/**
 * v3 ekstra forbidden — v1 base filter'da OLMAYAN ama brief madde 9'da
 * istenenler. v1'de zaten "eczane", "optisyen", "fizyoterapi" var ama
 * bazı ek varyantlar burada toplu:
 *  - ASM (Aile Sağlığı Merkezi)
 *  - Tıp Fakültesi Anabilim (genel hastane, diş bölümü dışında)
 */
const FORBIDDEN_V3_EXTRA: string[] = [
  'aile sağlığı merkezi',
  'asm',
  'tıp fakültesi anabilim',
  'eczane',
  'pharmacy',
  'optisyen',
  'optic',
  'veteriner',
  'fizik tedavi',
  'fizyoterapi',
];

/**
 * KAMU segment keyword'leri. Bu listede eşleşen klinikler reddedilmez —
 * segment='kamu' olarak kabul edilir. UI'da ayrı liste/filter olarak gösterilir.
 *  - Diş hekimliği fakültesi → üniversite
 *  - Sağlık Bakanlığı → kamu sağlık hizmeti
 *  - ADSM / Ağız Diş Sağlığı Merkezi → kamu poliklinik
 *  - Devlet/Kamu/Şehir hastanesi → entegre diş bölümleri
 */
const KAMU_KEYWORDS: string[] = [
  'diş hekimliği fakültesi',
  'sağlık bakanlığı',
  'adsm',
  'ağız diş sağlığı merkezi',
  'devlet hastanesi',
  'kamu hastanesi',
  'şehir hastanesi',
];

export type Segment = 'private' | 'kamu';

export interface FilterV3Result {
  valid: boolean;
  reason?: string;
  segment: Segment;
}

/**
 * v3 filter — sıralı kontrol:
 *  1. KAMU detect (önce — kabul + segment ayır)
 *  2. v3 extra forbidden
 *  3. v1 base filter (isValidDentalClinic)
 *  4. İlçe sınırı:
 *     - strictDistrict=false (default): SOFT, sadece district_mismatch flag
 *     - strictDistrict=true: HARD reject; mahalle listesi varsa ona da bak
 */
export interface FilterV3Options {
  strictDistrict?: boolean;
  /** Hedef ilçeye ait mahalle adları (lowercase). Adresinde herhangi biri
   *  geçen kayıt strict modda kabul edilir. */
  targetMahalleList?: string[];
}

export function filterClinicV3(
  name: string,
  types: string[],
  address?: string,
  targetDistrictReadable?: string,
  options?: FilterV3Options,
): FilterV3Result {
  // Türkçe-aware lowercase (default toLowerCase İngilizce locale → I→i (dotted)
  // ama Türkçe'de I→ı (dotless). Bu yüzden keyword listesi miss eder.)
  const nameLower = (name ?? '').toLocaleLowerCase('tr-TR');
  const addrLower = (address ?? '').toLocaleLowerCase('tr-TR');
  const strictDistrict = options?.strictDistrict === true;
  const mahalleList = Array.isArray(options?.targetMahalleList)
    ? options!.targetMahalleList
    : [];

  if (!nameLower.trim()) {
    return { valid: false, reason: 'empty_name', segment: 'private' };
  }

  // 1. KAMU segment detect (önce — kabul edilir ama segment ayrılır)
  for (const kw of KAMU_KEYWORDS) {
    if (nameLower.includes(kw) || addrLower.includes(kw)) {
      return { valid: true, segment: 'kamu' };
    }
  }

  // 2. v3 extra forbidden (name only) — KELİME-SINIRI eşleşme.
  //    'asm' "Kasman" soyadını, 'optic' "optician"... YANLIŞ elemesin diye
  //    substring değil tam-kelime/öbek sınırı kullanılır.
  const TR_WORD = 'a-zçğıöşü0-9';
  for (const kw of FORBIDDEN_V3_EXTRA) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^${TR_WORD}])${esc}([^${TR_WORD}]|$)`);
    if (re.test(nameLower)) {
      return { valid: false, reason: `forbidden_v3:${kw}`, segment: 'private' };
    }
  }

  // 3. v1 base filter
  const base = isValidDentalClinic(name, types, address);
  if (!base.valid) {
    return { valid: false, reason: base.reason, segment: 'private' };
  }

  // 4. İlçe sınırı check
  if (targetDistrictReadable && addrLower) {
    const target = targetDistrictReadable.toLowerCase();
    const hasDistrict = target && addrLower.includes(target);
    const hasMahalle =
      mahalleList.length > 0 &&
      mahalleList.some((m) => m && addrLower.includes(m));
    if (!hasDistrict && !hasMahalle) {
      if (strictDistrict) {
        // HARD reject
        return {
          valid: false,
          reason: 'district_mismatch_strict',
          segment: 'private',
        };
      }
      // SOFT — flag, kabul
      return { valid: true, reason: 'district_mismatch', segment: 'private' };
    }
  }

  return { valid: true, segment: 'private' };
}
