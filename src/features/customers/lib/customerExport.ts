/**
 * customerExport — Müşteri listesi XLSX export.
 *
 * Multi-select moddan seçili satırlar burada SheetJS (xlsx) ile
 * `aoa_to_sheet` üzerinden Excel dosyasına yazılır ve indirme tetiklenir.
 *
 * Sütunlar: Ad, Adres, Telefon, Mahalle, İl, İlçe, Son Ziyaret, Outcome.
 */

import * as XLSX from 'xlsx';

export interface AccountRow {
  id: string;
  name: string;
  type?: string | null;
  phone?: string | null;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  district?: string | null;
  lastVisitAt?: string | null;
  lastVisitOutcome?: string | null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Müşteri satırlarını XLSX dosyası olarak indirir.
 *
 * @example
 *   exportToXlsx(selectedRows, 'musteriler_2026-06-04.xlsx');
 */
export function exportToXlsx(rows: AccountRow[], filename = 'musteriler.xlsx'): void {
  const header: string[] = [
    'Ad',
    'Adres',
    'Telefon',
    'Mahalle',
    'İl',
    'İlçe',
    'Son Ziyaret',
    'Outcome',
  ];

  const aoa: (string | number)[][] = [header];

  for (const r of rows) {
    aoa.push([
      r.name ?? '',
      r.address ?? '',
      r.phone ?? '',
      r.neighborhood ?? '',
      r.city ?? '',
      r.district ?? '',
      formatDate(r.lastVisitAt),
      r.lastVisitOutcome ?? '',
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Kolon genişliklerini biraz daha okunabilir yap
  ws['!cols'] = [
    { wch: 32 }, // Ad
    { wch: 40 }, // Adres
    { wch: 16 }, // Telefon
    { wch: 18 }, // Mahalle
    { wch: 16 }, // İl
    { wch: 18 }, // İlçe
    { wch: 14 }, // Son Ziyaret
    { wch: 18 }, // Outcome
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Müşteriler');

  const safeName = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, safeName);
}
