/**
 * RepKpiPage — Plasiyer Performansı (actual vs target).
 *
 * URL: /admin/rep-kpi
 *
 * Seçili ay (default current YYYY-MM) için her rep:
 *   ACTUALS: ziyaret adedi (saha_visits), sipariş ₺ (orders),
 *            tahsilat ₺ (saha_odemeler), numune adedi+maliyet (saha_samples),
 *            tamamlanan rota (saha_routes status='completed').
 *   TARGETS: saha_rep_targets (visit/order/collection).
 * UI: rep tablosu + progress bar'lar + actual vs target sipariş ₺ bar chart.
 *     ADMIN inline hedef set formu (upsert saha_rep_targets).
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Target, Save } from 'lucide-react';

import { getTypedClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

interface RepRow {
  id: string;
  ad_soyad: string | null;
  email: string | null;
  role: string | null;
}

interface RepActual {
  visits: number;
  ordersTl: number;
  collectionsTl: number;
  sampleCount: number;
  sampleCostTl: number;
  routesCompleted: number;
}

interface RepTarget {
  visitTarget: number;
  orderTargetTl: number;
  collectionTargetTl: number;
}

interface KpiData {
  reps: RepRow[];
  actuals: Record<string, RepActual>;
  targets: Record<string, RepTarget>;
}

function num(v: number | string | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 'YYYY-MM' → ay başı/bitişi ISO (UTC). */
function monthRange(ym: string): {
  startIso: string;
  endIso: string;
  startDate: string;
  endDate: string;
} {
  const parts = ym.split('-');
  const y = Number.parseInt(parts[0] ?? '1970', 10);
  const m = Number.parseInt(parts[1] ?? '1', 10);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, 0, 0, 0)); // exclusive
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

async function fetchKpi(ym: string): Promise<KpiData> {
  const supabase = getTypedClient();
  const { startIso, endIso, startDate, endDate } = monthRange(ym);

  const [reps, visits, orders, odemeler, samples, routes, targets] = await Promise.all([
    supabase.from('profiles').select('id, ad_soyad, email, role').ilike('role', '%REP%'),
    supabase
      .from('saha_visits')
      .select('rep_id')
      .gte('check_in_at', startIso)
      .lt('check_in_at', endIso),
    supabase
      .from('orders')
      .select('sales_rep_id, total_amount, total')
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .not('sales_rep_id', 'is', null),
    supabase
      .from('saha_odemeler')
      .select('created_by, tutar')
      .gte('tarih', startDate)
      .lt('tarih', endDate)
      .not('created_by', 'is', null),
    supabase
      .from('saha_samples')
      .select('rep_id, saha_sample_lines(qty, unit_cost_tl)')
      .gte('given_at', startIso)
      .lt('given_at', endIso),
    // #73: routesCompleted ay-bazlı olmalı. saha_routes.completed_at (timestamptz)
    // seçili ayın aralığına göre filtrelenir; aksi halde kariyer-toplamı sayılıp
    // KPI yanlış çıkar. completed_at NULL olan eski tamamlanmış rotalar bu ayda
    // sayılmaz (doğru davranış: ay-içi tamamlananları gösteriyoruz).
    supabase
      .from('saha_routes')
      .select('profile_id, status, completed_at')
      .eq('status', 'completed')
      .gte('completed_at', startIso)
      .lt('completed_at', endIso),
    supabase
      .from('saha_rep_targets')
      .select('rep_id, visit_target, order_target_tl, collection_target_tl')
      .eq('year_month', ym),
  ]);

  if (reps.error) throw reps.error;

  const repRows = (reps.data ?? []) as RepRow[];
  const actuals: Record<string, RepActual> = {};

  function bucket(id: string): RepActual {
    let e = actuals[id];
    if (!e) {
      e = {
        visits: 0,
        ordersTl: 0,
        collectionsTl: 0,
        sampleCount: 0,
        sampleCostTl: 0,
        routesCompleted: 0,
      };
      actuals[id] = e;
    }
    return e;
  }
  for (const r of repRows) bucket(r.id);

  for (const v of (visits.data ?? []) as Array<{ rep_id: string | null }>) {
    if (!v.rep_id) continue;
    bucket(v.rep_id).visits += 1;
  }

  for (const o of (orders.data ?? []) as Array<{
    sales_rep_id: string | null;
    total_amount: number | string | null;
    total: number | string | null;
  }>) {
    if (!o.sales_rep_id) continue;
    const t = o.total_amount != null ? num(o.total_amount) : num(o.total);
    bucket(o.sales_rep_id).ordersTl += t;
  }

  for (const p of (odemeler.data ?? []) as Array<{
    created_by: string | null;
    tutar: number | string | null;
  }>) {
    if (!p.created_by) continue;
    bucket(p.created_by).collectionsTl += num(p.tutar);
  }

  for (const s of (samples.data ?? []) as Array<{
    rep_id: string | null;
    saha_sample_lines: Array<{
      qty: number | string | null;
      unit_cost_tl: number | string | null;
    }> | null;
  }>) {
    if (!s.rep_id) continue;
    const b = bucket(s.rep_id);
    b.sampleCount += 1;
    const lines = Array.isArray(s.saha_sample_lines) ? s.saha_sample_lines : [];
    for (const l of lines) b.sampleCostTl += num(l.qty) * num(l.unit_cost_tl);
  }

  // routes: status='completed' + completed_at seçili ay aralığında (#73 fix).
  if (!routes.error) {
    for (const r of (routes.data ?? []) as Array<{ profile_id: string | null }>) {
      if (!r.profile_id) continue;
      bucket(r.profile_id).routesCompleted += 1;
    }
  }

  const targetMap: Record<string, RepTarget> = {};
  if (!targets.error) {
    for (const t of (targets.data ?? []) as Array<{
      rep_id: string;
      visit_target: number | string | null;
      order_target_tl: number | string | null;
      collection_target_tl: number | string | null;
    }>) {
      targetMap[t.rep_id] = {
        visitTarget: num(t.visit_target),
        orderTargetTl: num(t.order_target_tl),
        collectionTargetTl: num(t.collection_target_tl),
      };
    }
  }

  return { reps: repRows, actuals, targets: targetMap };
}

function repLabel(rep: RepRow): string {
  return rep.ad_soyad ?? rep.email ?? rep.id.slice(0, 8);
}

function pct(actual: number, target: number): number {
  if (!target || target <= 0) return 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

function ProgressBar({ value }: { value: number }) {
  const color = value >= 100 ? 'bg-emerald-500' : value >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div
        className={`h-full ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export default function RepKpiPage() {
  const queryClient = useQueryClient();
  const [ym, setYm] = useState<string>(currentYearMonth());

  const kpiQuery = useQuery({
    queryKey: ['admin', 'rep-kpi', ym],
    queryFn: () => fetchKpi(ym),
  });

  const data = kpiQuery.data;
  const reps = data?.reps ?? [];

  const emptyActual: RepActual = {
    visits: 0,
    ordersTl: 0,
    collectionsTl: 0,
    sampleCount: 0,
    sampleCostTl: 0,
    routesCompleted: 0,
  };
  const emptyTarget: RepTarget = { visitTarget: 0, orderTargetTl: 0, collectionTargetTl: 0 };

  const chartData = useMemo(
    () =>
      reps.map((r) => {
        const a = data?.actuals[r.id] ?? emptyActual;
        const t = data?.targets[r.id] ?? emptyTarget;
        return {
          name: repLabel(r),
          'Gerçekleşen ₺': Math.round(a.ordersTl),
          'Hedef ₺': Math.round(t.orderTargetTl),
        };
      }),
    [reps, data], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // --- Inline hedef set formu ---
  const [formRepId, setFormRepId] = useState('');
  const [formVisit, setFormVisit] = useState('');
  const [formOrder, setFormOrder] = useState('');
  const [formCollection, setFormCollection] = useState('');

  const upsertMutation = useMutation({
    mutationFn: async () => {
      if (!formRepId) throw new Error('Plasiyer seçin.');
      const supabase = getTypedClient();
      const { error } = await supabase.from('saha_rep_targets').upsert(
        {
          rep_id: formRepId,
          year_month: ym,
          visit_target: Number.parseInt(formVisit, 10) || 0,
          order_target_tl: Number.parseFloat(formOrder) || 0,
          collection_target_tl: Number.parseFloat(formCollection) || 0,
        },
        { onConflict: 'rep_id,year_month' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'rep-kpi', ym] });
      setFormVisit('');
      setFormOrder('');
      setFormCollection('');
    },
  });

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Plasiyer KPI</h1>
          <p className="text-xs text-slate-500">Hedef vs gerçekleşen — aylık performans.</p>
        </div>
        <input
          type="month"
          value={ym}
          onChange={(e) => setYm(e.target.value)}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm"
        />
      </header>

      {kpiQuery.isError && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Veri yüklenemedi: {(kpiQuery.error as Error | null)?.message ?? 'bilinmeyen hata'}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Hedef set formu */}
        <section className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-600" />
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Hedef Belirle ({ym})
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <select
              value={formRepId}
              onChange={(e) => setFormRepId(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">Plasiyer seç…</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {repLabel(r)}
                </option>
              ))}
            </select>
            <input
              type="number"
              placeholder="Ziyaret hedefi"
              value={formVisit}
              onChange={(e) => setFormVisit(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder="Sipariş ₺ hedefi"
              value={formOrder}
              onChange={(e) => setFormOrder(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
            />
            <input
              type="number"
              placeholder="Tahsilat ₺ hedefi"
              value={formCollection}
              onChange={(e) => setFormCollection(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
            />
            <button
              type="button"
              onClick={() => upsertMutation.mutate()}
              disabled={upsertMutation.isPending || !formRepId}
              className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              Kaydet
            </button>
          </div>
          {upsertMutation.isError && (
            <p className="mt-2 text-xs text-rose-600">
              {(upsertMutation.error as Error | null)?.message ?? 'Kaydedilemedi.'}
            </p>
          )}
        </section>

        {/* Actual vs Target sipariş ₺ chart */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            Sipariş ₺ — Gerçekleşen vs Hedef
          </h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(v: number) => formatTRY(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Gerçekleşen ₺" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Hedef ₺" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Rep tablosu — actual vs target + progress */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Plasiyer Detay</h2>
            <p className="text-xs text-slate-500">
              {kpiQuery.isLoading ? 'Yükleniyor...' : `${reps.length} plasiyer · ${ym}`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Plasiyer</th>
                  <th className="px-3 py-2">Ziyaret (hedef)</th>
                  <th className="px-3 py-2">Sipariş ₺ (hedef)</th>
                  <th className="px-3 py-2">Tahsilat ₺ (hedef)</th>
                  <th className="px-3 py-2 text-right">Numune</th>
                  <th className="px-3 py-2 text-right">Numune ₺</th>
                  <th className="px-3 py-2 text-right">Rota✓</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {kpiQuery.isLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      Yükleniyor...
                    </td>
                  </tr>
                )}
                {!kpiQuery.isLoading && reps.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      Plasiyer bulunamadı.
                    </td>
                  </tr>
                )}
                {reps.map((rep) => {
                  const a = data?.actuals[rep.id] ?? emptyActual;
                  const t = data?.targets[rep.id] ?? emptyTarget;
                  return (
                    <tr key={rep.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{repLabel(rep)}</div>
                        <div className="text-[10px] text-slate-500">{rep.email ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 align-top" style={{ minWidth: 130 }}>
                        <div className="flex justify-between text-xs tabular-nums text-slate-700">
                          <span>{a.visits.toLocaleString('tr-TR')}</span>
                          <span className="text-slate-400">
                            / {t.visitTarget.toLocaleString('tr-TR')}
                          </span>
                        </div>
                        <ProgressBar value={pct(a.visits, t.visitTarget)} />
                      </td>
                      <td className="px-3 py-2 align-top" style={{ minWidth: 150 }}>
                        <div className="flex justify-between text-xs tabular-nums text-slate-700">
                          <span>{formatTRY(a.ordersTl)}</span>
                          <span className="text-slate-400">/ {formatTRY(t.orderTargetTl)}</span>
                        </div>
                        <ProgressBar value={pct(a.ordersTl, t.orderTargetTl)} />
                      </td>
                      <td className="px-3 py-2 align-top" style={{ minWidth: 150 }}>
                        <div className="flex justify-between text-xs tabular-nums text-slate-700">
                          <span>{formatTRY(a.collectionsTl)}</span>
                          <span className="text-slate-400">
                            / {formatTRY(t.collectionTargetTl)}
                          </span>
                        </div>
                        <ProgressBar value={pct(a.collectionsTl, t.collectionTargetTl)} />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {a.sampleCount.toLocaleString('tr-TR')}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {formatTRY(a.sampleCostTl)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {a.routesCompleted.toLocaleString('tr-TR')}
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
