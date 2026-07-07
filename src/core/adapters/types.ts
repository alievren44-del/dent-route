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

/**
 * Ürün varyantı (v_saha_products.product_variants jsonb → domain).
 * saha_create_order_tx v2 varyantı `id` (TEXT) ile çözer; fiyat/sku/öznitelikleri
 * SUNUCUDA v_saha_products'tan okur — client priceTry yalnız görsel quote içindir.
 */
export interface ProductVariant {
  id: string;
  sku?: string;
  priceTry: number;
  stockQuantity?: number;
  /** iso / grit / shaft / tipSize / packaging / piecesPerPackage … (serbest jsonb). */
  attributes: Record<string, unknown>;
}

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
  /** Varyantlı ürünlerde seçilebilir varyantlar; varyantsız üründe boş/tanımsız. */
  variants?: ProductVariant[];
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

export type OrderStatus = 'draft' | 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

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
  /**
   * Seçilen ürün varyantı (v_saha_products.product_variants[].id, TEXT). Verildiğinde
   * saha_create_order_tx fiyat/sku/attribute'ları bu varyanttan çözer + order_items'a
   * variant_id/selected_options yazar. Varyantsız kalemde tanımsız.
   */
  variantId?: string;
  unitPriceOverride?: number;
  notes?: string;
}

export interface NewOrder {
  customerId: string;
  /**
   * Doğrudan cari seçimi (klinik-siz cari). Verildiğinde sipariş bu cari üzerinden
   * oluşturulur — clinic_id/user_id gönderilmez (clinic_id XOR cari_id). customerId
   * yalnızca UI/quote için taşınır; cariId varsa müşteri-türü çözümü atlanır.
   */
  cariId?: string;
  items: NewOrderItem[];
  notes?: string;
  idempotencyKey: string;
  visitId?: string;
  /** true ise sipariş doğrudan 'approval_pending' olarak oluşturulur (race önler). */
  requiresApproval?: boolean;
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
  /** Range-tabanlı sayfalama: verilirse .range(offset, offset+limit-1) uygulanır. */
  offset?: number;
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
