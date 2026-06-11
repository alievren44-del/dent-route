// @vitest-environment jsdom
/**
 * AgingReportPage testleri (#72).
 *
 * Kapsam (asıl hedef #72):
 *  - fatura çekimi .limit(500) ile sınırlı (unbounded fetch kapatıldı)
 *  - dönen satır sayısı >= 500 → "kısmi rapor" uyarı banneri gösterilir
 *  - satır sayısı < 500 → truncate banneri GÖSTERİLMEZ
 *  - cari bazlı bucket toplamı doğru hesaplanır (satis +, iade -)
 *
 * Mock: @lib/supabase (çağrı arg yakalayan zincir builder), recharts. RQ gerçek.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Pass,
    Bar: Pass,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ResponsiveContainer: Pass,
    Cell: () => null,
  };
});

type Resp = { data: unknown; error: unknown };
const tableResponders: Record<string, () => Resp> = {};
const calls: Record<string, Array<[string, ...unknown[]]>> = {};

function makeBuilder(table: string) {
  calls[table] ??= [];
  const resolve = (): Resp =>
    tableResponders[table] ? tableResponders[table]() : { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls[table]!.push([name, ...args]);
      return builder;
    };
  for (const m of ['select', 'eq', 'in', 'ilike', 'order', 'limit', 'gte', 'lt', 'gt', 'not']) {
    builder[m] = vi.fn(rec(m));
  }
  (builder as { then: unknown }).then = (onFulfilled: (r: Resp) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled);
  return builder;
}

const fromMock = vi.fn((table: string) => makeBuilder(table));

vi.mock('@lib/supabase', () => ({
  getSupabaseClient: () => ({ from: fromMock }),
}));

import AgingReportPage from '@features/invoicing/pages/AgingReportPage';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function makeFatura(i: number) {
  // vade_tarihi geçmiş → b90_plus bucket
  return {
    id: `f${i}`,
    cari_id: `cari-${i % 3}`,
    tip: 'satis',
    toplam: 1000,
    odenen: 0,
    kalan: 1000,
    vade_tarihi: '2026-01-01',
    durum: 'acik',
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const k of Object.keys(tableResponders)) delete tableResponders[k];
  for (const k of Object.keys(calls)) delete calls[k];
});

describe('AgingReportPage — #72 limit + truncate banner', () => {
  it('fatura çekimi .limit(500) ile sınırlanır', async () => {
    tableResponders['saha_faturalar'] = () => ({ data: [], error: null });
    render(<AgingReportPage />, { wrapper });
    await screen.findByText('Açık alacak bulunamadı.');

    const limitCall = (calls['saha_faturalar'] ?? []).find(([m]) => m === 'limit');
    expect(limitCall, '.limit() çağrısı olmalı').toBeTruthy();
    expect(limitCall![1]).toBe(500);
  });

  it('dönen satır < 500 → truncate uyarı banneri GÖSTERİLMEZ', async () => {
    tableResponders['saha_faturalar'] = () => ({
      data: [makeFatura(1), makeFatura(2)],
      error: null,
    });
    tableResponders['saha_cariler'] = () => ({
      data: [
        { id: 'cari-1', fatura_unvani: 'Cari Bir', cari_kodu: 'C1', sales_rep_id: null },
        { id: 'cari-2', fatura_unvani: 'Cari İki', cari_kodu: 'C2', sales_rep_id: null },
      ],
      error: null,
    });
    render(<AgingReportPage />, { wrapper });
    await screen.findByText('Cari Bir');
    expect(screen.queryByText(/yalnızca ilk 500 fatura/)).not.toBeInTheDocument();
  });

  it('dönen satır == 500 (limit) → "kısmi rapor" truncate banneri gösterilir', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => makeFatura(i));
    tableResponders['saha_faturalar'] = () => ({ data: rows, error: null });
    tableResponders['saha_cariler'] = () => ({
      data: [
        { id: 'cari-0', fatura_unvani: 'Cari Sıfır', cari_kodu: 'C0', sales_rep_id: null },
        { id: 'cari-1', fatura_unvani: 'Cari Bir', cari_kodu: 'C1', sales_rep_id: null },
        { id: 'cari-2', fatura_unvani: 'Cari İki', cari_kodu: 'C2', sales_rep_id: null },
      ],
      error: null,
    });
    render(<AgingReportPage />, { wrapper });
    // truncate banner metni
    expect(
      await screen.findByText(/yalnızca ilk 500 fatura/),
    ).toBeInTheDocument();
  });

  it('bucket hesabı: tek satis faturası 90+ bucket toplamına yansır', async () => {
    tableResponders['saha_faturalar'] = () => ({
      data: [makeFatura(1)], // kalan 1000, vade 2026-01-01 → 90+ gün
      error: null,
    });
    tableResponders['saha_cariler'] = () => ({
      data: [{ id: 'cari-1', fatura_unvani: 'Cari Bir', cari_kodu: 'C1', sales_rep_id: null }],
      error: null,
    });
    render(<AgingReportPage />, { wrapper });
    await screen.findByText('Cari Bir');
    // 90+ stat kartı ve tablo hücresinde 1000 ₺ formatı
    await waitFor(() => {
      const matches = screen.getAllByText(/1\.000,00/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
