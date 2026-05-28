/**
 * DashboardPage — Admin özet paneli.
 *
 * Rep performans özeti: check-in, km, sipariş aggregate.
 * 4 ayrı Supabase query + client-side group-by.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  MapPin,
  Route,
  ShoppingCart,
  Radar,
  FileUp,
  Activity,
  MapPinned,
  UserCog,
  ScrollText,
  ClipboardCheck,
  Wallet,
  Receipt,
  CreditCard,
} from 'lucide-react';

import { getSupabaseClient } from '@/lib/supabase';

type RangeKey = '7' | '30' | '90';

interface RepRow {
  id: string;
  ad_soyad: string | null;
  email: string | null;
  role: string | null;
}

interface RepAggregate {
  checkIns: number;
  km: number;
  orders: number;
}

interface DashboardData {
  reps: RepRow[];
  byRep: Record<string, RepAggregate>;
  totals: {
    repCount: number;
    checkIns: number;
    km: number;
    orders: number;
  };
}

const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '7', label: 'Son 7 Gün' },
  { value: '30', label: 'Son 30 Gün' },
  { value: '90', label: 'Son 90 Gün' },
];

function sinceIsoFor(range: RangeKey): string {
  const days = Number.parseInt(range, 10);
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function fetchDashboard(sinceIso: string): Promise<DashboardData> {
  const supabase = getSupabaseClient();
  const sinceDate = sinceIso.slice(0, 10);

  const [reps, visits, mileage, orders] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, ad_soyad, email, role')
      .ilike('role', '%REP%'),
    supabase
      .from('saha_visits')
      .select('id, rep_id')
      .gte('check_in_at', sinceIso),
    supabase
      .from('saha_mileage_logs')
      .select('profile_id, distance_km')
      .gte('log_date', sinceDate),
    supabase
      .from('orders')
      .select('id, sales_rep_id')
      .gte('created_at', sinceIso)
      .not('sales_rep_id', 'is', null),
  ]);

  if (reps.error) throw reps.error;
  if (visits.error) throw visits.error;
  if (mileage.error) throw mileage.error;
  if (orders.error) throw orders.error;

  const repRows = (reps.data ?? []) as RepRow[];
  const byRep: Record<string, RepAggregate> = {};

  function bucket(id: string): RepAggregate {
    let entry = byRep[id];
    if (!entry) {
      entry = { checkIns: 0, km: 0, orders: 0 };
      byRep[id] = entry;
    }
    return entry;
  }

  for (const row of repRows) bucket(row.id);

  for (const v of (visits.data ?? []) as Array<{ rep_id: string | null }>) {
    if (!v.rep_id) continue;
    bucket(v.rep_id).checkIns += 1;
  }

  for (const m of (mileage.data ?? []) as Array<{
    profile_id: string | null;
    distance_km: number | string | null;
  }>) {
    if (!m.profile_id) continue;
    const km =
      typeof m.distance_km === 'string'
        ? Number.parseFloat(m.distance_km)
        : (m.distance_km ?? 0);
    bucket(m.profile_id).km += Number.isFinite(km) ? (km as number) : 0;
  }

  for (const o of (orders.data ?? []) as Array<{
    sales_rep_id: string | null;
  }>) {
    if (!o.sales_rep_id) continue;
    bucket(o.sales_rep_id).orders += 1;
  }

  const totals = {
    repCount: repRows.length,
    checkIns: (visits.data ?? []).length,
    km: ((mileage.data ?? []) as Array<{ distance_km: number | string | null }>).reduce(
      (acc, m) => {
        const km =
          typeof m.distance_km === 'string'
            ? Number.parseFloat(m.distance_km)
            : (m.distance_km ?? 0);
        return acc + (Number.isFinite(km) ? (km as number) : 0);
      },
      0,
    ),
    orders: (orders.data ?? []).length,
  };

  return { reps: repRows, byRep, totals };
}

function repLabel(rep: RepRow): string {
  return rep.ad_soyad ?? rep.email ?? rep.id.slice(0, 8);
}

function formatKm(km: number): string {
  return km.toLocaleString('tr-TR', { maximumFractionDigits: 1 });
}

export default function DashboardPage() {
  const [range, setRange] = useState<RangeKey>('30');
  const sinceIso = useMemo(() => sinceIsoFor(range), [range]);

  const dashboardQuery = useQuery({
    queryKey: ['admin', 'dashboard', sinceIso],
    queryFn: () => fetchDashboard(sinceIso),
  });

  const data = dashboardQuery.data;
  const reps = data?.reps ?? [];

  const sortedReps = useMemo(() => {
    if (!data) return [];
    return [...reps].sort((a, b) => {
      const aa = data.byRep[a.id] ?? { checkIns: 0, km: 0, orders: 0 };
      const bb = data.byRep[b.id] ?? { checkIns: 0, km: 0, orders: 0 };
      const aScore = aa.checkIns + aa.orders + aa.km;
      const bScore = bb.checkIns + bb.orders + bb.km;
      if (bScore !== aScore) return bScore - aScore;
      return (a.ad_soyad ?? a.email ?? '').localeCompare(
        b.ad_soyad ?? b.email ?? '',
        'tr',
      );
    });
  }, [data, reps]);

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Yönetici Paneli
          </h1>
          <p className="text-xs text-slate-500">
            Saha rep'lerinin dönem performansı.
          </p>
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
                  active
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </header>

      {dashboardQuery.isError && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Veri yüklenemedi:{' '}
          {(dashboardQuery.error as Error | null)?.message ?? 'bilinmeyen hata'}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Hızlı erişim grid */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Yönetici Menüsü
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <AdminLink to="/admin/clinic-scan" label="Klinik Tarama" icon={<Radar className="h-4 w-4" />} />
            <AdminLink to="/admin/clinics" label="CSV / Excel İçe Aktar" icon={<FileUp className="h-4 w-4" />} />
            <AdminLink to="/admin/heatmap" label="Heatmap" icon={<Activity className="h-4 w-4" />} />
            <AdminLink to="/admin/regions" label="Bölge Atama" icon={<MapPinned className="h-4 w-4" />} />
            <AdminLink to="/admin/users" label="Kullanıcı Yönetimi" icon={<UserCog className="h-4 w-4" />} />
            <AdminLink to="/admin/audit-logs" label="Audit Log" icon={<ScrollText className="h-4 w-4" />} />
            <AdminLink to="/orders/approval" label="Sipariş Onay" icon={<ClipboardCheck className="h-4 w-4" />} />
            <AdminLink to="/invoicing/cari" label="Cariler" icon={<Wallet className="h-4 w-4" />} />
            <AdminLink to="/invoicing/fatura/yeni" label="Yeni Fatura" icon={<Receipt className="h-4 w-4" />} />
            <AdminLink to="/invoicing/cek-senet" label="Çek / Senet" icon={<CreditCard className="h-4 w-4" />} />
          </div>
        </section>

        {/* Kart grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Toplam Rep"
            value={data ? data.totals.repCount.toLocaleString('tr-TR') : '—'}
            icon={<Users className="h-5 w-5 text-emerald-600" />}
            loading={dashboardQuery.isLoading}
          />
          <StatCard
            label="Check-in"
            value={data ? data.totals.checkIns.toLocaleString('tr-TR') : '—'}
            icon={<MapPin className="h-5 w-5 text-sky-600" />}
            loading={dashboardQuery.isLoading}
          />
          <StatCard
            label="Toplam KM"
            value={data ? formatKm(data.totals.km) : '—'}
            icon={<Route className="h-5 w-5 text-amber-600" />}
            loading={dashboardQuery.isLoading}
          />
          <StatCard
            label="Sipariş"
            value={data ? data.totals.orders.toLocaleString('tr-TR') : '—'}
            icon={<ShoppingCart className="h-5 w-5 text-violet-600" />}
            loading={dashboardQuery.isLoading}
          />
        </div>

        {/* Rep tablosu */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Rep Performansı
            </h2>
            <p className="text-xs text-slate-500">
              {dashboardQuery.isLoading
                ? 'Yükleniyor...'
                : `${reps.length} rep listeleniyor`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2">Ad Soyad</th>
                  <th className="px-4 py-2">E-posta</th>
                  <th className="px-4 py-2 text-right">Check-in</th>
                  <th className="px-4 py-2 text-right">KM</th>
                  <th className="px-4 py-2 text-right">Sipariş</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboardQuery.isLoading && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-slate-500"
                    >
                      Yükleniyor...
                    </td>
                  </tr>
                )}
                {!dashboardQuery.isLoading && sortedReps.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-6 text-center text-slate-500"
                    >
                      Rep bulunamadı.
                    </td>
                  </tr>
                )}
                {sortedReps.map((rep) => {
                  const agg = data?.byRep[rep.id] ?? {
                    checkIns: 0,
                    km: 0,
                    orders: 0,
                  };
                  return (
                    <tr key={rep.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-medium text-slate-800">
                        {repLabel(rep)}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {rep.email ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                        {agg.checkIns.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                        {formatKm(agg.km)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                        {agg.orders.toLocaleString('tr-TR')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
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
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </div>
        <div className="text-xl font-semibold text-slate-900 tabular-nums">
          {loading ? '...' : value}
        </div>
      </div>
    </div>
  );
}

interface AdminLinkProps {
  to: string;
  label: string;
  icon: React.ReactNode;
}

function AdminLink({ to, label, icon }: AdminLinkProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700"
    >
      <span className="shrink-0 text-emerald-600">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
