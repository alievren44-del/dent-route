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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingCart,
  X,
  Check,
  AlertTriangle,
  Bookmark,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { SupabaseCRMAdapter } from '@core/adapters/builtin/SupabaseCRMAdapter';
import { getTypedClient } from '@lib/supabase';
import { invalidateOrderDomain } from '@lib/queryKeys';
import type { Json } from '@/types/database.types';
import { useAuthStore } from '@core/auth/authStore';
import type { NewOrderItem, Product, ProductVariant } from '@core/adapters/types';
import { needsApproval, nextApproverRole, thresholdFor } from '@features/orders/lib/approvalRules';
import { enqueueOp } from '@core/offline/syncQueue';
import QueryErrorState from '@components/common/QueryErrorState';

const adapter = new SupabaseCRMAdapter();

interface CartItem extends NewOrderItem {
  productName: string;
  unitPriceSnapshot: number;
  /** Seçilen varyantın sku'su (varsa) — Sepet etiketinde gösterilir. */
  variantSku?: string;
  /** Kısa varyant etiketi ("SKU 801 · ISO 220 · 0,15") — Sepet satırında ürün adı altında. */
  variantLabel?: string;
}

interface TemplateLine {
  product_id: string;
  product_name: string;
  qty: number;
  unit_price: number;
}

interface OrderTemplate {
  id: string;
  name: string;
  lines: TemplateLine[];
}

interface CustomerOption {
  /** 'clinic' → saha_clinics kaydı; 'cari' → saha_cariler (muhasebe cari) kaydı. */
  kind: 'clinic' | 'cari';
  id: string;
  /** Görünen ad (klinik adı / cari fatura ünvanı). */
  name: string;
  /** Alt satır — klinikte adres/şehir, caride cari_kodu. */
  subtitle: string | null;
}

function formatTL(n: number): string {
  return n.toLocaleString('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: 2,
  });
}

/** Sepet satır anahtarı — aynı ürünün farklı varyantları ayrı satır olsun diye. */
function lineKey(productId: string, variantId?: string): string {
  return `${productId}::${variantId ?? ''}`;
}

/**
 * Kısa varyant etiketi: sku + öne çıkan öznitelikler (iso / tipSize / grit / packaging),
 * yalnız dolu olanlar kompakt biçimde. Örn: "SKU 801 · ISO 220 · 0,15".
 */
function variantLabel(v: ProductVariant): string {
  const a = v.attributes ?? {};
  const pick = (k: string): string | undefined => {
    const val = a[k];
    return val == null || val === '' ? undefined : String(val);
  };
  const iso = pick('iso');
  const parts = [
    v.sku ? `SKU ${v.sku}` : undefined,
    iso ? `ISO ${iso}` : undefined,
    pick('tipSize'),
    pick('grit'),
    pick('packaging'),
  ].filter(Boolean);
  return parts.join(' · ') || 'Varyant';
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
  // Seçilen müşterinin türü — 'cari' ise submit'te adapter'a cariId geçilir.
  // Başlangıç/legacy (initialCustomerId) klinik/profil yolu 'clinic' say.
  const [customerKind, setCustomerKind] = useState<'clinic' | 'cari'>('clinic');
  const [customerLabel, setCustomerLabel] = useState<string>('');
  const [customerSearch, setCustomerSearch] = useState<string>('');
  const [customerPickerOpen, setCustomerPickerOpen] = useState<boolean>(false);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState<string>('');
  const [productSearch, setProductSearch] = useState<string>('');
  const [productListOpen, setProductListOpen] = useState<boolean>(false);
  // Çok-varyantlı ürün seçilince açılan varyant seçici (inline expansion).
  const [variantPickFor, setVariantPickFor] = useState<Product | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const debouncedProductSearch = useDebounced(productSearch, 300);
  const debouncedCustomerSearch = useDebounced(customerSearch, 300);

  // Initial customer label — önce klinik (yeni akış), bulunamazsa profil (eski akış).
  useQuery({
    queryKey: ['order-form-customer', initialCustomerId],
    enabled: !!initialCustomerId,
    queryFn: async () => {
      const supabase = getTypedClient();
      const { data: clinic } = await supabase
        .from('saha_clinics')
        .select('id, name')
        .eq('id', initialCustomerId)
        .maybeSingle();
      if (clinic?.id) {
        setCustomerLabel((clinic as { name: string | null }).name ?? clinic.id);
        return clinic;
      }
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, ad_soyad, klinik_adi, email')
        .eq('id', initialCustomerId)
        .maybeSingle();
      if (prof) {
        const p = prof as {
          id: string;
          ad_soyad: string | null;
          klinik_adi: string | null;
          email: string | null;
        };
        setCustomerLabel(p.klinik_adi ?? p.ad_soyad ?? p.email ?? p.id);
      }
      return prof;
    },
  });

  // Müşteri arama — saha_clinics (3116 klinik) üzerinde isimle.
  const { data: customerOptions, isFetching: customerSearching } = useQuery({
    queryKey: ['order-form-customer-search', debouncedCustomerSearch],
    enabled: customerPickerOpen && debouncedCustomerSearch.trim().length >= 2,
    queryFn: async (): Promise<CustomerOption[]> => {
      const supabase = getTypedClient();
      const term = `%${debouncedCustomerSearch}%`;
      const { data, error: err } = await supabase
        .from('saha_clinics')
        .select('id, name, address')
        .ilike('name', term)
        .order('name')
        .limit(20);
      if (err) throw err;
      const rows = (data ?? []) as Array<{
        id: string;
        name: string | null;
        address: string | null;
      }>;
      return rows.map((r) => ({
        kind: 'clinic' as const,
        id: r.id,
        name: r.name ?? 'İsimsiz klinik',
        subtitle: r.address,
      }));
    },
  });

  // Müşteri arama — saha_cariler (muhasebe carileri) üzerinde fatura_unvani/cari_kodu ile.
  // RLS carileri temsilcinin kendine kısıtlar (bypass yok). Klinik-siz cariler için
  // sipariş açmayı mümkün kılar — RPC orders.user_id'yi cari.profile_id'den çözer.
  const { data: cariOptions, isFetching: cariSearching } = useQuery({
    queryKey: ['order-form-cari-search', debouncedCustomerSearch],
    enabled: customerPickerOpen && debouncedCustomerSearch.trim().length >= 2,
    queryFn: async (): Promise<CustomerOption[]> => {
      const supabase = getTypedClient();
      const term = `%${debouncedCustomerSearch}%`;
      const { data, error: err } = await supabase
        .from('saha_cariler')
        .select('id, cari_kodu, fatura_unvani, profile_id')
        .or(`fatura_unvani.ilike.${term},cari_kodu.ilike.${term}`)
        .limit(10);
      if (err) throw err;
      const rows = (data ?? []) as Array<{
        id: string;
        cari_kodu: string | null;
        fatura_unvani: string | null;
        profile_id: string | null;
      }>;
      return rows.map((r) => ({
        kind: 'cari' as const,
        id: r.id,
        name: r.fatura_unvani ?? r.cari_kodu ?? 'İsimsiz cari',
        subtitle: r.cari_kodu,
      }));
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
        ...(c.variantId ? { variantId: c.variantId } : {}),
        // quoteOrder varyant fiyatını product_id'den çözemez (base/sale price döner) →
        // varyant seçili satırda görsel toplam için varyant fiyatını override geçir.
        // (createOrder bu override'ı KASITEN atar; sunucu variant_id'den yeniden çözer.)
        ...(c.unitPriceOverride !== undefined
          ? { unitPriceOverride: c.unitPriceOverride }
          : c.variantId
            ? { unitPriceOverride: c.unitPriceSnapshot }
            : {}),
      })),
    [cart],
  );
  // KRİTİK: sessizce hata verirse subtotal/vatTotal/grandTotal aşağıda 0'a
  // düşer — kullanıcı ₺0 toplamlı bir sipariş gönderebilir ve onay-eşiği
  // kontrolü (needsApproval) yanlışlıkla atlanabilir. isError açıkça gösterilir.
  const {
    data: quote,
    isError: quoteIsError,
    error: quoteError,
    refetch: refetchQuote,
  } = useQuery({
    queryKey: ['order-form-quote', quoteItems, customerId],
    enabled: cart.length > 0 && !!customerId,
    queryFn: () => adapter.quoteOrder(quoteItems, customerId),
  });

  // Hazır şablonlar (rep kendi / admin hepsi — RLS).
  const repId = profile?.id ?? null;
  const queryClient = useQueryClient();
  const { data: templates } = useQuery({
    queryKey: ['order-templates', repId],
    enabled: Boolean(repId),
    queryFn: async (): Promise<OrderTemplate[]> => {
      const supabase = getTypedClient();
      const { data, error: err } = await supabase
        .from('saha_order_templates')
        .select('id, name, lines')
        .order('name');
      if (err) return [];
      // lines DB'de jsonb (Json) — uygulama TemplateLine[] olarak saklar/okur.
      return (data ?? []) as unknown as OrderTemplate[];
    },
  });

  async function saveTemplate(): Promise<void> {
    if (cart.length === 0 || !repId) return;
    const name = window.prompt('Şablon adı:')?.trim();
    if (!name) return;
    const lines: TemplateLine[] = cart.map((c) => ({
      product_id: c.productId,
      product_name: c.productName,
      qty: c.quantity,
      unit_price: c.unitPriceSnapshot,
    }));
    const supabase = getTypedClient();
    const { error: err } = await supabase
      .from('saha_order_templates')
      // lines DB'de jsonb — TemplateLine[]→Json cast (yapısal jsonb payload).
      .upsert(
        { rep_id: repId, name, lines: lines as unknown as Json },
        { onConflict: 'rep_id,name' },
      );
    if (err) {
      setError(`Şablon kaydedilemedi: ${err.message}`);
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ['order-templates', repId] });
  }

  function loadTemplate(t: OrderTemplate): void {
    const lines = Array.isArray(t.lines) ? t.lines : [];
    setCart(
      lines.map((l) => ({
        productId: l.product_id,
        quantity: l.qty,
        productName: l.product_name,
        unitPriceSnapshot: l.unit_price,
        unitPriceOverride: l.unit_price,
      })),
    );
  }

  /**
   * Ürün satırına/+ butonuna dokununca: 2+ varyant varsa varyant seçici aç,
   * 1 varyant varsa onu otomatik seç, varyantsız üründe eski davranış.
   */
  function handleProductPick(p: Product): void {
    const variants = p.variants ?? [];
    if (variants.length >= 2) {
      setVariantPickFor(p);
      setProductListOpen(false);
    } else {
      // Tam 1 varyant → dialogsuz otomatik seç; varyantsız → variant=undefined.
      addToCart(p, variants[0]);
    }
  }

  function addToCart(p: Product, variant?: ProductVariant): void {
    const variantId = variant?.id;
    // Varyant seçiliyse birim fiyat varyant fiyatı (görsel); değilse ürün base fiyatı.
    const unitPrice = variant != null ? variant.priceTry : (p.basePrice ?? 0);
    const label = variant != null ? variantLabel(variant) : undefined;
    setCart((prev) => {
      // Aynı ürün+varyant → miktar artır; farklı varyant → ayrı satır.
      const idx = prev.findIndex((it) => it.productId === p.id && it.variantId === variantId);
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
          ...(variantId ? { variantId } : {}),
          productName: p.name,
          unitPriceSnapshot: unitPrice,
          ...(variant?.sku ? { variantSku: variant.sku } : {}),
          ...(label ? { variantLabel: label } : {}),
        },
      ];
    });
    setProductSearch('');
    setProductListOpen(false);
    setVariantPickFor(null);
  }

  function updateQty(key: string, delta: number): void {
    setCart((prev) => {
      const next = prev
        .map((it) =>
          lineKey(it.productId, it.variantId) === key
            ? { ...it, quantity: Math.max(0, it.quantity + delta) }
            : it,
        )
        .filter((it) => it.quantity > 0);
      return next;
    });
  }

  function removeItem(key: string): void {
    setCart((prev) => prev.filter((it) => lineKey(it.productId, it.variantId) !== key));
  }

  function pickCustomer(c: CustomerOption): void {
    setCustomerId(c.id);
    setCustomerKind(c.kind);
    // Cari chip'inde fatura ünvanı + cari kodu birlikte gösterilir.
    setCustomerLabel(c.kind === 'cari' && c.subtitle ? `${c.name} · ${c.subtitle}` : c.name);
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

    // Her submit için deterministik idempotency key üret (uuid tabanlı).
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Offline veya ağ hatası durumunda kuyruğa alınacak payload.
    // adapter.createOrder'ın beklediği alanlarla uyumlu (syncQueue executeOp 'order.create').
    const offlinePayload: Record<string, unknown> = {
      idempotency_key: idempotencyKey,
      customer_id: customerId,
      // Cari seçimiyse cari_id taşı — syncQueue replay adapter.createOrder'a cariId geçer.
      cari_id: customerKind === 'cari' ? customerId : null,
      notes: notes.trim() || null,
      items: cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        // Varyant seçimi replay'de kaybolmasın → syncQueue order.create bunu adapter'a taşır.
        ...(c.variantId ? { variantId: c.variantId } : {}),
        unitPriceSnapshot: c.unitPriceSnapshot,
        ...(c.unitPriceOverride !== undefined ? { unitPriceOverride: c.unitPriceOverride } : {}),
      })),
      // Snapshot — replay sırasında adapter fiyatı DB'den tekrar çeker.
      subtotal_snapshot: subtotal,
      grand_total_snapshot: grandTotal,
      requires_approval: requiresApproval,
      sales_rep_id: profile?.id ?? null,
    };

    // Çevrim dışıysa doğrudan kuyruğa al.
    if (!navigator.onLine) {
      try {
        await enqueueOp('order.create', offlinePayload, idempotencyKey);
        toast.success('Sipariş kaydedildi — bağlantı geldiğinde gönderilecek');
        navigate('/orders/history');
      } catch (err) {
        // P8/T4: hatayı yutma — kök-nedeni logla + kullanıcıya mesajı göster.
        console.error('[OrderForm] offline enqueue başarısız:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Sipariş çevrim dışı kuyruğa eklenemedi: ${msg}`);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Çevrim içi: normal akış dene, başarısız olursa kuyruğa al.
    try {
      const items: NewOrderItem[] = cart.map((c) => ({
        productId: c.productId,
        quantity: c.quantity,
        // Varyant → sunucu fiyat/sku/attribute'ları variant_id'den çözer (RPC v2).
        ...(c.variantId ? { variantId: c.variantId } : {}),
        ...(c.unitPriceOverride !== undefined ? { unitPriceOverride: c.unitPriceOverride } : {}),
      }));
      const created = await adapter.createOrder({
        customerId,
        // Cari seçimiyse cariId geç → adapter clinic_id yerine cari_id gönderir.
        ...(customerKind === 'cari' ? { cariId: customerId } : {}),
        items,
        notes: notes.trim() || undefined,
        idempotencyKey,
        requiresApproval,
      });

      // Onay gerekirse bildirim fan-out. Status zaten adapter'da doğrudan
      // 'approval_pending' olarak set edildi — eski ikinci-UPDATE race penceresi
      // kaldırıldı (sipariş hiç 'pending' görünmüyor).
      if (requiresApproval) {
        const supabase = getTypedClient();

        // #79 — Onay bildirimi fan-out.
        // ESKİ BUG: 'notifications' tablosuna user_id OLMADAN, recipient_role'ü
        // data JSON'a gömülü yazılıyordu → (1) yanlış tablo: NAV feed'i
        // 'saha_notifications'tan okur, (2) user_id'siz: hiçbir alıcı sorgusu
        // okuyamıyor → bildirim TESLİM EDİLMİYOR.
        // FİX: MANAGER/ADMIN profillerini sorgula, her alıcı için user_id'li
        // ayrı 'saha_notifications' satırı insert et (fan-out). saha_notifications
        // şeması: user_id + type('order_approval') + title + body + payload(jsonb).
        // INSERT policy: saha_notifications_admin_insert (saha_is_rep_or_admin()).
        try {
          const message = `Yeni onay bekleyen sipariş: ${created.externalId ?? created.id.slice(0, 8)} — ${grandTotal.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' })}`;

          // Alıcılar: onaycı rolüne sahip kullanıcılar. approverRole bir üst
          // onaycıyı verir (REP→MANAGER, MANAGER→ADMIN). ADMIN her zaman dahil
          // (limitsiz onay yetkisi) ki MANAGER yoksa da bildirim ulaşsın.
          // profiles.role CANLI'da lowercase → approverRole uppercase ('MANAGER'/'ADMIN')
          // ile .in() 0 eşleşir, onay-bildirimi gitmezdi. Hem upper hem lower varyant.
          const recipientRoles = Array.from(
            new Set([approverRole ?? 'ADMIN', 'ADMIN'].flatMap((r) => [r, r.toLowerCase()])),
          );
          const { data: recipients, error: recErr } = await supabase
            .from('profiles')
            .select('id')
            .in('role', recipientRoles);
          if (recErr) {
            console.warn('[OrderFormPage] onaycı sorgusu başarısız:', recErr.message);
          }

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
              console.warn('[OrderFormPage] saha_notifications fan-out atlandı:', notErr.message);
            }
          } else {
            console.warn('[OrderFormPage] onaycı bulunamadı — bildirim gönderilmedi.');
          }
        } catch (notErr) {
          console.warn('[OrderFormPage] bildirim fan-out hatası:', notErr);
        }
      }

      // Invalidate order-related queries so approval list, sales hub, and
      // recent-orders cards all reflect the newly created order immediately.
      void invalidateOrderDomain(queryClient);
      navigate('/orders/history');
    } catch (err) {
      // Ağ/sunucu hatası → kuyruğa al, kullanıcıyı bilgilendir.
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
          navigate('/orders/history');
          return;
        } catch (enqErr) {
          // P8/T4: kuyruğa alma da başarısızsa hatayı yutma — logla + göster.
          console.error('[OrderForm] network-fallback enqueue başarısız:', enqErr);
          const enqMsg = enqErr instanceof Error ? enqErr.message : String(enqErr);
          setError(`Sipariş çevrim dışı kuyruğa eklenemedi: ${enqMsg}`);
          return;
        }
      }
      // P8/T4: sunucu/doğrulama hatası — kök-nedeni logla, mesajı UI'da göster.
      console.error('[OrderForm] sipariş oluşturulamadı:', err);
      setError(msg || 'Sipariş oluşturulamadı.');
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
                  setCustomerKind('clinic');
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
                  {(customerSearching || cariSearching) && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Aranıyor…</p>
                  )}
                  {!customerSearching &&
                    !cariSearching &&
                    (customerOptions ?? []).length === 0 &&
                    (cariOptions ?? []).length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok.</p>
                    )}
                  {(customerOptions ?? []).length > 0 && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Klinikler
                    </p>
                  )}
                  {(customerOptions ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="w-full text-left px-3 py-2.5 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0"
                    >
                      <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                      {c.subtitle && (
                        <p className="text-xs text-muted-foreground truncate">{c.subtitle}</p>
                      )}
                    </button>
                  ))}
                  {(cariOptions ?? []).length > 0 && (
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Cariler
                    </p>
                  )}
                  {(cariOptions ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="w-full text-left px-3 py-2.5 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0"
                    >
                      <p className="text-sm font-medium text-foreground truncate">{c.name}</p>
                      {c.subtitle && (
                        <p className="text-xs text-muted-foreground truncate">
                          Cari · {c.subtitle}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Hazır şablonlar */}
        {((templates ?? []).length > 0 || cart.length > 0) && (
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Bookmark className="h-3.5 w-3.5" /> Hazır Şablonlar
              </label>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => void saveTemplate()}
                  className="inline-flex items-center gap-1 text-xs text-primary font-medium px-2 py-1 min-h-tap-min"
                >
                  <Save className="h-3.5 w-3.5" /> Sepeti Şablon Kaydet
                </button>
              )}
            </div>
            {(templates ?? []).length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
                {(templates ?? []).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => loadTemplate(t)}
                    className="shrink-0 inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium min-h-tap-min hover:bg-muted/60"
                  >
                    <Bookmark className="h-3.5 w-3.5 text-primary" />
                    {t.name}
                    <span className="text-muted-foreground">
                      ({Array.isArray(t.lines) ? t.lines.length : 0})
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

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
            {/* Varyant seçici — 2+ varyantlı ürün seçilince arama sonuçlarının yerine geçer. */}
            {variantPickFor && (
              <div className="mt-1 rounded-lg border border-border bg-card shadow-lg max-h-80 overflow-y-auto">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/40 sticky top-0">
                  <span className="text-sm font-medium text-foreground truncate">
                    {variantPickFor.name} — varyant seç
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setVariantPickFor(null);
                      setProductListOpen(true);
                    }}
                    className="text-xs text-primary font-medium shrink-0 ml-2 px-2 py-1 min-h-tap-min"
                  >
                    ← Geri
                  </button>
                </div>
                {(variantPickFor.variants ?? []).map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => addToCart(variantPickFor, v)}
                    className="w-full text-left px-3 py-2.5 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {variantLabel(v)}
                      </p>
                      {v.stockQuantity != null && (
                        <p className="text-xs text-muted-foreground truncate">
                          Stok: {v.stockQuantity}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-semibold text-foreground">
                        {formatTL(v.priceTry)}
                      </span>
                      <Plus className="h-4 w-4 text-primary" />
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!variantPickFor && productListOpen && debouncedProductSearch.trim().length >= 2 && (
              <div className="mt-1 rounded-lg border border-border bg-card shadow-lg max-h-80 overflow-y-auto">
                {productSearching && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Aranıyor…</p>
                )}
                {!productSearching && (productOptions ?? []).length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok.</p>
                )}
                {(productOptions ?? []).map((p) => {
                  const variantCount = p.variants?.length ?? 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProductPick(p)}
                      className="w-full text-left px-3 py-2.5 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.sku ? `SKU: ${p.sku}` : ''}
                          {variantCount >= 2
                            ? `${p.sku ? ' · ' : ''}${variantCount} varyant ›`
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold text-foreground">
                          {formatTL(p.basePrice ?? 0)}
                        </span>
                        <Plus className="h-4 w-4 text-primary" />
                      </div>
                    </button>
                  );
                })}
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
                const key = lineKey(it.productId, it.variantId);
                const quoted = quote?.items.find(
                  (q) => q.productId === it.productId && q.variantId === it.variantId,
                );
                const unitPrice = quoted?.unitPrice ?? it.unitPriceSnapshot;
                const lineTotal = quoted?.lineTotal ?? unitPrice * it.quantity;
                return (
                  <div key={key} className="p-3 rounded-lg border border-border bg-card">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {it.productName}
                        </p>
                        {it.variantLabel && (
                          <p className="text-xs text-muted-foreground truncate">
                            {it.variantLabel}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(key)}
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
                          onClick={() => updateQty(key, -1)}
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
                          onClick={() => updateQty(key, 1)}
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
        {cart.length > 0 && quoteIsError && (
          <QueryErrorState
            message={
              quoteError instanceof Error
                ? `Fiyat hesaplanamadı — toplamlar YANLIŞ (₺0) olabilir. ${quoteError.message}`
                : 'Fiyat hesaplanamadı — toplamlar YANLIŞ (₺0) olabilir.'
            }
            onRetry={() => void refetchQuote()}
          />
        )}
        {cart.length > 0 && !quoteIsError && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Ara Toplam</span>
              <span className="font-medium text-foreground">{formatTL(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">KDV</span>
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
          disabled={submitting || cart.length === 0 || !customerId || quoteIsError}
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
