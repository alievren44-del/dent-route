/**
 * clinicExcelExport.ts — 14 sütun Excel export + renk kodlu satırlar.
 *
 * Phase 4 (Akıllı Tarama Motoru) — ScanRoutePlanner çıktısı.
 *
 * Sütunlar (planın 14 madde):
 *   1. Sıra (ordinal)
 *   2. Klinik Adı
 *   3. Mahalle
 *   4. Adres
 *   5. Telefon
 *   6. Yorum Sayısı (user_ratings_total)
 *   7. Puan (rating)
 *   8. Tip / Özellik (type_label)
 *   9. Ziyaret Tarihi (boş — saha rep doldurur)
 *  10. Temsilci
 *  11. Görüşülen Hekim (boş)
 *  12. Durum (boş)
 *  13. Sipariş (boş)
 *  14. Notlar (boş)
 *
 * Renk kuralları (satır fill):
 *  - user_ratings_total ≥ 500  → #FFA94D (turuncu, MEGA lead)
 *  - 150 ≤ user_ratings_total < 500 → #FFE082 (sarı, HOT lead)
 *  - diğer → beyaz (renksiz)
 *
 * Sheet'ler:
 *  - "Klinikler" → segment === 'private' kayıtlar
 *  - "KAMU"     → segment === 'kamu' kayıtlar
 *
 * Not (SheetJS Community Edition):
 *  - Cell-level styling (fill / font.bold) `s.fill.fgColor.rgb` ile yazılır.
 *    Resmî Microsoft Excel (2016+) ve Google Sheets render eder.
 *    LibreOffice eski versiyonlarda bazı stiller görmezden gelinebilir.
 *  - Renk kodları görünmezse export yine geçerli xlsx dosyasıdır; veri kaybı yok.
 */

import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────────────────

export interface ExportClinic {
  ordinal: number;
  name: string;
  neighborhood?: string;
  address?: string;
  phone?: string;
  user_ratings_total?: number;
  rating?: number;
  type_label?: string;
  /** 'private' (özel klinik) veya 'kamu' (ADSM/devlet hastanesi) */
  segment: 'private' | 'kamu';
}

export interface ExportOptions {
  filename: string;
  routeMeta?: {
    province: string;
    district?: string;
    totalKm?: number;
    totalDurationMin?: number;
    repName?: string;
    date?: string;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sabitler
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_COLOR = 'FF1F4E78'; // koyu mavi
const HEADER_TEXT_COLOR = 'FFFFFFFF'; // beyaz
const ORANGE_FILL = 'FFFFA94D';
const YELLOW_FILL = 'FFFFE082';

const HEADERS = [
  'Sıra',
  'Klinik Adı',
  'Mahalle',
  'Adres',
  'Telefon',
  'Yorum Sayısı',
  'Puan',
  'Tip/Özellik',
  'Ziyaret Tarihi',
  'Temsilci',
  'Görüşülen Hekim',
  'Durum',
  'Sipariş',
  'Notlar',
] as const;

const COLUMN_WIDTHS: XLSX.ColInfo[] = [
  { wch: 6 }, // Sıra
  { wch: 32 }, // Klinik Adı
  { wch: 18 }, // Mahalle
  { wch: 40 }, // Adres
  { wch: 16 }, // Telefon
  { wch: 12 }, // Yorum Sayısı
  { wch: 8 }, // Puan
  { wch: 18 }, // Tip/Özellik
  { wch: 14 }, // Ziyaret Tarihi
  { wch: 14 }, // Temsilci
  { wch: 18 }, // Görüşülen Hekim
  { wch: 14 }, // Durum
  { wch: 12 }, // Sipariş
  { wch: 28 }, // Notlar
];

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────

function fillColorForReviews(total: number | undefined): string | null {
  if (typeof total !== 'number') return null;
  if (total >= 500) return ORANGE_FILL;
  if (total >= 150) return YELLOW_FILL;
  return null;
}

function buildMetaBanner(meta: ExportOptions['routeMeta']): string {
  if (!meta) return '';
  const parts: string[] = [];
  parts.push(`İl: ${meta.province}`);
  if (meta.district) parts.push(`İlçe: ${meta.district}`);
  if (typeof meta.totalKm === 'number') {
    parts.push(`Toplam: ${meta.totalKm.toFixed(1)} km`);
  }
  if (typeof meta.totalDurationMin === 'number') {
    parts.push(`${meta.totalDurationMin} dk`);
  }
  if (meta.repName) parts.push(`Temsilci: ${meta.repName}`);
  if (meta.date) parts.push(meta.date);
  return parts.join(' — ');
}

interface CellStyle {
  fill?: { fgColor: { rgb: string }; patternType?: string };
  font?: { bold?: boolean; color?: { rgb: string }; sz?: number };
  alignment?: { horizontal?: string; vertical?: string; wrapText?: boolean };
  border?: Record<string, { style: string; color: { rgb: string } }>;
}

function applyStyleToRow(
  ws: XLSX.WorkSheet,
  rowIdx: number,
  colCount: number,
  style: CellStyle,
): void {
  // Worksheet'in cell access tipi `any` (xlsx WSKeys union'ı) ve `s`
  // property'si SheetJS Community'de typed değil. Runtime'da çalışıyor —
  // any cast + explicit eslint-disable bloku ile assignment yapıyoruz.
  /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: rowIdx, c });
    const cell = ws[ref];
    if (!cell) continue;
    const existing: CellStyle = (cell.s as CellStyle | undefined) ?? {};
    cell.s = { ...existing, ...style };
  }
  /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */
}

function buildSheetForSegment(
  clinics: ExportClinic[],
  options: ExportOptions,
): XLSX.WorkSheet {
  const metaBanner = buildMetaBanner(options.routeMeta);

  // AOA layout:
  //   row 0: [metaBanner, ...] (merged-look — sadece A1'e yazılır)
  //   row 1: HEADERS
  //   row 2+: data
  const aoa: Array<Array<string | number>> = [];

  if (metaBanner) {
    aoa.push([metaBanner]);
  }
  aoa.push([...HEADERS]);

  for (const c of clinics) {
    aoa.push([
      c.ordinal,
      c.name,
      c.neighborhood ?? '',
      c.address ?? '',
      c.phone ?? '',
      c.user_ratings_total ?? '',
      typeof c.rating === 'number' ? c.rating : '',
      c.type_label ?? '',
      '', // Ziyaret Tarihi (saha rep doldurur)
      options.routeMeta?.repName ?? '',
      '', // Görüşülen Hekim
      '', // Durum
      '', // Sipariş
      '', // Notlar
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Sütun genişliği
  ws['!cols'] = COLUMN_WIDTHS;

  const headerRowIdx = metaBanner ? 1 : 0;

  // Meta banner stil (varsa)
  if (metaBanner) {
    applyStyleToRow(ws, 0, 1, {
      font: { bold: true, sz: 11, color: { rgb: 'FF1F4E78' } },
      alignment: { horizontal: 'left', vertical: 'center' },
    });
    // Banner için satır yüksekliği
    ws['!rows'] = ws['!rows'] ?? [];
    ws['!rows'][0] = { hpt: 22 };
  }

  // Header stil — bold beyaz yazı, mavi fill
  applyStyleToRow(ws, headerRowIdx, HEADERS.length, {
    font: { bold: true, color: { rgb: HEADER_TEXT_COLOR }, sz: 11 },
    fill: { fgColor: { rgb: HEADER_COLOR }, patternType: 'solid' },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  });

  // Data satırları — renk kodu user_ratings_total'a göre
  for (let i = 0; i < clinics.length; i++) {
    const clinic = clinics[i]!;
    const rowIdx = headerRowIdx + 1 + i;
    const color = fillColorForReviews(clinic.user_ratings_total);
    if (color) {
      applyStyleToRow(ws, rowIdx, HEADERS.length, {
        fill: { fgColor: { rgb: color }, patternType: 'solid' },
      });
    }
  }

  return ws;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ana export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 14 sütunlu Excel (.xlsx) üretir + tarayıcıdan indirir.
 *
 * Klinikler iki sheet'e ayrılır:
 *   - "Klinikler" → segment === 'private'
 *   - "KAMU"     → segment === 'kamu'
 *
 * KAMU sheet'i yalnızca o segmentten kayıt varsa eklenir.
 *
 * @param clinics — Tüm klinik kayıtları (segment bilgisiyle).
 * @param options — Dosya adı + meta banner için bilgi.
 */
export function exportClinicsToExcel(
  clinics: ExportClinic[],
  options: ExportOptions,
): void {
  const wb = XLSX.utils.book_new();

  const privateClinics = clinics.filter((c) => c.segment === 'private');
  const kamuClinics = clinics.filter((c) => c.segment === 'kamu');

  const privateWs = buildSheetForSegment(privateClinics, options);
  XLSX.utils.book_append_sheet(wb, privateWs, 'Klinikler');

  if (kamuClinics.length > 0) {
    const kamuWs = buildSheetForSegment(kamuClinics, options);
    XLSX.utils.book_append_sheet(wb, kamuWs, 'KAMU');
  }

  XLSX.writeFile(wb, options.filename);
}
