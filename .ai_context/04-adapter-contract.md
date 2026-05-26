# 🔌 Adapter Contract — Saha App v1.0

> Bu dosya `ICRMAdapter` interface'inin tam sözleşmesidir. Built-in (Supabase) ve Custom REST adapter'ları **bu sözleşmeye birebir uymak zorundadır**.

---

## 1. Tasarım Prensipleri

1. **Read-mostly:** Adapter çoğunlukla okuma yapar. Yazma sadece `createOrder` ve opsiyonel `createCustomer` ile.
2. **Idempotent yazma:** Her create işlemi `idempotencyKey` alır, çift kayıt önlenir.
3. **Capabilities-aware:** Adapter neyi destekleyip neyi desteklemediğini bildirir (`getCapabilities()`).
4. **Hata standartlaştırılmış:** Hatalar `AdapterError` tipinde, `code` ve `retryable` alanlarıyla döner.
5. **Pagination:** Liste metotları cursor-based pagination kullanır.
6. **Vertical-aware:** Adapter aktif vertical'ı bilir, custom field validation yapabilir.

---

## 2. Çekirdek Tipler

```typescript
// src/core/adapters/types.ts

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Address {
  label?: string;                       // "primary", "billing"
  addressLine: string;
  district?: string;
  city?: string;
  postalCode?: string;
  country?: string;                     // ISO 3166-1 alpha-2, default 'TR'
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
  id: string;                           // adapter native ID (UUID veya external)
  externalId?: string;                  // varsa farklı sistemdeki ID
  name: string;
  type?: string;                        // vertical's customerTypes anahtarı
  taxId?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  status: 'active' | 'inactive' | 'prospect';
  region?: string;
  addresses: Address[];
  contacts?: Contact[];
  customFields?: Record<string, unknown>; // vertical'ın customFields'ından
  createdAt: string;                    // ISO 8601
  updatedAt: string;
}

export interface Product {
  id: string;
  externalId?: string;
  sku?: string;
  name: string;
  description?: string;
  category?: string;
  unit: string;                         // 'adet', 'kg', 'lt' vb.
  basePrice?: number;
  currency: string;                     // ISO 4217, default 'TRY'
  vatRate?: number;                     // % değer, ör: 20.0
  stockQuantity?: number;
  isActive: boolean;
  imageUrl?: string;
}

export interface Balance {
  customerId: string;
  totalOrders: number;
  totalPaid: number;
  balance: number;                      // negative = bizim alacağımız var
  currency: string;
  lastMovementAt?: string;
  asOf: string;                         // bu balance verisi ne zaman alındı
  cached: boolean;                      // cached mi live mi?
}

export interface Order {
  id: string;
  externalId?: string;
  customerId: string;
  status: 'draft' | 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  items: OrderItem[];
  totalAmount: number;
  currency: string;
  notes?: string;
  createdBy: string;
  createdAt: string;
}

export interface OrderItem {
  productId?: string;
  productSku?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  discountAmount?: number;
  vatRate?: number;
  lineTotal?: number;                   // (qty*price)-discount
  campaignId?: string;
}

export interface NewOrder {
  customerId: string;
  items: NewOrderItem[];
  notes?: string;
  idempotencyKey: string;               // ZORUNLU, UUID öner
  visitId?: string;                     // ziyaretle bağlantı
}

export interface NewOrderItem {
  productId: string;
  quantity: number;
  unitPriceOverride?: number;           // adapter izin verirse
  notes?: string;
}

export interface OrderQuote {
  items: QuotedItem[];
  subtotal: number;
  discountTotal: number;
  vatTotal: number;
  grandTotal: number;
  currency: string;
  appliedCampaigns: string[];           // campaign id listesi
  expiresAt?: string;                   // teklif geçerlilik
}

export interface QuotedItem extends NewOrderItem {
  unitPrice: number;
  appliedDiscount: number;
  lineTotal: number;
  appliedCampaign?: string;
}

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

export interface AdapterCapabilities {
  // Core
  customers: boolean;
  searchNearby: boolean;
  customerWrite: boolean;
  contacts: boolean;
  // Catalog
  products: boolean;
  campaigns: boolean;
  priceLists: boolean;
  // Commerce
  orders: boolean;
  orderQuote: boolean;
  balance: boolean;
  payments: boolean;
  // Sync
  webhookSupport: boolean;
  deltaSync: boolean;                   // updatedAfter parametresi destekli mi
}

export interface HealthStatus {
  ok: boolean;
  adapter: string;                      // adapter type
  version: string;
  latencyMs?: number;
  errors?: string[];
  checkedAt: string;
}
```

---

## 3. ICRMAdapter Interface

```typescript
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

  // ─── Customers (WRITE — opsiyonel, capability'ye göre) ──
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

export interface ListCustomersOptions extends ListOptions {
  status?: Customer['status'];
  region?: string;
  type?: string;
  search?: string;                      // ad/telefon araması
}

export interface ListProductsOptions extends ListOptions {
  category?: string;
  isActive?: boolean;
  search?: string;
}

export interface ListOptions {
  cursor?: string;
  limit?: number;                       // default 50, max 200
  updatedAfter?: string;                // delta sync için
}

export interface SearchOptions {
  type?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total?: number;                       // bilinmiyorsa undefined
}
```

---

## 4. Davranış Spesifikasyonu (Method-by-Method)

### `testConnection(): Promise<HealthStatus>`
- Bağlantı testi yapar (basit ping)
- Bootstrap script'i bunu çağırır
- 5 saniyeden uzun sürmemeli
- Hata fırlatmaz, `HealthStatus.ok = false` döner

### `getCapabilities(): AdapterCapabilities`
- Senkron, network çağrısı yok
- Constructor'da hesaplanmış değerleri döner
- UI hangi feature'ı render edeceğini buna göre karar verir

### `listCustomers(opts?)`
- Cursor-based pagination
- Default limit 50
- `search` parametresi: name + tax_id + phone üzerinde full-text
- Returns `Page<Customer>`

### `getCustomer(id: string)`
- Tek müşteri detay (adresler + kişiler dahil)
- Bulunamazsa `AdapterError({ code: 'NOT_FOUND' })`

### `searchNearby(location, radiusKm, opts?)`
- PostGIS sorgu (Built-in) veya REST endpoint (Custom)
- `radiusKm` default 5
- Maks 100 sonuç, daha fazlası için tekrar çağrı
- Sonuçlar **distance ASC** sıralı dönmeli
- Optional `type` parametresi vertical's customerTypes ile filtrelemek için

### `getBalance(customerId, opts?)`
- Default: cached (24 saat) dönebilir
- `forceFresh: true` → fresh fetch zorunlu
- Cache miss veya force ise live hesaplama yapılır (Built-in: VIEW sorgusu; Custom: REST çağrı)
- `Balance.cached` ve `Balance.asOf` her zaman set edilmeli

### `listOrders(customerId, opts?)`
- Müşterinin sipariş geçmişi
- `createdAt DESC` sıralı
- Default limit 50

### `createOrder(order: NewOrder): Promise<Order>`
- **İdempotent:** `idempotencyKey` daha önce kullanılmışsa, eski sipariş döner (yeni oluşturmaz)
- Önce `quoteOrder` çağrısıyla fiyat lock'lanmalı (recommend, zorunlu değil)
- Yetkilendirme: kullanıcı bu müşteriye atanmış olmalı (Built-in RLS, Custom: endpoint kontrol)
- Saha tarafında `visits.id` ile bağlantı kurmak için `visitId` opsiyonel

### `quoteOrder(items, customerId): Promise<OrderQuote>`
- **Hiçbir DB yazma yok**, sadece hesaplama
- Müşteri özel fiyat + aktif kampanya + KDV uygulanır
- Geriye fiyat lock için kullanılan bir hash dahil edilebilir (Faz 2)
- Built-in: SQL function ile hesaplar; Custom: REST `/orders/quote` endpoint

### `listProducts(opts?)` / `searchProducts(query, limit?)`
- Aktif ürünler default
- Search: name + SKU üzerinde
- Built-in: PostgreSQL full-text; Custom: API parametresi

### `listActiveCampaigns(customerId?)`
- Şu anda geçerli kampanyalar
- `customerId` verilirse o müşteri için geçerli olanlar
- Yoksa genel kampanyalar

### `listCustomersDelta(since)` / `listProductsDelta(since)`
- Background sync için
- `since`'tan sonra güncellenen kayıtlar
- Capability `deltaSync: true` ise destekli

---

## 5. Hata Modeli

```typescript
export class AdapterError extends Error {
  constructor(
    public code: AdapterErrorCode,
    message: string,
    public retryable: boolean = false,
    public details?: Record<string, unknown>,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export type AdapterErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'              // kullanıcı bu kaydı göremez
  | 'FORBIDDEN'                  // yetki yok (rol)
  | 'VALIDATION_ERROR'           // input invalid
  | 'CONFLICT'                   // çakışma (idempotency duplicate, vs)
  | 'RATE_LIMITED'               // retryable
  | 'NETWORK_ERROR'              // retryable
  | 'TIMEOUT'                    // retryable
  | 'SCHEMA_MISMATCH'            // adapter sözleşmesi uyumsuz response
  | 'ADAPTER_UNAVAILABLE'        // adapter çalışmıyor
  | 'NOT_IMPLEMENTED'            // capability'de yok
  | 'UNKNOWN';
```

**Kurallar:**
- Tüm AdapterError'lar **kullanıcıya gösterilmez**, application layer çevirir
- `retryable: true` olanlar TanStack Query tarafından otomatik retry'lanır (max 3, exp backoff)
- `RATE_LIMITED` özel: response'a `retryAfterMs` eklenmelidir

---

## 6. Built-in (Supabase) Adapter Notları

- Tüm okuma sorguları **Supabase JS Client** ile yapılır
- RLS, kullanıcı yetkisini DB tarafında zorlar (adapter ek check yapmaz)
- `searchNearby` PostGIS `ST_DWithin` + `ST_Distance` kullanır
- `createOrder` Edge Function üzerinden çağrılır (idempotency + quote validation server-side)
- `getBalance` `account_balances` VIEW'unu sorgular
- Capabilities: hepsi `true` (delta sync hariç, sonra eklenecek)

```typescript
// Örnek
class SupabaseCRMAdapter implements ICRMAdapter {
  readonly type = 'supabase' as const;
  readonly version = '1.0.0';
  
  constructor(private supabase: SupabaseClient) {}
  
  getCapabilities(): AdapterCapabilities {
    return {
      customers: true, searchNearby: true, customerWrite: true,
      contacts: true, products: true, campaigns: true, priceLists: true,
      orders: true, orderQuote: true, balance: true, payments: true,
      webhookSupport: false, deltaSync: false,
    };
  }
  
  async searchNearby(location, radiusKm = 5, opts) {
    const { data, error } = await this.supabase.rpc('search_nearby_accounts', {
      lat: location.lat,
      lng: location.lng,
      radius_m: radiusKm * 1000,
      account_type: opts?.type,
      max_results: opts?.limit ?? 50,
    });
    if (error) throw this.translateError(error);
    return data.map(this.mapToCustomer);
  }
  // ...
}
```

---

## 7. Custom REST Adapter Notları

- Tüm çağrılar HTTP fetch (Edge Function proxy üzerinden, doğrudan değil)
- Field mapping JSONPath ile config'ten okunur
- Auth: bearer, basic, ya da custom header (config-driven)
- Retry: `RATE_LIMITED` ve `5xx` durumlarda 3 deneme, exponential backoff
- Schema validation: response Zod ile doğrulanır, mismatch → `SCHEMA_MISMATCH`

```typescript
// Örnek field mapping
{
  "fieldMapping": {
    "customer": {
      "id": "$.customerId",
      "name": "$.companyName",
      "phone": "$.phone1",
      "addresses[0].addressLine": "$.address.fullAddress",
      "addresses[0].location.lat": "$.coordinates.latitude",
      "addresses[0].location.lng": "$.coordinates.longitude"
    }
  }
}
```

Custom adapter `getCapabilities()` capability'lerini **config'teki endpoint mevcudiyetine** göre döner. Örneğin `endpoints.createOrder` tanımlı değilse `orders: false`.

---

## 8. Capability-Aware UI

UI bileşenleri capability'lere bakar:

```tsx
const { capabilities } = useAdapter();

return (
  <>
    {capabilities.balance && <BalanceCard customerId={c.id} />}
    {capabilities.orders && <OrderHistorySection customerId={c.id} />}
    {capabilities.customerWrite && <EditCustomerButton />}
  </>
);
```

Bu sayede `custom_rest` modunda eksik endpoint'ler için UI'da disable / hide olur, hata göstermez.

---

## 9. Test Harness

Her adapter aynı test suite'ini geçmek zorundadır:

```typescript
// tests/integration/adapter-contract.test.ts

describe.each([
  ['builtin', () => new SupabaseCRMAdapter(testClient)],
  ['custom_rest', () => new CustomRESTAdapter(testConfig)],
])('Adapter contract: %s', (name, factory) => {
  let adapter: ICRMAdapter;
  beforeAll(() => { adapter = factory(); });
  
  it('testConnection returns ok', async () => {
    const health = await adapter.testConnection();
    expect(health.ok).toBe(true);
  });
  
  it('listCustomers returns paginated', async () => { ... });
  it('searchNearby returns sorted by distance', async () => { ... });
  it('createOrder is idempotent', async () => { ... });
  // ... (15+ contract tests)
});
```

Yeni bir adapter eklemek için: bu test suite'i geçmelidir. Bu Faz 2'de Logo/Mikro adapter'ları için referans noktası olacak.

---

## 10. Sürüm Politikası

- `ICRMAdapter` interface'i **semantik versiyonlanır** (`v1.0.0`)
- Breaking change (method kaldırma, signature değişimi) → major
- Yeni opsiyonel method/capability → minor
- Bug fix → patch
- Adapter'lar kendi `version` alanlarında interface uyumluluğunu beyan eder
