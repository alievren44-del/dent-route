// ============================================================================
// query-builder.ts — TextSearch + NearbySearch + Specialty sorgu üretici
// ============================================================================
//
// Brief madde 3: 8 hedefli base sorgu + mahalle çiftleri + uzmanlık.
//   - text[]      → TextSearch (lokasyon string'i kuyrukta, merkez bias yok)
//   - nearby[]    → NearbySearch keyword (her grid noktası için tekrar)
//   - specialty[] → TextSearch uzmanlık (7 dal × ilçe)
//
// Mahalle çiftleri: ilk 8-10 mahalle alınır, ardışık çiftler birleştirilir
// (örn. "Şifa Hamidiye Battalgazi"). Eksik slot'lar (mahalle yetmediyse)
// safe-fallback ile boş bırakılır → query trim'le düşürülür.
// ============================================================================

import { SPECIALTY_KEYWORDS } from './specialty-queries.ts';

export interface BuildArgs {
  ilceName: string; // human-readable, e.g. "Battalgazi"
  ilName: string; // e.g. "Malatya"
  neighborhoods: string[]; // ilk 8-10 mahalle (ilçe merkezine yakın)
}

export interface QuerySet {
  text: string[]; // TextSearch sorgular (genel + mahalle çiftleri)
  nearby: string[]; // NearbySearch keyword (grid noktası başına tekrar edilir)
  specialty: string[]; // TextSearch uzmanlık
}

/**
 * 8 base sorgu + 7 uzmanlık + 2 NearbySearch keyword üret.
 *
 * Mahalle çiftleri (pair(i, j)): her iki mahalle de varsa "A B" birleşir;
 * sadece i varsa A; ikisi de yoksa boş string → trim ile düşürülür.
 */
export function buildQueries(args: BuildArgs): QuerySet {
  const ilceName = (args.ilceName ?? '').trim();
  const ilName = (args.ilName ?? '').trim();
  const N = Array.isArray(args.neighborhoods)
    ? args.neighborhoods.map((s) => (s ?? '').trim()).filter((s) => s.length > 0)
    : [];

  const pair = (i: number, j: number): string => {
    const a = N[i] ?? '';
    const b = N[j] ?? '';
    if (a && b) return `${a} ${b}`;
    return a || b;
  };

  const rawText: string[] = [
    `diş hekimi muayenehanesi ${ilceName} merkez ${ilName}`,
    `Dt. diş doktoru ${pair(0, 1)} ${ilceName} ara sokak`,
    `diş kliniği ${pair(1, 2)} ${ilceName}`,
    `diş hekimi ${pair(3, 4)} ${ilceName} Cumhuriyet Caddesi`,
    `diş hekimi ${pair(5, 6)} ${ilceName}`,
    `ağız diş sağlığı polikliniği ${ilceName}`,
    `diş hekimi ${ilceName} ana cadde`,
    `diş hekimi 7/24 nöbetçi ${ilceName}`,
  ];

  // Normalize whitespace: çift+ boşluk → tek boşluk, trim. Pair'i boş geldiyse
  // sorgu içinde "  " kalmasın; sonra trim'le artık boş kalan veya tek-kelime
  // olan sorguları (anlamsız) filtrele.
  const text: string[] = rawText
    .map((q) => q.replace(/\s+/g, ' ').trim())
    // En az 3 token (örn. "diş hekimi <ilçe>") gerek — yoksa Google çok genel
    // sonuç döner, bandwidth boş gider.
    .filter((q) => q.split(' ').length >= 3);

  const nearby: string[] = ['diş hekimi', 'Dt. diş muayenehanesi'];

  const specialty: string[] = SPECIALTY_KEYWORDS.map((k) => `${k} ${ilceName}`.trim());

  return { text, nearby, specialty };
}
