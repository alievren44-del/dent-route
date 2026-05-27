/**
 * ublXml — UBL-TR 2.1 Fatura XML üretici (STUB).
 *
 * !!! ÖNEMLİ !!!
 * Bu modül GİB onaylı bir e-fatura çıktısı ÜRETMEZ. Sadece test/dev amaçlı
 * UBL-TR 2.1 spesifikasyonuna yakın bir XML iskeleti üretir.
 *
 * Production için:
 *   - GİB onaylı entegratör SDK (örn: Foriba, izibiz, Logo, Mikro)
 *   - Mali mühür imzalama (XAdES)
 *   - Şema validasyonu (UBL-TR 2.1 XSD)
 *   - Zarf paketleme + gönderim
 * gereklidir.
 *
 * Referans:
 *   - https://efatura.gov.tr/efaturamevzuat.html
 *   - https://docs.oasis-open.org/ubl/UBL-2.1.html
 */

interface UblCari {
  cari_kodu: string;
  fatura_unvani: string;
  vergi_no?: string | null;
  vergi_dairesi?: string | null;
  fatura_adresi?: string | null;
  il?: string | null;
  ilce?: string | null;
}

interface UblKalem {
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

interface UblInvoice {
  id: string;
  fatura_no?: string | null;
  tarih: string;
  vade_tarihi?: string | null;
  tip: string; // 'satis' | 'iade'
  ara_toplam: number;
  iskonto_toplam: number;
  kdv_tutari: number;
  toplam: number;
  para_birimi: string;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function uuidV4(): string {
  // crypto.randomUUID() yoksa fallback
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function fmtAmount(n: number): string {
  return n.toFixed(2);
}

function fmtDate(iso: string): string {
  // ISO YYYY-MM-DD direkt UBL'de geçerli
  return iso.slice(0, 10);
}

/**
 * UBL-TR 2.1 minimal Fatura XML üretir.
 */
export function generateUblInvoiceXml(
  invoice: UblInvoice,
  cari: UblCari,
  kalemler: UblKalem[],
): string {
  const uuid = uuidV4();
  const tipCode = invoice.tip === 'iade' ? 'IADE' : 'SATIS';
  const profile = invoice.tip === 'iade' ? 'IADEFATURA' : 'TEMELFATURA';

  const lines = kalemler
    .map((k) => {
      const lineId = k.sira;
      const iskontoTutari = k.miktar * k.birim_fiyat * k.iskonto_orani;
      return `  <cac:InvoiceLine>
    <cbc:ID>${lineId}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xmlEscape(k.birim.toUpperCase())}">${k.miktar.toFixed(3)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(k.net_tutar)}</cbc:LineExtensionAmount>
    ${
      iskontoTutari > 0
        ? `<cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:MultiplierFactorNumeric>${k.iskonto_orani.toFixed(4)}</cbc:MultiplierFactorNumeric>
      <cbc:Amount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(iskontoTutari)}</cbc:Amount>
    </cac:AllowanceCharge>`
        : ''
    }
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(k.kdv_tutari)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(k.net_tutar)}</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(k.kdv_tutari)}</cbc:TaxAmount>
        <cbc:Percent>${(k.kdv_orani * 100).toFixed(2)}</cbc:Percent>
        <cac:TaxCategory>
          <cac:TaxScheme>
            <cbc:Name>KDV</cbc:Name>
            <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
          </cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>${xmlEscape(k.urun_adi)}</cbc:Name>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(k.birim_fiyat)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ====================================================================== -->
<!-- STUB UBL-TR 2.1 — GİB ONAYLI DEĞİL. Sadece development/test amaçlı.    -->
<!-- Production için entegratör SDK + mali mühür imzası gerekir.            -->
<!-- ====================================================================== -->
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>${xmlEscape(profile)}</cbc:ProfileID>
  <cbc:ID>${xmlEscape(invoice.fatura_no ?? invoice.id)}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>${uuid}</cbc:UUID>
  <cbc:IssueDate>${fmtDate(invoice.tarih)}</cbc:IssueDate>
  ${invoice.vade_tarihi ? `<cbc:DueDate>${fmtDate(invoice.vade_tarihi)}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>${xmlEscape(tipCode)}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${xmlEscape(invoice.para_birimi)}</cbc:DocumentCurrencyCode>
  <cbc:LineCountNumeric>${kalemler.length}</cbc:LineCountNumeric>

  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="VKN">0000000000</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>Parla Diş Deposu</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:CityName>İstanbul</cbc:CityName>
        <cbc:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
        </cbc:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>—</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>

  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification>
        <cbc:ID schemeID="${cari.vergi_no && cari.vergi_no.length === 11 ? 'TCKN' : 'VKN'}">${xmlEscape(cari.vergi_no ?? '0000000000')}</cbc:ID>
      </cac:PartyIdentification>
      <cac:PartyName>
        <cbc:Name>${xmlEscape(cari.fatura_unvani)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        ${cari.fatura_adresi ? `<cbc:StreetName>${xmlEscape(cari.fatura_adresi)}</cbc:StreetName>` : ''}
        ${cari.ilce ? `<cbc:CitySubdivisionName>${xmlEscape(cari.ilce)}</cbc:CitySubdivisionName>` : ''}
        ${cari.il ? `<cbc:CityName>${xmlEscape(cari.il)}</cbc:CityName>` : ''}
        <cbc:Country>
          <cbc:IdentificationCode>TR</cbc:IdentificationCode>
        </cbc:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cac:TaxScheme>
          <cbc:Name>${xmlEscape(cari.vergi_dairesi ?? '—')}</cbc:Name>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>

  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.kdv_tutari)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.ara_toplam)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.kdv_tutari)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cac:TaxScheme>
          <cbc:Name>KDV</cbc:Name>
          <cbc:TaxTypeCode>0015</cbc:TaxTypeCode>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.ara_toplam)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.ara_toplam)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.toplam)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.iskonto_toplam)}</cbc:AllowanceTotalAmount>
    <cbc:PayableAmount currencyID="${xmlEscape(invoice.para_birimi)}">${fmtAmount(invoice.toplam)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>

${lines}
</Invoice>
`;
}

/**
 * Browser'da XML'i bir dosya olarak indirir.
 */
export function downloadUblXml(xml: string, fileName: string): void {
  const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
