/**
 * CalendarPage — Plasiyer takvimi (/takvim).
 *
 * İki görünüm:
 *  - Ajanda: tarihe göre gruplanmış akış (Yaklaşan / Geçmiş / Tümü).
 *  - Ay: takvim ızgarası; her gün hücresinde etkinlik noktaları; güne dokun → o günün
 *    listesi (gün-gün).
 *
 * Kaynaklar: saha_reminders (randevu/tekrar-ziyaret/tahsilat/tanıtım/not) +
 * saha_visits (tamamlanan ziyaret, sonuç + not).
 *
 * Manuel ekleme: "+ Ekle" → tip (Randevu/Tahsilat/Tanıtım Ziyareti/Tekrar Ziyaret/Genel)
 * + opsiyonel klinik + tarih-saat + başlık + not → saha_reminders. Eklenen kayıt
 * otomatik push + yerel bildirim zincirine girer.
 *
 * Rol: sales_rep yalnız kendi (RLS); admin rep-seçici ile herhangi plasiyer.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlarmClock,
  Banknote,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Megaphone,
  MessageCircle,
  Navigation,
  Phone,
  Plus,
  Stethoscope,
  StickyNote,
  X,
} from 'lucide-react';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions } from '@core/auth/usePermissions';
import { syncReminderNotifications } from '@lib/localReminders';
import { enqueueOp } from '@core/offline/syncQueue';
import { useRouteBasket } from '@features/routes/store/routeBasketStore';

type FilterMode = 'upcoming' | 'past' | 'all';
type ViewMode = 'agenda' | 'month';
type ReminderType = 'revisit' | 'appointment' | 'tahsilat' | 'tanitim' | 'task' | 'note';

interface ReminderRow {
  id: string;
  rep_id: string;
  account_id: string | null;
  visit_id: string | null;
  type: ReminderType;
  title: string | null;
  note: string | null;
  due_at: string;
  status: 'open' | 'done' | 'cancelled';
  assigned_by: string | null;
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
  type: ReminderType | 'visit';
  title: string;
  note: string | null;
  accountId: string | null;
  status?: ReminderRow['status'];
  visitId?: string | null;
  assignedBy?: string | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  met: 'Görüşüldü',
  callback: 'Tekrar Aranacak',
  no_meeting: 'Görüşülemedi',
  order_taken: 'Sipariş Alındı',
  sample_given: 'Numune Verildi',
};

// Manuel ekleme tip seçenekleri.
const ADD_TYPES: { value: ReminderType; label: string }[] = [
  { value: 'appointment', label: 'Randevu' },
  { value: 'tahsilat', label: 'Tahsilat Randevusu' },
  { value: 'tanitim', label: 'Tanıtım Ziyareti' },
  { value: 'revisit', label: 'Tekrar Ziyaret' },
  { value: 'task', label: 'Genel Görev' },
];

function startOfTodayISO(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
  dot: string;
} {
  switch (type) {
    case 'appointment':
      return { label: 'Randevu', Icon: Stethoscope, color: 'text-blue-600', dot: 'bg-blue-500' };
    case 'tahsilat':
      return {
        label: 'Tahsilat',
        Icon: Banknote,
        color: 'text-emerald-600',
        dot: 'bg-emerald-500',
      };
    case 'tanitim':
      return { label: 'Tanıtım', Icon: Megaphone, color: 'text-pink-600', dot: 'bg-pink-500' };
    case 'revisit':
      return {
        label: 'Tekrar Ziyaret',
        Icon: CalendarClock,
        color: 'text-amber-600',
        dot: 'bg-amber-500',
      };
    case 'visit':
      return { label: 'Ziyaret', Icon: MapPin, color: 'text-green-600', dot: 'bg-green-500' };
    case 'note':
      return { label: 'Not', Icon: StickyNote, color: 'text-purple-600', dot: 'bg-purple-500' };
    default:
      return { label: 'Görev', Icon: CalendarDays, color: 'text-foreground', dot: 'bg-gray-400' };
  }
}

function CalendarPage(): JSX.Element {
  const selfId = useAuthStore((s) => s.session?.userId ?? null);
  const { isAdmin } = usePermissions();
  const queryClient = useQueryClient();
  const [view, setView] = useState<ViewMode>('agenda');
  const [filter, setFilter] = useState<FilterMode>('upcoming');
  const [repFilter, setRepFilter] = useState<string>('self');
  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  // ?reminder=<id> → scroll + highlight (state sadece; effect allItems'tan sonra)
  const [searchParams] = useSearchParams();
  const focusReminderId = searchParams.get('reminder');
  const [focusId, setFocusId] = useState<string | null>(null);

  const targetRepId = isAdmin && repFilter !== 'self' ? repFilter : selfId;

  // Ay görünümünde tüm kayıtlar gerekli → effectiveFilter month'ta 'all'.
  const effectiveFilter: FilterMode = view === 'month' ? 'all' : filter;

  // Admin: plasiyer seçici
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
    queryKey: ['calendar', targetRepId, effectiveFilter],
    enabled: Boolean(targetRepId),
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async (): Promise<{ reminders: ReminderRow[]; visits: VisitRow[] }> => {
      if (!targetRepId) return { reminders: [], visits: [] };
      const sb = getSupabaseClient();
      const typed = getTypedClient();

      let rq = sb
        .from('saha_reminders')
        .select('id, rep_id, account_id, visit_id, type, title, note, due_at, status, assigned_by')
        .eq('rep_id', targetRepId)
        .neq('status', 'cancelled')
        .order('due_at', { ascending: true });
      if (effectiveFilter === 'upcoming') rq = rq.gte('due_at', startOfTodayISO());
      if (effectiveFilter === 'past') rq = rq.lt('due_at', startOfTodayISO());

      let vq = typed
        .from('saha_visits')
        .select('id, account_id, check_in_at, outcome, notes')
        .eq('rep_id', targetRepId)
        .eq('status', 'completed')
        .order('check_in_at', { ascending: false })
        .limit(200);
      if (effectiveFilter === 'upcoming') vq = vq.gte('check_in_at', startOfTodayISO());
      if (effectiveFilter === 'past') vq = vq.lt('check_in_at', startOfTodayISO());

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

  // Klinik ad + telefon
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

  // Atayan (admin) isimleri — "X atadı" göstermek için.
  const assignerIds = useMemo(
    () => [...new Set(reminders.map((r) => r.assigned_by).filter(Boolean))] as string[],
    [reminders],
  );
  const assignerQuery = useQuery({
    queryKey: ['calendar-assigner-names', assignerIds.sort().join(',')],
    enabled: assignerIds.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Record<string, string>> => {
      const sb = getTypedClient();
      const { data } = await sb
        .from('profiles')
        .select('id, ad_soyad, email')
        .in('id', assignerIds);
      const map: Record<string, string> = {};
      ((data ?? []) as { id: string; ad_soyad: string | null; email: string | null }[]).forEach(
        (p) => {
          map[p.id] = p.ad_soyad || p.email || 'Yönetici';
        },
      );
      return map;
    },
  });
  const assignerMap = assignerQuery.data ?? {};

  // Admin: atama yapılabilir plasiyerler (user_permissions grant).
  const assignableQuery = useQuery({
    queryKey: ['calendar-assignable-reps'],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<RepOption[]> => {
      const sb = getSupabaseClient();
      const { data: grants } = await sb
        .from('user_permissions')
        .select('user_id, effect')
        .eq('permission_code', 'saha:calendar:assignable');
      const ids = ((grants ?? []) as { user_id: string; effect: string }[])
        .filter((g) => g.effect === 'grant')
        .map((g) => g.user_id);
      if (ids.length === 0) return [];
      const { data: profs } = await getTypedClient()
        .from('profiles')
        .select('id, ad_soyad, email')
        .in('id', ids);
      return ((profs ?? []) as { id: string; ad_soyad: string | null; email: string | null }[]).map(
        (p) => ({ id: p.id, name: p.ad_soyad || p.email || p.id.slice(0, 8) }),
      );
    },
  });

  // Tüm ajanda öğeleri (gruplanmamış, ham)
  const allItems = useMemo<AgendaItem[]>(() => {
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
        assignedBy: r.assigned_by,
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
    return items;
  }, [reminders, visits]);

  // ?reminder=<id> → ajanda aç + scroll + 3.5sn highlight
  useEffect(() => {
    if (!focusReminderId || dataQuery.isLoading) return;
    const exists = allItems.some((i) => i.id === focusReminderId);
    if (!exists) return;
    setView('agenda');
    setFilter('all');
    setFocusId(focusReminderId);
    const t = setTimeout(() => {
      document
        .getElementById(`reminder-${focusReminderId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);
    const clear = setTimeout(() => setFocusId(null), 3500);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [focusReminderId, dataQuery.isLoading, allItems]);

  // Ajanda görünümü: güne göre grupla
  const grouped = useMemo(() => {
    const items = [...allItems].sort((a, b) =>
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
  }, [allItems, filter]);

  // Ay görünümü: gün → öğeler
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const it of allItems) {
      const k = dayKey(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    for (const arr of map.values())
      arr.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    return map;
  }, [allItems]);

  // Ay ızgarası hücreleri (Pazartesi başlangıç)
  const monthCells = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7; // Mon=0
    const gridStart = new Date(year, month, 1 - startOffset);
    const cells: Date[] = [];
    for (let i = 0; i < 42; i++) {
      cells.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
    }
    return cells;
  }, [monthCursor]);

  // B3 — rota sepeti
  const addToBasket = useRouteBasket((s) => s.add);

  // B1 — klinik telefonu ekle
  async function addClinicPhone(accountId: string, phone: string): Promise<void> {
    const clean = phone.replace(/[^\d+]/g, '');
    if (clean.length < 7) {
      toast.error('Geçerli numara girin.');
      return;
    }
    const sb = getSupabaseClient();
    const { error } = await sb.from('saha_clinics').update({ phone: clean }).eq('id', accountId);
    if (error) {
      toast.error('Numara kaydedilemedi.');
      return;
    }
    toast.success('Numara eklendi.');
    void queryClient.invalidateQueries({ queryKey: ['calendar-clinic-names'] });
  }

  // B3 — randevu kliniğini rota sepetine ekle
  async function addReminderToRoute(accountId: string): Promise<void> {
    const sb = getTypedClient();
    const { data } = await sb
      .from('saha_clinics')
      .select('id, name, lat, lng')
      .eq('id', accountId)
      .single();
    if (!data || data.lat == null || data.lng == null) {
      toast.error('Klinik konumu yok, rotaya eklenemedi.');
      return;
    }
    const res = addToBasket({
      id: data.id as string,
      name: data.name as string,
      lat: data.lat as number,
      lng: data.lng as number,
      source: 'saha',
    });
    if (res.ok) toast.success('Rota sepetine eklendi.');
    else toast.error(res.reason === 'full' ? 'Sepet dolu (max 12).' : 'Zaten sepette.');
  }

  async function markDone(id: string): Promise<void> {
    const sb = getSupabaseClient();
    const { error } = await sb.from('saha_reminders').update({ status: 'done' }).eq('id', id);
    if (error) {
      toast.error('Güncellenemedi');
      return;
    }
    toast.success('Tamamlandı', {
      action: {
        label: 'Geri al',
        onClick: () => {
          void (async () => {
            await sb.from('saha_reminders').update({ status: 'open' }).eq('id', id);
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
          })();
        },
      },
    });
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  async function snooze(id: string, ms: number, label: string): Promise<void> {
    const sb = getSupabaseClient();
    let dueDate = new Date(Date.now() + ms);
    if (label === 'Yarın') {
      // Ertesi gün sabah 09:00 (gece çalmasın).
      dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);
      dueDate.setHours(9, 0, 0, 0);
    }
    const due = dueDate.toISOString();
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
    void syncReminderNotifications();
  }

  const loading = dataQuery.isLoading || !selfId;
  const todayKey = dayKeyOf(new Date());

  const selectedDayItems = selectedDay ? (byDay.get(selectedDay) ?? []) : [];

  return (
    <div className="space-y-4 p-4 pb-24">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">Takvim</h1>
        </div>
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 h-10 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Ekle
        </button>
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
            className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
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

      {/* Görünüm toggle */}
      <div className="grid grid-cols-2 gap-1.5">
        {(
          [
            ['agenda', 'Ajanda'],
            ['month', 'Ay'],
          ] as [ViewMode, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setView(k)}
            className={`h-9 rounded-lg border px-3 text-sm font-medium ${
              view === k
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-background hover:bg-muted'
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

      {/* ----- AJANDA GÖRÜNÜMÜ ----- */}
      {view === 'agenda' && (
        <>
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
                className={`h-9 rounded-lg border px-3 text-sm font-medium ${
                  filter === k
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {!loading && grouped.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Bu filtrede takvim kaydı yok. "+ Ekle" ile manuel randevu/tahsilat/tanıtım ekleyebilir
              veya ziyaret formundan otomatik oluşturabilirsin.
            </div>
          )}

          <div className="space-y-5">
            {grouped.map(([k, items]) => (
              <div key={k} className="space-y-2">
                <h2 className="sticky top-0 bg-background/95 py-1 text-sm font-semibold text-foreground">
                  {dayLabel(items[0]?.at ?? `${k}T00:00:00`)}
                </h2>
                <ul className="space-y-2">
                  {items.map((it) => (
                    <AgendaCard
                      key={`${it.kind}-${it.id}`}
                      it={it}
                      clinic={it.accountId ? (nameMap[it.accountId] ?? null) : null}
                      onDone={markDone}
                      onSnooze={snooze}
                      assignerName={it.assignedBy ? (assignerMap[it.assignedBy] ?? null) : null}
                      highlighted={it.id === focusId}
                      onAddPhone={addClinicPhone}
                      onAddToRoute={addReminderToRoute}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ----- AY GÖRÜNÜMÜ ----- */}
      {view === 'month' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => {
                setSelectedDay(null);
                setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1));
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-muted"
              aria-label="Önceki ay"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold">
              {monthCursor.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedDay(null);
                setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1));
              }}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border hover:bg-muted"
              aria-label="Sonraki ay"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
            {['Pt', 'Sa', 'Ça', 'Pe', 'Cu', 'Ct', 'Pz'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthCells.map((d) => {
              const k = dayKeyOf(d);
              const inMonth = d.getMonth() === monthCursor.getMonth();
              const dayItems = byDay.get(k) ?? [];
              const isToday = k === todayKey;
              const isSelected = k === selectedDay;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : k)}
                  className={`flex aspect-square flex-col items-center justify-start rounded-lg border p-1 text-xs ${
                    isSelected
                      ? 'border-primary bg-primary/10'
                      : isToday
                        ? 'border-primary/50 bg-background'
                        : 'border-border bg-background'
                  } ${inMonth ? '' : 'opacity-40'}`}
                >
                  <span className={`${isToday ? 'font-bold text-primary' : 'text-foreground'}`}>
                    {d.getDate()}
                  </span>
                  <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                    {dayItems.slice(0, 4).map((it, i) => (
                      <span
                        key={i}
                        className={`h-1.5 w-1.5 rounded-full ${typeMeta(it.type).dot}`}
                      />
                    ))}
                    {dayItems.length > 4 && (
                      <span className="text-[9px] font-semibold leading-none text-muted-foreground">
                        +{dayItems.length - 4}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Seçili gün listesi */}
          {selectedDay && (
            <div className="space-y-2 pt-2">
              <h2 className="text-sm font-semibold">{dayLabel(`${selectedDay}T00:00:00`)}</h2>
              {selectedDayItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">Bu gün kayıt yok.</p>
              ) : (
                <ul className="space-y-2">
                  {selectedDayItems.map((it) => (
                    <AgendaCard
                      key={`${it.kind}-${it.id}`}
                      it={it}
                      clinic={it.accountId ? (nameMap[it.accountId] ?? null) : null}
                      onDone={markDone}
                      onSnooze={snooze}
                      assignerName={it.assignedBy ? (assignerMap[it.assignedBy] ?? null) : null}
                      highlighted={it.id === focusId}
                      onAddPhone={addClinicPhone}
                      onAddToRoute={addReminderToRoute}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {showAdd && targetRepId && selfId && (
        <AddReminderModal
          repId={targetRepId}
          selfId={selfId}
          isAdmin={isAdmin}
          assignableReps={
            (assignableQuery.data && assignableQuery.data.length > 0
              ? assignableQuery.data
              : (repsQuery.data ?? [])
            ).filter((r) => r.id !== selfId)
          }
          onClose={() => setShowAdd(false)}
          onAdded={(assignedRepId) => {
            setShowAdd(false);
            // Başka plasiyere atandıysa admin'in görünümünü o plasiyere geçir →
            // atanan kayıt anında görünür (aksi halde 'gözükmüyor' algısı).
            if (assignedRepId && assignedRepId !== selfId) {
              setRepFilter(assignedRepId);
              setView('agenda');
              setFilter('upcoming');
              setSelectedDay(null);
            }
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            void syncReminderNotifications();
          }}
        />
      )}
    </div>
  );
}

// ---- Ajanda kartı (ajanda + ay-gün listesi paylaşır) ----
function AgendaCard({
  it,
  clinic,
  onDone,
  onSnooze,
  assignerName,
  highlighted,
  onAddPhone,
  onAddToRoute,
}: {
  it: AgendaItem;
  clinic: { name: string; phone: string | null } | null;
  onDone: (id: string) => void;
  onSnooze: (id: string, ms: number, label: string) => void;
  assignerName?: string | null;
  highlighted?: boolean;
  onAddPhone?: (accountId: string, phone: string) => void;
  onAddToRoute?: (accountId: string) => void;
}): JSX.Element {
  const meta = typeMeta(it.type);
  const done = it.status === 'done';
  const phone = clinic?.phone ? clinic.phone.replace(/[^\d+]/g, '') : null;
  const waPhone = phone ? phone.replace(/^0/, '90').replace(/^\+/, '') : null;

  // B1 — numara ekleme inline state
  const [addingPhone, setAddingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  return (
    <li
      id={`reminder-${it.id}`}
      className={`rounded-2xl border border-border bg-card p-3 ${done ? 'opacity-60' : ''} ${highlighted ? 'ring-2 ring-primary ring-offset-2' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center pt-0.5">
          <meta.Icon className={`h-5 w-5 ${meta.color}`} aria-hidden="true" />
          <span className="mt-1 text-[10px] font-medium text-muted-foreground">
            {timeLabel(it.at)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium text-foreground ${done ? 'line-through' : ''}`}>
            {it.title}
          </p>
          {clinic && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {clinic.name}
            </p>
          )}
          {it.note && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{it.note}</p>}
          {assignerName && (
            <p className="mt-1 text-[11px] font-medium text-indigo-600">Atayan: {assignerName}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`text-[11px] font-medium ${meta.color}`}>{meta.label}</span>
            {it.visitId && (
              <Link
                to={`/visits/${it.visitId}`}
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Ziyareti aç
              </Link>
            )}
          </div>

          {it.kind === 'reminder' && !done && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
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
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                  WhatsApp
                </a>
              )}
              {/* B1 — numara ekle (klinik varsa ama telefon yoksa) */}
              {it.accountId && !clinic?.phone && onAddPhone && (
                addingPhone ? (
                  <>
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="Numara girin"
                      className="h-8 w-32 rounded-lg border border-border bg-background px-2 text-[11px]"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        onAddPhone(it.accountId!, phoneInput);
                        setAddingPhone(false);
                        setPhoneInput('');
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                    >
                      Kaydet
                    </button>
                    <button
                      type="button"
                      onClick={() => { setAddingPhone(false); setPhoneInput(''); }}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2 text-[11px] hover:bg-muted"
                      aria-label="İptal"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingPhone(true)}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                  >
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    Numara ekle
                  </button>
                )
              )}
              {/* B3 — rotaya ekle (klinik ve uygun tip) */}
              {it.accountId &&
                (['appointment', 'tahsilat', 'tanitim', 'revisit'] as AgendaItem['type'][]).includes(it.type) &&
                onAddToRoute && (
                <button
                  type="button"
                  onClick={() => onAddToRoute(it.accountId!)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                >
                  <Navigation className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                  Rotaya Ekle
                </button>
              )}
              <button
                type="button"
                onClick={() => onSnooze(it.id, 60 * 60 * 1000, '1 saat')}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
              >
                <AlarmClock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />1 saat
              </button>
              <button
                type="button"
                onClick={() => onSnooze(it.id, 24 * 60 * 60 * 1000, 'Yarın')}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
              >
                <AlarmClock className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                Yarın
              </button>
              <button
                type="button"
                onClick={() => onDone(it.id)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-2 text-[11px] font-medium text-green-700 hover:bg-green-100"
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
}

// ---- Manuel ekleme modalı ----
function AddReminderModal({
  repId,
  selfId,
  isAdmin,
  assignableReps,
  onClose,
  onAdded,
}: {
  repId: string;
  selfId: string;
  isAdmin: boolean;
  assignableReps: RepOption[];
  onClose: () => void;
  onAdded: (assignedRepId?: string) => void;
}): JSX.Element {
  // Hedef plasiyer (kimin takvimine). Admin başka plasiyere atayabilir → assigned_by=self.
  const [targetRep, setTargetRep] = useState<string>(repId);
  const [type, setType] = useState<ReminderType>('appointment');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [at, setAt] = useState('');
  const [clinicQuery, setClinicQuery] = useState('');
  const [clinic, setClinic] = useState<{ id: string; name: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const searchQuery = useQuery({
    queryKey: ['add-reminder-clinic-search', clinicQuery],
    enabled: clinicQuery.trim().length >= 2 && !clinic,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const sb = getTypedClient();
      const { data } = await sb
        .from('saha_clinics')
        .select('id, name')
        .ilike('name', `%${clinicQuery.trim()}%`)
        .eq('status', 'active')
        .limit(8);
      return ((data ?? []) as { id: string; name: string }[]).map((c) => ({
        id: c.id,
        name: c.name,
      }));
    },
  });

  async function save(): Promise<void> {
    if (!at) {
      toast.error('Tarih-saat seçin.');
      return;
    }
    const due = new Date(at);
    if (Number.isNaN(due.getTime())) {
      toast.error('Geçersiz tarih.');
      return;
    }
    // 60sn tolerans: "şu an" yazılan saatin kaydet'e basılana dek geçmişe düşmesini önle.
    if (due.getTime() < Date.now() - 60_000) {
      toast.error('Geçmiş tarihe randevu eklenemez.');
      return;
    }
    setSaving(true);
    const typeLabel = ADD_TYPES.find((t) => t.value === type)?.label ?? 'Hatırlatma';
    const finalTitle = title.trim() || (clinic ? `${typeLabel} — ${clinic.name}` : typeLabel);
    const isAssignment = targetRep !== selfId;

    // B2 — Offline: kuyruğa al, online olunca insert edilir.
    if (!navigator.onLine) {
      await enqueueOp('reminder.create', {
        rep_id: targetRep,
        created_by: selfId,
        assigned_by: isAssignment ? selfId : null,
        account_id: clinic?.id ?? null,
        type,
        title: finalTitle,
        note: note.trim() || null,
        due_at: due.toISOString(),
        status: 'open',
      });
      setSaving(false);
      toast.success('Çevrimdışı: bağlantı gelince kaydedilecek.');
      onAdded(isAssignment ? targetRep : undefined);
      return;
    }

    const sb = getSupabaseClient();
    const { data: inserted, error } = await sb
      .from('saha_reminders')
      .insert({
        rep_id: targetRep,
        created_by: selfId,
        assigned_by: isAssignment ? selfId : null,
        account_id: clinic?.id ?? null,
        type,
        title: finalTitle,
        note: note.trim() || null,
        due_at: due.toISOString(),
        status: 'open',
      })
      .select('id')
      .single();
    if (error) {
      setSaving(false);
      toast.error(`Eklenemedi: ${error.message}`);
      return;
    }
    // Atama ise hedef plasiyere anında bildirim (bell + push).
    // saha_notify_rep RPC her iki tabloya yazar (notifications INSERT RLS=service_role-only
    // olduğu için client doğrudan yazamaz; RPC SECURITY DEFINER ile bypass eder).
    let notifFailed = false;
    if (isAssignment) {
      const { error: notifErr } = await sb.rpc('saha_notify_rep', {
        p_user_id: targetRep,
        p_saha_type: 'system',
        p_title: `${typeLabel} atandı`,
        p_body: `${finalTitle} — ${due.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}`,
        p_data: {
          kind: 'visit_reminder',
          route: `/takvim?reminder=${inserted?.id ?? ''}`,
          deeplink: `/takvim?reminder=${inserted?.id ?? ''}`,
          reminder_id: inserted?.id,
        },
        p_push: true,
      });
      if (notifErr) notifFailed = true;
    }
    setSaving(false);
    // Tek mesaj: bildirim başarısızsa uyarı, aksi halde başarı (çift-toast yok).
    if (notifFailed) {
      toast.warning('Atandı, fakat bildirim gönderilemedi.');
    } else {
      toast.success(isAssignment ? 'Plasiyere atandı' : 'Takvime eklendi');
    }
    onAdded(isAssignment ? targetRep : undefined);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Takvime ekle"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Takvime Ekle</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          {isAdmin && assignableReps.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="ar-rep" className="text-xs text-muted-foreground">
                Kime (plasiyer takvimi)
              </label>
              <select
                id="ar-rep"
                value={targetRep}
                onChange={(e) => setTargetRep(e.target.value)}
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              >
                <option value={selfId}>Kendi takvimim</option>
                {assignableReps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Tür</label>
            <div className="grid grid-cols-2 gap-1.5">
              {ADD_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`h-9 rounded-lg border px-2 text-xs font-medium ${
                    type === t.value
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-muted'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="ar-at" className="text-xs text-muted-foreground">
              Tarih & Saat
            </label>
            <input
              id="ar-at"
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="ar-clinic" className="text-xs text-muted-foreground">
              Klinik / Cari (opsiyonel)
            </label>
            {clinic ? (
              <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2 text-sm">
                <span className="truncate">{clinic.name}</span>
                <button
                  type="button"
                  onClick={() => {
                    setClinic(null);
                    setClinicQuery('');
                  }}
                  className="ml-2 text-xs text-primary hover:underline"
                >
                  Değiştir
                </button>
              </div>
            ) : (
              <>
                <input
                  id="ar-clinic"
                  type="text"
                  value={clinicQuery}
                  onChange={(e) => setClinicQuery(e.target.value)}
                  placeholder="Klinik adı ara…"
                  className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
                />
                {(searchQuery.data ?? []).length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-xl border border-border bg-card">
                    {(searchQuery.data ?? []).map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setClinic(c)}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        >
                          {c.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="ar-title" className="text-xs text-muted-foreground">
              Başlık (opsiyonel)
            </label>
            <input
              id="ar-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Örn: Aylık tahsilat ziyareti"
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="ar-note" className="text-xs text-muted-foreground">
              Not (opsiyonel)
            </label>
            <textarea
              id="ar-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
          </div>

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            Takvime Ekle
          </button>
        </div>
      </div>
    </div>
  );
}

export default CalendarPage;
