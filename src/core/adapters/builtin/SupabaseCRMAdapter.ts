/**
 * SupabaseCRMAdapter — Built-in (default) adapter
 *
 * Bu adapter projenin kendi Supabase'ini kullanır (Built-in CRM Layer).
 * Sprint 2-5 boyunca method'lar doldurulacak. Şu an iskelet.
 *
 * Davranış spec: `.ai_context/04-adapter-contract.md` §6
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getTypedClient } from '@lib/supabase';
import type { Database } from '@/types/database.types';
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
  // A5 pilot: typed client — sıfır runtime değişiklik, yalnızca tip katmanı.
  private readonly supabase: SupabaseClient<Database>;

  constructor(deps: SupabaseCRMAdapterDeps = {}) {
    if (deps.client) {
      // Test inject: untyped client'ı typed olarak cast et (test DB şemasını karşılar).
      this.supabase = deps.client as unknown as SupabaseClient<Database>;
    } else if (deps.url && deps.anonKey) {
      this.supabase = createClient<Database>(deps.url, deps.anonKey);
    } else {
      // Default: paylaşımlı typed singleton (Parla session ile ortak).
      this.supabase = getTypedClient();
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

  // ─── Customers ────────────────────────────────────────

  async listCustomers(opts?: ListCustomersOptions): Promise<Page<Customer>> {
    let q = this.supabase.from('saha_clinics').select(CLINIC_COLS, { count: 'exact' });

    // DB status değerleri: 'active' | 'closed' | 'duplicate' | 'flagged'.
    // Customer.status ise 'active' | 'inactive' | 'prospect'.
    // 'active' → eq active; 'inactive' → not-active; default → active.
    if (opts?.status === 'inactive') {
      q = q.neq('status', 'active');
    } else {
      q = q.eq('status', 'active');
    }
    if (opts?.region) q = q.eq('province_slug', opts.region);
    if (opts?.search) q = q.ilike('name', `%${opts.search}%`);
    q = q.order('name').limit(opts?.limit ?? 50);

    const { data, error, count } = await q;
    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }

    const rows = (data ?? []) as ClinicRow[];
    return {
      items: rows.map(clinicRowToCustomer),
      total: count ?? undefined,
    };
  }

  async getCustomer(id: string): Promise<Customer> {
    const { data, error } = await this.supabase
      .from('saha_clinics')
      .select(CLINIC_COLS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }
    if (!data) {
      throw AdapterError.notFound('Customer', id);
    }
    return clinicRowToCustomer(data as ClinicRow);
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

    // saha_search_nearby_clinics RPC dönüş tipi status içermez — yalnızca active döndürdüğü
    // garantili. ClinicRow.status optional olduğundan unknown üzerinden cast güvenlidir.
    const rows = (data ?? []) as unknown as ClinicRow[];
    return rows.map(clinicRowToCustomer);
  }

  async createCustomer(data: NewCustomer): Promise<Customer> {
    const primary = data.addresses?.[0];
    const { data: inserted, error } = await this.supabase
      .from('saha_clinics')
      .insert({
        name: data.name,
        phone: data.phone ?? null,
        address: primary?.addressLine ?? null,
        // lat/lng saha_clinics'te NOT NULL — adres konumu yoksa 0,0 ile yer tut.
        lat: primary?.location?.lat ?? 0,
        lng: primary?.location?.lng ?? 0,
        province_slug: data.region ?? primary?.city ?? null,
        district_slug: primary?.district ?? null,
        types: data.type ? [data.type] : [],
        vertical_key: 'dental',
        status: 'active',
        // google_place_id UNIQUE NOT NULL — manuel kayıt için benzersiz değer.
        google_place_id: `manual:${crypto.randomUUID()}`,
      })
      .select(CLINIC_COLS)
      .single();

    if (error || !inserted) {
      throw new AdapterError('UNKNOWN', error?.message ?? 'customer insert failed', {
        originalError: error,
      });
    }
    return clinicRowToCustomer(inserted as ClinicRow);
  }

  async updateCustomer(id: string, patch: Partial<Customer>): Promise<Customer> {
    const primary = patch.addresses?.[0];
    // Typed Update shape — excess property check'i geçmek için DB tipini kullan.
    type ClinicUpdate = Database['public']['Tables']['saha_clinics']['Update'];
    const row: ClinicUpdate = {};
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.phone !== undefined) row.phone = patch.phone ?? null;
    if (patch.region !== undefined) row.province_slug = patch.region ?? null;
    if (patch.type !== undefined) row.types = patch.type ? [patch.type] : [];
    if (primary) {
      row.address = primary.addressLine ?? null;
      if (primary.location?.lat != null) row.lat = primary.location.lat;
      if (primary.location?.lng != null) row.lng = primary.location.lng;
      if (primary.district !== undefined) row.district_slug = primary.district ?? null;
      if (primary.city !== undefined && patch.region === undefined) {
        row.province_slug = primary.city ?? null;
      }
    }

    const { data, error } = await this.supabase
      .from('saha_clinics')
      .update(row)
      .eq('id', id)
      .select(CLINIC_COLS)
      .single();

    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }
    if (!data) {
      throw AdapterError.notFound('Customer', id);
    }
    return clinicRowToCustomer(data as ClinicRow);
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
      // DB şemasında kolon adı profile_id (user_id değil).
      const { data, error } = await this.supabase
        .from('wallet_transactions')
        .select('amount, type, created_at')
        .eq('profile_id', customerId);

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
        'id, order_number, user_id, cari_id, clinic_id, status, total, total_amount, notes, sales_rep_id, created_at, order_items(product_id, product_name, quantity, unit_price, line_total)',
        { count: 'exact' },
      )
      .or(`user_id.eq.${customerId},clinic_id.eq.${customerId}`)
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
    // DB'de status: string | null — null'ı mapOrderStatus boş string gibi işler.
    type OrderRow = {
      id: string;
      order_number: string | null;
      user_id: string | null;
      cari_id: string | null;
      clinic_id: string | null;
      status: string | null;
      total: number | null;
      total_amount: number | null;
      notes: string | null;
      sales_rep_id: string | null;
      created_at: string | null;
      order_items: OrderItemRow[] | null;
    };

    return {
      items: (data ?? []).map((r: OrderRow) => ({
        id: r.id,
        externalId: r.order_number ?? undefined,
        customerId: r.clinic_id ?? r.user_id ?? '',
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
        createdBy: r.sales_rep_id ?? r.user_id ?? '',
        createdAt: r.created_at ?? new Date().toISOString(),
      })),
      total: count ?? undefined,
    };
  }

  async getOrder(id: string): Promise<Order> {
    const { data, error } = await this.supabase
      .from('orders')
      .select(
        'id, order_number, user_id, cari_id, clinic_id, status, total, total_amount, notes, sales_rep_id, created_at, order_items(product_id, product_name, quantity, unit_price, line_total)',
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
    // DB'de status/created_at nullable — null-safe dönüşüm yapılır.
    type OrderRow = {
      id: string;
      order_number: string | null;
      user_id: string | null;
      cari_id: string | null;
      clinic_id: string | null;
      status: string | null;
      total: number | null;
      total_amount: number | null;
      notes: string | null;
      sales_rep_id: string | null;
      created_at: string | null;
      order_items: OrderItemRow[] | null;
    };
    const r = data as OrderRow;
    return {
      id: r.id,
      externalId: r.order_number ?? undefined,
      customerId: r.clinic_id ?? r.user_id ?? '',
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
      createdBy: r.sales_rep_id ?? r.user_id ?? '',
      createdAt: r.created_at ?? new Date().toISOString(),
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

    // Fiyat + meta snapshot — v_saha_products tek kaynak (quoteOrder ile aynı mantık).
    // Eskiden sadece unitPriceOverride'a bakılıyordu; sepetten override gelmediği için
    // fiyatlar 0 yazılıyordu. Artık fiyat/vergi DB'den çekilir.
    const productIds = order.items.map((it) => it.productId);
    const { data: productRows } = await this.supabase
      .from('v_saha_products')
      .select('id, name, sku, base_price, sale_price, tax_rate')
      .in('id', productIds);
    const priceMap = new Map<
      string,
      { name: string | null; sku: string | null; price: number; taxRate: number }
    >(
      (
        (productRows ?? []) as Array<{
          id: string;
          name: string | null;
          sku: string | null;
          base_price: number | string | null;
          sale_price: number | string | null;
          tax_rate: number | string | null;
        }>
      ).map((p) => {
        // tax_rate DB'de yüzde (ör. 10.00). Null → %10 varsayılan (dental standart).
        const taxPct = p.tax_rate != null ? Number(p.tax_rate) : 10;
        return [
          p.id,
          {
            name: p.name,
            sku: p.sku,
            price: Number(p.sale_price ?? p.base_price ?? 0),
            taxRate: Number.isFinite(taxPct) ? taxPct / 100 : 0.1,
          },
        ] as const;
      }),
    );

    // Tutarları hesapla (server-side doğrulama Parla'da).
    let subtotal = 0;
    let vatTotal = 0;
    const lineItems = order.items.map((it) => {
      const meta = priceMap.get(it.productId);
      const unitPrice = it.unitPriceOverride ?? meta?.price ?? 0;
      const lineTotal = unitPrice * it.quantity;
      subtotal += lineTotal;
      vatTotal += lineTotal * (meta?.taxRate ?? 0.1);
      return {
        ...it,
        unitPrice,
        lineTotal,
        sku: meta?.sku ?? '-',
        productName: meta?.name ?? 'Ürün',
      };
    });
    vatTotal = Math.round(vatTotal * 100) / 100;
    const grandTotal = subtotal + vatTotal;

    // Müşteri kimliği iki dünyadan gelebilir:
    //  - saha_clinics (3116 prospect) → cari find-or-create, sipariş cariye+kliniğe bağlanır.
    //  - profiles (eski ziyaret/müşteri-detay akışları) → legacy user_id.
    const { data: clinicRow } = await this.supabase
      .from('saha_clinics')
      .select('id')
      .eq('id', order.customerId)
      .maybeSingle();

    let clinicId: string | null = null;
    let cariId: string | null = null;
    let userId: string | null = order.customerId;

    if (clinicRow?.id) {
      clinicId = clinicRow.id;
      userId = null;
      const { data: resolvedCari, error: cariErr } = await this.supabase.rpc(
        'saha_get_or_create_cari_for_clinic',
        { p_clinic_id: clinicId },
      );
      if (cariErr || !resolvedCari) {
        throw new AdapterError('UNKNOWN', cariErr?.message ?? 'cari oluşturulamadı', {
          originalError: cariErr,
        });
      }
      cariId = resolvedCari;
    }

    // order_number DB şemasında NOT NULL required. Trigger yoksa timestamp tabanlı
    // benzersiz kod üret; DB trigger varsa override eder.
    // Date.now() tek başına eşzamanlı iki sipariş aynı ms'de çakışabilir (UNIQUE ihlali)
    // → rastgele sonek ile çakışma olasılığı ihmal edilebilir seviyeye iner.
    const rand = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
    const orderNumber = `SAH-${Date.now()}-${rand}`;
    const { data: newOrder, error: insErr } = await this.supabase
      .from('orders')
      .insert({
        order_number: orderNumber,
        user_id: userId,
        cari_id: cariId,
        clinic_id: clinicId,
        sales_rep_id: salesRepId,
        // Onay gereken sipariş doğrudan approval_pending oluşturulur — eski
        // "önce pending INSERT, sonra ikinci UPDATE" race penceresini kapatır.
        status: order.requiresApproval ? 'approval_pending' : 'pending',
        subtotal,
        vat_amount: vatTotal,
        total: grandTotal,
        total_amount: grandTotal,
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

    // order_items — sku/product_name/fiyat snapshot lineItems'tan (yukarıda v_saha_products'tan çekildi).
    const itemsPayload = lineItems.map((it) => ({
      order_id: newOrder.id,
      product_id: it.productId,
      sku: it.sku,
      product_name: it.productName,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      line_total: it.lineTotal,
    }));
    const { error: itemsErr } = await this.supabase.from('order_items').insert(itemsPayload);
    if (itemsErr) {
      // Kalemsiz sipariş sessizce oluşmasın — hatayı yüzeye çıkar.
      throw new AdapterError('UNKNOWN', `Sipariş kalemleri eklenemedi: ${itemsErr.message}`, {
        originalError: itemsErr,
      });
    }

    return this.getOrder(newOrder.id);
  }

  async quoteOrder(items: NewOrderItem[], _customerId: string): Promise<OrderQuote> {
    const productIds = items.map((i) => i.productId);
    const { data: products } = await this.supabase
      .from('v_saha_products')
      .select('id, name, base_price, sale_price, currency, tax_rate')
      .in('id', productIds);

    const priceMap = new Map<string, { price: number; currency: string; taxRate: number }>();
    const productRows = (products ?? []) as Array<{
      id: string;
      base_price: number | string;
      sale_price: number | string | null;
      currency: string | null;
      tax_rate: number | string | null;
    }>;
    for (const p of productRows) {
      // tax_rate DB'de yüzde olarak tutulur (ör. 10.00). Null → %10 varsayılan
      // (dental/medikal standart; web sitesi de 10). Açık değerler korunur.
      const taxPct = p.tax_rate != null ? Number(p.tax_rate) : 10;
      priceMap.set(p.id, {
        price: Number(p.sale_price ?? p.base_price),
        currency: p.currency ?? 'TRY',
        taxRate: Number.isFinite(taxPct) ? taxPct / 100 : 0.1,
      });
    }

    let subtotal = 0;
    let vatTotal = 0;
    const quotedItems: QuotedItem[] = items.map((it) => {
      const pi = priceMap.get(it.productId);
      const unitPrice = it.unitPriceOverride ?? pi?.price ?? 0;
      const lineTotal = unitPrice * it.quantity;
      const vatRate = pi?.taxRate ?? 0.1;
      subtotal += lineTotal;
      vatTotal += lineTotal * vatRate;
      return {
        ...it,
        unitPrice,
        appliedDiscount: 0,
        lineTotal,
      };
    });

    vatTotal = Math.round(vatTotal * 100) / 100;
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
      .from('v_saha_products')
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

    // v_saha_products view'unda id/name nullable (view'lar için tüm kolonlar null olabilir).
    type ProductRow = {
      id: string | null;
      sku: string | null;
      name: string | null;
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
      items: (data ?? [])
        .filter((r: ProductRow) => r.id != null)
        .map((r: ProductRow) => ({
          id: r.id ?? '',
          sku: r.sku ?? undefined,
          name: r.name ?? '',
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
      .from('v_saha_products')
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

    // v_saha_products view'unda id/name nullable.
    type ProductRow = {
      id: string | null;
      sku: string | null;
      name: string | null;
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
      id: r.id ?? '',
      sku: r.sku ?? undefined,
      name: r.name ?? '',
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
      .from('v_saha_products')
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

    // v_saha_products view'unda id/name nullable.
    type ProductRow = {
      id: string | null;
      sku: string | null;
      name: string | null;
      description: string | null;
      category_id: string | null;
      base_price: number | null;
      sale_price: number | null;
      currency: string | null;
      stock_quantity: number | null;
      is_active: boolean | null;
      main_image: string | null;
    };
    return (data ?? [])
      .filter((r: ProductRow) => r.id != null)
      .map((r: ProductRow) => ({
        id: r.id ?? '',
        sku: r.sku ?? undefined,
        name: r.name ?? '',
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

  // ─── Campaigns ────────────────────────────────────────

  async listActiveCampaigns(_customerId?: string): Promise<Campaign[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.supabase
      .from('campaigns')
      .select('*')
      .eq('is_active', true)
      .or(`start_date.is.null,start_date.lte.${nowIso}`)
      .or(`end_date.is.null,end_date.gte.${nowIso}`)
      .order('priority', { ascending: false });

    if (error) {
      throw new AdapterError('UNKNOWN', error.message, { originalError: error });
    }

    // DB'de reward/target_product Json tipinde; runtime'da nesne ya da null gelir.
    // Tip-katmanı cast — runtime davranışı değişmez.
    type CampaignRow = {
      id: string;
      name: string;
      type: string | null;
      display_text: string | null;
      start_date: string | null;
      end_date: string | null;
      reward: { type?: string; quantity?: number } | null;
      target_product: { discountType?: string; discountValue?: number } | null;
    };

    return (data ?? []).map((r) => mapCampaignRow(r as unknown as CampaignRow));
  }

  // ─── Order approval (programmatic) ────────────────────

  /**
   * Siparişi onaylar. Doğrudan UPDATE YERİNE server-side yetki kapısı
   * `approve_order_if_authorized` (SECURITY DEFINER) RPC'sini çağırır — neden:
   * eskiden client-side approvalRules tek kontroldü → REP kendi >5000₺ siparişini
   * adapter/REST ile onaylayabiliyordu (#70). RPC eşik uygular
   * (REP<=5000, MANAGER<=50000, ADMIN sınırsız). RPC void döner; status='approved' +
   * approved_at fonksiyon içinde set edilir, trg_order_status_change trigger'ı
   * stok + order-to-cash akışını otomatik tetikler (eskisi gibi).
   *
   * Hata ayrımı (UI anlamlı toast gösterebilsin diye AdapterError.code ile):
   *  - 'over_approval_limit:rep' / ':manager' → FORBIDDEN (+ details.reason='over_approval_limit')
   *  - 'not_authorized'                       → FORBIDDEN (+ details.reason='not_authorized')
   *  - diğer                                  → UNKNOWN
   */
  async approveOrder(orderId: string): Promise<void> {
    const { error } = await this.supabase.rpc('approve_order_if_authorized', {
      p_order_id: orderId,
    });

    if (error) {
      const msg = error.message ?? '';
      if (msg.includes('over_approval_limit')) {
        // REP/MANAGER limit aşımı: yetki var ama tutar sınırı geçildi.
        throw new AdapterError('FORBIDDEN', `Onay limiti aşıldı: ${msg}`, {
          originalError: error,
          details: { reason: 'over_approval_limit' },
        });
      }
      if (msg.includes('not_authorized')) {
        // Rol yok / onay yetkisi yok.
        throw new AdapterError('FORBIDDEN', 'Onay yetkiniz yok.', {
          originalError: error,
          details: { reason: 'not_authorized' },
        });
      }
      throw new AdapterError('UNKNOWN', `approveOrder başarısız: ${msg}`, {
        originalError: error,
      });
    }
  }
}

// ─── campaigns → Campaign mapping ───────────────────────

function mapCampaignRow(r: {
  id: string;
  name: string;
  type: string | null;
  display_text: string | null;
  start_date: string | null;
  end_date: string | null;
  reward: { type?: string; quantity?: number } | null;
  target_product: { discountType?: string; discountValue?: number } | null;
}): Campaign {
  // DB type → Campaign.discountType. Yüzde/sabit indirim varsa target_product'tan
  // çek; "free" (mal fazlası) kampanyaları buy_x_get_y olarak işaretle.
  const dbType = String(r.type ?? '').toLowerCase();
  let discountType: Campaign['discountType'] = 'percent';
  let discountValue: number | undefined;

  if (dbType.includes('free')) {
    discountType = 'buy_x_get_y';
    discountValue = r.reward?.quantity != null ? Number(r.reward.quantity) : undefined;
  } else {
    const tp = r.target_product;
    if (tp?.discountType === 'fixed') discountType = 'fixed';
    else discountType = 'percent';
    if (tp?.discountValue != null) discountValue = Number(tp.discountValue);
  }

  return {
    id: r.id,
    name: r.name,
    discountType,
    ...(discountValue != null ? { discountValue } : {}),
    ...(r.display_text ? { description: r.display_text } : {}),
    ...(r.start_date ? { startsAt: r.start_date } : {}),
    ...(r.end_date ? { endsAt: r.end_date } : {}),
  };
}

// ─── saha_clinics → Customer mapping ────────────────────
// Tüm customer method'ları (list/get/create/update/searchNearby) bu mapper'ı
// ve aynı kolon setini paylaşır.

const CLINIC_COLS =
  'id, google_place_id, name, lat, lng, address, phone, rating, user_ratings_total, types, province_slug, district_slug, clinic_segment, status, last_verified_at, created_at, updated_at';

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
  status: string | null;
  last_verified_at: string | null;
  // searchNearby RPC'sinde created_at/updated_at yok — opsiyonel.
  created_at?: string | null;
  updated_at?: string | null;
};

function clinicRowToCustomer(r: ClinicRow): Customer {
  const fallbackTs = r.last_verified_at ?? new Date().toISOString();
  return {
    id: r.id,
    externalId: r.google_place_id ?? undefined,
    name: r.name,
    type: r.clinic_segment ?? r.types?.[0] ?? undefined,
    phone: r.phone ?? undefined,
    // status kolonu yoksa (searchNearby RPC sadece active döner) → active say.
    status: r.status == null || r.status === 'active' ? 'active' : 'inactive',
    region: r.province_slug ?? undefined,
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
    createdAt: r.created_at ?? r.last_verified_at ?? fallbackTs,
    updatedAt: r.updated_at ?? r.last_verified_at ?? fallbackTs,
  };
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
