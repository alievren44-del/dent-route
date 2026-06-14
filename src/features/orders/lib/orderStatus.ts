/**
 * orderStatus — Sipariş durum tek-kaynak.
 *
 * Kanonik status değerleri ve Türkçe etiketleri ile Tailwind renk sınıfları burada
 * tanımlanır. RecentOrdersCard, SalesHubPage ve ilerde eklenecek tüm sipariş UI'ları
 * bu dosyayı tüketir; inline STATUS_LABELS / STATUS_STYLES map'leri kaldırılır.
 *
 * Kaynak: RecentOrdersCard.tsx (satır 33-55) + SalesHubPage.tsx (satır 52-74)
 * Fark:   SalesHubPage delivered→"Teslim", RecentOrdersCard→"Teslim Edildi"
 * Karar:  Kanonik "Teslim Edildi" (daha açıklayıcı).
 */

export interface OrderStatusMeta {
  /** Kullanıcıya gösterilen Türkçe etiket */
  label: string;
  /** Tailwind utility sınıfları (bg + text kombine) */
  color: string;
}

export const ORDER_STATUS: Record<string, OrderStatusMeta> = {
  draft: {
    label: 'Taslak',
    color: 'bg-gray-200 text-gray-700',
  },
  pending: {
    label: 'Beklemede',
    color: 'bg-amber-100 text-amber-800',
  },
  approval_pending: {
    label: 'Onay Bekliyor',
    color: 'bg-purple-100 text-purple-800',
  },
  approved: {
    label: 'Onaylandı',
    color: 'bg-blue-100 text-blue-800',
  },
  confirmed: {
    label: 'Onaylandı',
    color: 'bg-blue-100 text-blue-800',
  },
  rejected: {
    label: 'Reddedildi',
    color: 'bg-red-100 text-red-800',
  },
  shipped: {
    label: 'Kargoda',
    color: 'bg-indigo-100 text-indigo-800',
  },
  delivered: {
    label: 'Teslim Edildi',
    color: 'bg-green-100 text-green-800',
  },
  cancelled: {
    label: 'İptal',
    color: 'bg-red-100 text-red-800',
  },
};

/**
 * Verilen status string'i için OrderStatusMeta döner.
 * Bilinmeyen değerlerde fallback: label=status, color='bg-gray-100 text-gray-600'.
 */
export function orderStatusMeta(status: string): OrderStatusMeta {
  const key = status.toLowerCase();
  return (
    ORDER_STATUS[key] ?? {
      label: status,
      color: 'bg-gray-100 text-gray-600',
    }
  );
}
