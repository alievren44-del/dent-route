/**
 * E-Fatura Provider Factory
 *
 * Config'teki `einvoice.provider` değerine göre uygun EInvoiceProvider'ı
 * oluşturur. Tek source of truth — başka yerde provider constructor'ı
 * çağrılmaz. (src/core/adapters/factory.ts ile aynı stil.)
 *
 * Yeni entegratör eklemek = bir yeni dosya (örn. parasutProvider.ts) +
 * buraya bir case. Canlı entegratörler BLOKE: dış API anahtarları + mali
 * mühür gerektirir, henüz "not configured" hatası fırlatılır.
 */

import type { EInvoiceConfig } from '@config/types';
import { ManualEInvoiceProvider } from './manualProvider';
import type { EInvoiceProvider } from './provider';

export class EInvoiceNotConfiguredError extends Error {
  constructor(provider: string) {
    super(
      `E-Fatura entegratörü "${provider}" henüz yapılandırılmadı. ` +
        `Canlı GİB gönderimi için entegratör API anahtarları + mali mühür (XAdES) ` +
        `imzalama gerekir; bu adım dış (ücretli) kimlik bilgilerine bağlı (BLOKE). ` +
        `Şimdilik provider 'manual' kullanın.`,
    );
    this.name = 'EInvoiceNotConfiguredError';
  }
}

/**
 * Config'e göre provider üretir. einvoice bloğu yoksa veya provider 'manual'
 * ise lokal ManualEInvoiceProvider döner (default).
 */
export function createEInvoiceProvider(config?: EInvoiceConfig): EInvoiceProvider {
  const provider = config?.provider ?? 'manual';

  switch (provider) {
    case 'manual':
      return new ManualEInvoiceProvider({
        seller: config?.seller
          ? {
              vkn: config.seller.vkn,
              unvan: config.seller.unvan,
              vergiDairesi: config.seller.vergiDairesi,
              adres: config.seller.adres,
            }
          : undefined,
      });

    // ── Canlı entegratörler (BLOKE — dış kimlik bilgileri bekliyor) ──
    // Aşağıdakiler ileride YENİ bir <provider>Provider.ts dosyası implement
    // edilip buraya case eklenerek devreye girecek.
    case 'parasut':
    case 'mukellef':
    case 'izibiz':
    case 'uyumsoft':
    case 'edm':
      throw new EInvoiceNotConfiguredError(provider);

    default: {
      const _exhaustive: never = provider;
      throw new EInvoiceNotConfiguredError(String(_exhaustive));
    }
  }
}
