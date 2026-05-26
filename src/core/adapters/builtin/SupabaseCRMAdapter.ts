/**
 * SupabaseCRMAdapter — Built-in (default) adapter
 *
 * Bu adapter projenin kendi Supabase'ini kullanır (Built-in CRM Layer).
 * Sprint 2-5 boyunca method'lar doldurulacak. Şu an iskelet.
 *
 * Davranış spec: `.ai_context/04-adapter-contract.md` §6
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '@lib/supabase';
import type { ICRMAdapter } from '../ICRMAdapter';
import type {
  AdapterCapabilities,
  Balance,
  Campaign,
  Customer,
  HealthStatus,
  LatLng,
  ListCustomersOptions,
  ListOptions,
  ListProductsOptions,
  NewCustomer,
  NewOrder,
  NewOrderItem,
  Order,
  OrderQuote,
  Page,
  Product,
  SearchOptions,
} from '../types';
import { AdapterError } from '../errors';

export interface SupabaseCRMAdapterDeps {
  url?: string;
  anonKey?: string;
  client?: SupabaseClient; // test için inject edilebilir
}

export class SupabaseCRMAdapter implements ICRMAdapter {
  readonly type = 'supabase' as const;
  readonly version = '1.0.0';
  private readonly supabase: SupabaseClient;

  constructor(deps: SupabaseCRMAdapterDeps = {}) {
    if (deps.client) {
      this.supabase = deps.client;
    } else if (deps.url && deps.anonKey) {
      this.supabase = createClient(deps.url, deps.anonKey) as SupabaseClient;
    } else {
      // Default: shared client (Parla session ile paylaşır)
      this.supabase = getSupabaseClient();
    }
  }

  // ─── Health & Capabilities ────────────────────────────

  async testConnection(): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const { error } = await this.supabase.from('profiles').select('id').limit(1);
      const latencyMs = Math.round(performance.now() - start);
      if (error) {
        return {
          ok: false,
          adapter: this.type,
          version: this.version,
          latencyMs,
          errors: [error.message],
          checkedAt: new Date().toISOString(),
        };
      }
      return {
        ok: true,
        adapter: this.type,
        version: this.version,
        latencyMs,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        adapter: this.type,
        version: this.version,
        errors: [err instanceof Error ? err.message : String(err)],
        checkedAt: new Date().toISOString(),
      };
    }
  }

  getCapabilities(): AdapterCapabilities {
    return {
      customers: true,
      searchNearby: true,
      customerWrite: true,
      contacts: true,
      products: true,
      campaigns: true,
      priceLists: true,
      orders: true,
      orderQuote: true,
      balance: true,
      payments: true,
      webhookSupport: false,
      deltaSync: false, // Faz 2'de eklenecek
    };
  }

  // ─── Customers (TODO: Sprint 2) ───────────────────────

  listCustomers(_opts?: ListCustomersOptions): Promise<Page<Customer>> {
    throw AdapterError.notImplemented('listCustomers (Sprint 2)');
  }

  getCustomer(_id: string): Promise<Customer> {
    throw AdapterError.notImplemented('getCustomer (Sprint 2)');
  }

  async searchNearby(
    location: LatLng,
    radiusKm: number,
    opts?: SearchOptions,
  ): Promise<Customer[]> {
    const radiusM = Math.round(radiusKm * 1000);
    const limit = opts?.limit ?? 50;

    const { data, error } = await this.supabase.rpc('saha_search_nearby_accounts', {
      _lat: location.lat,
      _lng: location.lng,
      _radius_m: radiusM,
      _customer_type: opts?.type ?? null,
      _limit: limit,
    });

    if (error) {
      throw new AdapterError('UNKNOWN', `searchNearby başarısız: ${error.message}`, {
        originalError: error,
        details: { rpc: 'saha_search_nearby_accounts' },
      });
    }

    type RpcRow = {
      id: string;
      name: string;
      type: string | null;
      phone: string | null;
      whatsapp: string | null;
      email: string | null;
      status: 'active' | 'inactive' | 'prospect';
      region: string | null;
      addresses: unknown;
      contacts: unknown;
      custom_fields: Record<string, unknown> | null;
      created_at: string;
      updated_at: string;
      distance_m: number;
    };

    const rows = (data ?? []) as RpcRow[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type ?? undefined,
      phone: r.phone ?? undefined,
      whatsapp: r.whatsapp ?? undefined,
      email: r.email ?? undefined,
      status: r.status,
      region: r.region ?? undefined,
      addresses: Array.isArray(r.addresses) ? (r.addresses as Customer['addresses']) : [],
      contacts: Array.isArray(r.contacts) ? (r.contacts as Customer['contacts']) : undefined,
      customFields: r.custom_fields ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  createCustomer(_data: NewCustomer): Promise<Customer> {
    throw AdapterError.notImplemented('createCustomer (Sprint 2)');
  }

  updateCustomer(_id: string, _patch: Partial<Customer>): Promise<Customer> {
    throw AdapterError.notImplemented('updateCustomer (Sprint 2)');
  }

  // ─── Balance (TODO: Sprint 5) ─────────────────────────

  getBalance(_customerId: string, _opts?: { forceFresh?: boolean }): Promise<Balance> {
    throw AdapterError.notImplemented('getBalance (Sprint 5)');
  }

  // ─── Orders (TODO: Sprint 5) ──────────────────────────

  listOrders(_customerId: string, _opts?: ListOptions): Promise<Page<Order>> {
    throw AdapterError.notImplemented('listOrders (Sprint 5)');
  }

  getOrder(_id: string): Promise<Order> {
    throw AdapterError.notImplemented('getOrder (Sprint 5)');
  }

  createOrder(_order: NewOrder): Promise<Order> {
    throw AdapterError.notImplemented('createOrder (Sprint 5)');
  }

  quoteOrder(_items: NewOrderItem[], _customerId: string): Promise<OrderQuote> {
    throw AdapterError.notImplemented('quoteOrder (Sprint 5)');
  }

  // ─── Products (TODO: Sprint 5) ────────────────────────

  listProducts(_opts?: ListProductsOptions): Promise<Page<Product>> {
    throw AdapterError.notImplemented('listProducts (Sprint 5)');
  }

  getProduct(_id: string): Promise<Product> {
    throw AdapterError.notImplemented('getProduct (Sprint 5)');
  }

  searchProducts(_query: string, _limit?: number): Promise<Product[]> {
    throw AdapterError.notImplemented('searchProducts (Sprint 5)');
  }

  // ─── Campaigns (TODO: Faz 2) ──────────────────────────

  listActiveCampaigns(_customerId?: string): Promise<Campaign[]> {
    throw AdapterError.notImplemented('listActiveCampaigns (Faz 2)');
  }
}
