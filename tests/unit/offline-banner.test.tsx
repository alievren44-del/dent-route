// @vitest-environment jsdom
/**
 * OfflineBanner bileşen testleri (#86 / #66).
 *
 * Kapsam:
 *  - pending(sarı) / failed(kırmızı) rozet useLiveQuery'den okunur
 *  - failed > 0 → "Tekrar Dene" butonu görünür ve retryFailed çağırır
 *  - expand → failed liste + "Kaldır" butonu (removeOp çağırır)
 *  - MOUNT'ta otomatik-retry YOK (denetmen blocker fix doğrula:
 *    mount useEffect retryFailed çağırmamalı)
 *
 * Mock stratejisi: syncQueue (listPending/listFailed/retryFailed/removeOp) ve
 * dexie-react-hooks (useLiveQuery) mock'lanır. useLiveQuery, verilen async
 * sorguyu component render anında bir kez çalıştırıp sonucu state'e koyar;
 * gerçek Dexie/IndexedDB gerektirmeden bileşenin liveQuery sonuçlarını
 * tüketmesini taklit eder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';

import type { OfflineOp } from '@core/offline/db';

// --- syncQueue mock ---
const listPending = vi.fn<[], Promise<OfflineOp[]>>();
const listFailed = vi.fn<[], Promise<OfflineOp[]>>();
const retryFailed = vi.fn<[], Promise<void>>();
const removeOp = vi.fn<[number | undefined], Promise<void>>();

vi.mock('@core/offline/syncQueue', () => ({
  listPending: () => listPending(),
  listFailed: () => listFailed(),
  retryFailed: () => retryFailed(),
  removeOp: (id: number | undefined) => removeOp(id),
}));

// --- useLiveQuery mock ---
// Gerçek dexie-react-hooks gibi: querier'ı çalıştırır, Promise sonucunu state'e
// yazar. İlk render'da undefined döner (gerçek davranış), sonra resolve eder.
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: <T,>(querier: () => Promise<T> | T) => {
    const [value, setValue] = useState<T | undefined>(undefined);
    useEffect(() => {
      let active = true;
      void Promise.resolve(querier()).then((v) => {
        if (active) setValue(v);
      });
      return () => {
        active = false;
      };
      // querier her render'da yeni referans; gerçek useLiveQuery deps'i izler.
      // Test amacıyla bir kez koşması yeterli — deps boş bırakılamaz çünkü
      // mock yeniden çalışmalı; ama testlerde mock dönüşleri sabit.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return value;
  },
}));

// lucide-react ikonları jsdom'da sorunsuz; mock gerekmez.

import { OfflineBanner } from '@components/layout/OfflineBanner';

function makeOp(over: Partial<OfflineOp> = {}): OfflineOp {
  return {
    id: 1,
    opType: 'order.create',
    payload: { id: 'abc123', account_name: 'Klinik X', total: 1500 },
    idempotencyKey: 'k1',
    createdAt: '2026-06-01T10:00:00.000Z',
    retryCount: 3,
    status: 'failed',
    lastError: 'network error',
    ...over,
  } as OfflineOp;
}

function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  setOnline(true);
  listPending.mockResolvedValue([]);
  listFailed.mockResolvedValue([]);
  retryFailed.mockResolvedValue(undefined);
  removeOp.mockResolvedValue(undefined);
  cleanup();
});

describe('OfflineBanner', () => {
  it('online + pending yok + failed yok → null render (banner gizli)', async () => {
    const { container } = render(<OfflineBanner />);
    // liveQuery resolve olduktan sonra da boş kalmalı
    await waitFor(() => expect(listFailed).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('pending > 0 (online) → sarı/mavi senkron banneri ve adet gösterir', async () => {
    listPending.mockResolvedValue([makeOp({ status: 'pending' }), makeOp({ id: 2, status: 'pending' })]);
    render(<OfflineBanner />);
    expect(await screen.findByText(/2 işlem senkronize ediliyor/)).toBeInTheDocument();
  });

  it('failed > 0 → KIRMIZI rozet "N gönderilemedi" + "Tekrar Dene" butonu', async () => {
    listFailed.mockResolvedValue([makeOp({ id: 1 }), makeOp({ id: 2 })]);
    render(<OfflineBanner />);
    expect(await screen.findByText('2 gönderilemedi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeInTheDocument();
  });

  it('failed + pending birlikte → hem kırmızı "gönderilemedi" hem sarı "bekliyor" rozeti', async () => {
    listFailed.mockResolvedValue([makeOp({ id: 1 })]);
    listPending.mockResolvedValue([makeOp({ id: 9, status: 'pending' })]);
    render(<OfflineBanner />);
    expect(await screen.findByText('1 gönderilemedi')).toBeInTheDocument();
    expect(await screen.findByText('1 bekliyor')).toBeInTheDocument();
  });

  it('"Tekrar Dene" tıklanınca retryFailed çağrılır', async () => {
    listFailed.mockResolvedValue([makeOp({ id: 1 })]);
    render(<OfflineBanner />);
    const btn = await screen.findByRole('button', { name: 'Tekrar dene' });
    fireEvent.click(btn);
    await waitFor(() => expect(retryFailed).toHaveBeenCalledTimes(1));
  });

  it('expand → failed op listesi + "Kaldır" butonu görünür, tıklanınca removeOp(id)', async () => {
    listFailed.mockResolvedValue([
      makeOp({ id: 7, opType: 'order.create', payload: { id: 'ord777', account_name: 'Klinik Y', total: 990 } }),
    ]);
    render(<OfflineBanner />);
    // Rozet butonu (expand toggle)
    const toggle = await screen.findByRole('button', { name: 'Hata listesini göster' });
    fireEvent.click(toggle);
    // Açılınca op etiketi (Sipariş) ve Kaldır butonu görünür
    expect(await screen.findByText('Sipariş')).toBeInTheDocument();
    const removeBtn = screen.getByRole('button', { name: 'Bu işlemi kuyruktan kaldır' });
    fireEvent.click(removeBtn);
    await waitFor(() => expect(removeOp).toHaveBeenCalledWith(7));
  });

  it('MOUNT regresyon kontrolü: bileşen mount olunca retryFailed OTOMATİK çağrılMAMALI', async () => {
    // Denetmen blocker fix doğrulaması: failed varken bile mount'ta auto-retry yok.
    listFailed.mockResolvedValue([makeOp({ id: 1 }), makeOp({ id: 2 })]);
    render(<OfflineBanner />);
    // Banner çiziline kadar bekle (liveQuery resolve)
    await screen.findByText('2 gönderilemedi');
    // Kısa bir bekleme penceresi: herhangi bir effect retry tetiklemesin
    await new Promise((r) => setTimeout(r, 50));
    expect(retryFailed).not.toHaveBeenCalled();
  });

  it('offline + pending → çevrim dışı uyarısı ve adet', async () => {
    setOnline(false);
    listPending.mockResolvedValue([makeOp({ id: 1, status: 'pending' })]);
    render(<OfflineBanner />);
    expect(await screen.findByText(/Çevrim dışısınız/)).toBeInTheDocument();
    expect(screen.getByText(/1 işlem bağlantı geldiğinde gönderilecek/)).toBeInTheDocument();
  });
});
