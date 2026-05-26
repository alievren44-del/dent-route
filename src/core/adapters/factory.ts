/**
 * Adapter Factory
 *
 * Config'teki crm.type değerine göre uygun adapter'ı oluşturur.
 * Tek source of truth — uygulamanın başka hiçbir yerinde adapter constructor'ı çağrılmaz.
 */

import type { CRMConfig } from '@config/types';
import type { ICRMAdapter } from './ICRMAdapter';
import { AdapterError } from './errors';
import { SupabaseCRMAdapter } from './builtin/SupabaseCRMAdapter';
import { CustomRESTAdapter } from './custom-rest/CustomRESTAdapter';

export interface CreateAdapterDeps {
  supabaseUrl: string;
  supabaseAnonKey: string;
  customRestToken?: string;
}

export function createCRMAdapter(crm: CRMConfig, deps: CreateAdapterDeps): ICRMAdapter {
  switch (crm.type) {
    case 'supabase':
      return new SupabaseCRMAdapter({
        url: deps.supabaseUrl,
        anonKey: deps.supabaseAnonKey,
      });

    case 'custom_rest':
      return new CustomRESTAdapter({
        config: crm.config,
        token: deps.customRestToken,
      });

    default: {
      // Exhaustive check — yeni CRM tipi eklenince TS hata verir.
      const _exhaustive: never = crm;
      throw new AdapterError('UNKNOWN', `Bilinmeyen CRM tipi: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
