/**
 * TaskListPage — Plasiyer günlük görev listesi.
 *
 * Tablo: rep_tasks (Parla shared schema). Görevler tarih bazlı liste,
 * status'a göre tıklayınca pending → done.
 *
 * URL: /gorevler
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  Plus,
  ChevronLeft,
  ChevronRight,
  Check,
  Trash2,
  Loader2,
  MapPin,
  Phone,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';

import { getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import {
  type RepTask,
  type RepTaskStatus,
  type RepTaskType,
  TASK_STATUS_LABELS,
  TASK_TYPE_LABELS,
} from '@features/rep-ops/types';

const TYPE_ICONS: Record<RepTaskType, typeof MapPin> = {
  visit: MapPin,
  call: Phone,
  paperwork: FileText,
  other: ClipboardList,
};

function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(s: string, n: number): string {
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
}

function formatDateLabel(s: string): string {
  const today = toIsoDate(new Date());
  if (s === today) return 'Bugün';
  if (s === addDays(today, 1)) return 'Yarın';
  if (s === addDays(today, -1)) return 'Dün';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function fetchTasks(repId: string, date: string): Promise<RepTask[]> {
  const supabase = getTypedClient();
  const { data, error } = await supabase
    .from('rep_tasks')
    .select('*')
    .eq('rep_id', repId)
    .eq('scheduled_date', date)
    .order('scheduled_time', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as RepTask[];
}

interface FormState {
  title: string;
  description: string;
  task_type: RepTaskType;
  client_id: string;
  scheduled_time: string;
  notes: string;
}

const INITIAL_FORM: FormState = {
  title: '',
  description: '',
  task_type: 'visit',
  client_id: '',
  scheduled_time: '',
  notes: '',
};

export default function TaskListPage() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);
  const [date, setDate] = useState<string>(() => toIsoDate(new Date()));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);

  const query = useQuery<RepTask[], Error>({
    queryKey: ['rep-tasks', userId, date],
    queryFn: () => fetchTasks(userId!, date),
    enabled: !!userId,
  });

  const create = useMutation({
    mutationFn: async (data: FormState) => {
      const supabase = getTypedClient();
      const { error } = await supabase.from('rep_tasks').insert({
        rep_id: userId!,
        title: data.title.trim(),
        description: data.description.trim() || null,
        task_type: data.task_type,
        client_id: data.client_id.trim() || null,
        scheduled_date: date,
        scheduled_time: data.scheduled_time || null,
        notes: data.notes.trim() || null,
        status: 'pending',
        created_by: userId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rep-tasks'] });
      setShowForm(false);
      setForm(INITIAL_FORM);
      toast.success('Görev eklendi');
    },
    onError: (e: Error) => toast.error('Hata: ' + e.message),
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: RepTaskStatus }) => {
      const supabase = getTypedClient();
      const { error } = await supabase.from('rep_tasks').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rep-tasks'] }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const supabase = getTypedClient();
      const { error } = await supabase.from('rep_tasks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rep-tasks'] });
      toast.success('Görev silindi');
    },
  });

  const stats = useMemo(() => {
    const tasks = query.data ?? [];
    return {
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
      pending: tasks.filter((t) => t.status === 'pending').length,
    };
  }, [query.data]);

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <ClipboardList size={22} />
          Görevlerim
        </h1>
        <p className="text-sm text-slate-500">
          {stats.done}/{stats.total} tamamlandı
        </p>
      </header>

      {/* Tarih navigasyonu */}
      <section className="flex items-center justify-between rounded-xl bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => setDate(addDays(date, -1))}
          aria-label="Önceki gün"
          className="rounded-lg p-2 hover:bg-slate-100"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="text-center">
          <div className="text-sm font-semibold">{formatDateLabel(date)}</div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-xs text-slate-500"
          />
        </div>
        <button
          type="button"
          onClick={() => setDate(addDays(date, 1))}
          aria-label="Sonraki gün"
          className="rounded-lg p-2 hover:bg-slate-100"
        >
          <ChevronRight size={16} />
        </button>
      </section>

      <button
        type="button"
        onClick={() => setShowForm((v) => !v)}
        className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
      >
        <Plus size={14} />
        Yeni Görev
      </button>

      {showForm && (
        <section className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-600">Başlık</span>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="h-10 rounded-lg border border-slate-200 px-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">Tür</span>
              <select
                value={form.task_type}
                onChange={(e) => setForm({ ...form, task_type: e.target.value as RepTaskType })}
                className="h-10 rounded-lg border border-slate-200 px-2"
              >
                {(Object.keys(TASK_TYPE_LABELS) as RepTaskType[]).map((t) => (
                  <option key={t} value={t}>
                    {TASK_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-slate-600">Saat</span>
              <input
                type="time"
                value={form.scheduled_time}
                onChange={(e) => setForm({ ...form, scheduled_time: e.target.value })}
                className="h-10 rounded-lg border border-slate-200 px-2"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-600">Müşteri ID (ops.)</span>
            <input
              type="text"
              value={form.client_id}
              onChange={(e) => setForm({ ...form, client_id: e.target.value })}
              className="h-10 rounded-lg border border-slate-200 px-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-slate-600">Notlar (ops.)</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              className="rounded-lg border border-slate-200 p-2"
            />
          </label>
          <button
            type="button"
            onClick={() => create.mutate(form)}
            disabled={create.isPending || !form.title}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50"
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
        <p className="text-center text-sm text-slate-400">Bu gün için görev yok.</p>
      ) : (
        <ul className="space-y-2">
          {(query.data ?? []).map((t) => {
            const Icon = TYPE_ICONS[t.task_type];
            const st = TASK_STATUS_LABELS[t.status];
            const isDone = t.status === 'done';
            return (
              <li
                key={t.id}
                className={`flex items-start gap-2 rounded-xl bg-white p-3 shadow-sm ${
                  isDone ? 'opacity-60' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() =>
                    updateStatus.mutate({
                      id: t.id,
                      status: t.status === 'done' ? 'pending' : 'done',
                    })
                  }
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    isDone
                      ? 'border-emerald-500 bg-emerald-500 text-white'
                      : 'border-slate-300 bg-white text-slate-400 hover:border-emerald-500'
                  }`}
                  aria-label="Durumu değiştir"
                >
                  {isDone && <Check size={14} />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Icon size={14} className="shrink-0 text-slate-500" />
                    <h3 className={`text-sm font-semibold ${isDone ? 'line-through' : ''}`}>
                      {t.title}
                    </h3>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5">
                      {TASK_TYPE_LABELS[t.task_type]}
                    </span>
                    {t.scheduled_time && <span>⏰ {t.scheduled_time}</span>}
                    {t.client_id && <span>👤 {t.client_id.slice(0, 8)}</span>}
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.color}`}
                    >
                      {st.label}
                    </span>
                  </div>
                  {t.notes && <p className="mt-1 text-xs text-slate-500">{t.notes}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Görev silinsin mi?')) remove.mutate(t.id);
                  }}
                  className="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Sil"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
