// @vitest-environment jsdom
/**
 * RepKpiPage testleri (#73).
 *
 * Kapsam (asıl hedef #73):
 *  - routesCompleted ay-filtresi: saha_routes sorgusu
 *    .eq('status','completed') + .gte('completed_at', startIso)
 *    + .lt('completed_at', endIso) ile filtrelenmeli
 *    (aksi halde kariyer-toplamı sayılır → KPI yanlış).
 *  - completed_at ay aralığındaki rotalar rep'e sayılır; aralık dışı sayılmaz.
 *  - reps tablosu render + rep adı + Rota✓ sütunu doğru.
 *
 * Mock: @lib/supabase (çağrı argümanlarını yakalayan zincir builder), recharts.
 * react-query gerçek.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// recharts'ı hafif stub'la (jsdom layout uyarısı + ResponsiveContainer 0px).
vi.mock('recharts', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    BarChart: Pass,
    Bar: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
    ResponsiveContainer: Pass,
    Cell: () => null,
  };
});

// Builder: çağrılan method+arg'ları kaydet, terminalde thenable döndür.
type Resp = { data: unknown; error: unknown };
const tableResponders: Record<string, () => Resp> = {};
// table → [ [method, ...args] ] kayıt
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
  for (const m of ['select', 'eq', 'in', 'ilike', 'order', 'limit', 'gte', 'lt', 'not', 'upsert']) {
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

import RepKpiPage from '@features/admin/pages/RepKpiPage';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function setProfiles() {
  tableResponders['profiles'] = () => ({
    data: [{ id: 'rep-1', ad_soyad: 'Ali Plasiyer', email: 'ali@x.com', role: 'SAHA_REP' }],
    error: null,
  });
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const k of Object.keys(tableResponders)) delete tableResponders[k];
  for (const k of Object.keys(calls)) delete calls[k];
});

describe('RepKpiPage — #73 routesCompleted ay filtresi', () => {
  it('saha_routes sorgusu status=completed + completed_at ay aralığı ile filtrelenir', async () => {
    setProfiles();
    render(<RepKpiPage />, { wrapper });
    // "Ali Plasiyer" hem <option> hem tablo hücresinde geçer → findAllByText.
    await screen.findAllByText('Ali Plasiyer');

    const routeCalls = calls['saha_routes'] ?? [];
    expect(routeCalls, 'saha_routes sorgusu yapılmalı').toBeTruthy();

    // status='completed' eq filtresi
    const eqStatus = routeCalls.find(
      ([m, col, val]) => m === 'eq' && col === 'status' && val === 'completed',
    );
    expect(eqStatus, "eq('status','completed') olmalı").toBeTruthy();

    // gte('completed_at', <iso>) — ay başı
    const gte = routeCalls.find(([m, col]) => m === 'gte' && col === 'completed_at');
    expect(gte, "gte('completed_at', ...) olmalı (ay-bazlı filtre)").toBeTruthy();

    // lt('completed_at', <iso>) — ay sonu (exclusive)
    const lt = routeCalls.find(([m, col]) => m === 'lt' && col === 'completed_at');
    expect(lt, "lt('completed_at', ...) olmalı (ay-bazlı filtre)").toBeTruthy();

    // Aralık tutarlı: gte < lt ve aynı ayın sınırları (default = current month)
    const gteVal = String(gte![2]);
    const ltVal = String(lt![2]);
    expect(new Date(gteVal).getTime()).toBeLessThan(new Date(ltVal).getTime());
    // gte ay başı: gün=01, saat=00:00
    expect(gteVal).toMatch(/-01T00:00:00/);
  });

  it('ay aralığındaki completed rotalar Rota✓ sütununda sayılır', async () => {
    setProfiles();
    // 2 tamamlanmış rota döndür (mock zaten ay-filtreli sorgunun "döndürdüğü" set)
    tableResponders['saha_routes'] = () => ({
      data: [
        { profile_id: 'rep-1', status: 'completed', completed_at: '2026-06-05T10:00:00Z' },
        { profile_id: 'rep-1', status: 'completed', completed_at: '2026-06-09T10:00:00Z' },
      ],
      error: null,
    });
    render(<RepKpiPage />, { wrapper });
    await screen.findAllByText('Ali Plasiyer');
    // Tablo satırını (rowgroup tbody) bul; Rota✓ son hücre = 2.
    // rep adı tablo hücresinde olan <tr>'yi bul.
    await waitFor(() => {
      const rows = screen.getAllByRole('row');
      // Veri satırı: içinde "Ali Plasiyer" + email geçen row
      const dataRow = rows.find(
        (r) => within(r).queryByText('ali@x.com') && within(r).queryByText('Ali Plasiyer'),
      );
      expect(dataRow, 'rep veri satırı render olmalı').toBeTruthy();
      // Son hücre Rota✓ = 2
      const cells = within(dataRow!).getAllByRole('cell');
      expect(cells[cells.length - 1]).toHaveTextContent('2');
    });
  });

  it('rep yoksa "Plasiyer bulunamadı." gösterir', async () => {
    tableResponders['profiles'] = () => ({ data: [], error: null });
    render(<RepKpiPage />, { wrapper });
    expect(await screen.findByText('Plasiyer bulunamadı.')).toBeInTheDocument();
  });
});
