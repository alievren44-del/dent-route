/**
 * InlineOrderSheet — Takvim/ziyaret akışında "Sipariş Alındı" sonrası ürün+fiyat
 * girişini AYNI ekranda (bottom-sheet) yapmayı sağlar. Ayrı "Yeni Sipariş" sayfasına
 * gitmeden sipariş oluşturulur.
 *
 * PARA GÜVENLİĞİ (kritik): fiyat/vergi client'ta HESAPLANMAZ. Tüm fiyatlandırma
 * OrderFormPage ile AYNI yol üzerinden gider:
 *  - Görsel toplamlar: adapter.quoteOrder (server v_saha_products fiyatları).
 *  - Gönderim (online): adapter.createOrder — DB'den yeniden fiyatlar, order_items
 *    yazar, idempotency_key ile çift-insert'i önler, ve saha_clinics için
 *    saha_get_or_create_cari_for_clinic RPC ile cariyi OTOMATİK (idempotent) açar.
 *  - Gönderim (offline/ağ hatası): enqueueOp('order.create', ...) — syncQueue replay'i
 *    yine adapter.createOrder'dan geçer (client snapshot'una güvenilmez).
 *
 * Yani "cariye ekle" ayrıca yapılmaz — createOrder içinde idempotent olarak olur.
 * Bu bileşen fiyat mantığını YENİDEN YAZMAZ; yalnızca ön-seçili müşteri için ince
 * bir sepet UI'si sunar.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Minus, Trash2, X, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import { invalidateOrderDomain } from '@lib/queryKeys';
import { useAuthStore } from '@core/auth/authStore';
import type { NewOrderItem, Product } from '@core/adapters/types';
import { needsApproval, nextApproverRole, thresholdFor } from '@features/orders/lib/approvalRules';
import { enqueueOp } from '@core/offline/syncQueue';
import { getTypedClient } from '@lib/supabase';

const adapter = new SupabaseCRMAdapter();

interface CartItem extends NewOrderItem {
  productName: string;
  unitPriceSnapshot: number;
}

function formatTL(n: number): string {
  return n.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  });
}

export function InlineOrderSheet(props: {
  /** Ön-seçili müşteri (saha_clinics id). createOrder cariyi otomatik açar. */
  customerId: string;
  customerName: string;
  onClose: () => void;
  /** Sipariş oluşturulduğunda (online veya kuyruğa alındığında) çağrılır. */
  onCreated?: () => void;
}): JSX.Element {
  const { customerId, customerName, onClose, onCreated } = props;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
  const userRole = String(profile?.role ?? 'USER').toUpperCase();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [productSearch, setProductSearch] = useState<string>('');
  const [productListOpen, setProductListOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Basit debounce — OrderFormPage 300ms deseni.
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(productSearch), 300);
    return () => clearTimeout(h);
  }, [productSearch]);

  const { data: productOptions, isFetching: productSearching } = useQuery({
    queryKey: ['inline-order-product-search', debouncedSearch],
    enabled: productListOpen && debouncedSearch.trim().length >= 2,
    queryFn: () => adapter.searchProducts(debouncedSearch, 20),
  });

  // Server-side quote — görsel toplam için TEK fiyat kaynağı.
  const quoteItems = useMemo<NewOrderItem[]>(
    () =>
      cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        ...(c.unitPriceOverride !== undefined ? { unitPriceOverride: c.unitPriceOverride } : {}),
      })),
    [cart],
  );
  const { data: quote } = useQuery({
    queryKey: ['inline-order-quote', quoteItems, customerId],
    enabled: cart.length > 0 && !!customerId,
    queryFn: () => adapter.quoteOrder(quoteItems, customerId),
  });

  function addToCart(p: Product): void {
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        const existing = next[idx]!;
        next[idx] = { ...existing, quantity: existing.quantity + 1 };
        return next;
      }
      return [
        ...prev,
        {
          productId: p.id,
          quantity: 1,
          productName: p.name,
          unitPriceSnapshot: p.basePrice ?? 0,
        },
      ];
    });
    setProductSearch('');
    setProductListOpen(false);
  }

  function updateQty(productId: string, delta: number): void {
    setCart((prev) =>
      prev
        .map((it) =>
          it.productId === productId ? { ...it, quantity: Math.max(0, it.quantity + delta) } : it,
        )
        .filter((it) => it.quantity > 0),
    );
  }

  function removeItem(productId: string): void {
    setCart((prev) => prev.filter((it) => it.productId !== productId));
  }

  const subtotal = quote?.subtotal ?? 0;
  const vatTotal = quote?.vatTotal ?? 0;
  const grandTotal = quote?.grandTotal ?? 0;

  const requiresApproval = needsApproval(grandTotal, userRole);
  const approvalLimit = thresholdFor(userRole);
  const approverRole = nextApproverRole(userRole);

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (cart.length === 0) {
      setError('En az bir ürün ekleyiniz.');
      return;
    }
    setSubmitting(true);

    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // OrderFormPage ile birebir aynı offline payload — replay adapter.createOrder'dan geçer.
    const offlinePayload: Record<string, unknown> = {
      idempotency_key: idempotencyKey,
      customer_id: customerId,
      notes: notes.trim() || null,
      items: cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        unitPriceSnapshot: c.unitPriceSnapshot,
        ...(c.unitPriceOverride !== undefined ? { unitPriceOverride: c.unitPriceOverride } : {}),
      })),
      subtotal_snapshot: subtotal,
      grand_total_snapshot: grandTotal,
      requires_approval: requiresApproval,
      sales_rep_id: profile?.id ?? null,
    };

    if (!navigator.onLine) {
      try {
        await enqueueOp('order.create', offlinePayload, idempotencyKey);
        toast.success('Sipariş kaydedildi — bağlantı geldiğinde gönderilecek');
        onCreated?.();
        onClose();
      } catch {
        setError('Sipariş çevrim dışı kuyruğa eklenemedi.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    try {
      const items: NewOrderItem[] = cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        ...(c.unitPriceOverride !== undefined ? { unitPriceOverride: c.unitPriceOverride } : {}),
      }));
      // createOrder: DB'den yeniden fiyatlar + cariyi otomatik (idempotent) açar.
      const created = await adapter.createOrder({
        customerId,
        items,
        notes: notes.trim() || undefined,
        idempotencyKey,
        requiresApproval,
      });

      // Onay gerekiyorsa yöneticilere bildirim fan-out (OrderFormPage deseni).
      if (requiresApproval) {
        try {
          const supabase = getTypedClient();
          const message = `Yeni onay bekleyen sipariş: ${created.externalId ?? created.id.slice(0, 8)} — ${formatTL(grandTotal)}`;
          const recipientRoles = Array.from(
            new Set([approverRole ?? 'ADMIN', 'ADMIN'].flatMap((r) => [r, r.toLowerCase()])),
          );
          const { data: recipients } = await supabase
            .from('profiles')
            .select('id')
            .in('role', recipientRoles);
          const recipientIds = (recipients ?? [])
            .map((r) => (r as { id: string }).id)
            .filter((id): id is string => Boolean(id));
          if (recipientIds.length > 0) {
            const rows = recipientIds.map((uid) => ({
              user_id: uid,
              type: 'order_approval' as const,
              title: 'Onay bekleyen sipariş',
              body: message,
              payload: {
                order_id: created.id,
                total: grandTotal,
                sales_rep_id: profile?.id ?? null,
              },
            }));
            const { error: notErr } = await supabase.from('saha_notifications').insert(rows);
            if (notErr) {
              console.warn('[InlineOrderSheet] saha_notifications fan-out atlandı:', notErr.message);
            }
          }
        } catch (notErr) {
          console.warn('[InlineOrderSheet] bildirim fan-out hatası:', notErr);
        }
      }

      void invalidateOrderDomain(queryClient);
      toast.success(requiresApproval ? 'Sipariş onaya gönderildi' : 'Sipariş oluşturuldu');
      onCreated?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        !navigator.onLine;
      if (isNetworkError) {
        try {
          await enqueueOp('order.create', offlinePayload, idempotencyKey);
          toast.success('Bağlantı hatası — sipariş kaydedildi, bağlantı geldiğinde gönderilecek');
          onCreated?.();
          onClose();
          return;
        } catch {
          setError('Sipariş çevrim dışı kuyruğa eklenemedi.');
          return;
        }
      }
      setError(msg || 'Sipariş oluşturulamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Sipariş oluştur"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-background shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Sipariş Oluştur</h2>
            <p className="truncate text-xs text-muted-foreground">{customerName}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted" aria-label="Kapat">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Ürün ekleme */}
          <section>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Ürün Ekle
            </label>
            <div className="relative">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setProductListOpen(true);
                  }}
                  onFocus={() => setProductListOpen(true)}
                  placeholder="Ürün ara (min 2 karakter)…"
                  className="flex-1 bg-transparent text-sm outline-none"
                />
                {productSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setProductSearch('');
                      setProductListOpen(false);
                    }}
                    className="min-h-tap-min min-w-tap-min -mr-1 flex items-center justify-center p-1"
                    aria-label="Temizle"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                )}
              </div>
              {productListOpen && debouncedSearch.trim().length >= 2 && (
                <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                  {productSearching && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Aranıyor…</p>
                  )}
                  {!productSearching && (productOptions ?? []).length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok.</p>
                  )}
                  {(productOptions ?? []).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => addToCart(p)}
                      className="min-h-tap-min flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                        {p.sku && (
                          <p className="truncate text-xs text-muted-foreground">SKU: {p.sku}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {formatTL(p.basePrice ?? 0)}
                        </span>
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Sepet */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Sepet ({cart.length})</h3>
            {cart.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Henüz ürün yok.
              </p>
            ) : (
              <div className="space-y-2">
                {cart.map((it) => {
                  const quoted = quote?.items.find((q) => q.productId === it.productId);
                  const unitPrice = quoted?.unitPrice ?? it.unitPriceSnapshot;
                  const lineTotal = quoted?.lineTotal ?? unitPrice * it.quantity;
                  return (
                    <div key={it.productId} className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {it.productName}
                        </p>
                        <button
                          type="button"
                          onClick={() => removeItem(it.productId)}
                          className="min-h-tap-min min-w-tap-min -m-1.5 flex items-center justify-center rounded-full p-1.5 text-red-600 hover:bg-muted"
                          aria-label="Sil"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateQty(it.productId, -1)}
                            className="min-h-tap-min min-w-tap-min flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted"
                            aria-label="Azalt"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span className="min-w-[2ch] text-center text-sm font-semibold">
                            {it.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateQty(it.productId, 1)}
                            className="min-h-tap-min min-w-tap-min flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted"
                            aria-label="Arttır"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">
                            {formatTL(unitPrice)} × {it.quantity}
                          </p>
                          <p className="text-sm font-semibold text-foreground">
                            {formatTL(lineTotal)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Toplamlar */}
          {cart.length > 0 && (
            <section className="space-y-1.5 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Ara Toplam</span>
                <span className="font-medium text-foreground">{formatTL(subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">KDV</span>
                <span className="font-medium text-foreground">{formatTL(vatTotal)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between border-t border-border pt-1.5">
                <span className="text-base font-semibold text-foreground">Genel Toplam</span>
                <span className="text-lg font-bold text-primary">{formatTL(grandTotal)}</span>
              </div>
            </section>
          )}

          {/* Onay eşiği uyarısı */}
          {cart.length > 0 && requiresApproval && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
              <div className="min-w-0 text-amber-900">
                <p className="text-sm font-semibold">Bu sipariş onay bekleyecek</p>
                <p className="mt-0.5 text-xs">
                  Toplam {formatTL(grandTotal)}{' '}
                  {Number.isFinite(approvalLimit) ? (
                    <> senin {formatTL(approvalLimit)} eşiğini aşıyor.</>
                  ) : (
                    <> onay gerektiriyor.</>
                  )}
                  {approverRole && <> {approverRole} onayına gönderilecek.</>}
                </p>
              </div>
            </div>
          )}

          {/* Notlar */}
          <section>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Notlar</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="İsteğe bağlı sipariş notu…"
              className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </section>

          {error && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Ayrı sayfada aç — gelişmiş (şablon vb.) için kaçış yolu */}
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate(`/orders/new?customerId=${customerId}`);
            }}
            className="w-full text-center text-xs text-muted-foreground underline"
          >
            Gelişmiş sipariş ekranında aç
          </button>
        </div>

        {/* Sticky submit */}
        <div className="border-t border-border bg-background px-4 py-3">
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || cart.length === 0}
            className="min-h-tap-min flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground shadow-lg disabled:opacity-50"
          >
            {submitting ? (
              <>Gönderiliyor…</>
            ) : (
              <>
                <Check className="h-5 w-5" />
                {requiresApproval ? 'Onaya Gönder' : 'Sipariş Oluştur'}
                {cart.length > 0 && (
                  <span className="ml-1 text-xs opacity-90">({formatTL(grandTotal)})</span>
                )}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default InlineOrderSheet;
