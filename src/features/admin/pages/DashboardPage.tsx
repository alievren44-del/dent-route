/**
 * DashboardPage — Admin özet paneli.
 *
 * Rep performans özeti: check-in, km, sipariş aggregate.
 * 4 ayrı Supabase query + client-side group-by.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  Wallet,
  Receipt,
  CreditCard,
  Globe,
  BarChart3,
  Target,
  Boxes,
  Hourglass,
} from 'lucide-react';

import { getTypedClient } from '@/lib/supabase';

// ---- Canlı aktivite tipleri ----
interface LiveVisitRow {
  id: string;
  account_id: string | null;
  rep_id: string | null;
  check_in_at: string | null;
  outcome: string | null;
  status: string | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  met: 'Görüşüldü',
  not_met: 'Görüşülemedi',
  left_material: 'Materyal Bırakıldı',
  follow_up: 'Takip Gerekli',
  sale: 'Satış',
  no_answer: 'Cevap Yok',
};

function todayStartISO(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function fetchLiveActivity(): Promise<{
  visits: LiveVisitRow[];
  repNames: Record<string, string>;
  clinicNames: Record<string, string>;
}> {
  const supabase = getTypedClient();
  const todayISO = todayStartISO();

  const { data: visits, error: visitsErr } = await supabase
    .from('saha_visits')
    .select('id, account_id, rep_id, check_in_at, outcome, status')
    .gte('check_in_at', todayISO)
    .order('check_in_at', { ascending: false })
    .limit(30);

  if (visitsErr) throw visitsErr;
  const rows = (visits ?? []) as LiveVisitRow[];

  const repIds = [...new Set(rows.map((r) => r.rep_id).filter(Boolean) as string[])];
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter(Boolean) as string[])];

  const [repsRes, clinicsRes] = await Promise.all([
    repIds.length > 0
      ? supabase.from('profiles').select('id, ad_soyad').in('id', repIds)
      : { data: [], error: null },
    accountIds.length > 0
      ? supabase.from('saha_clinics').select('id, name').in('id', accountIds)
      : { data: [], error: null },
  ]);

  const repNames: Record<string, string> = {};
  for (const r of (repsRes.data ?? []) as Array<{ id: string; ad_soyad: string | null }>) {
    repNames[r.id] = r.ad_soyad ?? r.id.slice(0, 8);
  }

  const clinicNames: Record<string, string> = {};
  for (const c of (clinicsRes.data ?? []) as Array<{ id: string; name: string | null }>) {
    clinicNames[c.id] = c.name ?? c.id.slice(0, 8);
  }

  return { visits: rows, repNames, clinicNames };
}

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
  /** Atanmış cari sayısı */
  cariCount: number;
  /** Tamamlanmış sipariş toplam tutarı ₺ */
  salesTry: number;
  /** Tahsilat toplamı ₺ (saha_odemeler) */
  collectionTry: number;
  /** Composite skor — 0-100 normalize (max'a göre) */
  score: number;
}

interface DashboardData {
  reps: RepRow[];
  byRep: Record<string, RepAggregate>;
  totals: {
    repCount: number;
    checkIns: number;
    km: number;
    orders: number;
    cariCount: number;
    salesTry: number;
    collectionTry: number;
  };
}

type ScoreKey = 'score' | 'checkIns' | 'km' | 'orders' | 'cariCount' | 'salesTry' | 'collectionTry';

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
  const supabase = getTypedClient();
  const sinceDate = sinceIso.slice(0, 10);

  const [reps, visits, mileage, orders, cariler, odemeler] = await Promise.all([
    // Sahada çalışan admin'ler (eda/ali) de plasiyer-seçim/KPI'da görünsün — REP + ADMIN.
    supabase.from('profiles').select('id, ad_soyad, email, role').or('role.ilike.%REP%,role.ilike.%ADMIN%'),
    supabase.from('saha_visits').select('id, rep_id').gte('check_in_at', sinceIso),
    supabase.from('saha_mileage_logs').select('profile_id, distance_km').gte('log_date', sinceDate),
    supabase
      .from('orders')
      .select('id, sales_rep_id, total_amount, total')
      .gte('created_at', sinceIso)
      .not('sales_rep_id', 'is', null),
    supabase.from('saha_cariler').select('id, sales_rep_id').not('sales_rep_id', 'is', null),
    supabase
      .from('saha_odemeler')
      .select('tutar, created_by')
      .gte('tarih', sinceDate)
      .not('created_by', 'is', null),
  ]);

  if (reps.error) throw reps.error;
  if (visits.error) throw visits.error;
  if (mileage.error) throw mileage.error;
  if (orders.error) throw orders.error;
  // cariler ve odemeler best-effort (RLS / kolon yoksa skip)
  const carilerRows = !cariler.error && cariler.data ? cariler.data : [];
  const odemelerRows = !odemeler.error && odemeler.data ? odemeler.data : [];

  const repRows = (reps.data ?? []) as RepRow[];
  const byRep: Record<string, RepAggregate> = {};

  function bucket(id: string): RepAggregate {
    let entry = byRep[id];
    if (!entry) {
      entry = {
        checkIns: 0,
        km: 0,
        orders: 0,
        cariCount: 0,
        salesTry: 0,
        collectionTry: 0,
        score: 0,
      };
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
      typeof m.distance_km === 'string' ? Number.parseFloat(m.distance_km) : (m.distance_km ?? 0);
    bucket(m.profile_id).km += Number.isFinite(km) ? km : 0;
  }

  for (const o of (orders.data ?? []) as Array<{
    sales_rep_id: string | null;
    total_amount: number | string | null;
    total: number | string | null;
  }>) {
    if (!o.sales_rep_id) continue;
    const b = bucket(o.sales_rep_id);
    b.orders += 1;
    const t =
      typeof o.total_amount === 'number'
        ? o.total_amount
        : typeof o.total === 'number'
          ? o.total
          : typeof o.total_amount === 'string'
            ? Number.parseFloat(o.total_amount)
            : 0;
    b.salesTry += Number.isFinite(t) ? t : 0;
  }

  for (const c of carilerRows as Array<{ sales_rep_id: string | null }>) {
    if (!c.sales_rep_id) continue;
    bucket(c.sales_rep_id).cariCount += 1;
  }

  for (const p of odemelerRows as Array<{
    created_by: string | null;
    tutar: number | string | null;
  }>) {
    if (!p.created_by) continue;
    const t =
      typeof p.tutar === 'number'
        ? p.tutar
        : typeof p.tutar === 'string'
          ? Number.parseFloat(p.tutar)
          : 0;
    bucket(p.created_by).collectionTry += Number.isFinite(t) ? t : 0;
  }

  // Composite skor — her metriği max'a göre normalize, ağırlıklı toplam.
  const max = {
    checkIns: 1,
    km: 1,
    orders: 1,
    cariCount: 1,
    salesTry: 1,
    collectionTry: 1,
  };
  for (const id of Object.keys(byRep)) {
    const b = byRep[id]!;
    if (b.checkIns > max.checkIns) max.checkIns = b.checkIns;
    if (b.km > max.km) max.km = b.km;
    if (b.orders > max.orders) max.orders = b.orders;
    if (b.cariCount > max.cariCount) max.cariCount = b.cariCount;
    if (b.salesTry > max.salesTry) max.salesTry = b.salesTry;
    if (b.collectionTry > max.collectionTry) max.collectionTry = b.collectionTry;
  }
  // Ağırlıklar — ziyaret + satış ana göstergeler
  const W = {
    checkIns: 20,
    km: 5,
    orders: 20,
    cariCount: 10,
    salesTry: 30,
    collectionTry: 15,
  };
  for (const id of Object.keys(byRep)) {
    const b = byRep[id]!;
    b.score =
      (b.checkIns / max.checkIns) * W.checkIns +
      (b.km / max.km) * W.km +
      (b.orders / max.orders) * W.orders +
      (b.cariCount / max.cariCount) * W.cariCount +
      (b.salesTry / max.salesTry) * W.salesTry +
      (b.collectionTry / max.collectionTry) * W.collectionTry;
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
        return acc + (Number.isFinite(km) ? km : 0);
      },
      0,
    ),
    orders: (orders.data ?? []).length,
    cariCount: carilerRows.length,
    salesTry: Object.values(byRep).reduce((s, b) => s + b.salesTry, 0),
    collectionTry: Object.values(byRep).reduce((s, b) => s + b.collectionTry, 0),
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
  const navigate = useNavigate();
  const [range, setRange] = useState<RangeKey>('30');
  const sinceIso = useMemo(() => sinceIsoFor(range), [range]);

  const dashboardQuery = useQuery({
    queryKey: ['admin', 'dashboard', sinceIso],
    queryFn: () => fetchDashboard(sinceIso),
  });

  const liveQuery = useQuery({
    queryKey: ['admin-live-activity'],
    queryFn: fetchLiveActivity,
    refetchInterval: 60_000,
  });

  const data = dashboardQuery.data;
  const reps = useMemo(() => data?.reps ?? [], [data]);

  const [sortKey, setSortKey] = useState<ScoreKey>('score');

  const sortedReps = useMemo(() => {
    if (!data) return [];
    const empty: RepAggregate = {
      checkIns: 0,
      km: 0,
      orders: 0,
      cariCount: 0,
      salesTry: 0,
      collectionTry: 0,
      score: 0,
    };
    return [...reps].sort((a, b) => {
      const aa = data.byRep[a.id] ?? empty;
      const bb = data.byRep[b.id] ?? empty;
      const diff = bb[sortKey] - aa[sortKey];
      if (diff !== 0) return diff;
      return (a.ad_soyad ?? a.email ?? '').localeCompare(b.ad_soyad ?? b.email ?? '', 'tr');
    });
  }, [data, reps, sortKey]);

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Yönetici Paneli</h1>
          <p className="text-xs text-slate-500">Saha rep'lerinin dönem performansı.</p>
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
          Veri yüklenemedi: {(dashboardQuery.error as Error | null)?.message ?? 'bilinmeyen hata'}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Hızlı erişim grid */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Yönetici Menüsü
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <AdminLink
              to="/admin/clinic-scan"
              label="Klinik Tarama"
              icon={<Radar className="h-4 w-4" />}
            />
            <AdminLink
              to="/admin/tr-seed"
              label="TR Seed Tarama"
              icon={<Globe className="h-4 w-4" />}
            />
            <AdminLink
              to="/admin/clinics"
              label="CSV / Excel İçe Aktar"
              icon={<FileUp className="h-4 w-4" />}
            />
            <AdminLink
              to="/admin/heatmap"
              label="Heatmap"
              icon={<Activity className="h-4 w-4" />}
            />
            <AdminLink
              to="/admin/regions"
              label="Bölge Atama"
              icon={<MapPinned className="h-4 w-4" />}
            />
            <AdminLink
              to="/admin/users"
              label="Kullanıcı Yönetimi"
              icon={<UserCog className="h-4 w-4" />}
            />
            <AdminLink
              to="/admin/audit-logs"
              label="Audit Log"
              icon={<ScrollText className="h-4 w-4" />}
            />
            {/* "Sipariş Onay" tile kaldırıldı: ekip tümü admin/rep → oto-onay
                (approvalRules ADMIN/REP=Infinity), onay-akışı kullanılmıyor. */}
            <AdminLink to="/invoicing/cari" label="Cariler" icon={<Wallet className="h-4 w-4" />} />
            <AdminLink
              to="/invoicing/fatura/yeni"
              label="Yeni Fatura"
              icon={<Receipt className="h-4 w-4" />}
            />
            <AdminLink
              to="/invoicing/cek-senet"
              label="Çek / Senet"
              icon={<CreditCard className="h-4 w-4" />}
            />
            <AdminLink to="/admin/bi" label="BI Panosu" icon={<BarChart3 className="h-4 w-4" />} />
            <AdminLink
              to="/admin/rep-kpi"
              label="Plasiyer KPI"
              icon={<Target className="h-4 w-4" />}
            />
            <AdminLink
              to="/admin/stock"
              label="Stok Defteri"
              icon={<Boxes className="h-4 w-4" />}
            />
            <AdminLink
              to="/invoicing/aging"
              label="Alacak Yaşlandırma"
              icon={<Hourglass className="h-4 w-4" />}
            />
          </div>
        </section>

        {/* Canlı Aktivite */}
        <section className="overflow-hidden rounded-lg border border-emerald-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-emerald-100 bg-emerald-50 px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-emerald-800">Canlı Aktivite</h2>
              <p className="text-xs text-emerald-600">Bugünkü saha ziyaretleri (son 30)</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              Canlı · 60s
            </span>
          </div>
          <div className="divide-y divide-slate-100">
            {liveQuery.isLoading && (
              <p className="px-4 py-5 text-center text-sm text-slate-400">Yükleniyor...</p>
            )}
            {liveQuery.isError && (
              <p className="px-4 py-5 text-center text-sm text-rose-500">
                Veri alınamadı: {(liveQuery.error as Error | null)?.message ?? 'hata'}
              </p>
            )}
            {!liveQuery.isLoading &&
              !liveQuery.isError &&
              (liveQuery.data?.visits.length ?? 0) === 0 && (
                <p className="px-4 py-5 text-center text-sm text-slate-400">
                  Bugün henüz ziyaret yok.
                </p>
              )}
            {(liveQuery.data?.visits ?? []).map((visit) => {
              const repName = visit.rep_id
                ? (liveQuery.data?.repNames[visit.rep_id] ?? visit.rep_id.slice(0, 8))
                : '—';
              const clinicName = visit.account_id
                ? (liveQuery.data?.clinicNames[visit.account_id] ?? visit.account_id.slice(0, 8))
                : '—';
              const timeStr = visit.check_in_at
                ? new Date(visit.check_in_at).toLocaleTimeString('tr-TR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—';
              const isInProgress = visit.status === 'in_progress';
              const outcomeText = isInProgress
                ? null
                : visit.outcome
                  ? (OUTCOME_LABEL[visit.outcome] ?? visit.outcome)
                  : null;

              return (
                <div
                  key={visit.id}
                  className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="font-medium text-slate-800">{repName}</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-600">{clinicName}</span>
                  <span className="text-slate-400">·</span>
                  <span className="tabular-nums text-slate-500">{timeStr}</span>
                  {isInProgress && (
                    <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
                      Devam ediyor
                    </span>
                  )}
                  {!isInProgress && outcomeText && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {outcomeText}
                    </span>
                  )}
                </div>
              );
            })}
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

        {/* Rep performans + scoring tablosu */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">Plasiyer Performans Skoru</h2>
              <p className="text-xs text-slate-500">
                {dashboardQuery.isLoading
                  ? 'Yükleniyor...'
                  : `${reps.length} plasiyer · skor = ziyaret + KM + sipariş + cari + satış ₺ + tahsilat ₺ (normalize)`}
              </p>
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as ScoreKey)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
            >
              <option value="score">Skor (composite)</option>
              <option value="checkIns">Ziyaret sayısı</option>
              <option value="km">KM</option>
              <option value="orders">Sipariş adedi</option>
              <option value="cariCount">Cari sayısı</option>
              <option value="salesTry">Satış ₺</option>
              <option value="collectionTry">Tahsilat ₺</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Plasiyer</th>
                  <th className="px-3 py-2 text-right">Skor</th>
                  <th className="px-3 py-2 text-right">Ziyaret</th>
                  <th className="px-3 py-2 text-right">KM</th>
                  <th className="px-3 py-2 text-right">Sipariş</th>
                  <th className="px-3 py-2 text-right">Cari</th>
                  <th className="px-3 py-2 text-right">Satış ₺</th>
                  <th className="px-3 py-2 text-right">Tahsilat ₺</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dashboardQuery.isLoading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                      Yükleniyor...
                    </td>
                  </tr>
                )}
                {!dashboardQuery.isLoading && sortedReps.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                      Plasiyer bulunamadı.
                    </td>
                  </tr>
                )}
                {sortedReps.map((rep, idx) => {
                  const agg: RepAggregate = data?.byRep[rep.id] ?? {
                    checkIns: 0,
                    km: 0,
                    orders: 0,
                    cariCount: 0,
                    salesTry: 0,
                    collectionTry: 0,
                    score: 0,
                  };
                  const isTop = idx < 3;
                  return (
                    <tr
                      key={rep.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${repLabel(rep)} KPI detayına git`}
                      onClick={() => navigate(`/admin/rep-kpi?rep=${rep.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          navigate(`/admin/rep-kpi?rep=${rep.id}`);
                        }
                      }}
                      className={`cursor-pointer ${isTop ? 'bg-emerald-50/50 hover:bg-emerald-100/60' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-3 py-2 text-xs font-semibold text-slate-500">{idx + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{repLabel(rep)}</div>
                        <div className="text-[10px] text-slate-500">{rep.email ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ${
                            isTop ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {agg.score.toFixed(0)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {agg.checkIns.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatKm(agg.km)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {agg.orders.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {agg.cariCount.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {agg.salesTry.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {agg.collectionTry.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}
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
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
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
