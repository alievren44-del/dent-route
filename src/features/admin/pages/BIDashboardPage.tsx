/**
 * BIDashboardPage — Konsolide grafikli BI panosu.
 *
 * URL: /admin/bi
 *
 * 30/90 gün pencere toggle (DashboardPage range stili). Grafikler:
 *   - Sipariş trendi (günlük bar — orders.created_at, sum total_amount)
 *   - Plasiyer bazlı satış (bar — orders → profiles)
 *   - Ziyaret durum dağılımı (pie — saha_visits status)
 *   - Tahsilat trendi (line — saha_odemeler günlük, sum tutar)
 * + StatCard'lar: toplam satış, toplam tahsilat, açık alacak, ziyaret.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { TrendingUp, Wallet, MapPin, Banknote } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

type RangeKey = '30' | '90';

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '30', label: 'Son 30 Gün' },
  { value: '90', label: 'Son 90 Gün' },
];

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

interface DayPoint {
  day: string;
  value: number;
}
interface RepPoint {
  name: string;
  value: number;
}
interface StatusPoint {
  name: string;
  value: number;
}

interface BIData {
  ordersTrend: DayPoint[];
  salesByRep: RepPoint[];
  visitStatus: StatusPoint[];
  collectionsTrend: DayPoint[];
  totals: {
    salesTl: number;
    collectedTl: number;
    openArTl: number;
    visits: number;
  };
}

function num(v: number | string | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function sinceIsoFor(range: RangeKey): string {
  const days = Number.parseInt(range, 10);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'Devam Eden',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
};

async function fetchBI(sinceIso: string): Promise<BIData> {
  const supabase = getSupabaseClient();
  const sinceDate = sinceIso.slice(0, 10);

  const [orders, profiles, visits, odemeler, faturalar] = await Promise.all([
    supabase
      .from('orders')
      .select('sales_rep_id, total_amount, total, created_at')
      .gte('created_at', sinceIso),
    supabase.from('profiles').select('id, ad_soyad, email'),
    supabase.from('saha_visits').select('status').gte('check_in_at', sinceIso),
    supabase.from('saha_odemeler').select('tutar, tarih').gte('tarih', sinceDate),
    supabase
      .from('saha_faturalar')
      .select('kalan, tip, durum')
      .gt('kalan', 0)
      .not('durum', 'in', '(odendi,iptal)'),
  ]);

  if (orders.error) throw orders.error;

  const profileName = new Map<string, string>();
  for (const p of (profiles.data ?? []) as Array<{ id: string; ad_soyad: string | null; email: string | null }>) {
    profileName.set(p.id, p.ad_soyad ?? p.email ?? p.id.slice(0, 8));
  }

  // Sipariş trendi (günlük) + plasiyer bazlı satış
  const orderByDay = new Map<string, number>();
  const salesByRepMap = new Map<string, number>();
  let salesTl = 0;
  for (const o of (orders.data ?? []) as Array<{
    sales_rep_id: string | null;
    total_amount: number | string | null;
    total: number | string | null;
    created_at: string | null;
  }>) {
    const t = o.total_amount != null ? num(o.total_amount) : num(o.total);
    salesTl += t;
    const day = (o.created_at ?? '').slice(0, 10);
    if (day) orderByDay.set(day, (orderByDay.get(day) ?? 0) + t);
    if (o.sales_rep_id) {
      salesByRepMap.set(o.sales_rep_id, (salesByRepMap.get(o.sales_rep_id) ?? 0) + t);
    }
  }

  const ordersTrend: DayPoint[] = Array.from(orderByDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, value]) => ({ day: day.slice(5), value: Math.round(value) }));

  const salesByRep: RepPoint[] = Array.from(salesByRepMap.entries())
    .map(([id, value]) => ({ name: profileName.get(id) ?? id.slice(0, 8), value: Math.round(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  // Ziyaret durum dağılımı
  const statusMap = new Map<string, number>();
  for (const v of (visits.data ?? []) as Array<{ status: string | null }>) {
    const s = v.status ?? 'unknown';
    statusMap.set(s, (statusMap.get(s) ?? 0) + 1);
  }
  const visitStatus: StatusPoint[] = Array.from(statusMap.entries()).map(([k, value]) => ({
    name: STATUS_LABELS[k] ?? k,
    value,
  }));
  const visitsTotal = (visits.data ?? []).length;

  // Tahsilat trendi (günlük)
  const collByDay = new Map<string, number>();
  let collectedTl = 0;
  for (const p of (odemeler.data ?? []) as Array<{ tutar: number | string | null; tarih: string | null }>) {
    const t = num(p.tutar);
    collectedTl += t;
    const day = (p.tarih ?? '').slice(0, 10);
    if (day) collByDay.set(day, (collByDay.get(day) ?? 0) + t);
  }
  const collectionsTrend: DayPoint[] = Array.from(collByDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, value]) => ({ day: day.slice(5), value: Math.round(value) }));

  // Açık alacak (kalan işaret: satis +, iade -)
  let openArTl = 0;
  if (!faturalar.error) {
    for (const f of (faturalar.data ?? []) as Array<{ kalan: number | string | null; tip: string }>) {
      const sign = f.tip === 'iade' ? -1 : 1;
      openArTl += sign * num(f.kalan);
    }
  }

  return {
    ordersTrend,
    salesByRep,
    visitStatus,
    collectionsTrend,
    totals: { salesTl, collectedTl, openArTl, visits: visitsTotal },
  };
}

export default function BIDashboardPage() {
  const [range, setRange] = useState<RangeKey>('30');
  const sinceIso = useMemo(() => sinceIsoFor(range), [range]);

  const biQuery = useQuery({
    queryKey: ['admin', 'bi', sinceIso],
    queryFn: () => fetchBI(sinceIso),
  });

  const data = biQuery.data;

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">BI Panosu</h1>
          <p className="text-xs text-slate-500">Satış, tahsilat ve ziyaret trendleri.</p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-sm">
          {RANGE_OPTIONS.map((opt) => {
            const active = opt.value === range;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                className={`rounded px-3 py-1 text-sm font-medium transition ${
                  active ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </header>

      {biQuery.isError && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Veri yüklenemedi: {(biQuery.error as Error | null)?.message ?? 'bilinmeyen hata'}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Stat kartları */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Toplam Satış"
            value={data ? formatTRY(data.totals.salesTl) : '—'}
            icon={<TrendingUp className="h-5 w-5 text-emerald-600" />}
            loading={biQuery.isLoading}
          />
          <StatCard
            label="Toplam Tahsilat"
            value={data ? formatTRY(data.totals.collectedTl) : '—'}
            icon={<Banknote className="h-5 w-5 text-sky-600" />}
            loading={biQuery.isLoading}
          />
          <StatCard
            label="Açık Alacak"
            value={data ? formatTRY(data.totals.openArTl) : '—'}
            icon={<Wallet className="h-5 w-5 text-amber-600" />}
            loading={biQuery.isLoading}
          />
          <StatCard
            label="Ziyaret"
            value={data ? data.totals.visits.toLocaleString('tr-TR') : '—'}
            icon={<MapPin className="h-5 w-5 text-violet-600" />}
            loading={biQuery.isLoading}
          />
        </div>

        {/* Sipariş trendi */}
        <ChartCard title="Sipariş Trendi (günlük ₺)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data?.ordersTrend ?? []}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={70} />
              <Tooltip formatter={(v: number) => formatTRY(v)} />
              <Bar dataKey="value" name="Satış ₺" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Plasiyer bazlı satış */}
          <ChartCard title="Plasiyer Bazlı Satış ₺">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.salesByRep ?? []} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip formatter={(v: number) => formatTRY(v)} />
                <Bar dataKey="value" name="Satış ₺" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Ziyaret durum pie */}
          <ChartCard title="Ziyaret Durum Dağılımı">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.visitStatus ?? []}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label
                >
                  {(data?.visitStatus ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Tahsilat trendi */}
        <ChartCard title="Tahsilat Trendi (günlük ₺)">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data?.collectionsTrend ?? []}>
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} width={70} />
              <Tooltip formatter={(v: number) => formatTRY(v)} />
              <Line type="monotone" dataKey="value" name="Tahsilat ₺" stroke="#0ea5e9" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="h-64 w-full">{children}</div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  loading: boolean;
}

function StatCard({ label, value, icon, loading }: StatCardProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="text-xl font-semibold text-slate-900 tabular-nums">
          {loading ? '...' : value}
        </div>
      </div>
    </div>
  );
}
