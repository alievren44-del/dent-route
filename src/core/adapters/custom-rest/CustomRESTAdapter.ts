/**
 * CustomRESTAdapter — Config-driven REST API adapter
 *
 * Müşterinin kendi REST API'sine bağlanır. Field mapping JSONPath ile yapılır.
 * Endpoint'ler config'te tanımlı.
 *
 * Capability tespiti: hangi endpoint config'te tanımlıysa o capability true döner.
 *
 * Implementasyon Faz 2'de tam olarak yapılacak. MVP'de skeleton.
 */

import type { CustomRESTCRMConfig } from '@config/types';
import type { ICRMAdapter } from '../ICRMAdapter';
import type {
  AdapterCapabilities,
  Balance,
  Customer,
  HealthStatus,
  LatLng,
  ListCustomersOptions,
  ListOptions,
  ListProductsOptions,
  NewOrder,
  NewOrderItem,
  Order,
  OrderQuote,
  Page,
  Product,
  SearchOptions,
} from '../types';
import { AdapterError } from '../errors';

export interface CustomRESTAdapterDeps {
  config: CustomRESTCRMConfig;
  token?: string;
}

export class CustomRESTAdapter implements ICRMAdapter {
  readonly type = 'custom_rest' as const;
  readonly version = '0.1.0';

  constructor(private deps: CustomRESTAdapterDeps) {}

  async testConnection(): Promise<HealthStatus> {
    const start = performance.now();
    try {
      const res = await fetch(`${this.deps.config.baseUrl}/health`, {
        headers: this.buildHeaders(),
      });
      const latencyMs = Math.round(performance.now() - start);
      return {
        ok: res.ok,
        adapter: this.type,
        version: this.version,
        latencyMs,
        errors: res.ok ? undefined : [`HTTP ${res.status}`],
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
    const endpoints = this.deps.config.endpoints;
    const has = (key: string) => Boolean(endpoints[key]);
    return {
      customers: has('listCustomers'),
      searchNearby: has('searchNearby'),
      customerWrite: has('createCustomer'),
      contacts: false, // Faz 2'de eklenebilir
      products: has('listProducts'),
      campaigns: has('listActiveCampaigns'),
      priceLists: false,
      orders: has('listOrders') && has('createOrder'),
      orderQuote: has('quoteOrder'),
      balance: has('getBalance'),
      payments: false,
      webhookSupport: false,
      deltaSync: false,
    };
  }

  // ─── TODO: Faz 2'de implementasyon ──────────────────

  listCustomers(_opts?: ListCustomersOptions): Promise<Page<Customer>> {
    throw AdapterError.notImplemented('CustomRESTAdapter.listCustomers (Faz 2)');
  }

  getCustomer(_id: string): Promise<Customer> {
    throw AdapterError.notImplemented('CustomRESTAdapter.getCustomer (Faz 2)');
  }

  searchNearby(_location: LatLng, _radiusKm: number, _opts?: SearchOptions): Promise<Customer[]> {
    throw AdapterError.notImplemented('CustomRESTAdapter.searchNearby (Faz 2)');
  }

  getBalance(_customerId: string): Promise<Balance> {
    throw AdapterError.notImplemented('CustomRESTAdapter.getBalance (Faz 2)');
  }

  listOrders(_customerId: string, _opts?: ListOptions): Promise<Page<Order>> {
    throw AdapterError.notImplemented('CustomRESTAdapter.listOrders (Faz 2)');
  }

  getOrder(_id: string): Promise<Order> {
    throw AdapterError.notImplemented('CustomRESTAdapter.getOrder (Faz 2)');
  }

  createOrder(_order: NewOrder): Promise<Order> {
    throw AdapterError.notImplemented('CustomRESTAdapter.createOrder (Faz 2)');
  }

  quoteOrder(_items: NewOrderItem[], _customerId: string): Promise<OrderQuote> {
    throw AdapterError.notImplemented('CustomRESTAdapter.quoteOrder (Faz 2)');
  }

  listProducts(_opts?: ListProductsOptions): Promise<Page<Product>> {
    throw AdapterError.notImplemented('CustomRESTAdapter.listProducts (Faz 2)');
  }

  getProduct(_id: string): Promise<Product> {
    throw AdapterError.notImplemented('CustomRESTAdapter.getProduct (Faz 2)');
  }

  searchProducts(_query: string, _limit?: number): Promise<Product[]> {
    throw AdapterError.notImplemented('CustomRESTAdapter.searchProducts (Faz 2)');
  }

  // ─── Helpers ─────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const auth = this.deps.config.auth;
    if (auth.type === 'bearer' && this.deps.token) {
      headers.Authorization = `Bearer ${this.deps.token}`;
    } else if (auth.type === 'custom_header' && auth.headerName && this.deps.token) {
      headers[auth.headerName] = this.deps.token;
    }
    return headers;
  }
}
