/**
 * invoiceCalc — Fatura hesaplama yardımcı fonksiyonları (pure, TR muhasebe).
 *
 * Formül (DB'deki GENERATED kolonlarla birebir):
 *   net_tutar       = round(miktar * birim_fiyat * (1 - iskonto_orani), 2)
 *   iskonto_tutari  = round(miktar * birim_fiyat * iskonto_orani, 2)
 *   kdv_tutari      = round(net_tutar * kdv_orani, 2)
 *   satir_toplam    = round(net_tutar * (1 + kdv_orani), 2)
 *
 * Yuvarlama: TR muhasebe standardı — "round half away from zero" 2 decimal.
 *   Math.round(n * 100) / 100 → JavaScript "round half to even" değil, pratikte
 *   epsilon eklediğimiz için "half away from zero" benzeri davranır.
 */

export interface LineItem {
  miktar: number;
  birim_fiyat: number;
  iskonto_orani: number; // 0..1 (örn: 0.10 = %10)
  kdv_orani: number; // 0..1 (örn: 0.20 = %20)
}

export interface LineTotal {
  netTotal: number;
  iskonto_tutari: number;
  kdv_tutari: number;
  total: number;
}

export interface InvoiceTotals {
  ara_toplam: number;
  iskonto_toplam: number;
  kdv_tutari: number;
  toplam: number;
}

/**
 * 2 decimal half-away-from-zero rounding (TR muhasebe standardı).
 * Math.round(0.5) === 1, Math.round(-0.5) === 0 olduğundan epsilon ile
 * negatif tarafı simetrik yapıyoruz.
 */
function round2(n: number): number {
  const sign = n < 0 ? -1 : 1;
  return (sign * Math.round(Math.abs(n) * 100 + Number.EPSILON)) / 100;
}

/**
 * Bir kalemin tüm tutarlarını hesaplar.
 */
export function calcLineTotal(
  miktar: number,
  birim_fiyat: number,
  iskonto_orani: number,
  kdv_orani: number,
): LineTotal {
  const gross = miktar * birim_fiyat;
  const iskonto_tutari = round2(gross * iskonto_orani);
  const netTotal = round2(gross - iskonto_tutari);
  const kdv_tutari = round2(netTotal * kdv_orani);
  const total = round2(netTotal + kdv_tutari);
  return { netTotal, iskonto_tutari, kdv_tutari, total };
}

/**
 * Tüm kalemler için fatura toplamını hesaplar.
 * ara_toplam = net kalemlerin toplamı (iskontodan sonra, KDV'den önce)
 */
export function calcInvoiceTotals(lines: LineItem[]): InvoiceTotals {
  let ara = 0;
  let iskonto = 0;
  let kdv = 0;
  let toplam = 0;
  for (const line of lines) {
    const t = calcLineTotal(line.miktar, line.birim_fiyat, line.iskonto_orani, line.kdv_orani);
    ara += t.netTotal;
    iskonto += t.iskonto_tutari;
    kdv += t.kdv_tutari;
    toplam += t.total;
  }
  return {
    ara_toplam: round2(ara),
    iskonto_toplam: round2(iskonto),
    kdv_tutari: round2(kdv),
    toplam: round2(toplam),
  };
}

/**
 * Tarih + gün → vade tarihi (YYYY-MM-DD)
 */
export function calcVadeTarihi(tarih: string | Date, odeme_vadesi_gun: number): string {
  const d = typeof tarih === 'string' ? new Date(tarih) : new Date(tarih.getTime());
  d.setDate(d.getDate() + (odeme_vadesi_gun || 0));
  return d.toISOString().slice(0, 10);
}

/**
 * TRY formatlayıcı — 1.234,56 ₺
 */
export function formatTRY(n: number): string {
  return n.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}
