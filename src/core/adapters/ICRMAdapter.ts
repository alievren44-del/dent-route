/**
 * ICRMAdapter — CRM Adapter Sözleşmesi
 *
 * Tüm adapter implementasyonları (built-in, custom REST, ileride Logo/Mikro)
 * BU interface'i tam olarak implement etmek zorundadır.
 *
 * Davranış spesifikasyonları: `.ai_context/04-adapter-contract.md`
 */

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
} from './types';

export interface ICRMAdapter {
  // ─── Identification ─────────────────────────────────────
  readonly type: 'supabase' | 'custom_rest';
  readonly version: string;

  // ─── Health & Capabilities ──────────────────────────────
  testConnection(): Promise<HealthStatus>;
  getCapabilities(): AdapterCapabilities;

  // ─── Customers (READ) ───────────────────────────────────
  listCustomers(opts?: ListCustomersOptions): Promise<Page<Customer>>;
  getCustomer(id: string): Promise<Customer>;
  searchNearby(location: LatLng, radiusKm: number, opts?: SearchOptions): Promise<Customer[]>;

  // ─── Customers (WRITE — opsiyonel) ──────────────────────
  createCustomer?(data: NewCustomer): Promise<Customer>;
  updateCustomer?(id: string, patch: Partial<Customer>): Promise<Customer>;

  // ─── Balance ────────────────────────────────────────────
  getBalance(customerId: string, opts?: { forceFresh?: boolean }): Promise<Balance>;

  // ─── Orders ─────────────────────────────────────────────
  listOrders(customerId: string, opts?: ListOptions): Promise<Page<Order>>;
  getOrder(id: string): Promise<Order>;
  createOrder(order: NewOrder): Promise<Order>;
  quoteOrder(items: NewOrderItem[], customerId: string): Promise<OrderQuote>;
  cancelOrder?(id: string, reason?: string): Promise<Order>;

  // ─── Products ───────────────────────────────────────────
  listProducts(opts?: ListProductsOptions): Promise<Page<Product>>;
  getProduct(id: string): Promise<Product>;
  searchProducts(query: string, limit?: number): Promise<Product[]>;

  // ─── Campaigns (opsiyonel) ──────────────────────────────
  listActiveCampaigns?(customerId?: string): Promise<Campaign[]>;

  // ─── Delta sync (opsiyonel) ─────────────────────────────
  listCustomersDelta?(since: string): Promise<Customer[]>;
  listProductsDelta?(since: string): Promise<Product[]>;
}
