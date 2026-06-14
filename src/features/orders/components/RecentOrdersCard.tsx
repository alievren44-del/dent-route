/**
 * RecentOrdersCard — Müşteriye ait son N siparişi listeleyen kart.
 *
 * Props:
 *   - customerId: orders.user_id (Parla profile.id ile aynı)
 *   - limit?: number = 5
 *
 * CustomerDetailPage'in "Son Siparişler" bölümünde kullanılır.
 * Tüm siparişler için /orders/history?customer_id= linki verilir.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ShoppingBag } from 'lucide-react';

import { getTypedClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';
import { orderStatusMeta } from '@features/orders/lib/orderStatus';

interface RecentOrdersCardProps {
  customerId: string;
  limit?: number;
}

interface OrderRow {
  id: string;
  order_number: string | null;
  total: number | string | null;
  total_amount: number | string | null;
  status: string | null;
  created_at: string | null;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

async function fetchRecentOrders(customerId: string, limit: number): Promise<OrderRow[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, total, total_amount, status, created_at')
    .eq('user_id', customerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as OrderRow[];
}

export function RecentOrdersCard({ customerId, limit = 5 }: RecentOrdersCardProps): JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['recent-orders', customerId, limit],
    enabled: Boolean(customerId),
    queryFn: () => fetchRecentOrders(customerId, limit),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          Son Siparişler
        </h3>
        <Link
          to={`/orders/history?customer_id=${customerId}`}
          className="text-xs text-primary font-medium flex items-center gap-0.5 px-2 py-1 min-h-tap-min"
        >
          Tümü
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoading && (
        <div className="space-y-2" aria-label="Yükleniyor">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {isError && <p className="text-sm text-red-600 py-3 text-center">Siparişler yüklenemedi.</p>}

      {!isLoading && !isError && (data ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground py-4 text-center">Henüz sipariş yok.</p>
      )}

      {!isLoading && !isError && (data ?? []).length > 0 && (
        <ul className="divide-y divide-border -mx-1">
          {(data ?? []).map((o) => {
            const statusStr = String(o.status ?? '');
            const meta = orderStatusMeta(statusStr);
            const total = Number(o.total ?? o.total_amount ?? 0);
            return (
              <li key={o.id} className="px-1 py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {o.order_number ?? `#${o.id.slice(0, 8)}`}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(o.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                    <span className="text-sm font-semibold text-foreground">
                      {formatTRY(total)}
                    </span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.color}`}
                    >
                      {meta.label}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default RecentOrdersCard;
