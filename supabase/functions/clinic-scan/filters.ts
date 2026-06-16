// Vertical-specific filter logic for clinic-scan / discovery.
// Pure TypeScript — no Deno / Node specific imports — so this module can be
// imported by both the Edge Function (Deno) and the vitest unit tests (Node).

const FORBIDDEN_KEYWORDS = [
  // Güzellik/bakım
  'güzellik', 'guzellik', 'kuaför', 'kuafor', 'berber', 'salon',
  'spa', 'cilt bakım', 'cilt bakim', 'estetik merkezi',
  // Tıbbi branşlar (diş dışı)
  'ortopedi', 'ortopedist', 'kardiyoloji', 'dahiliye',
  'kbb', 'üroloji', 'uroloji', 'pediatri', 'göz', 'goz',
  'dermatoloji', 'dermatology', 'plastik cerrah', 'plastic surgery',
  'estetik cerrah', 'göz doktor', 'goz doktor', 'ophthalmology',
  'psikolog', 'psikiyatri', 'diyetisyen', 'beslenme uzmanı', 'beslenme uzmani',
  // Ticari (diş dışı sağlık + diğer)
  'eczane', 'pharmacy', 'optisyen', 'optic', 'optik',
  'veteriner', 'veterinary', 'fizik tedavi', 'fizyoterapi',
  'kuyumcu', 'restaurant', 'restoran', 'kafe', 'cafe', 'market',
];

const REQUIRED_DENTAL_KEYWORDS = [
  // A. Genel diş varyantları
  'diş', 'dis', 'dental', 'dent', 'denta', 'dentist',
  'dishekim', 'dishekimi',
  // Ağız/oral/çene
  'ağız', 'agiz', 'çene', 'cene', 'oral',
  // B. Türkçe uzmanlık dalları
  'ortodont', 'pedodont', 'endodont', 'periodont',
  'protetik', 'implant', 'implantol', 'protez',
  'çene cerrah', 'cene cerrah', 'ağız cerrah', 'agiz cerrah',
  'oral cerrah', 'maksillofas',
  // C. İngilizce uzmanlık
  'orthodont', 'paedodont', 'endodontic', 'periodontal',
  'prosthetic', 'maxillofac',
  // D. Klinik tipi
  'adsm', 'ağız diş', 'agiz dis', 'ağız diş sağlığı', 'agiz dis sagligi',
  'dental clinic', 'dental hospital',
  'diş polikliniği', 'dis poliklinigi',
  // E. Yüksek-güven tedaviler
  'zirkonyum', 'zirconia', 'zirkonia',
  'lamine veneer', 'kanal tedavi',
  'gülüş tasarım', 'gulus tasarim', 'smile design', 'hollywood smile',
  'all on 4', 'all-on-4', 'allon4',
  'diş beyazlat', 'dis beyazlat',
  // F. Hekim unvanları
  'diş hekim', 'dis hekim', 'dt ', 'dts',
];

// Türk diş hekimi prefiksleri — "Dr. X", "Dt. X" gibi.
// Google Places bunlarda type=dentist DÖNDÜRMEYEBİLİR ama isim Dr./Dt. ile
// başlıyorsa + tıbbi/health type'ı varsa + forbidden yoksa, kabul edilebilir.
const DENTAL_TITLE_PREFIXES = ['dt.', 'dt ', 'dr.', 'dr '];
const MEDICAL_GENERIC_TYPES = ['health', 'doctor', 'establishment', 'point_of_interest'];

export interface FilterResult {
  valid: boolean;
  reason?: string;
}

function normalize(s: string | undefined | null): string {
  // Türkçe-aware lowercase + ASCII fold.
  // JS default .toLowerCase() İngilizce locale kullanır: "I" → "i" (dotted),
  // ama Türkçe'de "I" → "ı" (dotless). Bu yüzden "AĞIZ" → "ağiz" (dotted)
  // oluyor ama keyword listemizde "ağız" (dotless) → match fail.
  const n = (s ?? '').toLocaleLowerCase('tr-TR').trim();
  // Türkçe → ASCII fold: keyword listesindeki "ağız"/"agiz" varyantlarının
  // her ikisi de yakalansın diye text'i çift normalize ederiz.
  // (Liste hem 'diş' hem 'dis', hem 'ağız' hem 'agiz' içeriyor — bu sayede
  // bazı orijinal Türkçe karakterli text de fold edilmiş varyantı yakalar.)
  return n;
}

function containsAny(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (n && haystack.includes(n)) return n;
  }
  return null;
}

// Kelime-sınırı eşleşme: needle yalnız tam kelime/öbek olarak geçerse hit verir.
// Substring değil → 'göz' "Gözde"yi, 'berber' "Berberoğlu"yu, 'asm' "Kasman"ı
// YANLIŞ elemez. Türkçe harf sınıfı bilinçli (haystack zaten tr-lowercase).
const TR_WORD_CHARS = 'a-zçğıöşü0-9';
function wordHit(haystack: string, needles: string[]): string | null {
  for (const n of needles) {
    if (!n) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^${TR_WORD_CHARS}])${esc}([^${TR_WORD_CHARS}]|$)`);
    if (re.test(haystack)) return n;
  }
  return null;
}

export function isValidDentalClinic(
  name: string,
  types: string[] = [],
  address?: string,
): FilterResult {
  const nameLc = normalize(name);
  const addrLc = normalize(address);
  const typesLc = (types ?? []).map((t) => normalize(t));

  if (!nameLc) {
    return { valid: false, reason: 'empty_name' };
  }

  // Dental pozitif sinyaller (loose/substring — recall'ı MAKSİMİZE eder:
  // 'dent' "dentart"ı, 'diş' "dişdeposu"nu yakalasın).
  const haystack = `${nameLc} ${addrLc}`.trim();
  const hasDentistType = typesLc.includes('dentist');
  const dentalHit = containsAny(haystack, REQUIRED_DENTAL_KEYWORDS);
  const hasTitlePrefix = DENTAL_TITLE_PREFIXES.some((p) => nameLc.startsWith(p));
  const hasMedicalType = typesLc.some((t) => MEDICAL_GENERIC_TYPES.includes(t));
  const dentalSignal = hasDentistType || Boolean(dentalHit) || (hasTitlePrefix && hasMedicalType);

  // Forbidden (göz/berber/ortopedi/eczane…) — KELİME-SINIRI eşleşme + yalnızca
  // dental sinyal YOKSA veto. Böylece soyadı/adı forbidden token içeren GERÇEK
  // diş hekimi (Gözde, Berberoğlu, Baran Göz + "Ağız Diş Çene Cerrahisi") elenmez;
  // ama dental sinyali olmayan gerçek göz/ortopedi kliniği ("Dünya Göz") elenir.
  const forbiddenHit = wordHit(nameLc, FORBIDDEN_KEYWORDS);
  if (forbiddenHit && !dentalSignal) {
    return { valid: false, reason: `forbidden_keyword:${forbiddenHit}` };
  }

  if (dentalSignal) {
    return { valid: true };
  }

  return { valid: false, reason: 'no_dental_signal' };
}

export type VerticalFilter = (
  name: string,
  types: string[],
  address?: string,
) => FilterResult;

export const VERTICAL_FILTERS: Record<string, VerticalFilter> = {
  dental: isValidDentalClinic,
};

export function getFilterForVertical(verticalKey: string): VerticalFilter {
  return VERTICAL_FILTERS[verticalKey] ?? isValidDentalClinic;
}
