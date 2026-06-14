/**
 * SalesHubPage — Satış sekmesi ana ekranı (/sales).
 *
 * Plasiyer + admin görür (admin-gate YOK). Görünürlük:
 *  - Plasiyer: yalnız kendi satışları (sales_rep_id = userId)
 *  - Admin/Manager: tüm satışlar
 * (DB seviyesinde RLS Faz 2'de sıkılaştırılacak — burada görünüm seviyesi filtre.)
 *
 * İçerik:
 *  - Bu ay sipariş adedi + toplam ₺ (KPI kartları)
 *  - Aylık hedef ilerleme (saha_rep_targets — varsa)
 *  - Hızlı işlemler grid: Yeni Satış, Sipariş Geçmişi, Onay Bekleyenler (admin), Cariler (admin)
 *  - Son siparişler listesi
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus,
  History,
  ClipboardCheck,
  Users,
  TrendingUp,
  ShoppingCart,
  ChevronRight,
  MapPin,
  Banknote,
} from 'lucide-react';

import { getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { mapParlaToSahaRole } from '@core/auth/types';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

interface OrderLite {
  id: string;
  order_number: string | null;
  status: string | null;
  total: number | string | null;
  total_amount: number | string | null;
  created_at: string | null;
  customer?: { ad_soyad: string | null; klinik_adi: string | null; email: string | null } | null;
}

interface RepTarget {
  order_target_tl: number | string | null;
  visit_target: number | null;
  collection_target_tl: number | string | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak',
  pending: 'Beklemede',
  approval_pending: 'Onay Bekliyor',
  approved: 'Onaylandı',
  confirmed: 'Onaylandı',
  rejected: 'Reddedildi',
  shipped: 'Kargoda',
  delivered: 'Teslim',
  cancelled: 'İptal',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-700',
  pending: 'bg-amber-100 text-amber-800',
  approval_pending: 'bg-purple-100 text-purple-800',
  approved: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  shipped: 'bg-indigo-100 text-indigo-800',
  delivered: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function customerName(c: OrderLite['customer']): string {
  if (!c) return 'Müşteri —';
  return c.klinik_adi ?? c.ad_soyad ?? c.email ?? 'Müşteri —';
}

function monthStartISO(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}

function yearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function SalesHubPage(): JSX.Element {
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const userId = session?.userId ?? null;
  const isAdmin = mapParlaToSahaRole(profile?.role) === 'admin';

  // Bu ayki satışlar (KPI + son siparişler tek sorgu)
  const ordersQuery = useQuery({
    queryKey: ['sales-hub-orders', userId, isAdmin],
    enabled: Boolean(userId),
    queryFn: async (): Promise<OrderLite[]> => {
      const supabase = getTypedClient();
      const baseSelect = `id, order_number, status, total, total_amount, created_at,
        customer:profiles!orders_user_id_profiles_fkey (ad_soyad, klinik_adi, email)`;
      const run = (selectStr: string) => {
        let q = supabase
          .from('orders')
          .select(selectStr)
          .gte('created_at', monthStartISO())
          .order('created_at', { ascending: false })
          .limit(50);
        if (!isAdmin && userId) q = q.eq('sales_rep_id', userId);
        return q;
      };
      const first = await run(baseSelect);
      if (first.error) {
        // FK alias yoksa sade select fallback
        const fb = await run('id, order_number, status, total, total_amount, created_at');
        if (fb.error) throw fb.error;
        return (fb.data ?? []) as unknown as OrderLite[];
      }
      return (first.data ?? []) as unknown as OrderLite[];
    },
  });

  // Bugün + aylık ziyaret/tahsilat (rep için; admin'e gösterilmez)
  const todayQuery = useQuery({
    queryKey: ['sales-hub-today', userId],
    enabled: Boolean(userId) && !isAdmin,
    queryFn: async (): Promise<{
      visitsToday: number;
      collectionsTodayTl: number;
      ordersToday: number;
      visitsMonth: number;
      collectionsMonthTl: number;
    }> => {
      const supabase = getTypedClient();

      // Bugün başlangıcı (ISO + DATE string)
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const todayISO = todayDate.toISOString();
      const todayYMD = todayISO.slice(0, 10); // 'YYYY-MM-DD'

      // Ay başı
      const monthStart = monthStartISO(); // 'YYYY-MM-DD'

      try {
        const [visitsTodayRes, visitsMonthRes, odTodayRes, odMonthRes, ordTodayRes] =
          await Promise.all([
            // Bugünkü ziyaret adedi
            supabase
              .from('saha_visits')
              .select('id', { count: 'exact', head: true })
              .eq('rep_id', userId!)
              .gte('check_in_at', todayISO),
            // Aylık ziyaret adedi
            supabase
              .from('saha_visits')
              .select('id', { count: 'exact', head: true })
              .eq('rep_id', userId!)
              .gte('check_in_at', monthStart),
            // Bugünkü tahsilat ₺ (tarih = DATE sütun)
            supabase
              .from('saha_odemeler')
              .select('tutar')
              .eq('created_by', userId!)
              .gte('tarih', todayYMD),
            // Aylık tahsilat ₺
            supabase
              .from('saha_odemeler')
              .select('tutar')
              .eq('created_by', userId!)
              .gte('tarih', monthStart),
            // Bugünkü sipariş adedi
            supabase
              .from('orders')
              .select('id', { count: 'exact', head: true })
              .eq('sales_rep_id', userId!)
              .gte('created_at', todayISO),
          ]);

        const visitsToday = visitsTodayRes.count ?? 0;
        const visitsMonth = visitsMonthRes.count ?? 0;
        const collectionsTodayTl = (odTodayRes.data ?? []).reduce(
          (acc, r) => acc + Number(r.tutar ?? 0),
          0,
        );
        const collectionsMonthTl = (odMonthRes.data ?? []).reduce(
          (acc, r) => acc + Number(r.tutar ?? 0),
          0,
        );
        const ordersToday = ordTodayRes.count ?? 0;

        return { visitsToday, collectionsTodayTl, ordersToday, visitsMonth, collectionsMonthTl };
      } catch {
        return {
          visitsToday: 0,
          collectionsTodayTl: 0,
          ordersToday: 0,
          visitsMonth: 0,
          collectionsMonthTl: 0,
        };
      }
    },
  });

  // Aylık hedef (varsa) — rep kendi hedefi
  const targetQuery = useQuery({
    queryKey: ['sales-hub-target', userId],
    enabled: Boolean(userId) && !isAdmin,
    queryFn: async (): Promise<RepTarget | null> => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('saha_rep_targets')
        .select('order_target_tl, visit_target, collection_target_tl')
        .eq('rep_id', userId!)
        .eq('year_month', yearMonth())
        .maybeSingle();
      if (error) return null; // tablo/satır yoksa sessizce geç
      return (data ?? null) as RepTarget | null;
    },
  });

  const orders = ordersQuery.data ?? [];

  const { orderCount, totalTl } = useMemo(() => {
    const count = orders.length;
    const sum = orders.reduce((acc, o) => acc + Number(o.total ?? o.total_amount ?? 0), 0);
    return { orderCount: count, totalTl: sum };
  }, [orders]);

  const targetTl = Number(targetQuery.data?.order_target_tl ?? 0);
  const targetPct = targetTl > 0 ? Math.min(100, Math.round((totalTl / targetTl) * 100)) : 0;

  // Ziyaret + tahsilat hedef ilerleme (aylık)
  const visitTargetCount = targetQuery.data?.visit_target ?? 0;
  const collectionTargetTl = Number(targetQuery.data?.collection_target_tl ?? 0);
  const visitsMonth = todayQuery.data?.visitsMonth ?? 0;
  const collectionsMonthTl = todayQuery.data?.collectionsMonthTl ?? 0;
  const visitPct =
    visitTargetCount > 0 ? Math.min(100, Math.round((visitsMonth / visitTargetCount) * 100)) : 0;
  const collectionPct =
    collectionTargetTl > 0
      ? Math.min(100, Math.round((collectionsMonthTl / collectionTargetTl) * 100))
      : 0;

  // Bugün kart verileri
  const visitsToday = todayQuery.data?.visitsToday ?? 0;
  const collectionsTodayTl = todayQuery.data?.collectionsTodayTl ?? 0;
  const ordersToday = todayQuery.data?.ordersToday ?? 0;

  const actions = [
    {
      key: 'new',
      label: 'Yeni Satış',
      desc: 'Sahada sipariş gir',
      Icon: Plus,
      to: '/orders/new',
      primary: true,
      show: true,
    },
    {
      key: 'history',
      label: 'Sipariş Geçmişi',
      desc: 'Geçmiş satışlar',
      Icon: History,
      to: '/orders/history',
      show: true,
    },
    {
      key: 'approval',
      label: 'Onay Bekleyenler',
      desc: 'Sipariş onayı',
      Icon: ClipboardCheck,
      to: '/orders/approval',
      show: isAdmin,
    },
    {
      key: 'cari',
      label: 'Cariler',
      desc: 'Cari hesaplar',
      Icon: Users,
      to: '/invoicing/cari',
      show: isAdmin,
    },
  ].filter((a) => a.show);

  return (
    <div className="flex flex-col min-h-full pb-20">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground flex-1">Satış</h1>
        </div>
      </div>

      <div className="flex-1 px-4 py-3 space-y-4">
        {/* Bugün özet kartı (sadece plasiyer) */}
        {!isAdmin && (
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Bugün</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center gap-1">
                <MapPin className="h-4 w-4 text-primary" />
                <p className="text-lg font-bold text-foreground leading-none">{visitsToday}</p>
                <p className="text-[10px] text-muted-foreground text-center">Ziyaret</p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <ShoppingCart className="h-4 w-4 text-primary" />
                <p className="text-lg font-bold text-foreground leading-none">{ordersToday}</p>
                <p className="text-[10px] text-muted-foreground text-center">Sipariş</p>
              </div>
              <div className="flex flex-col items-center gap-1">
                <Banknote className="h-4 w-4 text-primary" />
                <p className="text-lg font-bold text-foreground leading-none">
                  {collectionsTodayTl > 0 ? formatTRY(collectionsTodayTl) : '₺0'}
                </p>
                <p className="text-[10px] text-muted-foreground text-center">Tahsilat</p>
              </div>
            </div>
          </div>
        )}

        {/* KPI kartları */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Bu Ay Satış</p>
            <p className="mt-1 text-xl font-bold text-foreground">{formatTRY(totalTl)}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-3">
            <p className="text-xs text-muted-foreground">Sipariş Adedi</p>
            <p className="mt-1 text-xl font-bold text-foreground">{orderCount}</p>
          </div>
        </div>

        {/* Hedef ilerleme (rep, en az bir hedef varsa) */}
        {!isAdmin && (targetTl > 0 || visitTargetCount > 0 || collectionTargetTl > 0) && (
          <div className="rounded-xl border border-border bg-card p-3 space-y-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              Aylık Hedef İlerlemesi
            </span>

            {/* Sipariş ₺ hedefi */}
            {targetTl > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-muted-foreground">Satış ₺</span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatTRY(totalTl)} / {formatTRY(targetTl)} · %{targetPct}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${targetPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Ziyaret hedefi */}
            {visitTargetCount > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-muted-foreground">Ziyaret</span>
                  <span className="text-[11px] text-muted-foreground">
                    {visitsMonth} / {visitTargetCount} · %{visitPct}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all"
                    style={{ width: `${visitPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Tahsilat ₺ hedefi */}
            {collectionTargetTl > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-muted-foreground">Tahsilat ₺</span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatTRY(collectionsMonthTl)} / {formatTRY(collectionTargetTl)} · %
                    {collectionPct}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${collectionPct}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hızlı işlemler */}
        <div className="grid grid-cols-2 gap-3">
          {actions.map(({ key, label, desc, Icon, to, primary }) => (
            <button
              key={key}
              type="button"
              onClick={() => navigate(to)}
              className={[
                'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left min-h-tap-min',
                primary
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-card hover:bg-muted/40',
              ].join(' ')}
            >
              <Icon className={`h-5 w-5 ${primary ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <span className="text-[11px] text-muted-foreground">{desc}</span>
            </button>
          ))}
        </div>

        {/* Son siparişler */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-foreground">Son Satışlar</h2>
            <button
              type="button"
              onClick={() => navigate('/orders/history')}
              className="flex items-center gap-0.5 text-xs text-primary"
            >
              Tümü <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {ordersQuery.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />
              ))}
            </div>
          )}

          {ordersQuery.isError && (
            <p className="text-sm text-red-600 py-6 text-center">Satışlar yüklenemedi.</p>
          )}

          {!ordersQuery.isLoading && !ordersQuery.isError && orders.length === 0 && (
            <div className="rounded-xl border border-dashed border-border py-10 text-center">
              <p className="text-sm text-muted-foreground">Bu ay satış yok.</p>
              <button
                type="button"
                onClick={() => navigate('/orders/new')}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground min-h-tap-min"
              >
                <Plus className="h-4 w-4" /> İlk Satışı Gir
              </button>
            </div>
          )}

          {!ordersQuery.isLoading && !ordersQuery.isError && orders.length > 0 && (
            <ul className="space-y-2">
              {orders.slice(0, 10).map((o) => {
                const status = String(o.status ?? '').toLowerCase();
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => navigate(`/orders/history?status=${status}`)}
                      className="w-full text-left p-3 rounded-lg border border-border bg-card hover:bg-muted/40 min-h-tap-min"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {o.order_number ?? `#${o.id.slice(0, 8)}`}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {customerName(o.customer ?? null)}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {formatDate(o.created_at)}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-sm font-bold text-foreground">
                            {formatTRY(Number(o.total ?? o.total_amount ?? 0))}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              STATUS_STYLES[status] ?? 'bg-gray-200 text-gray-700'
                            }`}
                          >
                            {STATUS_LABELS[status] ?? o.status}
                          </span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default SalesHubPage;
