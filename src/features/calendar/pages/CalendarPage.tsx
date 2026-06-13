/**
 * CalendarPage — Plasiyer takvimi (/takvim).
 *
 * Ziyaretlerde girilen "Tekrar Ziyaret" ve "Hekim Randevusu" hatırlatmaları
 * (saha_reminders) + tamamlanan ziyaretler (saha_visits, not + sonuç) tek bir
 * ajanda akışında, tarihe göre gruplanmış gösterilir.
 *
 * Rol davranışı:
 *  - sales_rep: yalnız kendi takvimi (RLS rep_id = auth.uid).
 *  - admin: üstte plasiyer seçici → herhangi bir plasiyerin takvimi (RLS admin = tümü).
 *
 * Filtreler: Yaklaşan (bugün+) · Geçmiş · Tümü.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlarmClock,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Stethoscope,
  StickyNote,
} from 'lucide-react';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions } from '@core/auth/usePermissions';

type FilterMode = 'upcoming' | 'past' | 'all';

interface ReminderRow {
  id: string;
  rep_id: string;
  account_id: string | null;
  visit_id: string | null;
  type: 'revisit' | 'appointment' | 'task' | 'note';
  title: string | null;
  note: string | null;
  due_at: string;
  status: 'open' | 'done' | 'cancelled';
}

interface VisitRow {
  id: string;
  account_id: string | null;
  check_in_at: string;
  outcome: string | null;
  notes: string | null;
}

interface RepOption {
  id: string;
  name: string;
}

interface AgendaItem {
  kind: 'reminder' | 'visit';
  id: string;
  at: string; // ISO
  type: ReminderRow['type'] | 'visit';
  title: string;
  note: string | null;
  accountId: string | null;
  status?: ReminderRow['status'];
  visitId?: string | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  met: 'Görüşüldü',
  callback: 'Tekrar Aranacak',
  no_meeting: 'Görüşülemedi',
  order_taken: 'Sipariş Alındı',
  sample_given: 'Numune Verildi',
};

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Bugün';
  if (diffDays === 1) return 'Yarın';
  if (diffDays === -1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function typeMeta(type: AgendaItem['type']): {
  label: string;
  Icon: typeof CalendarClock;
  color: string;
} {
  switch (type) {
    case 'appointment':
      return { label: 'Randevu', Icon: Stethoscope, color: 'text-blue-600' };
    case 'revisit':
      return { label: 'Tekrar Ziyaret', Icon: CalendarClock, color: 'text-amber-600' };
    case 'visit':
      return { label: 'Ziyaret', Icon: MapPin, color: 'text-green-600' };
    case 'note':
      return { label: 'Not', Icon: StickyNote, color: 'text-purple-600' };
    default:
      return { label: 'Görev', Icon: CalendarDays, color: 'text-foreground' };
  }
}

function CalendarPage(): JSX.Element {
  const selfId = useAuthStore((s) => s.session?.userId ?? null);
  const { isAdmin } = usePermissions();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterMode>('upcoming');
  const [repFilter, setRepFilter] = useState<string>('self');

  const targetRepId = isAdmin && repFilter !== 'self' ? repFilter : selfId;

  // Admin: plasiyer seçici listesi
  const repsQuery = useQuery({
    queryKey: ['calendar-reps'],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<RepOption[]> => {
      const sb = getTypedClient();
      const { data, error } = await sb
        .from('profiles')
        .select('id, ad_soyad, email, role')
        .in('role', ['REP', 'SALES_REP', 'sales_rep', 'rep', 'MANAGER', 'manager']);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        name: (r.ad_soyad as string) || (r.email as string) || String(r.id).slice(0, 8),
      }));
    },
  });

  // Hatırlatmalar + ziyaretler
  const dataQuery = useQuery({
    queryKey: ['calendar', targetRepId, filter],
    enabled: Boolean(targetRepId),
    queryFn: async (): Promise<{ reminders: ReminderRow[]; visits: VisitRow[] }> => {
      if (!targetRepId) return { reminders: [], visits: [] };
      const sb = getSupabaseClient();
      const typed = getTypedClient();

      let rq = sb
        .from('saha_reminders')
        .select('id, rep_id, account_id, visit_id, type, title, note, due_at, status')
        .eq('rep_id', targetRepId)
        .neq('status', 'cancelled')
        .order('due_at', { ascending: true });
      if (filter === 'upcoming') rq = rq.gte('due_at', startOfTodayISO());
      if (filter === 'past') rq = rq.lt('due_at', startOfTodayISO());

      let vq = typed
        .from('saha_visits')
        .select('id, account_id, check_in_at, outcome, notes')
        .eq('rep_id', targetRepId)
        .eq('status', 'completed')
        .order('check_in_at', { ascending: false })
        .limit(100);
      if (filter === 'upcoming') vq = vq.gte('check_in_at', startOfTodayISO());
      if (filter === 'past') vq = vq.lt('check_in_at', startOfTodayISO());

      const [rRes, vRes] = await Promise.all([rq, vq]);
      if (rRes.error) throw rRes.error;
      return {
        reminders: (rRes.data ?? []) as ReminderRow[],
        visits: (vRes.data ?? []) as VisitRow[],
      };
    },
  });

  const reminders = useMemo(() => dataQuery.data?.reminders ?? [], [dataQuery.data]);
  const visits = useMemo(() => dataQuery.data?.visits ?? [], [dataQuery.data]);

  // Klinik adlarını topluca çek
  const accountIds = useMemo(() => {
    const s = new Set<string>();
    reminders.forEach((r) => r.account_id && s.add(r.account_id));
    visits.forEach((v) => v.account_id && s.add(v.account_id));
    return [...s];
  }, [reminders, visits]);

  const namesQuery = useQuery({
    queryKey: ['calendar-clinic-names', accountIds.sort().join(',')],
    enabled: accountIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, { name: string; phone: string | null }>> => {
      const typed = getTypedClient();
      const { data } = await typed
        .from('saha_clinics')
        .select('id, name, phone')
        .in('id', accountIds);
      const map: Record<string, { name: string; phone: string | null }> = {};
      ((data ?? []) as { id: string; name: string; phone: string | null }[]).forEach((c) => {
        map[c.id] = { name: c.name, phone: c.phone };
      });
      return map;
    },
  });
  const nameMap = namesQuery.data ?? {};

  // Birleşik ajanda
  const grouped = useMemo(() => {
    const items: AgendaItem[] = [];
    for (const r of reminders) {
      items.push({
        kind: 'reminder',
        id: r.id,
        at: r.due_at,
        type: r.type,
        title: r.title || typeMeta(r.type).label,
        note: r.note,
        accountId: r.account_id,
        status: r.status,
        visitId: r.visit_id,
      });
    }
    for (const v of visits) {
      const outcome = v.outcome ? (OUTCOME_LABEL[v.outcome] ?? v.outcome) : null;
      items.push({
        kind: 'visit',
        id: v.id,
        at: v.check_in_at,
        type: 'visit',
        title: outcome ? `Ziyaret — ${outcome}` : 'Ziyaret',
        note: v.notes,
        accountId: v.account_id,
        visitId: v.id,
      });
    }
    // upcoming: yakın tarih önce; past/all: yeni tarih önce
    items.sort((a, b) =>
      filter === 'upcoming'
        ? new Date(a.at).getTime() - new Date(b.at).getTime()
        : new Date(b.at).getTime() - new Date(a.at).getTime(),
    );
    const map = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const k = dayKey(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()];
  }, [reminders, visits, filter]);

  async function markDone(id: string): Promise<void> {
    const sb = getSupabaseClient();
    const { error } = await sb.from('saha_reminders').update({ status: 'done' }).eq('id', id);
    if (error) {
      toast.error('Güncellenemedi');
      return;
    }
    toast.success('Tamamlandı');
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  // Ertele: yeni due_at + bildirimi tekrar gönderilebilir yap (notified_at sıfırla).
  async function snooze(id: string, ms: number, label: string): Promise<void> {
    const sb = getSupabaseClient();
    const due = new Date(Date.now() + ms).toISOString();
    const { error } = await sb
      .from('saha_reminders')
      .update({ due_at: due, status: 'open', notified_at: null })
      .eq('id', id);
    if (error) {
      toast.error('Ertelenemedi');
      return;
    }
    toast.success(`${label} ertelendi`);
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  const loading = dataQuery.isLoading;
  const empty = !loading && grouped.length === 0;

  return (
    <div className="p-4 space-y-4 pb-24">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Takvim</h1>
      </div>

      {/* Admin: plasiyer seçici */}
      {isAdmin && (
        <div className="space-y-1">
          <label htmlFor="rep-sel" className="text-xs text-muted-foreground">
            Plasiyer
          </label>
          <select
            id="rep-sel"
            value={repFilter}
            onChange={(e) => setRepFilter(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 h-11 text-sm"
          >
            <option value="self">Kendi takvimim</option>
            {(repsQuery.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Filtre */}
      <div className="grid grid-cols-3 gap-1.5">
        {(
          [
            ['upcoming', 'Yaklaşan'],
            ['past', 'Geçmiş'],
            ['all', 'Tümü'],
          ] as [FilterMode, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-lg border px-3 h-9 text-sm font-medium ${
              filter === k
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Yükleniyor…
        </div>
      )}

      {empty && (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Bu filtrede takvim kaydı yok. Ziyaret formunda tekrar ziyaret tarihi veya randevu girince
          burada otomatik görünür.
        </div>
      )}

      <div className="space-y-5">
        {grouped.map(([k, items]) => (
          <div key={k} className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground sticky top-0 bg-background/95 py-1">
              {dayLabel(items[0]?.at ?? `${k}T00:00:00`)}
            </h2>
            <ul className="space-y-2">
              {items.map((it) => {
                const meta = typeMeta(it.type);
                const done = it.status === 'done';
                const clinic = it.accountId ? nameMap[it.accountId] : null;
                const phone = clinic?.phone ? clinic.phone.replace(/[^\d+]/g, '') : null;
                const waPhone = phone ? phone.replace(/^0/, '90').replace(/^\+/, '') : null;
                return (
                  <li
                    key={`${it.kind}-${it.id}`}
                    className={`rounded-2xl border border-border bg-card p-3 ${done ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex flex-col items-center pt-0.5">
                        <meta.Icon className={`h-5 w-5 ${meta.color}`} aria-hidden="true" />
                        <span className="mt-1 text-[10px] font-medium text-muted-foreground">
                          {timeLabel(it.at)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm font-medium text-foreground ${done ? 'line-through' : ''}`}
                        >
                          {it.title}
                        </p>
                        {clinic && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                            <MapPin className="h-3 w-3" aria-hidden="true" />
                            {clinic.name}
                          </p>
                        )}
                        {it.note && (
                          <p className="mt-1 text-xs text-muted-foreground line-clamp-3">
                            {it.note}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className={`text-[11px] font-medium ${meta.color}`}>
                            {meta.label}
                          </span>
                          {it.visitId && (
                            <Link
                              to={`/visits/${it.visitId}`}
                              className="text-[11px] font-medium text-primary hover:underline"
                            >
                              Ziyareti aç
                            </Link>
                          )}
                        </div>

                        {/* Aksiyonlar — hatırlatma kartı için ara / whatsapp / ertele / tamamla */}
                        {it.kind === 'reminder' && !done && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {phone && (
                              <a
                                href={`tel:${phone}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 h-8 text-[11px] font-medium hover:bg-muted"
                              >
                                <Phone className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                                Ara
                              </a>
                            )}
                            {waPhone && (
                              <a
                                href={`https://wa.me/${waPhone}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 h-8 text-[11px] font-medium hover:bg-muted"
                              >
                                <MessageCircle
                                  className="h-3.5 w-3.5 text-green-600"
                                  aria-hidden="true"
                                />
                                WhatsApp
                              </a>
                            )}
                            <button
                              type="button"
                              onClick={() => void snooze(it.id, 60 * 60 * 1000, '1 saat')}
                              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 h-8 text-[11px] font-medium hover:bg-muted"
                            >
                              <AlarmClock
                                className="h-3.5 w-3.5 text-amber-600"
                                aria-hidden="true"
                              />
                              1 saat
                            </button>
                            <button
                              type="button"
                              onClick={() => void snooze(it.id, 24 * 60 * 60 * 1000, 'Yarın')}
                              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 h-8 text-[11px] font-medium hover:bg-muted"
                            >
                              <AlarmClock
                                className="h-3.5 w-3.5 text-amber-600"
                                aria-hidden="true"
                              />
                              Yarın
                            </button>
                            <button
                              type="button"
                              onClick={() => void markDone(it.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-2 h-8 text-[11px] font-medium text-green-700 hover:bg-green-100"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Tamamlandı
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export default CalendarPage;
