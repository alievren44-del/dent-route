/**
 * CollectionListPage — Saha rep tahsilat kaydı.
 *
 * Parla Web rep/RepCollections.tsx port. Express API yerine direct Supabase.
 * Tablo: rep_collections (Parla shared schema).
 *
 * URL: /tahsilatlar
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { getSupabaseClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import {
  type RepCollection,
  type CollectionMethod,
  COLLECTION_METHOD_LABELS,
  COLLECTION_STATUS_LABELS,
} from '@features/rep-ops/types';

function formatTRY(n: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n);
}

async function fetchCollections(repId: string): Promise<RepCollection[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('rep_collections')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RepCollection[];
}

interface FormState {
  client_id: string;
  amount: string;
  method: CollectionMethod;
  check_number: string;
  due_date: string;
  reference_no: string;
}

const INITIAL_FORM: FormState = {
  client_id: '',
  amount: '',
  method: 'CASH',
  check_number: '',
  due_date: '',
  reference_no: '',
};

export default function CollectionListPage() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const query = useQuery<RepCollection[], Error>({
    queryKey: ['rep-collections', userId],
    queryFn: () => fetchCollections(userId!),
    enabled: !!userId,
  });

  const create = useMutation({
    mutationFn: async (data: FormState) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.from('rep_collections').insert({
        rep_id: userId,
        client_id: data.client_id.trim(),
        amount: Number(data.amount),
        method: data.method,
        check_number: data.method === 'CHECK' ? data.check_number.trim() || null : null,
        due_date: data.method === 'CHECK' && data.due_date ? data.due_date : null,
        reference_no: data.reference_no.trim() || null,
        status: 'PENDING' as const,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rep-collections'] });
      setShowForm(false);
      setForm(INITIAL_FORM);
      toast.success('Tahsilat kaydedildi');
    },
    onError: (e: Error) => toast.error('Hata: ' + e.message),
  });

  const monthlyTotal = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    let total = 0;
    for (const c of query.data ?? []) {
      if (c.status === 'CONFIRMED' && c.created_at >= monthStart) {
        total += Number(c.amount);
      }
    }
    return total;
  }, [query.data]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Banknote size={22} />
            Tahsilatlarım
          </h1>
          <p className="text-sm text-slate-500">
            Bu ay onaylanan: <span className="font-bold text-emerald-600">{formatTRY(monthlyTotal)}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus size={14} />
          Yeni Tahsilat
        </button>
      </header>

      {showForm && (
        <section className="space-y-3 rounded-xl bg-white p-3 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">Müşteri ID</span>
              <input
                type="text"
                value={form.client_id}
                onChange={(e) => setForm({ ...form, client_id: e.target.value })}
                className="h-10 rounded-lg border border-slate-200 px-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">Tutar (TL)</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="h-10 rounded-lg border border-slate-200 px-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">Yöntem</span>
              <select
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value as CollectionMethod })}
                className="h-10 rounded-lg border border-slate-200 px-2"
              >
                {(Object.keys(COLLECTION_METHOD_LABELS) as CollectionMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {COLLECTION_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
            {form.method === 'CHECK' && (
              <>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-slate-600">Çek No</span>
                  <input
                    type="text"
                    value={form.check_number}
                    onChange={(e) => setForm({ ...form, check_number: e.target.value })}
                    className="h-10 rounded-lg border border-slate-200 px-2"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-slate-600">Vade Tarihi</span>
                  <input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                    className="h-10 rounded-lg border border-slate-200 px-2"
                  />
                </label>
              </>
            )}
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">Referans No (ops.)</span>
              <input
                type="text"
                value={form.reference_no}
                onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
                className="h-10 rounded-lg border border-slate-200 px-2"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={() => create.mutate(form)}
            disabled={create.isPending || !form.client_id || !form.amount}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {create.isPending && <Loader2 size={14} className="animate-spin" />}
            Kaydet
          </button>
        </section>
      )}

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <Loader2 size={14} className="animate-spin" /> Yükleniyor…
        </div>
      ) : (query.data ?? []).length === 0 ? (
        <p className="text-center text-sm text-slate-400">Henüz tahsilat yok.</p>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-600">
              <tr>
                <th className="px-3 py-2">Tarih</th>
                <th className="px-3 py-2">Müşteri</th>
                <th className="px-3 py-2">Yöntem</th>
                <th className="px-3 py-2 text-right">Tutar</th>
                <th className="px-3 py-2 text-center">Durum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(query.data ?? []).map((c) => {
                const st = COLLECTION_STATUS_LABELS[c.status];
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">
                      {new Date(c.created_at).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-3 py-2 font-medium">{c.client_id}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {COLLECTION_METHOD_LABELS[c.method]}
                      {c.check_number ? ` #${c.check_number}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-600">
                      {formatTRY(Number(c.amount))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.color}`}>
                        {st.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
