/**
 * CollectionListPage — Saha rep tahsilat kaydı.
 *
 * Parla Web rep/RepCollections.tsx port. Express API yerine direct Supabase.
 * Tablo: rep_collections (Parla shared schema).
 *
 * URL: /tahsilatlar
 */

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, Plus, Loader2, Search, X, Check } from 'lucide-react';
import { toast } from 'sonner';

import { getTypedClient } from '@lib/supabase';
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

// #69 fix: client_id serbest-metin ham UUID girişi yerine cari/klinik picker.
// OrderFormPage'deki saha_clinics arama deseni port edildi (yerel useDebounced,
// repo'da paylaşılan hook yok). Aktif klinik sonuçlarını id+ad olarak döner.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

interface ClinicOption {
  id: string;
  name: string;
  address: string | null;
}

async function fetchCollections(repId: string): Promise<RepCollection[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('rep_collections')
    .select('*')
    .eq('rep_id', repId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as RepCollection[];
}

// Tablo render'ında ham UUID yerine klinik/cari adı göstermek için lookup.
// Tahsilat satırlarındaki client_id'leri tek seferde saha_clinics'ten çözer,
// bulunamayanlar için profiles fallback dener. Sonuç: { uuid -> görünen ad }.
async function fetchClientNames(ids: string[]): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  if (ids.length === 0) return map;
  const supabase = getTypedClient();

  // 1) saha_clinics (modern akış).
  const clinicRes = await supabase.from('saha_clinics').select('id, name').in('id', ids);
  for (const row of (clinicRes.data ?? []) as Array<{ id: string; name: string | null }>) {
    if (row.name) map[row.id] = row.name;
  }

  // 2) profiles fallback — saha_clinics'te bulunamayan id'ler için.
  const missing = ids.filter((id) => !map[id]);
  if (missing.length > 0) {
    const profRes = await supabase
      .from('profiles')
      .select('id, klinik_adi, ad_soyad, email')
      .in('id', missing);
    for (const row of (profRes.data ?? []) as Array<{
      id: string;
      klinik_adi: string | null;
      ad_soyad: string | null;
      email: string | null;
    }>) {
      const label = row.klinik_adi ?? row.ad_soyad ?? row.email;
      if (label) map[row.id] = label;
    }
  }

  return map;
}

interface FormState {
  client_id: string;
  // Seçilen cari/klinik adı — UI'da gösterim + validate için (DB'ye yazılmaz).
  client_name: string;
  amount: string;
  method: CollectionMethod;
  check_number: string;
  due_date: string;
  reference_no: string;
}

const INITIAL_FORM: FormState = {
  client_id: '',
  client_name: '',
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

  // #69: cari/klinik picker state — serbest-metin UUID yerine arama+seçim.
  const [clientSearch, setClientSearch] = useState('');
  const debouncedClientSearch = useDebounced(clientSearch, 300);

  const query = useQuery<RepCollection[], Error>({
    queryKey: ['rep-collections', userId],
    queryFn: () => fetchCollections(userId!),
    enabled: !!userId,
  });

  // Klinik arama — en az 2 karakter, aktif saha_clinics kayıtları.
  const clientSearchQuery = useQuery<ClinicOption[], Error>({
    queryKey: ['collection-client-search', debouncedClientSearch],
    enabled: showForm && debouncedClientSearch.trim().length >= 2,
    queryFn: async (): Promise<ClinicOption[]> => {
      const supabase = getTypedClient();
      const term = `%${debouncedClientSearch.trim()}%`;
      const { data, error } = await supabase
        .from('saha_clinics')
        .select('id, name, address')
        .ilike('name', term)
        .order('name')
        .limit(20);
      if (error) throw error;
      return ((data ?? []) as Array<{ id: string; name: string | null; address: string | null }>).map(
        (r) => ({ id: r.id, name: r.name ?? 'İsimsiz klinik', address: r.address }),
      );
    },
  });

  // Tablo satırlarındaki ham UUID'leri okunur isme çeviren lookup.
  const clientIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of query.data ?? []) {
      if (c.client_id) set.add(c.client_id);
    }
    return Array.from(set);
  }, [query.data]);

  const namesQuery = useQuery<Record<string, string>, Error>({
    queryKey: ['collection-client-names', clientIds],
    enabled: clientIds.length > 0,
    queryFn: () => fetchClientNames(clientIds),
  });
  const clientNames = namesQuery.data ?? {};

  const create = useMutation({
    mutationFn: async (data: FormState) => {
      const supabase = getTypedClient();
      // Typed-client guard: rep_id NOT NULL — session yoksa insert malformed satır
      // yazardı (undefined → boş). Oturum yoksa erken hata ver.
      if (!userId) throw new Error('Oturum bulunamadı — tekrar giriş yapın.');
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
      void queryClient.invalidateQueries({ queryKey: ['rep-collections'] });
      setShowForm(false);
      setForm(INITIAL_FORM);
      setClientSearch('');
      toast.success('Tahsilat kaydedildi');
    },
    onError: (e: Error) => toast.error('Hata: ' + e.message),
  });

  const monthlyTotal = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
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
            Bu ay onaylanan:{' '}
            <span className="font-bold text-emerald-600">{formatTRY(monthlyTotal)}</span>
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
            {/* #69: ham UUID girişi yerine cari/klinik picker. */}
            <label className="flex flex-col gap-1 text-xs sm:col-span-2">
              <span className="font-medium text-slate-600">Cari / Klinik</span>
              {form.client_id ? (
                // Seçili cari — ad gösterimi + temizle.
                <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-2">
                  <span className="flex items-center gap-1.5 truncate text-sm font-medium text-emerald-800">
                    <Check size={14} /> {form.client_name || form.client_id}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setForm({ ...form, client_id: '', client_name: '' });
                      setClientSearch('');
                    }}
                    className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100"
                    aria-label="Cari seçimini temizle"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Klinik adı ile ara (en az 2 harf)…"
                    className="h-10 w-full rounded-lg border border-slate-200 pl-7 pr-2"
                  />
                  {(clientSearchQuery.isFetching ||
                    (debouncedClientSearch.trim().length >= 2 &&
                      (clientSearchQuery.data?.length ?? 0) > 0)) && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {clientSearchQuery.isFetching ? (
                        <div className="flex items-center gap-2 px-3 py-2 text-slate-500">
                          <Loader2 size={14} className="animate-spin" /> Aranıyor…
                        </div>
                      ) : (
                        (clientSearchQuery.data ?? []).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setForm({ ...form, client_id: opt.id, client_name: opt.name });
                              setClientSearch('');
                            }}
                            className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-slate-50"
                          >
                            <span className="font-medium text-slate-800">{opt.name}</span>
                            {opt.address && (
                              <span className="truncate text-[11px] text-slate-400">
                                {opt.address}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                  {debouncedClientSearch.trim().length >= 2 &&
                    !clientSearchQuery.isFetching &&
                    (clientSearchQuery.data?.length ?? 0) === 0 && (
                      <p className="mt-1 text-[11px] text-slate-400">Eşleşen klinik bulunamadı.</p>
                    )}
                </div>
              )}
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
                    <td className="px-3 py-2 font-medium">
                      {/* #69: ham UUID yerine çözülen klinik/cari adı; lookup
                          yüklenirken veya isim bulunamazsa zarif fallback. */}
                      {clientNames[c.client_id] ??
                        (namesQuery.isLoading ? (
                          <span className="text-slate-400">Yükleniyor…</span>
                        ) : (
                          <span className="text-slate-400" title={c.client_id}>
                            Bilinmeyen cari
                          </span>
                        ))}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {COLLECTION_METHOD_LABELS[c.method]}
                      {c.check_number ? ` #${c.check_number}` : ''}
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-emerald-600">
                      {formatTRY(Number(c.amount))}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.color}`}
                      >
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
