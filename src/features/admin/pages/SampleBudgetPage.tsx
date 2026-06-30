/**
 * SampleBudgetPage — Admin sayfası.
 *
 * Plasiyerlere AYLIK numune bütçesi tanımlar (saha_sample_quotas).
 * Form (SampleFormMobile) `kalan = budget_tl - spent_tl` okur; satır yoksa kalan=0
 * → plasiyer numune veremez. Bu sayfa o satırları yönetir.
 *
 * RLS: saha_sample_quotas_admin_insert/update (saha_is_admin()) zaten mevcut.
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, Wallet, Loader2 } from 'lucide-react';

import { getTypedClient } from '@/lib/supabase';

interface RepRow {
  id: string;
  ad_soyad: string | null;
  email: string | null;
}

interface QuotaRow {
  rep_id: string;
  year_month: string;
  budget_tl: number;
  spent_tl: number;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function fetchReps(): Promise<RepRow[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, ad_soyad, email, role')
    .ilike('role', '%REP%');
  if (error) throw error;
  return (data ?? [])
    .map((r) => ({ id: r.id, ad_soyad: r.ad_soyad, email: r.email }))
    .sort((a, b) =>
      (a.ad_soyad ?? a.email ?? '').localeCompare(b.ad_soyad ?? b.email ?? '', 'tr'),
    );
}

async function fetchQuotas(yearMonth: string): Promise<QuotaRow[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('saha_sample_quotas')
    .select('rep_id, year_month, budget_tl, spent_tl')
    .eq('year_month', yearMonth);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    rep_id: r.rep_id,
    year_month: r.year_month,
    budget_tl: Number(r.budget_tl),
    spent_tl: Number(r.spent_tl),
  }));
}

async function saveBudget(repId: string, yearMonth: string, budgetTl: number): Promise<void> {
  const supabase = getTypedClient();
  const { error } = await supabase
    .from('saha_sample_quotas')
    .upsert(
      { rep_id: repId, year_month: yearMonth, budget_tl: budgetTl },
      { onConflict: 'rep_id,year_month' },
    );
  if (error) throw error;
}

function repLabel(rep: RepRow): string {
  return rep.ad_soyad ?? rep.email ?? rep.id.slice(0, 8);
}

export default function SampleBudgetPage() {
  const queryClient = useQueryClient();
  const [yearMonth, setYearMonth] = useState<string>(currentYearMonth());
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const repsQuery = useQuery({ queryKey: ['admin', 'sample-budget', 'reps'], queryFn: fetchReps });
  const quotasQuery = useQuery({
    queryKey: ['admin', 'sample-budget', 'quotas', yearMonth],
    queryFn: () => fetchQuotas(yearMonth),
  });

  const quotaMap = useMemo(() => {
    const m = new Map<string, QuotaRow>();
    (quotasQuery.data ?? []).forEach((q) => m.set(q.rep_id, q));
    return m;
  }, [quotasQuery.data]);

  const mutation = useMutation({
    mutationFn: ({ repId, budget }: { repId: string; budget: number }) =>
      saveBudget(repId, yearMonth, budget),
    onSuccess: (_d, vars) => {
      setDrafts((p) => {
        const n = { ...p };
        delete n[vars.repId];
        return n;
      });
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'sample-budget', 'quotas', yearMonth],
      });
    },
  });

  const reps = repsQuery.data ?? [];

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center gap-2">
        <Wallet size={22} className="text-emerald-600" />
        <h1 className="text-lg font-bold text-slate-900">Plasiyer Numune Bütçesi</h1>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm font-medium text-slate-600">Ay:</label>
        <input
          type="month"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
      </div>

      {(repsQuery.isLoading || quotasQuery.isLoading) && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Yükleniyor…
        </div>
      )}

      {repsQuery.error && (
        <p className="text-sm text-red-600">Plasiyerler yüklenemedi.</p>
      )}

      {reps.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Plasiyer</th>
                <th className="px-3 py-2 text-right">Bütçe (₺)</th>
                <th className="px-3 py-2 text-right">Harcanan</th>
                <th className="px-3 py-2 text-right">Kalan</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {reps.map((rep) => {
                const quota = quotaMap.get(rep.id);
                const draft = drafts[rep.id];
                const value = draft ?? (quota ? String(quota.budget_tl) : '');
                const spent = quota?.spent_tl ?? 0;
                const budgetNum = Number(value) || 0;
                const remaining = Math.max(0, budgetNum - spent);
                const dirty = draft !== undefined && draft !== (quota ? String(quota.budget_tl) : '');
                const saving = mutation.isPending && mutation.variables?.repId === rep.id;
                return (
                  <tr key={rep.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium text-slate-800">{repLabel(rep)}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        type="number"
                        min={0}
                        step={100}
                        value={value}
                        placeholder="0"
                        onChange={(e) =>
                          setDrafts((p) => ({ ...p, [rep.id]: e.target.value }))
                        }
                        className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm"
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">{spent.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right text-slate-700">{remaining.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={!dirty || saving || value === ''}
                        onClick={() =>
                          mutation.mutate({ repId: rep.id, budget: Number(value) || 0 })
                        }
                        className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                      >
                        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                        Kaydet
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {mutation.error && (
        <p className="mt-2 text-sm text-red-600">Kaydedilemedi — yetki veya bağlantı hatası.</p>
      )}

      <p className="mt-3 text-xs text-slate-500">
        Bütçe aylık tanımlanır. Plasiyer numune verdikçe "Harcanan" artar; kalan 0 olunca
        bütçe aşımı uyarısı çıkar (admin numunede bütçeye takılmaz).
      </p>
    </div>
  );
}
