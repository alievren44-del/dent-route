// @vitest-environment jsdom
/**
 * CollectionListPage testleri (#69).
 *
 * Kapsam:
 *  - client_id artık ham UUID input DEĞİL → picker (klinik arama input'u var)
 *  - tablo, ham UUID yerine cari/klinik adı lookup'ı (fetchClientNames) gösterir
 *  - "Yeni Tahsilat" açıldığında ham UUID metin girişi BULUNMAMALI
 *  - picker'dan seçim → form.client_id set + seçili cari adı gösterimi
 *
 * Mock: @lib/supabase (zincirlenebilir query builder), @core/auth/authStore,
 * sonner. react-query gerçek (QueryClientProvider ile sarmalanır).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- authStore mock: session.userId döndür ---
vi.mock('@core/auth/authStore', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ session: { userId: 'rep-1' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// --- Supabase mock ---
// Her .from(table) çağrısı için, table'a göre yapılandırılabilir bir zincir
// builder döndürür. Terminal çözüm `select(...).then(...)` veya doğrudan await
// üzerinden gerçekleşir; ayrıca `.in(...)`, `.ilike(...)`, `.order(...)`,
// `.limit(...)`, `.eq(...)` chainable + thenable.
type Resp = { data: unknown; error: unknown };
const tableResponders: Record<string, () => Resp> = {};

function makeBuilder(table: string) {
  const resolve = (): Resp =>
    tableResponders[table] ? tableResponders[table]() : { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const m of ['select', 'eq', 'in', 'ilike', 'order', 'limit', 'gte', 'lt', 'not']) {
    builder[m] = vi.fn(chain);
  }
  // thenable: await builder veya await builder.select(...) çalışsın
  (builder as { then: unknown }).then = (onFulfilled: (r: Resp) => unknown) =>
    Promise.resolve(resolve()).then(onFulfilled);
  // insert ayrı: { error } döner
  builder.insert = vi.fn(() => Promise.resolve({ error: null }));
  return builder;
}

const fromMock = vi.fn((table: string) => makeBuilder(table));

vi.mock('@lib/supabase', () => ({
  getSupabaseClient: () => ({ from: fromMock }),
  // #106 typed-flip: CollectionListPage artik getTypedClient kullaniyor (ayni client)
  getTypedClient: () => ({ from: fromMock }),
}));

import CollectionListPage from '@features/rep-ops/pages/CollectionListPage';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const k of Object.keys(tableResponders)) delete tableResponders[k];
});

describe('CollectionListPage', () => {
  it('boş tahsilat listesi → "Henüz tahsilat yok" gösterir', async () => {
    tableResponders['rep_collections'] = () => ({ data: [], error: null });
    render(<CollectionListPage />, { wrapper });
    expect(await screen.findByText('Henüz tahsilat yok.')).toBeInTheDocument();
  });

  it('tablo: ham UUID yerine klinik adı lookup gösterir (fetchClientNames)', async () => {
    tableResponders['rep_collections'] = () => ({
      data: [
        {
          id: 'c1',
          rep_id: 'rep-1',
          client_id: 'uuid-aaaa-bbbb',
          amount: 1500,
          method: 'CASH',
          check_number: null,
          due_date: null,
          reference_no: null,
          status: 'PENDING',
          created_at: '2026-06-01T08:00:00.000Z',
        },
      ],
      error: null,
    });
    // saha_clinics lookup → görünen ad
    tableResponders['saha_clinics'] = () => ({
      data: [{ id: 'uuid-aaaa-bbbb', name: 'Beyaz Diş Kliniği' }],
      error: null,
    });
    render(<CollectionListPage />, { wrapper });
    // Ham UUID DEĞİL, çözülen ad görünmeli
    expect(await screen.findByText('Beyaz Diş Kliniği')).toBeInTheDocument();
    expect(screen.queryByText('uuid-aaaa-bbbb')).not.toBeInTheDocument();
  });

  it('#69 regresyon: "Yeni Tahsilat" formunda ham UUID girişi YOK, picker arama input var', async () => {
    tableResponders['rep_collections'] = () => ({ data: [], error: null });
    render(<CollectionListPage />, { wrapper });
    await screen.findByText('Henüz tahsilat yok.');

    // Formu aç
    fireEvent.click(screen.getByRole('button', { name: /Yeni Tahsilat/ }));

    // Picker arama input'u olmalı (placeholder ile)
    const search = await screen.findByPlaceholderText(/Klinik adı ile ara/);
    expect(search).toBeInTheDocument();

    // "Cari / Klinik" etiketi var ama altında serbest UUID input yok:
    // tüm metin/number input'ları kontrol et — UUID için placeholder içermemeli
    const inputs = screen.getAllByRole('textbox');
    for (const el of inputs) {
      const ph = el.getAttribute('placeholder') ?? '';
      expect(ph.toLowerCase()).not.toContain('uuid');
      expect(ph.toLowerCase()).not.toContain('client_id');
    }
  });

  it('picker: arama → sonuç listesi → seçim, form.client_id set + seçili cari adı gösterilir', async () => {
    tableResponders['rep_collections'] = () => ({ data: [], error: null });
    // saha_clinics hem isim-lookup hem arama için kullanılır; arama sonucu döndür
    tableResponders['saha_clinics'] = () => ({
      data: [{ id: 'cli-99', name: 'Gülüş Dental', address: 'Çankaya' }],
      error: null,
    });
    render(<CollectionListPage />, { wrapper });
    await screen.findByText('Henüz tahsilat yok.');
    fireEvent.click(screen.getByRole('button', { name: /Yeni Tahsilat/ }));

    const search = await screen.findByPlaceholderText(/Klinik adı ile ara/);
    fireEvent.change(search, { target: { value: 'Gülüş' } });

    // debounce 300ms + query → sonuç butonu
    const option = await screen.findByText('Gülüş Dental', {}, { timeout: 2000 });
    fireEvent.click(option);

    // Seçili cari kutusu: ad + temizle butonu
    expect(await screen.findByRole('button', { name: 'Cari seçimini temizle' })).toBeInTheDocument();
    // Seçili ad emerald kutuda görünür
    const selectedBox = screen.getByRole('button', { name: 'Cari seçimini temizle' }).parentElement;
    expect(selectedBox && within(selectedBox).getByText('Gülüş Dental')).toBeTruthy();
  });
});
