/**
 * EInvoiceProvider — e-Fatura entegratör sözleşmesi (SCAFFOLD).
 *
 * Bu interface, e-fatura oluşturma / durum sorgulama / iptal işlemlerini
 * soyutlar. Şu an yalnızca `ManualEInvoiceProvider` (lokal UBL XML üretici)
 * implement eder.
 *
 * Gerçek bir GİB onaylı entegratör (Paraşüt / İzibiz / Uyumsoft / EDM /
 * Mükellef...) ileride bu interface'i implement eden YENİ bir dosya ekleyip
 * factory'ye bir case ekleyerek devreye girer. Canlı GİB gönderimi + mali
 * mühür (XAdES) imzalama + entegratör API anahtarları BLOKE: dış (ücretli)
 * kimlik bilgileri ve Supabase Edge Function + secrets gerektirir.
 */

import type { UblCari, UblInvoice, UblKalem } from './ublXml';

/** createInvoice'a verilen payload — InvoiceDetailPage'in ürettiği şekiller. */
export interface EInvoicePayload {
  invoice: UblInvoice;
  cari: UblCari;
  kalemler: UblKalem[];
}

/** createInvoice sonucu. ETTN = e-fatura evrensel tekil no (UUID). */
export type EInvoiceResult = {
  ettn: string;
  status: string;
  xml: string;
};

export interface EInvoiceProvider {
  /** Provider adı (config.einvoice.provider ile eşleşir). */
  readonly name: string;

  /** Faturayı UBL'e dönüştürür ve (canlı provider'da) entegratöre POST eder. */
  createInvoice(payload: EInvoicePayload): Promise<EInvoiceResult>;

  /** ETTN ile fatura durumu sorgular. */
  getStatus(ettn: string): Promise<{ status: string }>;

  /** Faturayı iptal eder. */
  cancel(ettn: string, reason: string): Promise<{ status: string }>;
}
