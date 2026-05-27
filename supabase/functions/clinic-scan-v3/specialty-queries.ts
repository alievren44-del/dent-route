// ============================================================================
// specialty-queries.ts — Uzmanlık keyword'leri (clinic-scan-v3)
// ============================================================================
//
// Brief madde 4: Türkiye'de diş hekimliği uzmanlık dalları. Her biri için bir
// Google TextSearch sorgusu çalıştırılır — uzman diş hekimleri genel "diş
// hekimi" aramasında geri planda kalır (üst sırada market lideri klinikler).
//
// NAME_PATTERNS: dönen sonuçları post-filter etmek için (örn. Google "ortodonti
// İstanbul" sorgusuna ortopedi merkezi de dönebilir → name regex ile elenir).
// Bu liste opsiyonel kullanılabilir (clinic-scan-v3/index.ts içinde post-filter).
// ============================================================================

export const SPECIALTY_KEYWORDS: string[] = [
  'ortodonti uzmanı',
  'pedodonti çocuk diş hekimi',
  'endodonti kanal tedavisi uzmanı',
  'çene cerrahisi uzmanı',
  'periodontoloji diş eti uzmanı',
  'protetik diş tedavisi uzmanı',
  'implantoloji uzmanı diş hekimi',
];

export const SPECIALTY_NAME_PATTERNS: RegExp[] = [
  /ortodonti/i,
  /pedodonti/i,
  /endodont/i,
  /\bçene cerrah/i,
  /periodonto/i,
  /\bprotetik/i,
  /implanto/i,
  /Uzm\.?\s*Dr\.?\s*Dt/i,
];

/**
 * İsim, uzmanlık göstergeleri içeriyor mu? confidence boosting + reporting için.
 */
export function isSpecialty(name: string): boolean {
  if (!name) return false;
  return SPECIALTY_NAME_PATTERNS.some((re) => re.test(name));
}
