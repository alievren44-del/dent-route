/**
 * Adapter Types
 *
 * `.ai_context/04-adapter-contract.md` ile birebir uyumlu.
 * Şema değişiklikleri her iki yerde de yapılmalı.
 */

// ─── Geo ──────────────────────────────────────────────────────

export interface LatLng {
  lat: number;
  lng: number;
}

// ─── Customer ─────────────────────────────────────────────────

export interface Address {
  label?: string;
  addressLine: string;
  district?: string;
  city?: string;
  postalCode?: string;
  country?: string;
  location?: LatLng;
  googlePlaceId?: string;
  isPrimary?: boolean;
}

export interface Contact {
  fullName: string;
  title?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  isPrimary?: boolean;
}

export interface Customer {
  id: string;
  externalId?: string;
  name: string;
  type?: string; // vertical's customerTypes key
  taxId?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  status: 'active' | 'inactive' | 'prospect';
  region?: string;
  addresses: Address[];
  contacts?: Contact[];
  customFields?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface NewCustomer {
  name: string;
  type?: string;
  taxId?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  addresses: Address[];
  contacts?: Contact[];
  customFields?: Record<string, unknown>;
  region?: string;
}

// ─── Product ──────────────────────────────────────────────────

export interface Product {
  id: string;
  externalId?: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;
  basePrice?: number;
  currency: string;
  vatRate?: number;
  stockQuantity?: number;
  isActive: boolean;
  imageUrl?: string;
}

// ─── Balance ──────────────────────────────────────────────────

export interface Balance {
  customerId: string;
  totalOrders: number;
  totalPaid: number;
  balance: number;
  currency: string;
  lastMovementAt?: string;
  asOf: string;
  cached: boolean;
  /** Cari kredi limiti (saha_cariler.kredi_limiti). 0 → limit tanımlı değil. */
  creditLimit?: number;
  /** Kullanım oranı 0..1 → kredi limitinin yüzde kaçının dolu olduğu. */
  creditUsed?: number;
  /** Vadesi geçmiş + ödenmemiş fatura kalan toplamı (saha_faturalar.kalan). */
  due?: number;
}

// ─── Order ────────────────────────────────────────────────────

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  productId?: string;
  productSku?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  vatRate?: number;
  lineTotal?: number;
  campaignId?: string;
}

export interface Order {
  id: string;
  externalId?: string;
  customerId: string;
  status: OrderStatus;
  items: OrderItem[];
  totalAmount: number;
  currency: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface NewOrderItem {
  productId: string;
  quantity: number;
  unitPriceOverride?: number;
  notes?: string;
}

export interface NewOrder {
  customerId: string;
  items: NewOrderItem[];
  notes?: string;
  idempotencyKey: string;
  visitId?: string;
}

export interface QuotedItem extends NewOrderItem {
  unitPrice: number;
  appliedDiscount: number;
  lineTotal: number;
  appliedCampaign?: string;
}

export interface OrderQuote {
  items: QuotedItem[];
  subtotal: number;
  discountTotal: number;
  vatTotal: number;
  grandTotal: number;
  currency: string;
  appliedCampaigns: string[];
  expiresAt?: string;
}

// ─── Campaign ─────────────────────────────────────────────────

export interface Campaign {
  id: string;
  name: string;
  description?: string;
  discountType: 'percent' | 'fixed' | 'buy_x_get_y';
  discountValue?: number;
  startsAt?: string;
  endsAt?: string;
  appliesToProducts?: string[];
}

// ─── Pagination ───────────────────────────────────────────────

export interface ListOptions {
  cursor?: string;
  limit?: number;
  updatedAfter?: string;
}

export interface ListCustomersOptions extends ListOptions {
  status?: Customer['status'];
  region?: string;
  type?: string;
  search?: string;
}

export interface ListProductsOptions extends ListOptions {
  category?: string;
  isActive?: boolean;
  search?: string;
}

export interface SearchOptions {
  type?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}

// ─── Capabilities & Health ────────────────────────────────────

export interface AdapterCapabilities {
  customers: boolean;
  searchNearby: boolean;
  customerWrite: boolean;
  contacts: boolean;
  products: boolean;
  campaigns: boolean;
  priceLists: boolean;
  orders: boolean;
  orderQuote: boolean;
  balance: boolean;
  payments: boolean;
  webhookSupport: boolean;
  deltaSync: boolean;
}

export interface HealthStatus {
  ok: boolean;
  adapter: string;
  version: string;
  latencyMs?: number;
  errors?: string[];
  checkedAt: string;
}
