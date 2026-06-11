/**
 * routeBasketStore — kalıcı (localStorage) rota sepeti.
 *
 * Discovery sayfasından eklenen klinik/durak adayları burada toplanır,
 * sonra RoutePlannerPage tarafından okunup Mapbox Optimize'a gönderilir.
 *
 * Persistence: zustand/persist + localStorage key `route-basket-v1`.
 * Limit: MAX_BASKET = 12 (Mapbox Optimize sınırı + UX sade kalsın diye).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export const MAX_BASKET = 12;

export type BasketStopSource = 'saha' | 'google_places' | 'manual';

export interface BasketStop {
  /** Stable id: saha customerId, google place id veya temp_<name> */
  id: string;
  name: string;
  lat: number;
  lng: number;
  source: BasketStopSource;
  /** Opsiyonel: marker rengi resolve için */
  customerType?: string;
  address?: string;
  phone?: string;
  /** Sepete eklenme zamanı (epoch ms) — sıralama için */
  addedAt: number;
}

export type AddResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'full' };

/**
 * Bir BasketStop'un addedAt hariç tüm alanları — district kuyruğunda
 * sıralı tüm klinikleri tam veriyle taşımak için.
 */
export type QueuedStop = Omit<BasketStop, 'addedAt'>;

interface RouteBasketState {
  items: BasketStop[];

  /** İlçe (district) auto modunda sıralı TÜM klinikler (12+ dahil). */
  districtQueue: QueuedStop[];
  /** districtQueue içinde bir sonraki batch'in başlangıç index'i. */
  districtBatchStart: number;

  has(id: string): boolean;
  count(): number;
  add(stop: Omit<BasketStop, 'addedAt'>): AddResult;
  remove(id: string): void;
  clear(): void;

  /** Tüm sıralı district listesini kaydet, cursor'ı sıfırla. */
  setDistrictQueue(stops: QueuedStop[]): void;
  /** Sıradaki MAX_BASKET kliniği sepete doldur, cursor'ı ilerlet. */
  loadNextDistrictBatch(): void;
  /** Kuyrukta daha doldurulmamış klinik var mı? */
  hasNextDistrictBatch(): boolean;
  /** District kuyruğunu tamamen temizle. */
  clearDistrictQueue(): void;
}

export const useRouteBasket = create<RouteBasketState>()(
  persist(
    (set, get) => ({
      items: [],
      districtQueue: [],
      districtBatchStart: 0,

      has(id) {
        return get().items.some((s) => s.id === id);
      },

      count() {
        return get().items.length;
      },

      add(stop) {
        const items = get().items;
        if (items.some((s) => s.id === stop.id)) {
          return { ok: false, reason: 'duplicate' };
        }
        if (items.length >= MAX_BASKET) {
          return { ok: false, reason: 'full' };
        }
        const next: BasketStop = { ...stop, addedAt: Date.now() };
        set({ items: [...items, next] });
        return { ok: true };
      },

      remove(id) {
        set({ items: get().items.filter((s) => s.id !== id) });
      },

      clear() {
        set({ items: [] });
      },

      setDistrictQueue(stops) {
        set({ districtQueue: stops, districtBatchStart: 0 });
      },

      loadNextDistrictBatch() {
        const { districtQueue, districtBatchStart } = get();
        const batch = districtQueue.slice(
          districtBatchStart,
          districtBatchStart + MAX_BASKET,
        );
        const now = Date.now();
        const items: BasketStop[] = batch.map((s, i) => ({
          ...s,
          // addedAt'leri sıralı tut ki sepet sırası kuyruk sırasını korusun.
          addedAt: now + i,
        }));
        set({
          items,
          districtBatchStart: districtBatchStart + batch.length,
        });
      },

      hasNextDistrictBatch() {
        const { districtQueue, districtBatchStart } = get();
        return districtBatchStart < districtQueue.length;
      },

      clearDistrictQueue() {
        set({ districtQueue: [], districtBatchStart: 0 });
      },
    }),
    {
      name: 'route-basket-v1',
      storage: createJSONStorage(() => localStorage),
      // Sadece items + district kuyruğunu persist et — fonksiyonlar zaten her
      // render'da yeniden oluşur.
      partialize: (state) => ({
        items: state.items,
        districtQueue: state.districtQueue,
        districtBatchStart: state.districtBatchStart,
      }),
      version: 2,
    },
  ),
);
