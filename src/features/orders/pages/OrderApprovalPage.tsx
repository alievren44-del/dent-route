/**
 * OrderApprovalPage — Onay bekleyen siparişler listesi.
 *
 * URL: /orders/approval
 * Yetki: MANAGER / ADMIN (caller route guard ile sağlar)
 *
 * Davranış:
 *  - `orders.status = 'approval_pending'` satırlarını listeler.
 *  - Onayla → status='approved', approved_by/at set.
 *  - Reddet  → modal'da sebep iste → status='rejected', rejection_reason.
 *  - Realtime: postgres_changes → invalidate.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, ChevronDown, ChevronUp, Inbox, X } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

interface PendingOrderRow {
  id: string;
  order_number: string | null;
  user_id: string | null;
  sales_rep_id: string | null;
  total: number | string | null;
  total_amount: number | string | null;
  notes: string | null;
  created_at: string | null;
  customer?: {
    id: string;
    ad_soyad: string | null;
    klinik_adi: string | null;
    email: string | null;
  } | null;
  rep?: {
    id: string;
    ad_soyad: string | null;
    email: string | null;
  } | null;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function customerLabel(c: PendingOrderRow['customer']): string {
  if (!c) return '—';
  return c.klinik_adi ?? c.ad_soyad ?? c.email ?? c.id.slice(0, 8);
}

function repLabel(r: PendingOrderRow['rep']): string {
  if (!r) return '—';
  return r.ad_soyad ?? r.email ?? r.id.slice(0, 8);
}

async function fetchPendingOrders(): Promise<PendingOrderRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('orders')
    .select(
      `id, order_number, user_id, sales_rep_id, total, total_amount, notes, created_at,
       customer:profiles!orders_user_id_fkey (id, ad_soyad, klinik_adi, email),
       rep:profiles!orders_sales_rep_id_fkey (id, ad_soyad, email)`,
    )
    .eq('status', 'approval_pending')
    .order('created_at', { ascending: true });
  if (error) {
    // FK aliaslar yoksa daha sade sorgu deneyelim
    const { data: fallback, error: fbErr } = await supabase
      .from('orders')
      .select('id, order_number, user_id, sales_rep_id, total, total_amount, notes, created_at')
      .eq('status', 'approval_pending')
      .order('created_at', { ascending: true });
    if (fbErr) throw fbErr;
    return (fallback ?? []) as PendingOrderRow[];
  }
  return (data ?? []) as unknown as PendingOrderRow[];
}

function OrderApprovalPage(): JSX.Element {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['order-approval-list'],
    queryFn: fetchPendingOrders,
  });

  // Realtime: orders status=approval_pending değişimleri
  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('order-approval-list')
      .on('postgres_changes' as never, { event: '*', schema: 'public', table: 'orders' }, () => {
        void queryClient.invalidateQueries({ queryKey: ['order-approval-list'] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const approveMutation = useMutation({
    mutationFn: async (orderId: string) => {
      // Doğrudan UPDATE yerine server-side yetki kapısı RPC'si — neden: eskiden
      // bu mutation doğrudan orders.status='approved' yazıyordu, REP kendi
      // >5000₺ siparişini onaylayabiliyordu (#70). RPC eşik uygular ve
      // status='approved' + approved_at'ı kendi içinde set eder; trigger stok +
      // order-to-cash'i tetikler.
      const supabase = getSupabaseClient();
      const { error: err } = await supabase.rpc('approve_order_if_authorized', {
        p_order_id: orderId,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      toast.success('Sipariş onaylandı.');
      void queryClient.invalidateQueries({ queryKey: ['order-approval-list'] });
    },
    onError: (err: unknown) => {
      // RPC exception mesajına göre anlamlı toast — backend otorite.
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('over_approval_limit')) {
        toast.error(
          'Bu tutar için onay yetkiniz yok (REP limiti 5.000₺ / MANAGER 50.000₺).',
        );
      } else if (msg.includes('not_authorized')) {
        toast.error('Onay yetkiniz yok.');
      } else {
        toast.error(msg || 'Onay başarısız.');
      }
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const supabase = getSupabaseClient();
      const { error: err } = await supabase
        .from('orders')
        .update({
          status: 'rejected',
          rejection_reason: reason,
          approved_by: profile?.id ?? null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (err) throw err;
    },
    onSuccess: () => {
      toast.success('Sipariş reddedildi.');
      setRejectFor(null);
      setRejectReason('');
      void queryClient.invalidateQueries({ queryKey: ['order-approval-list'] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Red işlemi başarısız.');
    },
  });

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const orders = useMemo(() => data ?? [], [data]);

  return (
    <div className="flex flex-col min-h-full pb-20">
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
            aria-label="Geri"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-foreground">Onay Bekleyen Siparişler</h1>
            <p className="text-xs text-muted-foreground">{orders.length} sipariş onay bekliyor</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-2">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Liste yüklenemedi: {error instanceof Error ? error.message : 'bilinmeyen hata'}
          </div>
        )}

        {!isLoading && !isError && orders.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Inbox className="h-12 w-12 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium text-foreground">Onay bekleyen sipariş yok</p>
            <p className="text-xs text-muted-foreground mt-1">
              Yeni başvurular geldiğinde burada görünecek.
            </p>
          </div>
        )}

        {orders.map((o) => {
          const isOpen = expanded.has(o.id);
          const total = Number(o.total ?? o.total_amount ?? 0);
          return (
            <div key={o.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(o.id)}
                className="w-full flex items-start justify-between gap-3 px-3 py-3 text-left hover:bg-muted/40 min-h-tap-min"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-medium">
                      Onay Bekliyor
                    </span>
                    <p className="text-sm font-semibold text-foreground truncate">
                      {o.order_number ?? `#${o.id.slice(0, 8)}`}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {customerLabel(o.customer ?? null)}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Temsilci: {repLabel(o.rep ?? null)} · {formatDateTime(o.created_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-base font-bold text-foreground">{formatTRY(total)}</span>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-border space-y-3">
                  {o.notes && (
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-0.5">Notlar</p>
                      <p className="text-xs text-foreground whitespace-pre-wrap">{o.notes}</p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => approveMutation.mutate(o.id)}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-green-600 text-white text-sm font-semibold min-h-tap-min disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      Onayla
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectFor(o.id);
                        setRejectReason('');
                      }}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold min-h-tap-min disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      Reddet
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Red modal */}
      {rejectFor && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
          <div className="w-full max-w-sm rounded-2xl bg-background p-4 shadow-xl">
            <h2 className="text-base font-semibold text-foreground mb-2">Siparişi reddet</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Red sebebini yazın. Temsilci bu mesajı görecek.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder="Örn: Kredi limiti aşıldı"
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => {
                  setRejectFor(null);
                  setRejectReason('');
                }}
                className="flex-1 px-3 py-2.5 rounded-lg border border-border text-sm font-medium min-h-tap-min hover:bg-muted"
              >
                İptal
              </button>
              <button
                type="button"
                onClick={() => {
                  const reason = rejectReason.trim();
                  if (!reason) {
                    toast.error('Red sebebi gerekli.');
                    return;
                  }
                  rejectMutation.mutate({ id: rejectFor, reason });
                }}
                disabled={rejectMutation.isPending}
                className="flex-1 px-3 py-2.5 rounded-lg bg-red-600 text-white text-sm font-semibold min-h-tap-min disabled:opacity-50"
              >
                {rejectMutation.isPending ? 'Gönderiliyor…' : 'Reddet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OrderApprovalPage;
