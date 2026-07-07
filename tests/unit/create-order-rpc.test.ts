/**
 * SupabaseCRMAdapter.createOrder — RPC (saha_create_order_tx) yolu birim testleri.
 *
 * Kapsam:
 *  - createOrder, sunucu-otoriteli RPC'yi TEK doğru p_payload ile çağırır:
 *    idempotency_key geçer, items = [{product_id, quantity}] (unitPriceOverride
 *    KASITEN atlanır → client fiyatı gönderilmez), klinik ise clinic_id, değilse
 *    user_id set edilir. Status/order_number/fiyat client'tan GİTMEZ.
 *  - reused:true dönen RPC yanıtında da tam Order (getOrder) döndürülür.
 *  - RPC hatası (ör. 'fiyat çözülemedi: X') AdapterError olarak yüzeye çıkar.
 *
 * Mock stratejisi: adapter deps.client ile mock Supabase enjekte edilir. Zincir
 * (.from().select().eq().maybeSingle()) tabloya göre farklı sonuç döndürür; .rpc()
 * çağrı argümanını yakalar.
 */
import { describe, it, expect, vi } from 'vitest';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import { AdapterError } from '@core/adapters/errors';

interface MockOpts {
  clinicResult: { data: { id: string } | null; error: unknown };
  orderResult: { data: unknown; error: unknown };
  rpcResult: { data: unknown; error: unknown };
}

function makeMockClient(opts: MockOpts): {
  client: unknown;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const from = vi.fn((table: string) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: () => {
        if (table === 'saha_clinics') return Promise.resolve(opts.clinicResult);
        if (table === 'orders') return Promise.resolve(opts.orderResult);
        return Promise.resolve({ data: null, error: null });
      },
    };
    return builder;
  });
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args });
    return Promise.resolve(opts.rpcResult);
  });
  return { client: { from, rpc, auth: {} }, rpcCalls };
}

const ORDER_ROW = {
  id: 'order-uuid-1',
  order_number: 'SAH-20260707120000-abc123',
  user_id: null,
  cari_id: 'cari-1',
  clinic_id: 'clinic-1',
  status: 'pending',
  total: 110,
  total_amount: 110,
  notes: null,
  sales_rep_id: 'rep-1',
  created_at: '2026-07-07T12:00:00.000Z',
  order_items: [
    { product_id: 'prod-1', product_name: 'Test Ürün', quantity: 2, unit_price: 50, line_total: 100 },
  ],
};

describe('createOrder → saha_create_order_tx RPC', () => {
  it('klinik müşteride doğru p_payload (clinic_id + product_id/quantity, override yok) kurar', async () => {
    const { client, rpcCalls } = makeMockClient({
      clinicResult: { data: { id: 'clinic-1' }, error: null },
      orderResult: { data: ORDER_ROW, error: null },
      rpcResult: {
        data: {
          order_id: 'order-uuid-1',
          order_number: 'SAH-20260707120000-abc123',
          status: 'pending',
          total: 110,
          reused: false,
        },
        error: null,
      },
    });
    const adapter = new SupabaseCRMAdapter({ client: client as never });

    const result = await adapter.createOrder({
      customerId: 'clinic-1',
      idempotencyKey: 'idem-key-1',
      notes: 'acele',
      items: [{ productId: 'prod-1', quantity: 2, unitPriceOverride: 999 }],
    });

    // RPC tek kez, doğru fonksiyon + payload ile çağrıldı.
    const call = rpcCalls.find((c) => c.fn === 'saha_create_order_tx');
    expect(call).toBeDefined();
    const payload = call!.args.p_payload as Record<string, unknown>;
    expect(payload.idempotency_key).toBe('idem-key-1');
    expect(payload.clinic_id).toBe('clinic-1');
    expect(payload.user_id).toBeUndefined();
    expect(payload.notes).toBe('acele');
    // items yalnız product_id + quantity — client fiyatı (unitPriceOverride) SIZDIRILMAZ.
    expect(payload.items).toEqual([{ product_id: 'prod-1', quantity: 2 }]);
    // status / order_number / subtotal / total client'tan GÖNDERİLMEZ.
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('order_number');
    expect(payload).not.toHaveProperty('total');

    // Dönüş: getOrder üzerinden tam Order.
    expect(result.id).toBe('order-uuid-1');
    expect(result.externalId).toBe('SAH-20260707120000-abc123');
    expect(result.status).toBe('pending');
    expect(result.totalAmount).toBe(110);
    expect(result.items).toHaveLength(1);
  });

  it('klinik değilse user_id yoluna düşer (legacy profil)', async () => {
    const { client, rpcCalls } = makeMockClient({
      clinicResult: { data: null, error: null },
      orderResult: { data: ORDER_ROW, error: null },
      rpcResult: {
        data: { order_id: 'order-uuid-1', order_number: 'X', status: 'pending', reused: false },
        error: null,
      },
    });
    const adapter = new SupabaseCRMAdapter({ client: client as never });
    await adapter.createOrder({
      customerId: 'profile-uuid',
      idempotencyKey: 'idem-2',
      items: [{ productId: 'prod-1', quantity: 1 }],
    });
    const payload = rpcCalls[0]!.args.p_payload as Record<string, unknown>;
    expect(payload.user_id).toBe('profile-uuid');
    expect(payload.clinic_id).toBeUndefined();
  });

  it('cariId verilirse p_payload cari_id taşır, clinic_id/user_id GÖNDERMEZ (klinik çözümü atlanır)', async () => {
    const { client, rpcCalls } = makeMockClient({
      // clinicResult verilse de cariId yolu klinik lookup'ını atlamalı.
      clinicResult: { data: { id: 'clinic-should-be-ignored' }, error: null },
      orderResult: { data: ORDER_ROW, error: null },
      rpcResult: {
        data: {
          order_id: 'order-uuid-1',
          order_number: 'SAH-20260707120000-abc123',
          status: 'pending',
          total: 110,
          reused: false,
        },
        error: null,
      },
    });
    const adapter = new SupabaseCRMAdapter({ client: client as never });

    await adapter.createOrder({
      customerId: 'cari-uuid-9',
      cariId: 'cari-uuid-9',
      idempotencyKey: 'idem-cari-1',
      items: [{ productId: 'prod-1', quantity: 3 }],
    });

    const call = rpcCalls.find((c) => c.fn === 'saha_create_order_tx');
    expect(call).toBeDefined();
    const payload = call!.args.p_payload as Record<string, unknown>;
    expect(payload.cari_id).toBe('cari-uuid-9');
    expect(payload).not.toHaveProperty('clinic_id');
    expect(payload).not.toHaveProperty('user_id');
    expect(payload.items).toEqual([{ product_id: 'prod-1', quantity: 3 }]);
  });

  it('reused:true yanıtında da tam Order (getOrder) döndürür', async () => {
    const { client } = makeMockClient({
      clinicResult: { data: { id: 'clinic-1' }, error: null },
      orderResult: { data: ORDER_ROW, error: null },
      rpcResult: {
        data: {
          order_id: 'order-uuid-1',
          order_number: 'SAH-20260707120000-abc123',
          status: 'pending',
          reused: true,
        },
        error: null,
      },
    });
    const adapter = new SupabaseCRMAdapter({ client: client as never });
    const result = await adapter.createOrder({
      customerId: 'clinic-1',
      idempotencyKey: 'idem-key-1',
      items: [{ productId: 'prod-1', quantity: 2 }],
    });
    expect(result.id).toBe('order-uuid-1');
    expect(result.status).toBe('pending');
  });

  it('RPC hatası (fiyat çözülemedi) AdapterError olarak yüzeye çıkar', async () => {
    const { client } = makeMockClient({
      clinicResult: { data: { id: 'clinic-1' }, error: null },
      orderResult: { data: ORDER_ROW, error: null },
      rpcResult: { data: null, error: { message: 'fiyat çözülemedi: prod-9' } },
    });
    const adapter = new SupabaseCRMAdapter({ client: client as never });
    await expect(
      adapter.createOrder({
        customerId: 'clinic-1',
        idempotencyKey: 'idem-3',
        items: [{ productId: 'prod-9', quantity: 1 }],
      }),
    ).rejects.toMatchObject({ message: 'fiyat çözülemedi: prod-9' });
    await expect(
      adapter.createOrder({
        customerId: 'clinic-1',
        idempotencyKey: 'idem-3',
        items: [{ productId: 'prod-9', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(AdapterError);
  });
});
