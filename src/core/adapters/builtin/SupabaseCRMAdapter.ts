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
  OrderStatus,
  Page,
  Product,
  QuotedItem,
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

    const { data, error } = await this.supabase.rpc('saha_search_nearby_clinics', {
      _lat: location.lat,
      _lng: location.lng,
      _radius_m: radiusM,
      _vertical_key: 'dental',
      _limit: limit,
    });

    if (error) {
      throw new AdapterError('UNKNOWN', `searchNearby başarısız: ${error.message}`, {
        originalError: error,
        details: { rpc: 'saha_search_nearby_clinics' },
      });
    }

    type ClinicRow = {
      id: string;
      google_place_id: string | null;
      name: string;
      lat: number | null;
      lng: number | null;
      address: string | null;
      phone: string | null;
      rating: number | null;
      user_ratings_total: number | null;
      types: string[] | null;
      province_slug: string | null;
      district_slug: string | null;
      clinic_segment: string | null;
      last_verified_at: string | null;
      distance_m: number;
    };

    const rows = (data ?? []) as ClinicRow[];
    return rows.map<Customer>((r) => ({
      id: r.id,
      name: r.name,
      type: r.clinic_segment ?? undefined,
      phone: r.phone ?? undefined,
      status: 'active' as const,
      addresses:
        r.lat != null && r.lng != null
          ? ([
              {
                addressLine: r.address ?? '',
                district: r.district_slug ?? undefined,
                city: r.province_slug ?? undefined,
                location: { lat: r.lat, lng: r.lng },
                isPrimary: true,
              },
            ] as Customer['addresses'])
          : [],
      customFields: {
        google_place_id: r.google_place_id,
        rating: r.rating,
        user_ratings_total: r.user_ratings_total,
        types: r.types,
        last_verified_at: r.last_verified_at,
      },
      createdAt: r.last_verified_at ?? new Date().toISOString(),
      updatedAt: r.last_verified_at ?? new Date().toISOString(),
    }));
  }

  createCustomer(_data: NewCustomer): Promise<Customer> {
    throw AdapterError.notImplemented('createCustomer (Sprint 2)');
  }

  updateCustomer(_id: string, _patch: Partial<Customer>): Promise<Customer> {
    throw AdapterError.notImplemented('updateCustomer (Sprint 2)');
  }

  // ─── Balance ──────────────────────────────────────────

  async getBalance(customerId: string, _opts?: { forceFresh?: boolean }): Promise<Balance> {
    // Önce saha_cariler / saha_faturalar üzerinden gerçek cari bakiyeyi dene.
    // Tablo yoksa (invoicing migration uygulanmamış) — wallet_transactions
    // fallback'ine düşeriz, o da yoksa sıfır bakiye döneriz.
    try {
      const { data: cari, error: cariErr } = await this.supabase
        .from('saha_cariler')
        .select('id, kredi_limiti, acilis_bakiyesi')
        .eq('profile_id', customerId)
        .maybeSingle();

      if (cariErr) {
        // Tablo yok / RLS engelli → fallback
        throw cariErr;
      }

      if (!cari) {
        // Cari kaydı yok → sıfır bakiye, limit yok.
        return {
          customerId,
          totalOrders: 0,
          totalPaid: 0,
          balance: 0,
          due: 0,
          currency: 'TRY',
          creditLimit: 0,
          creditUsed: 0,
          asOf: new Date().toISOString(),
          cached: false,
        };
      }

      const cariRow = cari as {
        id: string;
        kredi_limiti: number | string | null;
        acilis_bakiyesi: number | string | null;
      };

      const { data: faturalar } = await this.supabase
        .from('saha_faturalar')
        .select('toplam, odenen, durum, tip, updated_at')
        .eq('cari_id', cariRow.id)
        .neq('durum', 'iptal');

      let due = 0;
      let lastMovement: string | undefined;
      const rows = (faturalar ?? []) as Array<{
        toplam: number | string;
        odenen: number | string;
        durum: string | null;
        tip: string | null;
        updated_at: string | null;
      }>;
      for (const f of rows) {
        const kalan = Number(f.toplam ?? 0) - Number(f.odenen ?? 0);
        const sign = String(f.tip ?? '').toLowerCase() === 'iade' ? -1 : 1;
        due += sign * kalan;
        if (f.updated_at && (!lastMovement || f.updated_at > lastMovement)) {
          lastMovement = f.updated_at;
        }
      }

      const acilis = Number(cariRow.acilis_bakiyesi ?? 0);
      const balance = Math.round((acilis + due) * 100) / 100;
      const creditLimit = Number(cariRow.kredi_limiti ?? 0) || 0;
      const creditUsed = creditLimit > 0 ? Math.max(0, balance) / creditLimit : 0;

      return {
        customerId,
        totalOrders: rows.length,
        totalPaid: 0,
        balance,
        due: Math.max(0, due),
        currency: 'TRY',
        creditLimit,
        creditUsed,
        ...(lastMovement ? { lastMovementAt: lastMovement } : {}),
        asOf: new Date().toISOString(),
        cached: false,
      };
    } catch {
      // saha_cariler yok ya da erişilemiyor — wallet_transactions fallback.
      const { data, error } = await this.supabase
        .from('wallet_transactions')
        .select('amount, type, created_at')
        .eq('user_id', customerId);

      if (error) {
        return {
          customerId,
          totalOrders: 0,
          totalPaid: 0,
          balance: 0,
          due: 0,
          currency: 'TRY',
          creditLimit: 0,
          creditUsed: 0,
          asOf: new Date().toISOString(),
          cached: false,
        };
      }

      let balance = 0;
      let lastMovement: string | undefined;
      const rows = (data ?? []) as Array<{
        amount: number | string;
        type: string | null;
        created_at: string;
      }>;
      for (const row of rows) {
        const amt = Number(row.amount);
        const type = String(row.type ?? '').toLowerCase();
        const sign = ['credit', 'alacak', 'add', 'deposit'].includes(type) ? 1 : -1;
        balance += amt * sign;
        if (!lastMovement || row.created_at > lastMovement) lastMovement = row.created_at;
      }

      return {
        customerId,
        totalOrders: 0,
        totalPaid: 0,
        balance,
        due: Math.max(0, balance),
        currency: 'TRY',
        creditLimit: 0,
        creditUsed: 0,
        ...(lastMovement ? { lastMovementAt: lastMovement } : {}),
        asOf: new Date().toISOString(),
        cached: false,
      };
    }
  }

  // ─── Orders ───────────────────────────────────────────

  async listOrders(customerId: string, opts?: ListOptions): Promise<Page<Order>> {
    const { data, error, count } = await this.supabase
      .from('orders')
      .select(
        'id, order_number, user_id, status, total, total_amount, notes, sales_rep_id, created_at, order_items(product_id, quantity, unit_price, line_total)',
        { count: 'exact' },
      )
      .eq('user_id', customerId)
      .order('created_at', { ascending: false })
      .limit(opts?.limit ?? 50);

    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }

    type OrderItemRow = {
      product_id: string | null;
      product_name?: string | null;
      quantity: number | null;
      unit_price: number | null;
      line_total: number | null;
    };
    type OrderRow = {
      id: string;
      order_number: string | null;
      user_id: string;
      status: string;
      total: number | null;
      total_amount: number | null;
      notes: string | null;
      sales_rep_id: string | null;
      created_at: string;
      order_items: OrderItemRow[] | null;
    };

    return {
      items: (data ?? []).map((r: OrderRow) => ({
        id: r.id,
        externalId: r.order_number ?? undefined,
        customerId: r.user_id,
        status: mapOrderStatus(r.status),
        items: (r.order_items ?? []).map((li: OrderItemRow) => ({
          productId: li.product_id ?? undefined,
          productName: String(li.product_name ?? li.product_id ?? 'Ürün'),
          quantity: Number(li.quantity ?? 0),
          unitPrice: Number(li.unit_price ?? 0),
          lineTotal: li.line_total != null ? Number(li.line_total) : undefined,
        })),
        totalAmount: Number(r.total ?? r.total_amount ?? 0),
        currency: 'TRY',
        notes: r.notes ?? undefined,
        createdBy: r.sales_rep_id ?? r.user_id,
        createdAt: r.created_at,
      })),
      total: count ?? undefined,
    };
  }

  async getOrder(id: string): Promise<Order> {
    const { data, error } = await this.supabase
      .from('orders')
      .select(
        'id, order_number, user_id, status, total, total_amount, notes, sales_rep_id, created_at, order_items(product_id, quantity, unit_price, line_total)',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }
    if (!data) {
      throw AdapterError.notFound('Order', id);
    }

    type OrderItemRow = {
      product_id: string | null;
      product_name?: string | null;
      quantity: number | null;
      unit_price: number | null;
      line_total: number | null;
    };
    type OrderRow = {
      id: string;
      order_number: string | null;
      user_id: string;
      status: string;
      total: number | null;
      total_amount: number | null;
      notes: string | null;
      sales_rep_id: string | null;
      created_at: string;
      order_items: OrderItemRow[] | null;
    };
    const r = data as OrderRow;
    return {
      id: r.id,
      externalId: r.order_number ?? undefined,
      customerId: r.user_id,
      status: mapOrderStatus(r.status),
      items: (r.order_items ?? []).map((li: OrderItemRow) => ({
        productId: li.product_id ?? undefined,
        productName: String(li.product_name ?? li.product_id ?? 'Ürün'),
        quantity: Number(li.quantity ?? 0),
        unitPrice: Number(li.unit_price ?? 0),
        lineTotal: li.line_total != null ? Number(li.line_total) : undefined,
      })),
      totalAmount: Number(r.total ?? r.total_amount ?? 0),
      currency: 'TRY',
      notes: r.notes ?? undefined,
      createdBy: r.sales_rep_id ?? r.user_id,
      createdAt: r.created_at,
    };
  }

  async createOrder(order: NewOrder): Promise<Order> {
    const { data: userData } = await this.supabase.auth.getUser();
    const salesRepId = userData.user?.id;

    // Idempotency check — orders.idempotency_key kolonu var (20260605000001).
    if (order.idempotencyKey) {
      const { data: existing } = await this.supabase
        .from('orders')
        .select('id')
        .eq('idempotency_key', order.idempotencyKey)
        .maybeSingle();
      if (existing?.id) {
        return this.getOrder(existing.id);
      }
    }

    // Calculate total client-side (server-side validation Parla'da)
    let subtotal = 0;
    const lineItems = order.items.map((it) => {
      const unitPrice = it.unitPriceOverride ?? 0;
      const lineTotal = unitPrice * it.quantity;
      subtotal += lineTotal;
      return { ...it, unitPrice, lineTotal };
    });

    const { data: newOrder, error: insErr } = await this.supabase
      .from('orders')
      .insert({
        user_id: order.customerId,
        sales_rep_id: salesRepId,
        status: 'pending',
        subtotal,
        total: subtotal,
        total_amount: subtotal,
        notes: order.notes ?? null,
        idempotency_key: order.idempotencyKey ?? null,
      })
      .select('id')
      .single();

    if (insErr || !newOrder) {
      throw new AdapterError('UNKNOWN', insErr?.message ?? 'order insert failed', {
        originalError: insErr,
      });
    }

    const itemsPayload = lineItems.map((it) => ({
      order_id: newOrder.id,
      product_id: it.productId,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      line_total: it.lineTotal,
    }));
    const { error: itemsErr } = await this.supabase.from('order_items').insert(itemsPayload);
    if (itemsErr) {
      console.warn('order_items insert warning:', itemsErr.message);
    }

    return this.getOrder(newOrder.id);
  }

  async quoteOrder(items: NewOrderItem[], _customerId: string): Promise<OrderQuote> {
    const productIds = items.map((i) => i.productId);
    const { data: products } = await this.supabase
      .from('products')
      .select('id, name, base_price, sale_price, currency')
      .in('id', productIds);

    const priceMap = new Map<string, { price: number; currency: string }>();
    const productRows = (products ?? []) as Array<{
      id: string;
      base_price: number | string;
      sale_price: number | string | null;
      currency: string | null;
    }>;
    for (const p of productRows) {
      priceMap.set(p.id, {
        price: Number(p.sale_price ?? p.base_price),
        currency: p.currency ?? 'TRY',
      });
    }

    let subtotal = 0;
    const quotedItems: QuotedItem[] = items.map((it) => {
      const pi = priceMap.get(it.productId);
      const unitPrice = it.unitPriceOverride ?? pi?.price ?? 0;
      const lineTotal = unitPrice * it.quantity;
      subtotal += lineTotal;
      return {
        ...it,
        unitPrice,
        appliedDiscount: 0,
        lineTotal,
      };
    });

    const vatTotal = subtotal * 0.2;
    return {
      items: quotedItems,
      subtotal,
      discountTotal: 0,
      vatTotal,
      grandTotal: subtotal + vatTotal,
      currency: 'TRY',
      appliedCampaigns: [],
    };
  }

  // ─── Products ─────────────────────────────────────────

  async listProducts(opts?: ListProductsOptions): Promise<Page<Product>> {
    let q = this.supabase
      .from('products')
      .select(
        'id, sku, name, description, category_id, base_price, sale_price, currency, stock_quantity, is_active, main_image',
        { count: 'exact' },
      )
      .eq('is_active', true)
      .order('name');

    if (opts?.search) q = q.ilike('name', `%${opts.search}%`);
    if (opts?.category) q = q.eq('category_id', opts.category);
    if (opts?.isActive !== undefined) q = q.eq('is_active', opts.isActive);
    q = q.limit(opts?.limit ?? 50);

    const { data, error, count } = await q;
    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }

    type ProductRow = {
      id: string;
      sku: string | null;
      name: string;
      description: string | null;
      category_id: string | null;
      base_price: number | null;
      sale_price: number | null;
      currency: string | null;
      stock_quantity: number | null;
      is_active: boolean | null;
      main_image: string | null;
    };

    return {
      items: (data ?? []).map((r: ProductRow) => ({
        id: r.id,
        sku: r.sku ?? undefined,
        name: r.name,
        description: r.description ?? undefined,
        category: r.category_id ?? undefined,
        unit: 'adet',
        basePrice: r.sale_price != null ? Number(r.sale_price) : Number(r.base_price ?? 0),
        currency: r.currency ?? 'TRY',
        stockQuantity: r.stock_quantity ?? undefined,
        isActive: Boolean(r.is_active),
        imageUrl: r.main_image ?? undefined,
      })),
      total: count ?? undefined,
    };
  }

  async getProduct(id: string): Promise<Product> {
    const { data, error } = await this.supabase
      .from('products')
      .select(
        'id, sku, name, description, category_id, base_price, sale_price, currency, stock_quantity, is_active, main_image',
      )
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }
    if (!data) {
      throw AdapterError.notFound('Product', id);
    }

    type ProductRow = {
      id: string;
      sku: string | null;
      name: string;
      description: string | null;
      category_id: string | null;
      base_price: number | null;
      sale_price: number | null;
      currency: string | null;
      stock_quantity: number | null;
      is_active: boolean | null;
      main_image: string | null;
    };
    const r = data as ProductRow;
    return {
      id: r.id,
      sku: r.sku ?? undefined,
      name: r.name,
      description: r.description ?? undefined,
      category: r.category_id ?? undefined,
      unit: 'adet',
      basePrice: r.sale_price != null ? Number(r.sale_price) : Number(r.base_price ?? 0),
      currency: r.currency ?? 'TRY',
      stockQuantity: r.stock_quantity ?? undefined,
      isActive: Boolean(r.is_active),
      imageUrl: r.main_image ?? undefined,
    };
  }

  async searchProducts(query: string, limit?: number): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from('products')
      .select(
        'id, sku, name, description, category_id, base_price, sale_price, currency, stock_quantity, is_active, main_image',
      )
      .eq('is_active', true)
      .ilike('name', `%${query}%`)
      .order('name')
      .limit(limit ?? 20);

    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }

    type ProductRow = {
      id: string;
      sku: string | null;
      name: string;
      description: string | null;
      category_id: string | null;
      base_price: number | null;
      sale_price: number | null;
      currency: string | null;
      stock_quantity: number | null;
      is_active: boolean | null;
      main_image: string | null;
    };
    return (data ?? []).map((r: ProductRow) => ({
      id: r.id,
      sku: r.sku ?? undefined,
      name: r.name,
      description: r.description ?? undefined,
      category: r.category_id ?? undefined,
      unit: 'adet',
      basePrice: r.sale_price != null ? Number(r.sale_price) : Number(r.base_price ?? 0),
      currency: r.currency ?? 'TRY',
      stockQuantity: r.stock_quantity ?? undefined,
      isActive: Boolean(r.is_active),
      imageUrl: r.main_image ?? undefined,
    }));
  }

  // ─── Campaigns (TODO: Faz 2) ──────────────────────────

  listActiveCampaigns(_customerId?: string): Promise<Campaign[]> {
    throw AdapterError.notImplemented('listActiveCampaigns (Faz 2)');
  }
}

function mapOrderStatus(s: string | null | undefined): OrderStatus {
  const v = String(s ?? '')
    .toLowerCase()
    .trim();
  switch (v) {
    case 'draft':
    case 'taslak':
      return 'draft';
    case 'pending':
    case 'beklemede':
    case 'awaiting':
    case 'new':
    case 'created':
      return 'pending';
    case 'confirmed':
    case 'approved':
    case 'onaylandi':
    case 'onaylandı':
    case 'processing':
    case 'preparing':
      return 'confirmed';
    case 'shipped':
    case 'in_transit':
    case 'kargoda':
    case 'kargolandi':
    case 'kargolandı':
      return 'shipped';
    case 'delivered':
    case 'completed':
    case 'teslim_edildi':
    case 'tamamlandi':
    case 'tamamlandı':
      return 'delivered';
    case 'cancelled':
    case 'canceled':
    case 'iptal':
    case 'iptal_edildi':
      return 'cancelled';
    default:
      return 'pending';
  }
}
