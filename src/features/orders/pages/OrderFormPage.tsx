/**
 * OrderFormPage — Yeni sipariş oluşturma ekranı.
 *
 * URL: /orders/new?customerId=:id
 * - Müşteri seçici (customerId yoksa autocomplete profiles)
 * - Ürün arama + sepete ekleme
 * - Sepet: miktar +/-, satır toplamı, sil
 * - Toplamlar: subtotal + KDV + grandTotal (adapter.quoteOrder)
 * - Notlar + sticky CTA submit
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus, Minus, Trash2, ShoppingCart, X, Check, AlertTriangle } from 'lucide-react';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import { getSupabaseClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import type { NewOrderItem, Product } from '@core/adapters/types';
import { needsApproval, nextApproverRole, thresholdFor } from '@features/orders/lib/approvalRules';

const adapter = new SupabaseCRMAdapter();

interface CartItem extends NewOrderItem {
  productName: string;
  unitPriceSnapshot: number;
}

interface CustomerOption {
  id: string;
  ad_soyad: string | null;
  klinik_adi: string | null;
  email: string | null;
  city: string | null;
}

function formatTL(n: number): string {
  return n.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  });
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return debounced;
}

function OrderFormPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  // Hem ?customerId hem ?customer_id desteklenir (diğer feature'lar customer_id kullanıyor).
  const initialCustomerId = searchParams.get('customerId') ?? searchParams.get('customer_id') ?? '';
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const userRole = String(profile?.role ?? 'USER').toUpperCase();

  const [customerId, setCustomerId] = useState<string>(initialCustomerId);
  const [customerLabel, setCustomerLabel] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [customerPickerOpen, setCustomerPickerOpen] = useState<boolean>(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [productSearch, setProductSearch] = useState<string>('');
  const [productListOpen, setProductListOpen] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedProductSearch = useDebounced(productSearch, 300);
  const debouncedCustomerSearch = useDebounced(customerSearch, 300);

  // Initial customer label
  useQuery({
    queryKey: ['order-form-customer', initialCustomerId],
    enabled: !!initialCustomerId,
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, ad_soyad, klinik_adi, email')
        .eq('id', initialCustomerId)
        .maybeSingle();
      if (err) throw err;
      const row = (data ?? null) as CustomerOption | null;
      if (row) {
        setCustomerLabel(row.klinik_adi ?? row.ad_soyad ?? row.email ?? row.id);
      }
      return row;
    },
  });

  // Customer autocomplete
  const { data: customerOptions, isFetching: customerSearching } = useQuery({
    queryKey: ['order-form-customer-search', debouncedCustomerSearch],
    enabled: customerPickerOpen && debouncedCustomerSearch.trim().length >= 2,
    queryFn: async (): Promise<CustomerOption[]> => {
      const supabase = getSupabaseClient();
      const term = `%${debouncedCustomerSearch}%`;
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, ad_soyad, klinik_adi, email, city')
        .or(`klinik_adi.ilike.${term},ad_soyad.ilike.${term},email.ilike.${term}`)
        .limit(20);
      if (err) throw err;
      return (data ?? []) as CustomerOption[];
    },
  });

  // Product search
  const { data: productOptions, isFetching: productSearching } = useQuery({
    queryKey: ['order-form-product-search', debouncedProductSearch],
    enabled: productListOpen && debouncedProductSearch.trim().length >= 2,
    queryFn: () => adapter.searchProducts(debouncedProductSearch, 20),
  });

  // Quote
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
    queryKey: ['order-form-quote', quoteItems, customerId],
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
    setCart((prev) => {
      const next = prev
        .map((it) =>
          it.productId === productId ? { ...it, quantity: Math.max(0, it.quantity + delta) } : it,
        )
        .filter((it) => it.quantity > 0);
      return next;
    });
  }

  function removeItem(productId: string): void {
    setCart((prev) => prev.filter((it) => it.productId !== productId));
  }

  function pickCustomer(c: CustomerOption): void {
    setCustomerId(c.id);
    setCustomerLabel(c.klinik_adi ?? c.ad_soyad ?? c.email ?? c.id);
    setCustomerPickerOpen(false);
    setCustomerSearch('');
  }

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (!customerId) {
      setError('Müşteri seçiniz.');
      return;
    }
    if (cart.length === 0) {
      setError('En az bir ürün ekleyiniz.');
      return;
    }
    setSubmitting(true);
    try {
      const idempotencyKey = `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const items: NewOrderItem[] = cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        ...(c.unitPriceOverride !== undefined ? { unitPriceOverride: c.unitPriceOverride } : {}),
      }));
      const created = await adapter.createOrder({
        customerId,
        items,
        notes: notes.trim() || undefined,
        idempotencyKey,
      });

      // Onay gerekirse: status'u 'approval_pending' olarak güncelle ve notify.
      if (requiresApproval) {
        const supabase = getSupabaseClient();
        const { error: updErr } = await supabase
          .from('orders')
          .update({ status: 'approval_pending', idempotency_key: idempotencyKey })
          .eq('id', created.id);
        if (updErr) {
          console.warn('[OrderFormPage] approval_pending status set edilemedi:', updErr.message);
        }

        // Notifications tablosuna kayıt — şema farklı olabilir (recipient_role kolonu
        // bizim Parla baseline'da yok; user_id + type + title + message kullanır).
        try {
          const message = `Yeni onay bekleyen sipariş: ${created.externalId ?? created.id.slice(0, 8)} — ${grandTotal.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}`;
          const { error: notErr } = await supabase.from('notifications').insert({
            type: 'new_order',
            title: 'Onay bekleyen sipariş',
            message,
            data: {
              ref_id: created.id,
              recipient_role: approverRole ?? 'ADMIN',
              total: grandTotal,
              sales_rep_id: profile?.id ?? null,
            },
          });
          if (notErr) {
            console.warn('[OrderFormPage] notifications insert atlandı:', notErr.message);
          }
        } catch (notErr) {
          console.warn('[OrderFormPage] notifications tablosu yok / hata:', notErr);
        }
      }

      navigate(`/clinics/${customerId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sipariş oluşturulamadı.');
    } finally {
      setSubmitting(false);
    }
  }

  const subtotal = quote?.subtotal ?? 0;
  const vatTotal = quote?.vatTotal ?? 0;
  const grandTotal = quote?.grandTotal ?? 0;

  // Onay eşik kontrolü (Sprint 2 / PROMPT-15)
  const requiresApproval = needsApproval(grandTotal, userRole);
  const approvalLimit = thresholdFor(userRole);
  const approverRole = nextApproverRole(userRole);

  return (
    <div className="flex flex-col min-h-full pb-32">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-20">
        <h1 className="text-lg font-semibold text-foreground">Yeni Sipariş</h1>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Müşteri seçici */}
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Müşteri</label>
          {customerId && !customerPickerOpen ? (
            <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border bg-card">
              <p className="text-sm font-medium text-foreground truncate">
                {customerLabel || customerId}
              </p>
              <button
                type="button"
                onClick={() => {
                  setCustomerId('');
                  setCustomerLabel('');
                  setCustomerPickerOpen(true);
                }}
                className="text-xs text-primary font-medium px-2 py-1 min-h-tap-min"
              >
                Değiştir
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setCustomerPickerOpen(true);
                  }}
                  onFocus={() => setCustomerPickerOpen(true)}
                  placeholder="Müşteri ara (min 2 karakter)…"
                  className="flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              {customerPickerOpen && debouncedCustomerSearch.trim().length >= 2 && (
                <div className="mt-1 rounded-lg border border-border bg-card shadow-lg max-h-72 overflow-y-auto">
                  {customerSearching && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Aranıyor…</p>
                  )}
                  {!customerSearching && (customerOptions ?? []).length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok.</p>
                  )}
                  {(customerOptions ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="w-full text-left px-3 py-2.5 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0"
                    >
                      <p className="text-sm font-medium text-foreground truncate">
                        {c.klinik_adi ?? c.ad_soyad ?? c.email ?? c.id}
                      </p>
                      {c.city && <p className="text-xs text-muted-foreground truncate">{c.city}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Ürün ekleme */}
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Ürün Ekle
          </label>
          <div className="relative">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card">
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
                  className="p-1 -mr-1 min-h-tap-min min-w-tap-min flex items-center justify-center"
                  aria-label="Temizle"
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              )}
            </div>
            {productListOpen && debouncedProductSearch.trim().length >= 2 && (
              <div className="mt-1 rounded-lg border border-border bg-card shadow-lg max-h-80 overflow-y-auto">
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
                    className="w-full text-left px-3 py-2.5 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      {p.sku && (
                        <p className="text-xs text-muted-foreground truncate">SKU: {p.sku}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
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
          <h2 className="text-sm font-semibold text-foreground mb-2">Sepet ({cart.length})</h2>
          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center border border-dashed border-border rounded-lg">
              Henüz ürün yok.
            </p>
          ) : (
            <div className="space-y-2">
              {cart.map((it) => {
                const quoted = quote?.items.find((q) => q.productId === it.productId);
                const unitPrice = quoted?.unitPrice ?? it.unitPriceSnapshot;
                const lineTotal = quoted?.lineTotal ?? unitPrice * it.quantity;
                return (
                  <div key={it.productId} className="p-3 rounded-lg border border-border bg-card">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">
                        {it.productName}
                      </p>
                      <button
                        type="button"
                        onClick={() => removeItem(it.productId)}
                        className="p-1.5 -m-1.5 rounded-full hover:bg-muted text-red-600 min-h-tap-min min-w-tap-min flex items-center justify-center"
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
                          className="h-9 w-9 rounded-full border border-border flex items-center justify-center hover:bg-muted min-h-tap-min min-w-tap-min"
                          aria-label="Azalt"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="text-sm font-semibold min-w-[2ch] text-center">
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(it.productId, 1)}
                          className="h-9 w-9 rounded-full border border-border flex items-center justify-center hover:bg-muted min-h-tap-min min-w-tap-min"
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
          <section className="rounded-xl border border-border bg-card p-4 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Ara Toplam</span>
              <span className="font-medium text-foreground">{formatTL(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">KDV (%20)</span>
              <span className="font-medium text-foreground">{formatTL(vatTotal)}</span>
            </div>
            <div className="border-t border-border pt-1.5 mt-1.5 flex items-center justify-between">
              <span className="text-base font-semibold text-foreground">Genel Toplam</span>
              <span className="text-lg font-bold text-primary">{formatTL(grandTotal)}</span>
            </div>
          </section>
        )}

        {/* Onay eşiği uyarısı (Sprint 2 / PROMPT-15) */}
        {cart.length > 0 && requiresApproval && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="min-w-0 text-amber-900">
              <p className="text-sm font-semibold">Bu sipariş onay bekleyecek</p>
              <p className="text-xs mt-0.5">
                Toplam {formatTL(grandTotal)}{' '}
                {Number.isFinite(approvalLimit) ? (
                  <> senin {formatTL(approvalLimit)} TL eşiğini aşıyor.</>
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
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Notlar</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="İsteğe bağlı sipariş notu…"
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        </section>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </div>

      {/* Sticky bottom CTA */}
      <div className="fixed bottom-16 left-0 right-0 px-4 pb-3 pt-2 bg-gradient-to-t from-background via-background to-transparent z-20">
        <button
          type="button"
          onClick={() => {
            void handleSubmit();
          }}
          disabled={submitting || cart.length === 0 || !customerId}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg min-h-tap-min disabled:opacity-50"
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
          {cart.length === 0 && !submitting && <ShoppingCart className="h-5 w-5 hidden" />}
        </button>
      </div>
    </div>
  );
}

export default OrderFormPage;
