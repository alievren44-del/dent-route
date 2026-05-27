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

interface RouteBasketState {
  items: BasketStop[];

  has(id: string): boolean;
  count(): number;
  add(stop: Omit<BasketStop, 'addedAt'>): AddResult;
  remove(id: string): void;
  clear(): void;
}

export const useRouteBasket = create<RouteBasketState>()(
  persist(
    (set, get) => ({
      items: [],

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
    }),
    {
      name: 'route-basket-v1',
      storage: createJSONStorage(() => localStorage),
      // Sadece items'ı persist et — fonksiyonlar zaten her render'da yeniden oluşur.
      partialize: (state) => ({ items: state.items }),
      version: 1,
    },
  ),
);
