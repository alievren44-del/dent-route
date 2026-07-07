/**
 * syncQueue — offline op'lar 'cari.create' + 'clinic.create' replay-güvenliği (#P9).
 *
 * Kapsam:
 *  - cari.create: client-üretimli uuid `id` ile insert; replay'de pk unique_violation
 *    (23505) → BAŞARI sayılır (throw yok, op 'completed'). link_profile_id varsa
 *    saha_link_cari_to_profile RPC'si çağrılır ve link_profile_id insert satırından
 *    ayıklanır (saha_cariler'e sızmaz).
 *  - clinic.create: upsert onConflict 'google_place_id' → idempotent (replay çift-insert
 *    yapmaz), başarı.
 *
 * Mock stratejisi: '@core/offline/db' bellek-içi sahte ops store ile, '@lib/supabase'
 * mock Supabase ile değiştirilir (vi.hoisted — factory hoisting güvenli). Gerçek
 * IndexedDB/ağ gerekmez.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OfflineOp } from '@core/offline/db';

// vi.hoisted: mock factory'leri dosya başına kaldırıldığından paylaşılan durum da
// hoisted olmalı (aksi halde "Cannot access before initialization").
const h = vi.hoisted(() => {
  const state = {
    rows: [] as OfflineOp[],
    nextId: 1,
    insertResult: { error: null as unknown },
    upsertResult: { error: null as unknown },
    rpcResult: { error: null as unknown },
  };
  const ops = {
    where: (field: string) => ({
      equals: (val: unknown) => {
        const match = () =>
          state.rows.filter((r) => (r as unknown as Record<string, unknown>)[field] === val);
        return {
          toArray: () => Promise.resolve(match()),
          filter: (fn: (op: OfflineOp) => boolean) => ({
            first: () => Promise.resolve(match().filter(fn)[0]),
          }),
        };
      },
    }),
    add: (row: Omit<OfflineOp, 'id'>) => {
      const id = state.nextId++;
      state.rows.push({ ...row, id } as OfflineOp);
      return Promise.resolve(id);
    },
    update: (id: number, patch: Partial<OfflineOp>) => {
      const r = state.rows.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
      return Promise.resolve(1);
    },
    delete: (id: number) => {
      state.rows = state.rows.filter((x) => x.id !== id);
      return Promise.resolve();
    },
  };
  const insertMock = vi.fn((..._args: unknown[]) => Promise.resolve(state.insertResult));
  const upsertMock = vi.fn((..._args: unknown[]) => Promise.resolve(state.upsertResult));
  const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(state.rpcResult));
  const fromMock = vi.fn((..._args: unknown[]) => ({ insert: insertMock, upsert: upsertMock }));
  const client = { from: fromMock, rpc: rpcMock };
  return { state, ops, insertMock, upsertMock, rpcMock, fromMock, client };
});

vi.mock('@core/offline/db', () => ({ offlineDB: { ops: h.ops } }));
vi.mock('@lib/supabase', () => ({
  getTypedClient: () => h.client,
  getSupabaseClient: () => h.client,
}));

import { enqueueOp, processQueue } from '@core/offline/syncQueue';

beforeEach(() => {
  h.state.rows = [];
  h.state.nextId = 1;
  h.state.insertResult = { error: null };
  h.state.upsertResult = { error: null };
  h.state.rpcResult = { error: null };
  h.insertMock.mockClear();
  h.upsertMock.mockClear();
  h.rpcMock.mockClear();
  h.fromMock.mockClear();
});

describe('syncQueue cari.create', () => {
  it('client id ile insert eder, link_profile_id insert satırından ayıklanır ve RPC çağrılır', async () => {
    await enqueueOp(
      'cari.create',
      { id: 'cari-uuid-1', fatura_unvani: 'Test Cari', cari_kodu: '', link_profile_id: 'prof-1' },
      'cari-uuid-1',
    );
    const res = await processQueue();

    expect(res.success).toBe(1);
    expect(res.failed).toBe(0);
    // insert satırında link_profile_id OLMAMALI (saha_cariler kolonu değil).
    const insertArg = h.insertMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(insertArg.id).toBe('cari-uuid-1');
    expect(insertArg).not.toHaveProperty('link_profile_id');
    // link RPC doğru argümanlarla çağrıldı.
    expect(h.rpcMock).toHaveBeenCalledWith('saha_link_cari_to_profile', {
      p_cari_id: 'cari-uuid-1',
      p_profile_id: 'prof-1',
    });
    expect(h.state.rows[0]!.status).toBe('completed');
  });

  it('replay: pk unique_violation (23505) BAŞARI sayılır (throw yok)', async () => {
    h.state.insertResult = { error: { code: '23505', message: 'duplicate key' } };
    await enqueueOp(
      'cari.create',
      { id: 'cari-uuid-2', fatura_unvani: 'X', cari_kodu: '' },
      'cari-uuid-2',
    );
    const res = await processQueue();

    expect(res.success).toBe(1);
    expect(res.failed).toBe(0);
    // link_profile_id yok → RPC çağrılmaz.
    expect(h.rpcMock).not.toHaveBeenCalled();
    expect(h.state.rows[0]!.status).toBe('completed');
  });

  it('23505 dışı insert hatası op’u başarısız yapar (retry/pending)', async () => {
    h.state.insertResult = { error: { code: '23502', message: 'not null violation' } };
    await enqueueOp(
      'cari.create',
      { id: 'cari-uuid-3', fatura_unvani: 'Y', cari_kodu: '' },
      'cari-uuid-3',
    );
    const res = await processQueue();

    expect(res.success).toBe(0);
    expect(res.failed).toBe(1);
    expect(h.state.rows[0]!.status).toBe('pending'); // retryCount<3 → yeniden dene
  });
});

describe('syncQueue clinic.create', () => {
  it('upsert onConflict google_place_id ile idempotent yazar', async () => {
    await enqueueOp(
      'clinic.create',
      { google_place_id: 'manual_field_abc', name: 'Klinik', lat: 1, lng: 2 },
      'manual_field_abc',
    );
    const res = await processQueue();

    expect(res.success).toBe(1);
    expect(res.failed).toBe(0);
    expect(h.fromMock).toHaveBeenCalledWith('saha_clinics');
    const upsertOpts = h.upsertMock.mock.calls[0]![1] as { onConflict: string };
    expect(upsertOpts.onConflict).toBe('google_place_id');
    expect(h.state.rows[0]!.status).toBe('completed');
  });
});
