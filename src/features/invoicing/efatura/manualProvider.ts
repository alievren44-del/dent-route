/**
 * ManualEInvoiceProvider — lokal (entegratörsüz) e-Fatura sağlayıcısı.
 *
 * createInvoice:
 *   - UBL-TR 2.1 XML'i üretir (generateUblInvoiceXml),
 *   - lokal bir ETTN (UUID v4) üretir,
 *   - status 'manual_generated' döner,
 *   - XML'i tarayıcıda indirir.
 *
 * getStatus / cancel: lokal stub durum döner (gerçek GİB sorgusu yok).
 *
 * Gerçek entegratör (Paraşüt/İzibiz/...) burada EInvoiceProvider implement
 * edip POST eder; canlı GİB+mali mühür Supabase Edge Function + secrets ile
 * yapılacak.
 */

import {
  downloadUblXml,
  generateUblInvoiceXml,
  uuidV4,
  type UblProfile,
  type UblSeller,
} from './ublXml';
import type { EInvoicePayload, EInvoiceProvider, EInvoiceResult } from './provider';

export interface ManualProviderOptions {
  /** config.einvoice.seller'dan gelir; verilmezse ublXml placeholder kullanılır. */
  seller?: UblSeller;
  /** İsteğe bağlı ProfileID override (örn. e-Arşiv). */
  profile?: UblProfile;
}

export class ManualEInvoiceProvider implements EInvoiceProvider {
  readonly name = 'manual';

  constructor(private readonly options: ManualProviderOptions = {}) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async createInvoice(payload: EInvoicePayload): Promise<EInvoiceResult> {
    const ettn = uuidV4();
    const xml = generateUblInvoiceXml(payload.invoice, payload.cari, payload.kalemler, {
      seller: this.options.seller,
      profile: this.options.profile,
      uuid: ettn,
    });

    const fileName = `${payload.invoice.fatura_no ?? payload.invoice.id}.xml`;
    downloadUblXml(xml, fileName);

    return {
      ettn,
      status: 'manual_generated',
      xml,
    };
  }

  // Lokal stub — gerçek GİB durum sorgusu entegratör tarafından eklenecek.
  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatus(_ettn: string): Promise<{ status: string }> {
    return { status: 'manual_generated' };
  }

  // Lokal stub — gerçek iptal entegratör + GİB üzerinden yapılacak.
  // eslint-disable-next-line @typescript-eslint/require-await
  async cancel(_ettn: string, _reason: string): Promise<{ status: string }> {
    return { status: 'manual_cancelled' };
  }
}
