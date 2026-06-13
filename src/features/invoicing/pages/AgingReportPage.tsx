/**
 * AgingReportPage — Alacak Yaşlandırma (AR Aging) raporu.
 *
 * URL: /invoicing/aging
 *
 * Açık faturaları (kalan > 0, durum not in odendi/iptal) vade gününe göre
 * bucket'lar: Vadesi Gelmemiş / 0-30 / 31-60 / 61-90 / 90+.
 * 4 stat kart + recharts bar chart + cari bazlı tablo.
 *
 * kalan işaret konvansiyonu: tip 'satis' +, 'iade' - (CariDetailPage ile aynı).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Wallet, CalendarClock, AlertTriangle, Clock } from 'lucide-react';

import { getTypedClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

interface FaturaRow {
  id: string;
  cari_id: string;
  tip: string;
  toplam: number | string | null;
  odenen: number | string | null;
  kalan: number | string | null;
  vade_tarihi: string | null;
  durum: string;
}

interface CariRow {
  id: string;
  fatura_unvani: string | null;
  cari_kodu: string | null;
  sales_rep_id: string | null;
}

type BucketKey = 'current' | 'b0_30' | 'b31_60' | 'b61_90' | 'b90_plus';

interface CariAging {
  cariId: string;
  unvan: string;
  cariKodu: string;
  current: number;
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90_plus: number;
  total: number;
}

interface AgingData {
  byCari: CariAging[];
  totals: Record<BucketKey, number> & { total: number };
  /** #72: unbounded fetch'i kapatmak için fatura çekimi limitlendi.
   *  Limit'e ulaşıldıysa true → kullanıcıya "kısmi rapor" uyarısı (sessiz kesme YASAK). */
  truncated: boolean;
}

/** #72: ölçekte (binlerce açık fatura) limitsiz fetch OOM/jank yaratıyordu.
 *  Güvenli üst sınır; aşılırsa UI'da uyarı gösterilir. */
const FATURA_FETCH_LIMIT = 500;

const BUCKET_META: { key: BucketKey; label: string; color: string }[] = [
  { key: 'current', label: 'Vadesi Gelmemiş', color: '#10b981' },
  { key: 'b0_30', label: '0-30 Gün', color: '#3b82f6' },
  { key: 'b31_60', label: '31-60 Gün', color: '#f59e0b' },
  { key: 'b61_90', label: '61-90 Gün', color: '#f97316' },
  { key: 'b90_plus', label: '90+ Gün', color: '#ef4444' },
];

function num(v: number | string | null | undefined): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Gün farkı = bugün - vade (pozitif → gecikmiş). vade yoksa 0 (current sayılır). */
function daysOverdue(vade: string | null): number {
  if (!vade) return 0;
  const v = new Date(vade);
  if (Number.isNaN(v.getTime())) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  v.setHours(0, 0, 0, 0);
  return Math.floor((today.getTime() - v.getTime()) / 86400000);
}

function bucketFor(days: number): BucketKey {
  if (days <= 0) return 'current';
  if (days <= 30) return 'b0_30';
  if (days <= 60) return 'b31_60';
  if (days <= 90) return 'b61_90';
  return 'b90_plus';
}

async function fetchAging(): Promise<AgingData> {
  const supabase = getTypedClient();

  // #72: limitsiz çekim yerine üst sınır + deterministik sıralama (en geç vadeli
  // = en kritik açık alacaklar önce). limit+1 istemiyoruz; cap'e ulaşıldıysa
  // truncated bayrağı ile UI'da uyarı gösteriyoruz (sessiz kesme YASAK).
  const { data: faturalar, error } = await supabase
    .from('saha_faturalar')
    .select('id, cari_id, tip, toplam, odenen, kalan, vade_tarihi, durum')
    .gt('kalan', 0)
    .not('durum', 'in', '(odendi,iptal)')
    .order('vade_tarihi', { ascending: true, nullsFirst: false })
    .limit(FATURA_FETCH_LIMIT);
  if (error) throw error;

  const rows = (faturalar ?? []) as FaturaRow[];
  const truncated = rows.length >= FATURA_FETCH_LIMIT;

  // Cari isimlerini çek
  const cariIds = Array.from(new Set(rows.map((r) => r.cari_id).filter(Boolean)));
  const cariById = new Map<string, CariRow>();
  if (cariIds.length > 0) {
    const { data: cariler, error: cerr } = await supabase
      .from('saha_cariler')
      .select('id, fatura_unvani, cari_kodu, sales_rep_id')
      .in('id', cariIds);
    if (cerr) throw cerr;
    for (const c of (cariler ?? []) as CariRow[]) cariById.set(c.id, c);
  }

  const accMap = new Map<string, CariAging>();
  const totals: Record<BucketKey, number> & { total: number } = {
    current: 0,
    b0_30: 0,
    b31_60: 0,
    b61_90: 0,
    b90_plus: 0,
    total: 0,
  };

  for (const f of rows) {
    // kalan işaret: satis +, iade -
    const sign = f.tip === 'iade' ? -1 : 1;
    const kalan = sign * num(f.kalan);
    if (kalan === 0) continue;

    const bucket = bucketFor(daysOverdue(f.vade_tarihi));

    const cari = cariById.get(f.cari_id);
    let entry = accMap.get(f.cari_id);
    if (!entry) {
      entry = {
        cariId: f.cari_id,
        unvan: cari?.fatura_unvani ?? '(bilinmiyor)',
        cariKodu: cari?.cari_kodu ?? '—',
        current: 0,
        b0_30: 0,
        b31_60: 0,
        b61_90: 0,
        b90_plus: 0,
        total: 0,
      };
      accMap.set(f.cari_id, entry);
    }
    entry[bucket] += kalan;
    entry.total += kalan;
    totals[bucket] += kalan;
    totals.total += kalan;
  }

  const byCari = Array.from(accMap.values()).sort((a, b) => b.total - a.total);
  return { byCari, totals, truncated };
}

export default function AgingReportPage() {
  const agingQuery = useQuery({
    queryKey: ['invoicing', 'aging'],
    queryFn: fetchAging,
  });

  const data = agingQuery.data;

  const chartData = useMemo(
    () =>
      BUCKET_META.map((m) => ({
        name: m.label,
        value: data ? data.totals[m.key] : 0,
        color: m.color,
      })),
    [data],
  );

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Alacak Yaşlandırma</h1>
          <p className="text-xs text-slate-500">Açık faturaların vade gününe göre dağılımı.</p>
        </div>
      </header>

      {agingQuery.isError && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          Veri yüklenemedi: {(agingQuery.error as Error | null)?.message ?? 'bilinmeyen hata'}
        </div>
      )}

      {/* #72: limit'e ulaşıldıysa kısmi rapor uyarısı — sessiz kesme YASAK. */}
      {data?.truncated && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Çok sayıda açık fatura var; performans için yalnızca ilk {FATURA_FETCH_LIMIT} fatura (en
            eski vadeden başlayarak) gösteriliyor. Toplamlar bu alt kümeyi yansıtır.
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Stat kart grid — bucket toplamları */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="0-30 Gün"
            value={data ? formatTRY(data.totals.b0_30) : '—'}
            icon={<Clock className="h-5 w-5 text-sky-600" />}
            loading={agingQuery.isLoading}
          />
          <StatCard
            label="31-60 Gün"
            value={data ? formatTRY(data.totals.b31_60) : '—'}
            icon={<CalendarClock className="h-5 w-5 text-amber-600" />}
            loading={agingQuery.isLoading}
          />
          <StatCard
            label="61-90 Gün"
            value={data ? formatTRY(data.totals.b61_90) : '—'}
            icon={<AlertTriangle className="h-5 w-5 text-orange-600" />}
            loading={agingQuery.isLoading}
          />
          <StatCard
            label="90+ Gün"
            value={data ? formatTRY(data.totals.b90_plus) : '—'}
            icon={<AlertTriangle className="h-5 w-5 text-rose-600" />}
            loading={agingQuery.isLoading}
          />
        </div>

        {/* Toplam açık alacak + grafik */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-emerald-600" />
              <h2 className="text-sm font-semibold text-slate-700">Bucket Dağılımı</h2>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-slate-500">Toplam Açık</div>
              <div className="text-lg font-semibold tabular-nums text-slate-900">
                {data ? formatTRY(data.totals.total) : '—'}
              </div>
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} width={70} />
                <Tooltip formatter={(v: number) => formatTRY(v)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cari bazlı tablo */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">Cari Bazlı Açık Alacaklar</h2>
            <p className="text-xs text-slate-500">
              {agingQuery.isLoading
                ? 'Yükleniyor...'
                : `${data?.byCari.length ?? 0} cari · vade gününe göre bucket dağılımı`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Cari</th>
                  <th className="px-3 py-2 text-right">Toplam Açık</th>
                  <th className="px-3 py-2 text-right">Vadesi Gelmemiş</th>
                  <th className="px-3 py-2 text-right">0-30</th>
                  <th className="px-3 py-2 text-right">31-60</th>
                  <th className="px-3 py-2 text-right">61-90</th>
                  <th className="px-3 py-2 text-right">90+</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agingQuery.isLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      Yükleniyor...
                    </td>
                  </tr>
                )}
                {!agingQuery.isLoading && (data?.byCari.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      Açık alacak bulunamadı.
                    </td>
                  </tr>
                )}
                {(data?.byCari ?? []).map((c) => (
                  <tr key={c.cariId} className="hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{c.unvan}</div>
                      <div className="text-[10px] text-slate-500">{c.cariKodu}</div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {formatTRY(c.total)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {c.current ? formatTRY(c.current) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                      {c.b0_30 ? formatTRY(c.b0_30) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                      {c.b31_60 ? formatTRY(c.b31_60) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-700">
                      {c.b61_90 ? formatTRY(c.b61_90) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                      {c.b90_plus ? formatTRY(c.b90_plus) : '—'}
                    </td>
                  </tr>
                ))}
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
