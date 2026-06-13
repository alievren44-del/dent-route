/**
 * StockLedgerPage — Stok Hareketleri Defteri (READ-ONLY + append-only ledger view).
 *
 * KRİTİK: products.stock_quantity CANLI/PAYLAŞILAN e-ticaret stoğudur. Bu sayfa
 * yalnızca OKUR — hiçbir stok mutasyonu yapmaz. Satış satırları
 * handle_order_status_change trigger'ı tarafından sipariş onayında otomatik düşer.
 */

import { useQuery } from '@tanstack/react-query';
import { Package, ArrowDownUp } from 'lucide-react';

import { getTypedClient } from '@/lib/supabase';

interface ProductRef {
  name: string | null;
  sku: string | null;
}

interface StockMovementRow {
  id: string;
  quantity: number;
  type: string;
  reference_id: string | null;
  note: string | null;
  created_at: string;
  products: ProductRef | ProductRef[] | null;
}

interface ProductStockRow {
  id: string;
  name: string | null;
  sku: string | null;
  stock_quantity: number | null;
  stock_status: string | null;
}

interface LedgerData {
  movements: StockMovementRow[];
  products: ProductStockRow[];
}

const TYPE_LABELS: Record<string, string> = {
  sale: 'Satış',
  manual: 'Manuel',
  return: 'İade',
  adjust: 'Düzeltme',
};

function productRef(row: StockMovementRow): ProductRef | null {
  const p = row.products;
  if (!p) return null;
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function fetchLedger(): Promise<LedgerData> {
  const supabase = getTypedClient();

  const [movements, products] = await Promise.all([
    supabase
      .from('stock_movements')
      .select('id, quantity, type, reference_id, note, created_at, products(name, sku)')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('products')
      .select('id, name, sku, stock_quantity, stock_status')
      .eq('is_active', true)
      .order('stock_quantity')
      .limit(50),
  ]);

  if (movements.error) throw movements.error;
  if (products.error) throw products.error;

  return {
    movements: (movements.data ?? []) as StockMovementRow[],
    products: (products.data ?? []) as ProductStockRow[],
  };
}

export default function StockLedgerPage() {
  const ledgerQuery = useQuery({
    queryKey: ['admin', 'stock-ledger'],
    queryFn: fetchLedger,
  });

  const data = ledgerQuery.data;
  const movements = data?.movements ?? [];
  const products = data?.products ?? [];

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Stok Defteri</h1>
          <p className="text-xs text-slate-500">
            Append-only stok hareketleri ve mevcut stok durumu (yalnızca okuma).
          </p>
        </div>
      </header>

      {ledgerQuery.isError && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Veri yüklenemedi: {(ledgerQuery.error as Error | null)?.message ?? 'bilinmeyen hata'}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Stok Hareketleri */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <ArrowDownUp className="h-4 w-4 text-emerald-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Stok Hareketleri</h2>
              <p className="text-xs text-slate-500">
                {ledgerQuery.isLoading
                  ? 'Yükleniyor…'
                  : `Son ${movements.length} hareket · satış negatif, iade/restock pozitif`}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Tarih</th>
                  <th className="px-3 py-2">Ürün</th>
                  <th className="px-3 py-2 text-right">Miktar</th>
                  <th className="px-3 py-2">Tip</th>
                  <th className="px-3 py-2">Not</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerQuery.isLoading && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      Yükleniyor…
                    </td>
                  </tr>
                )}
                {!ledgerQuery.isLoading && movements.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      Henüz stok hareketi yok.
                    </td>
                  </tr>
                )}
                {movements.map((m) => {
                  const p = productRef(m);
                  const negative = m.quantity < 0;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">
                        {formatDateTime(m.created_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{p?.name ?? '—'}</div>
                        <div className="text-[10px] text-slate-500">{p?.sku ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`tabular-nums font-semibold ${
                            negative ? 'text-rose-600' : 'text-emerald-600'
                          }`}
                        >
                          {negative ? '' : '+'}
                          {m.quantity.toLocaleString('tr-TR')}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                          {typeLabel(m.type)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{m.note ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* Mevcut Stok */}
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <Package className="h-4 w-4 text-emerald-600" />
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Mevcut Stok</h2>
              <p className="text-xs text-slate-500">
                {ledgerQuery.isLoading
                  ? 'Yükleniyor…'
                  : 'Canlı e-ticaret stoğu (salt okunur) · düşük stok önce'}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Ürün</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2 text-right">Adet</th>
                  <th className="px-3 py-2">Durum</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ledgerQuery.isLoading && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      Yükleniyor…
                    </td>
                  </tr>
                )}
                {!ledgerQuery.isLoading && products.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                      Ürün bulunamadı.
                    </td>
                  </tr>
                )}
                {products.map((p) => {
                  const qty = p.stock_quantity ?? 0;
                  const low = qty <= 5;
                  return (
                    <tr key={p.id} className={low ? 'bg-rose-50/50' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-2 font-medium text-slate-800">{p.name ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{p.sku ?? '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`tabular-nums font-semibold ${
                            low ? 'text-rose-600' : 'text-slate-700'
                          }`}
                        >
                          {qty.toLocaleString('tr-TR')}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">{p.stock_status ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
