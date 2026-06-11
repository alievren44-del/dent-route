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

  // ─── Customers ───────────────────────────────────────

  async listCustomers(opts?: ListCustomersOptions): Promise<Page<Customer>> {
    const raw = await this.request('listCustomers', { query: opts as QueryParams });
    return this.toPage<Customer>(raw, 'customer');
  }

  async getCustomer(id: string): Promise<Customer> {
    const raw = await this.request('getCustomer', { params: { id } });
    return mapFields<Customer>(this.unwrapItem(raw), this.mapFor('customer'));
  }

  async searchNearby(
    location: LatLng,
    radiusKm: number,
    opts?: SearchOptions,
  ): Promise<Customer[]> {
    const raw = await this.request('searchNearby', {
      query: { lat: location.lat, lng: location.lng, radiusKm, ...(opts as QueryParams) },
    });
    return this.unwrapArray(raw).map((row) => mapFields<Customer>(row, this.mapFor('customer')));
  }

  // ─── Balance ─────────────────────────────────────────

  async getBalance(customerId: string): Promise<Balance> {
    const raw = await this.request('getBalance', { params: { id: customerId } });
    return mapFields<Balance>(this.unwrapItem(raw), this.mapFor('balance'));
  }

  // ─── Orders ──────────────────────────────────────────

  async listOrders(customerId: string, opts?: ListOptions): Promise<Page<Order>> {
    const raw = await this.request('listOrders', {
      params: { id: customerId },
      query: { customerId, ...(opts as QueryParams) },
    });
    return this.toPage<Order>(raw, 'order');
  }

  async getOrder(id: string): Promise<Order> {
    const raw = await this.request('getOrder', { params: { id } });
    return mapFields<Order>(this.unwrapItem(raw), this.mapFor('order'));
  }

  async createOrder(order: NewOrder): Promise<Order> {
    const raw = await this.request('createOrder', { body: order });
    return mapFields<Order>(this.unwrapItem(raw), this.mapFor('order'));
  }

  async quoteOrder(items: NewOrderItem[], customerId: string): Promise<OrderQuote> {
    const raw = await this.request('quoteOrder', { body: { items, customerId } });
    return mapFields<OrderQuote>(this.unwrapItem(raw), this.mapFor('orderQuote'));
  }

  // ─── Products ────────────────────────────────────────

  async listProducts(opts?: ListProductsOptions): Promise<Page<Product>> {
    const raw = await this.request('listProducts', { query: opts as QueryParams });
    return this.toPage<Product>(raw, 'product');
  }

  async getProduct(id: string): Promise<Product> {
    const raw = await this.request('getProduct', { params: { id } });
    return mapFields<Product>(this.unwrapItem(raw), this.mapFor('product'));
  }

  async searchProducts(query: string, limit?: number): Promise<Product[]> {
    const raw = await this.request('searchProducts', { query: { q: query, limit } });
    return this.unwrapArray(raw).map((row) => mapFields<Product>(row, this.mapFor('product')));
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
    } else if (auth.type === 'basic' && this.deps.token) {
      // 'basic': token zaten "user:pass" base64'ü olarak ya da hazır değer
      // olarak env'den gelir. Base64 değilse btoa ile encode et.
      const value = isBase64(this.deps.token) ? this.deps.token : safeBtoa(this.deps.token);
      headers.Authorization = `Basic ${value}`;
    } else if (auth.type === 'custom_header' && auth.headerName && this.deps.token) {
      headers[auth.headerName] = this.deps.token;
    }
    return headers;
  }

  /** Endpoint config'ini döner, yoksa NOT_IMPLEMENTED fırlatır. */
  private endpoint(key: string): { method: string; path: string } {
    const ep = this.deps.config.endpoints[key];
    if (!ep) {
      throw AdapterError.notImplemented(`endpoint ${key} not configured`);
    }
    return ep;
  }

  private mapFor(entity: string): Record<string, string> {
    return this.deps.config.fieldMapping[entity] ?? {};
  }

  /** Config'te tanımlı endpoint'e fetch atar, JSON döner. */
  private async request(
    key: string,
    opts: { params?: Record<string, string>; query?: QueryParams; body?: unknown } = {},
  ): Promise<unknown> {
    const ep = this.endpoint(key);
    const url = this.buildUrl(ep.path, opts.params, opts.query);
    try {
      const res = await fetch(url, {
        method: ep.method.toUpperCase(),
        headers: this.buildHeaders(),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      if (!res.ok) {
        throw httpToAdapterError(res.status, key);
      }
      // 204 / boş gövde toleransı.
      const text = await res.text();
      return text ? (JSON.parse(text) as unknown) : null;
    } catch (err) {
      if (err instanceof AdapterError) throw err;
      throw new AdapterError(
        'NETWORK_ERROR',
        `CustomREST ${key} isteği başarısız: ${err instanceof Error ? err.message : String(err)}`,
        { retryable: true, originalError: err },
      );
    }
  }

  /** baseUrl + path(:param substitution) + ?query. */
  private buildUrl(
    path: string,
    params?: Record<string, string>,
    query?: QueryParams,
  ): string {
    let resolved = path;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        resolved = resolved.replace(`:${k}`, encodeURIComponent(v));
      }
    }
    const base = this.deps.config.baseUrl.replace(/\/$/, '');
    const url = new URL(`${base}${resolved.startsWith('/') ? '' : '/'}${resolved}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /** Response'u Page<T>'e çevirir: items + nextCursor + total. */
  private toPage<T>(raw: unknown, entity: string): Page<T> {
    const map = this.mapFor(entity);
    const items = this.unwrapArray(raw).map((row) => mapFields<T>(row, map));
    const meta = isRecord(raw) ? raw : {};
    return {
      items,
      nextCursor: typeof meta.nextCursor === 'string' ? meta.nextCursor : undefined,
      total: typeof meta.total === 'number' ? meta.total : undefined,
    };
  }

  /** Response gövdesinden dizi çıkarır ({items:[...]} veya direkt [...]). */
  private unwrapArray(raw: unknown): Record<string, unknown>[] {
    if (Array.isArray(raw)) return raw as Record<string, unknown>[];
    if (isRecord(raw) && Array.isArray(raw.items)) {
      return raw.items as Record<string, unknown>[];
    }
    if (isRecord(raw) && Array.isArray(raw.data)) {
      return raw.data as Record<string, unknown>[];
    }
    return [];
  }

  /** Tekil obje çıkarır ({data:{...}} sarmalını açar). */
  private unwrapItem(raw: unknown): Record<string, unknown> {
    if (isRecord(raw) && isRecord(raw.data)) return raw.data;
    if (isRecord(raw)) return raw;
    return {};
  }
}

// ─── Module helpers ────────────────────────────────────

type QueryParams = Record<string, string | number | boolean | undefined>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * mapFields — config.fieldMapping[entity] kullanarak ham API satırını domain
 * tipine çevirir. Map { domainKey: 'apiKey' } şeklindedir. Map boşsa satır
 * olduğu gibi (cast) döner.
 */
export function mapFields<T>(row: Record<string, unknown>, map: Record<string, string>): T {
  if (Object.keys(map).length === 0) {
    return row as T;
  }
  const out: Record<string, unknown> = {};
  for (const [domainKey, apiKey] of Object.entries(map)) {
    out[domainKey] = getPath(row, apiKey);
  }
  return out as T;
}

/** 'a.b.c' nokta yollu erişim (nested API alanları için). */
function getPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path.includes('.')) return obj[path];
  return path.split('.').reduce<unknown>((acc, part) => {
    return isRecord(acc) ? acc[part] : undefined;
  }, obj);
}

function httpToAdapterError(status: number, key: string): AdapterError {
  switch (status) {
    case 401:
      return AdapterError.unauthorized();
    case 403:
      return new AdapterError('FORBIDDEN', `CustomREST ${key}: erişim yasak (403).`);
    case 404:
      return AdapterError.notFound(key);
    case 409:
      return AdapterError.conflict(`CustomREST ${key}: çakışma (409).`);
    case 429:
      return AdapterError.rateLimited(1000);
    default:
      return new AdapterError('NETWORK_ERROR', `CustomREST ${key}: HTTP ${status}`, {
        retryable: status >= 500,
      });
  }
}

function safeBtoa(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  // Node/SSR fallback.
  return Buffer.from(s, 'utf-8').toString('base64');
}

function isBase64(s: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0 && !s.includes(':');
}
