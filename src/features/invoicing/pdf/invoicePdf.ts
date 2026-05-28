/**
 * invoicePdf — Fatura PDF üretimi (HTML-to-print yaklaşımı).
 *
 * NOT: jsPDF / pdf-lib gibi PDF kütüphaneleri kurulu DEĞİL. Yeni npm bağımlılığı
 * eklemeden çözüm: HTML string üret, yeni pencerede aç, window.print() çağır.
 * Kullanıcı tarayıcının "PDF olarak kaydet" diyalogundan kaydeder.
 *
 * Avantajı:
 *   - 0 bundle maliyeti
 *   - Türkçe karakter sorunu yok (browser font handling)
 *   - A4 layout @page CSS ile garanti
 *
 * Dezavantajı:
 *   - Popup blocker'a takılabilir (kullanıcıya uyarı verilir)
 *   - Programatik kaydetme yok (kullanıcı bir tık daha yapar)
 *
 * Daha sonra (PROMPT-16+) jsPDF eklenirse bu modül export'ları aynı kalır,
 * sadece implementation değişir.
 */

import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

export interface PdfCari {
  cari_kodu: string;
  fatura_unvani: string;
  vergi_no?: string | null;
  vergi_dairesi?: string | null;
  fatura_adresi?: string | null;
  il?: string | null;
  ilce?: string | null;
}

export interface PdfKalem {
  sira: number;
  urun_adi: string;
  birim: string;
  miktar: number;
  birim_fiyat: number;
  iskonto_orani: number;
  kdv_orani: number;
  net_tutar: number;
  kdv_tutari: number;
  satir_toplam: number;
}

export interface PdfInvoice {
  fatura_no?: string | null;
  tarih: string;
  vade_tarihi?: string | null;
  tip: string;
  ara_toplam: number;
  iskonto_toplam: number;
  kdv_tutari: number;
  toplam: number;
  para_birimi: string;
  aciklama?: string | null;
}

const FIRMA = {
  unvan: 'Parla Diş Deposu',
  vergi_no: '—',
  vergi_dairesi: '—',
  adres: 'İstanbul, Türkiye',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Fatura için yazdırılabilir HTML üretir.
 */
export function generateInvoicePdfHtml(
  invoice: PdfInvoice,
  cari: PdfCari,
  kalemler: PdfKalem[],
): string {
  const kalemRows = kalemler
    .map(
      (k) => `
      <tr>
        <td class="num">${k.sira}</td>
        <td>${escapeHtml(k.urun_adi)}</td>
        <td class="num">${k.miktar.toLocaleString('tr-TR')} ${escapeHtml(k.birim)}</td>
        <td class="num">${formatTRY(k.birim_fiyat)}</td>
        <td class="num">${(k.iskonto_orani * 100).toFixed(2)}%</td>
        <td class="num">${(k.kdv_orani * 100).toFixed(2)}%</td>
        <td class="num">${formatTRY(k.net_tutar)}</td>
        <td class="num">${formatTRY(k.satir_toplam)}</td>
      </tr>`,
    )
    .join('');

  const tipEtiket = invoice.tip === 'iade' ? 'İADE FATURASI' : 'SATIŞ FATURASI';

  return `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <title>Fatura ${escapeHtml(invoice.fatura_no ?? '')}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #111;
      font-size: 11pt;
      line-height: 1.4;
      margin: 0;
      padding: 0;
    }
    .container { max-width: 210mm; margin: 0 auto; padding: 10mm; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #111;
      padding-bottom: 10mm;
      margin-bottom: 10mm;
    }
    .logo-placeholder {
      width: 60mm;
      height: 25mm;
      border: 1px dashed #aaa;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #888;
      font-size: 9pt;
    }
    .invoice-title {
      text-align: right;
    }
    .invoice-title h1 { margin: 0; font-size: 20pt; }
    .invoice-title .meta { font-size: 10pt; margin-top: 2mm; }
    .parties {
      display: flex;
      gap: 10mm;
      margin-bottom: 10mm;
    }
    .party {
      flex: 1;
      padding: 5mm;
      background: #f7f7f7;
      border-radius: 2mm;
    }
    .party h3 {
      margin: 0 0 3mm 0;
      font-size: 10pt;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
    }
    .party .name { font-weight: 600; font-size: 11pt; margin-bottom: 1mm; }
    .party .row { font-size: 9pt; color: #444; margin-top: 1mm; }
    table.items {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 5mm;
      font-size: 9pt;
    }
    table.items th {
      background: #111;
      color: #fff;
      padding: 2mm 3mm;
      text-align: left;
      font-weight: 600;
    }
    table.items td {
      padding: 2mm 3mm;
      border-bottom: 1px solid #ddd;
    }
    table.items .num { text-align: right; }
    .totals {
      display: flex;
      justify-content: flex-end;
      margin-top: 5mm;
    }
    .totals table {
      min-width: 80mm;
      font-size: 10pt;
    }
    .totals td { padding: 1.5mm 3mm; }
    .totals .label { color: #666; }
    .totals .value { text-align: right; font-weight: 500; }
    .totals .grand {
      border-top: 2px solid #111;
      font-weight: 700;
      font-size: 12pt;
    }
    .footer {
      margin-top: 15mm;
      padding-top: 5mm;
      border-top: 1px solid #ddd;
      font-size: 9pt;
      color: #666;
    }
    .footer .aciklama { white-space: pre-wrap; margin-bottom: 5mm; }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-placeholder">LOGO</div>
      <div class="invoice-title">
        <h1>${escapeHtml(tipEtiket)}</h1>
        <div class="meta">
          <div><strong>Fatura No:</strong> ${escapeHtml(invoice.fatura_no ?? '—')}</div>
          <div><strong>Tarih:</strong> ${fmtDate(invoice.tarih)}</div>
          <div><strong>Vade:</strong> ${fmtDate(invoice.vade_tarihi)}</div>
        </div>
      </div>
    </div>

    <div class="parties">
      <div class="party">
        <h3>Satıcı</h3>
        <div class="name">${escapeHtml(FIRMA.unvan)}</div>
        <div class="row">VKN: ${escapeHtml(FIRMA.vergi_no)}</div>
        <div class="row">Vergi Dairesi: ${escapeHtml(FIRMA.vergi_dairesi)}</div>
        <div class="row">${escapeHtml(FIRMA.adres)}</div>
      </div>
      <div class="party">
        <h3>Alıcı (Cari ${escapeHtml(cari.cari_kodu)})</h3>
        <div class="name">${escapeHtml(cari.fatura_unvani)}</div>
        ${cari.vergi_no ? `<div class="row">VKN: ${escapeHtml(cari.vergi_no)}</div>` : ''}
        ${cari.vergi_dairesi ? `<div class="row">Vergi Dairesi: ${escapeHtml(cari.vergi_dairesi)}</div>` : ''}
        ${cari.fatura_adresi ? `<div class="row">${escapeHtml(cari.fatura_adresi)}</div>` : ''}
        ${cari.il || cari.ilce ? `<div class="row">${escapeHtml(cari.ilce ?? '')} ${escapeHtml(cari.il ?? '')}</div>` : ''}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Sıra</th>
          <th>Ürün / Hizmet</th>
          <th class="num">Miktar</th>
          <th class="num">Birim Fiyat</th>
          <th class="num">İsk.</th>
          <th class="num">KDV</th>
          <th class="num">Net</th>
          <th class="num">Toplam</th>
        </tr>
      </thead>
      <tbody>
        ${kalemRows}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr>
          <td class="label">Ara Toplam</td>
          <td class="value">${formatTRY(invoice.ara_toplam)}</td>
        </tr>
        <tr>
          <td class="label">İskonto</td>
          <td class="value">-${formatTRY(invoice.iskonto_toplam)}</td>
        </tr>
        <tr>
          <td class="label">KDV</td>
          <td class="value">${formatTRY(invoice.kdv_tutari)}</td>
        </tr>
        <tr class="grand">
          <td class="label">Genel Toplam</td>
          <td class="value">${formatTRY(invoice.toplam)}</td>
        </tr>
      </table>
    </div>

    <div class="footer">
      ${invoice.aciklama ? `<div class="aciklama"><strong>Açıklama:</strong> ${escapeHtml(invoice.aciklama)}</div>` : ''}
      <div>Bu belge tarayıcıdan "PDF olarak kaydet" seçeneğiyle PDF'e dönüştürülebilir.</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Yeni pencerede HTML'i açıp print diyaloğunu tetikler.
 * Popup engelliyse hata fırlatır.
 */
export function openInvoicePrintWindow(html: string): void {
  const w = window.open('', '_blank');
  if (!w) {
    throw new Error('Popup engellendi. Tarayıcı ayarlarından bu site için popup izni verin.');
  }
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    w.focus();
    w.print();
  }, 250);
}

/**
 * Tek adımda: HTML üret + yazdır penceresi aç.
 */
export function printInvoice(invoice: PdfInvoice, cari: PdfCari, kalemler: PdfKalem[]): void {
  const html = generateInvoicePdfHtml(invoice, cari, kalemler);
  openInvoicePrintWindow(html);
}

/**
 * Cari ekstresi (basit) için yardımcı — InvoiceDetailPage dışında
 * CariDetailPage'in Ekstre tabı tarafından çağrılır.
 */
export function generateExtractPdfHtml(
  cari: PdfCari,
  dateFrom: string,
  dateTo: string,
  rows: Array<{
    tarih: string;
    tip: string;
    aciklama: string;
    borc: number;
    alacak: number;
    bakiye: number;
  }>,
): string {
  const rowsHtml = rows
    .map(
      (r) => `
      <tr>
        <td>${fmtDate(r.tarih)}</td>
        <td>${escapeHtml(r.tip)}</td>
        <td>${escapeHtml(r.aciklama)}</td>
        <td class="num">${r.borc > 0 ? formatTRY(r.borc) : '—'}</td>
        <td class="num">${r.alacak > 0 ? formatTRY(r.alacak) : '—'}</td>
        <td class="num"><strong>${formatTRY(r.bakiye)}</strong></td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="tr"><head><meta charset="UTF-8"><title>Cari Ekstre — ${escapeHtml(cari.fatura_unvani)}</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: -apple-system, sans-serif; font-size: 10pt; color: #111; }
h1 { font-size: 16pt; margin-bottom: 2mm; }
.meta { color: #666; margin-bottom: 5mm; font-size: 9pt; }
table { width: 100%; border-collapse: collapse; font-size: 9pt; }
th { background: #111; color: #fff; padding: 2mm; text-align: left; }
td { padding: 2mm; border-bottom: 1px solid #ddd; }
.num { text-align: right; }
</style></head><body>
<h1>Cari Ekstre — ${escapeHtml(cari.fatura_unvani)}</h1>
<div class="meta">Kod: ${escapeHtml(cari.cari_kodu)} • Dönem: ${fmtDate(dateFrom)} – ${fmtDate(dateTo)}</div>
<table>
<thead><tr><th>Tarih</th><th>Tip</th><th>Açıklama</th><th class="num">Borç</th><th class="num">Alacak</th><th class="num">Bakiye</th></tr></thead>
<tbody>${rowsHtml}</tbody>
</table>
</body></html>`;
}
