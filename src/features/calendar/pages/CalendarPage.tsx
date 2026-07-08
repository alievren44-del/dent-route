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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Megaphone,
  MessageCircle,
  Navigation,
  Paperclip,
  Phone,
  Plus,
  Stethoscope,
  StickyNote,
  Truck,
  X,
} from 'lucide-react';
import {
  ReminderDetailSheet,
  type ReminderDetailItem,
} from '@features/calendar/components/ReminderDetailSheet';
import { InlineOrderSheet } from '@features/orders/components/InlineOrderSheet';
import { PullToRefresh } from '@components/ui/PullToRefresh';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions } from '@core/auth/usePermissions';
import { syncReminderNotifications } from '@lib/localReminders';
import { enqueueOp } from '@core/offline/syncQueue';
import { useRouteBasket } from '@features/routes/store/routeBasketStore';
import {
  uploadReminderAttachment,
  getReminderAttachmentsMap,
  type ReminderAttachment,
} from '@lib/reminderAttachments';
import { localDayKey, localDayLabel, buildDueAt, isPastDay } from '@lib/datetime';
import { googleMapsDirectionsUrl } from '@lib/maps';

type FilterMode = 'upcoming' | 'past' | 'all' | 'overdue' | 'recent';
type ViewMode = 'agenda' | 'month';
type ReminderType =
  | 'revisit'
  | 'appointment'
  | 'tahsilat'
  | 'tanitim'
  | 'task'
  | 'note'
  | 'malzeme_teslim'
  | 'no_order_alert';

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
  recurrence: 'none' | 'weekly' | 'monthly';
  outcome: string | null;
  completion_note: string | null;
  source_ref: string | null;
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

// AddReminderModal'ı ön-dolu açmak için (Tekrar Randevu akışı).
interface ReminderInitial {
  type: ReminderType;
  title: string;
  note: string;
  clinic: { id: string; name: string } | null;
  recurrence: 'none' | 'weekly' | 'monthly';
  sourceId: string | null; // kaynak randevu (R5 bağ → source_ref)
}

// H4: mevcut reminder'ı düzenlemek için AddReminderModal'a geçilen veri.
interface ReminderEditData {
  id: string;
  type: ReminderType;
  title: string;
  note: string | null;
  at: string; // ISO
  clinic: { id: string; name: string } | null;
  recurrence: 'none' | 'weekly' | 'monthly';
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
  recurrence?: 'none' | 'weekly' | 'monthly';
  outcome?: string | null;
  completionNote?: string | null;
  sourceRef?: string | null;
  // Bu öğe "Gecikti" kovasından çıktı mı? (durum çözülmüş VEYA aynı kliniğe
  // vaktinde/sonra tamamlanmış ziyaret = görüşüldü yapılmış). Tek doğru kaynak.
  resolved?: boolean;
}

// TEK DOĞRU KAYNAK (single source of truth): bir hatırlatmayı "Gecikti"
// kovasından çıkaran çözülmüş durumlar. Randevu tamamlandı VEYA iptal edildiyse
// artık gecikmiş sayılmaz. (Ayrıca görüşüldü/ziyaret derivasyonu allItems'ta.)
const RESOLVED_REMINDER_STATUSES: ReadonlySet<ReminderRow['status']> = new Set([
  'done',
  'cancelled',
]);

const OUTCOME_LABEL: Record<string, string> = {
  met: 'Görüşüldü',
  callback: 'Tekrar Aranacak',
  no_meeting: 'Görüşülemedi',
  order_taken: 'Sipariş Alındı',
  sample_given: 'Numune Verildi',
  tahsil_edildi: 'Tahsil Edildi',
  soz_verildi: 'Söz Verildi',
  odenmedi: 'Ödenmedi',
};

// Günlük Plan tipi grupları — filtre çipleri + özet satırı için.
const TYPE_GROUPS: Record<string, { label: string; types: (ReminderType | 'visit')[] }> = {
  randevu: { label: 'Randevu', types: ['appointment'] },
  teslim: { label: 'Teslim', types: ['malzeme_teslim'] },
  tahsilat: { label: 'Tahsilat', types: ['tahsilat'] },
  gorev: {
    label: 'Görev',
    types: ['task', 'revisit', 'note', 'tanitim', 'visit', 'no_order_alert'],
  },
};

function groupOf(type: AgendaItem['type']): string {
  for (const [key, g] of Object.entries(TYPE_GROUPS)) {
    if ((g.types as string[]).includes(type)) return key;
  }
  return 'gorev';
}

// Manuel ekleme tip seçenekleri.
const ADD_TYPES: { value: ReminderType; label: string }[] = [
  { value: 'appointment', label: 'Randevu' },
  { value: 'malzeme_teslim', label: 'Malzeme Teslimi' },
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

// H2: son 7 günü kapsayan "yakın geçmiş + gelecek" filtresi için.
function sevenDaysAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// Optimistik ekleme için: yeni bir reminder, verilen filtre penceresine (sunucu
// sorgusuyla aynı sınırlar) düşüyor mu? Düşmüyorsa cache'e enjekte etmeyiz
// (aksi halde 'Geçmiş' modunda gelecek randevu yanlış görünürdü → refetch temizler).
function reminderPassesFilter(r: ReminderRow, filter: FilterMode): boolean {
  if (r.status === 'cancelled') return false; // sunucu .neq('status','cancelled')
  const due = new Date(r.due_at).getTime();
  switch (filter) {
    case 'upcoming':
      return due >= new Date(startOfTodayISO()).getTime();
    case 'recent':
      return due >= new Date(sevenDaysAgoISO()).getTime();
    case 'past':
      return due < new Date(startOfTodayISO()).getTime();
    case 'overdue':
      return due < Date.now() && r.status === 'open';
    case 'all':
    default:
      return true;
  }
}

// Thin wrappers so callers stay unchanged; logic lives in src/lib/datetime.ts.
const dayKey = (iso: string) => localDayKey(iso);
const dayKeyOf = (d: Date) => localDayKey(d);
const dayLabel = (iso: string) => localDayLabel(iso);

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
    case 'malzeme_teslim':
      return { label: 'Malzeme Teslimi', Icon: Truck, color: 'text-cyan-600', dot: 'bg-cyan-500' };
    case 'no_order_alert':
      return {
        label: 'Pasif Klinik',
        Icon: AlertTriangle,
        color: 'text-red-600',
        dot: 'bg-red-500',
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
  // H2: default 'recent' → son 7 gün tamamlananlar + gelecek randevular görünür.
  const [filter, setFilter] = useState<FilterMode>('recent');
  const [repFilter, setRepFilter] = useState<string>('self');
  const [monthCursor, setMonthCursor] = useState<Date>(() => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AgendaItem | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  // Ajanda tip-filtresi: boş set = Tümü/all.
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  // R1 — kliniksiz randevuya klinik bağla (LinkClinicModal için reminder id).
  const [linkClinicFor, setLinkClinicFor] = useState<string | null>(null);
  // "Tekrar Randevu" → AddReminderModal'ı klinik/tür/başlık dolu açar (kullanıcı
  // yalnız yeni tarih-saat seçer). null = normal boş ekleme.
  const [followUpInit, setFollowUpInit] = useState<ReminderInitial | null>(null);
  // H4: mevcut reminder'ı düzenlemek için. null = yeni ekleme.
  const [editReminder, setEditReminder] = useState<ReminderEditData | null>(null);
  // "Sipariş Alındı" tamamlandığında ürün+fiyat girişi için inline sipariş sheet'i.
  // Klinik ön-seçili; cari createOrder içinde otomatik (idempotent) açılır.
  const [orderForClinic, setOrderForClinic] = useState<{ id: string; name: string } | null>(null);

  // UX — Yaklaşan modda gelecek gün-grupları varsayılan KATLI (accordion). Bugün+geçmiş açık.
  const [futureCollapsed, setFutureCollapsed] = useState(true);
  // UX — Geçmiş modda tarihe atlama: seçilen günden eski/o gün öğelere daralt.
  const [pastBefore, setPastBefore] = useState('');
  // UX — Açılışta "Bugün" grubuna otomatik odak (recent modda bir kez).
  const todayRef = useRef<HTMLDivElement | null>(null);
  const didTodayScroll = useRef(false);

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
        // Admin de saha-rep olabilir (ör. Eda Elmas = sahibi+plasiyer) → plasiyer
        // takviminde görünmeli. (debug_reports 2026-06-27: "eda elmas plasiyer'de yok".)
        .in('role', [
          'REP',
          'SALES_REP',
          'sales_rep',
          'rep',
          'MANAGER',
          'manager',
          'ADMIN',
          'admin',
        ]);
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
        .select(
          'id, rep_id, account_id, visit_id, type, title, note, due_at, status, assigned_by, recurrence, outcome, completion_note, source_ref',
        )
        .eq('rep_id', targetRepId)
        .neq('status', 'cancelled')
        .order('due_at', { ascending: true });
      if (effectiveFilter === 'upcoming') rq = rq.gte('due_at', startOfTodayISO());
      if (effectiveFilter === 'recent') rq = rq.gte('due_at', sevenDaysAgoISO()); // H2
      if (effectiveFilter === 'past') rq = rq.lt('due_at', startOfTodayISO());
      if (effectiveFilter === 'overdue')
        rq = rq.lt('due_at', new Date().toISOString()).eq('status', 'open');

      let vq = typed
        .from('saha_visits')
        .select('id, account_id, check_in_at, outcome, notes')
        .eq('rep_id', targetRepId)
        .eq('status', 'completed')
        .order('check_in_at', { ascending: false })
        .limit(200);
      // overdue filtresi sadece reminderlar için; ziyaret sorgusu boş kalsın
      if (effectiveFilter === 'upcoming') vq = vq.gte('check_in_at', startOfTodayISO());
      if (effectiveFilter === 'recent') vq = vq.gte('check_in_at', sevenDaysAgoISO()); // H2
      if (effectiveFilter === 'past') vq = vq.lt('check_in_at', startOfTodayISO());

      const [rRes, vRes] = await Promise.all([
        rq,
        effectiveFilter === 'overdue' ? Promise.resolve({ data: [], error: null }) : vq,
      ]);
      if (rRes.error) throw rRes.error;
      if (vRes.error) throw vRes.error;
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
    queryFn: async (): Promise<
      Record<string, { name: string; phone: string | null; lat: number | null; lng: number | null }>
    > => {
      const typed = getTypedClient();
      const { data } = await typed
        .from('saha_clinics')
        .select('id, name, phone, lat, lng')
        .in('id', accountIds);
      const map: Record<
        string,
        { name: string; phone: string | null; lat: number | null; lng: number | null }
      > = {};
      (
        (data ?? []) as {
          id: string;
          name: string;
          phone: string | null;
          lat: number | null;
          lng: number | null;
        }[]
      ).forEach((c) => {
        map[c.id] = { name: c.name, phone: c.phone, lat: c.lat, lng: c.lng };
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

  // SC-2 — Takvim dışı klinik arama: term >= 2 karakter olunca RPC çağrılır.
  // Sonuçlar, takvim öğelerinin yanında klinik listesi olarak gösterilir.
  const clinicSearchQuery = useQuery({
    queryKey: ['calendar-clinic-search', searchTerm],
    enabled: searchTerm.trim().length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const sb = getSupabaseClient();
      const { data } = await sb.rpc('saha_search_clinics', {
        _q: searchTerm.trim(),
        _limit: 20,
      });
      return ((data ?? []) as { id: string; name: string }[]).map((c) => ({
        id: c.id,
        name: c.name,
      }));
    },
  });

  // Foto/ses ekleri — görünür reminder id'leri için yükle.
  const reminderIds = useMemo(() => reminders.map((r) => r.id), [reminders]);
  const attachmentsQuery = useQuery({
    queryKey: ['calendar-attachments', reminderIds.slice().sort().join(',')],
    enabled: reminderIds.length > 0,
    staleTime: 60_000,
    queryFn: () => getReminderAttachmentsMap(reminderIds),
  });
  const attachmentsMap = attachmentsQuery.data ?? {};

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
    // Klinik başına tamamlanmış ziyaretlerin gün-anahtarları (YYYY-MM-DD).
    // "Bugün gidildi = görüşüldü" bilgisi ayrı saha_visits kaydında durur; randevu
    // satırının status'u hâlâ 'open' kalır. Bu harita ile randevuyu ziyaretten
    // türeterek çözülmüş sayarız (aksi halde gidilse de 'Gecikti' kalıyordu).
    const visitDaysByAccount = new Map<string, Set<string>>();
    for (const v of visits) {
      if (!v.account_id) continue;
      const set = visitDaysByAccount.get(v.account_id) ?? new Set<string>();
      set.add(dayKey(v.check_in_at));
      visitDaysByAccount.set(v.account_id, set);
    }
    const reminderResolved = (r: ReminderRow): boolean => {
      if (RESOLVED_REMINDER_STATUSES.has(r.status)) return true;
      if (!r.account_id) return false;
      // Aynı kliniğe randevu gününde VEYA sonrasında tamamlanmış ziyaret var mı?
      const dueDay = dayKey(r.due_at);
      const visitDays = visitDaysByAccount.get(r.account_id);
      if (!visitDays) return false;
      for (const vDay of visitDays) if (vDay >= dueDay) return true; // YYYY-MM-DD lexik sıralı
      return false;
    };
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
        recurrence: r.recurrence,
        outcome: r.outcome,
        completionNote: r.completion_note,
        sourceRef: r.source_ref,
        resolved: reminderResolved(r),
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

  // UX — Açılışta "Bugün" grubuna odaklan (recent mod, ajanda, bir kez). Yukarı=geçmiş,
  // aşağı=gelecek. Deep-link (?reminder) varsa ona öncelik ver, today-scroll atla.
  useEffect(() => {
    if (didTodayScroll.current) return;
    if (focusReminderId) return;
    if (view !== 'agenda' || filter !== 'recent') return;
    if (loading) return;
    if (!todayRef.current) return;
    const t = setTimeout(() => {
      todayRef.current?.scrollIntoView({ block: 'start' });
      didTodayScroll.current = true;
    }, 100);
    return () => clearTimeout(t);
  });

  // Offline kuyruğu (reminder.create / visit.create) bağlantı gelince flush edilince
  // takvimi sunucu gerçeğiyle tazele → optimistik offline satırlar gerçek kayıtla
  // reconcile olur (aynı id ile upsert → çift yok), reconnect-refetch flicker'ı önlenir.
  useEffect(() => {
    const onSynced = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    };
    window.addEventListener('saha-sync-completed', onSynced);
    return () => window.removeEventListener('saha-sync-completed', onSynced);
  }, [queryClient]);

  // Arama filtresi — klinik adı veya nota göre (boşsa tüm öğeler)
  // H6: tanıtım hatırlatmaları ajanda listesinden gizlenir; byDay (ay görünümü) etkilenmez.
  const filteredItems = useMemo<AgendaItem[]>(() => {
    const term = searchTerm.trim().toLocaleLowerCase('tr');
    // H6: tanıtım ajandadan gizli — ama deep-link ile odaklanılan tanıtım kaydı görünsün.
    let items = allItems.filter((it) => it.type !== 'tanitim' || it.id === focusId);
    if (term) {
      items = items.filter((it) => {
        const clinicName = it.accountId ? (nameMap[it.accountId]?.name ?? '') : '';
        return (
          clinicName.toLocaleLowerCase('tr').includes(term) ||
          (it.note ?? '').toLocaleLowerCase('tr').includes(term) ||
          it.title.toLocaleLowerCase('tr').includes(term)
        );
      });
    }
    if (typeFilter.size > 0) {
      items = items.filter((it) => typeFilter.has(groupOf(it.type)));
    }
    // 'past' modunda tarih-seçici: yalnız seçilen günden eski/o gün öğeler.
    if (filter === 'past' && pastBefore) {
      items = items.filter((it) => dayKey(it.at) <= pastBefore);
    }
    return items;
  }, [allItems, searchTerm, nameMap, typeFilter, focusId, filter, pastBefore]);

  // Ajanda görünümü: güne göre grupla
  const grouped = useMemo(() => {
    // H2 sıralama: 'recent' modunda geçmiş günler (tamamlananlar) en üstte-yeni önce,
    // ardından bugün+gelecek yakın önce. 'upcoming' ve 'all' yakın önce. Geçmiş ters.
    const items = [...filteredItems].sort((a, b) => {
      if (filter === 'recent') {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayTs = todayStart.getTime();
        const aTime = new Date(a.at).getTime();
        const bTime = new Date(b.at).getTime();
        const aIsPast = aTime < todayTs;
        const bIsPast = bTime < todayTs;
        if (aIsPast && !bIsPast) return -1; // geçmiş günler önce
        if (!aIsPast && bIsPast) return 1;
        if (aIsPast && bIsPast) return bTime - aTime; // geçmiş: en yeni önce
        return aTime - bTime; // gelecek: en yakın önce
      }
      return filter === 'upcoming'
        ? new Date(a.at).getTime() - new Date(b.at).getTime()
        : new Date(b.at).getTime() - new Date(a.at).getTime();
    });
    const map = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const k = dayKey(it.at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return [...map.entries()];
  }, [filteredItems, filter]);

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
      id: data.id,
      name: data.name,
      lat: data.lat,
      lng: data.lng,
      source: 'saha',
    });
    if (res.ok) toast.success('Rota sepetine eklendi.');
    else toast.error(res.reason === 'full' ? 'Sepet dolu (max 12).' : 'Zaten sepette.');
  }

  async function completeReminder(
    id: string,
    outcome: string,
    note: string,
    potential?: number | null,
  ): Promise<void> {
    const sb = getSupabaseClient();
    const { error } = await sb
      .from('saha_reminders')
      .update({
        status: 'done',
        outcome,
        completion_note: note.trim() || null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) {
      toast.error('Kaydedilemedi');
      return;
    }
    // Potansiyel seçildiyse klinik kaydını güncelle (latest-wins; fire-and-forget).
    if (potential != null) {
      const sourceR = reminders.find((r) => r.id === id);
      if (sourceR?.account_id) {
        const typed = getTypedClient();
        void typed
          .from('saha_clinics')
          .update({ potential, potential_at: new Date().toISOString() })
          .eq('id', sourceR.account_id);
      }
    }
    toast.success('Tamamlandı');
    // C3 — Tekrarlayan: tamamlananın recurrence'ı varsa sonraki occurrence'ı oluştur.
    const sourceReminder = reminders.find((r) => r.id === id);
    if (sourceReminder && sourceReminder.recurrence && sourceReminder.recurrence !== 'none') {
      const nextDue = new Date(sourceReminder.due_at);
      if (sourceReminder.recurrence === 'weekly') nextDue.setDate(nextDue.getDate() + 7);
      else nextDue.setMonth(nextDue.getMonth() + 1);
      const { error: recurErr } = await sb.from('saha_reminders').insert({
        rep_id: sourceReminder.rep_id,
        account_id: sourceReminder.account_id,
        type: sourceReminder.type,
        title: sourceReminder.title,
        note: sourceReminder.note,
        due_at: nextDue.toISOString(),
        status: 'open',
        recurrence: sourceReminder.recurrence,
        assigned_by: sourceReminder.assigned_by,
        created_by: sourceReminder.rep_id,
      });
      if (recurErr) toast.warning('Tamamlandı, fakat sonraki tekrar oluşturulamadı.');
    } else if (
      sourceReminder &&
      (sourceReminder.type === 'tanitim' || sourceReminder.type === 'malzeme_teslim')
    ) {
      // Otomatik takip (2026-06-19 karar): tanıtım/teslimat tamamlanınca recurrence
      // seçilmese bile 1 ay sonrasına aynı tipte takip hatırlatması oluştur. Tarih
      // TAMAMLANMA anına göre (geç tamamlanırsa kaymasın). dispatch cron push'lar.
      const followDue = new Date();
      followDue.setMonth(followDue.getMonth() + 1);
      followDue.setHours(9, 0, 0, 0);
      const isTeslim = sourceReminder.type === 'malzeme_teslim';
      const { error: followErr } = await sb.from('saha_reminders').insert({
        rep_id: sourceReminder.rep_id,
        account_id: sourceReminder.account_id,
        type: sourceReminder.type,
        title: sourceReminder.title,
        note: isTeslim
          ? 'Otomatik takip — 1 ay önce malzeme teslimi yapıldı, tekrar teslim/kontrol.'
          : 'Otomatik takip — 1 ay önce tanıtım yapıldı, tekrar ziyaret/tanıtım.',
        due_at: followDue.toISOString(),
        status: 'open',
        created_by: sourceReminder.rep_id,
      });
      if (followErr) toast.warning('Tamamlandı, fakat otomatik takip oluşturulamadı.');
    }
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
  }

  // R1 — kliniksiz randevuya klinik bağla → not o klinik geçmişinde görünür.
  async function linkReminderClinic(reminderId: string, clinicId: string): Promise<void> {
    const sb = getSupabaseClient();
    const { error } = await sb
      .from('saha_reminders')
      .update({ account_id: clinicId })
      .eq('id', reminderId);
    if (error) {
      toast.error('Klinik bağlanamadı.');
      return;
    }
    toast.success('Klinik bağlandı.');
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-clinic-names'] });
  }

  async function reopenReminder(id: string): Promise<void> {
    const sb = getSupabaseClient();
    await sb
      .from('saha_reminders')
      .update({ status: 'open', outcome: null, completion_note: null, completed_at: null })
      .eq('id', id);
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

  // Randevu/reminder sil (RLS: rep-kendi VEYA admin). Admin'e bildirim DB-trigger ile.
  async function deleteReminder(id: string): Promise<void> {
    const sb = getSupabaseClient();
    const { error } = await sb.from('saha_reminders').delete().eq('id', id);
    if (error) {
      toast.error('Silinemedi: ' + (error.message || ''));
      return;
    }
    toast.success('Silindi');
    void queryClient.invalidateQueries({ queryKey: ['calendar'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-clinic-names'] });
  }

  const loading = dataQuery.isLoading || !selfId;
  const todayKey = dayKeyOf(new Date());

  // UX — 'recent' modda gelecek (bugünden sonraki) günleri accordion ile katla.
  // grouped sıralaması recent'te: geçmiş → bugün → gelecek; gelecek gruplar sonda bitişik.
  const canCollapseFuture = view === 'agenda' && filter === 'recent';
  const futureItemCount = canCollapseFuture
    ? filteredItems.filter((it) => dayKey(it.at) > todayKey).length
    : 0;
  const firstFutureKey = canCollapseFuture
    ? grouped.find(([k]) => k > todayKey)?.[0]
    : undefined;

  const selectedDayItems = useMemo(() => {
    if (!selectedDay) return [];
    if (!searchTerm.trim()) return byDay.get(selectedDay) ?? [];
    // When searching, filter the selected day's items by search term too
    return (byDay.get(selectedDay) ?? []).filter((it) => {
      const term = searchTerm.trim().toLocaleLowerCase('tr');
      const clinicName = it.accountId ? (nameMap[it.accountId]?.name ?? '') : '';
      return (
        clinicName.toLocaleLowerCase('tr').includes(term) ||
        (it.note ?? '').toLocaleLowerCase('tr').includes(term) ||
        it.title.toLocaleLowerCase('tr').includes(term)
      );
    });
  }, [selectedDay, byDay, searchTerm, nameMap]);

  return (
    <PullToRefresh onRefresh={() => queryClient.invalidateQueries({ queryKey: ['calendar'] })}>
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

      {/* İlk yükleme: ajanda kartı şeklinde iskelet (arka-plan refetch'te gösterilmez). */}
      {loading && <AgendaSkeleton />}

      {/* ----- AJANDA GÖRÜNÜMÜ ----- */}
      {view === 'agenda' && (
        <>
          {/* Klinik adı / not arama */}
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Klinik adı veya notta ara…"
              className="h-10 w-full rounded-xl border border-border bg-background px-3 pr-9 text-sm placeholder:text-muted-foreground"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                aria-label="Aramayı temizle"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Zaman filtresi — tek satır yatay kaydırma (sarmalanmaz) */}
          <div className="-mx-4 flex flex-nowrap gap-1.5 overflow-x-auto px-4 no-scrollbar">
            {(
              [
                ['recent', 'Yaklaşan'],
                ['past', 'Geçmiş'],
                ['all', 'Tümü'],
                ['overdue', 'Gecikti'],
              ] as [FilterMode, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`h-9 shrink-0 whitespace-nowrap rounded-lg border px-3 text-xs font-medium ${
                  filter === k
                    ? k === 'overdue'
                      ? 'border-red-500 bg-red-500 text-white'
                      : 'border-primary bg-primary text-primary-foreground'
                    : k === 'overdue'
                      ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                      : 'border-border bg-background hover:bg-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Geçmiş modda tarihe atlama: seçilen günden eskiye daralt (arama girişi zaten üstte) */}
          {filter === 'past' && (
            <div className="flex items-center gap-2">
              <label htmlFor="past-date" className="shrink-0 text-xs text-muted-foreground">
                Tarihe git
              </label>
              <input
                id="past-date"
                type="date"
                value={pastBefore}
                max={todayKey}
                onChange={(e) => setPastBefore(e.target.value)}
                className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm"
              />
              {pastBefore && (
                <button
                  type="button"
                  onClick={() => setPastBefore('')}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Tarih filtresini temizle"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* Tip filtre çipleri — Günlük Plan · tek satır yatay kaydırma */}
          <div className="-mx-4 flex flex-nowrap gap-1.5 overflow-x-auto px-4 no-scrollbar">
            <button
              type="button"
              onClick={() => setTypeFilter(new Set())}
              className={`h-7 shrink-0 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
                typeFilter.size === 0
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-muted-foreground hover:bg-muted'
              }`}
            >
              Tümü
            </button>
            {Object.entries(TYPE_GROUPS).map(([key, g]) => {
              const repType = g.types[0]!;
              const meta = typeMeta(repType);
              const active = typeFilter.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setTypeFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    });
                  }}
                  className={`inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ${
                    active
                      ? `border-transparent bg-primary text-primary-foreground`
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
                  {g.label}
                </button>
              );
            })}
          </div>

          {!loading && grouped.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              <p>
                {searchTerm.trim()
                  ? `"${searchTerm.trim()}" için sonuç bulunamadı.`
                  : 'Bu filtrede takvim kaydı yok. "+ Ekle" ile manuel randevu/tahsilat/tanıtım ekleyebilir veya ziyaret formundan otomatik oluşturabilirsin.'}
              </p>
              {!searchTerm.trim() && (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Ekle
                </button>
              )}
            </div>
          )}

          <div className="space-y-5">
            {grouped.map(([k, items]) => {
              // Günlük özet: grup bazında sayı
              const daySummary = Object.entries(TYPE_GROUPS)
                .map(([gKey, g]) => {
                  const count = items.filter((it) =>
                    (g.types as string[]).includes(it.type),
                  ).length;
                  if (count === 0) return null;
                  const meta = typeMeta(g.types[0]!);
                  return { gKey, count, meta, label: g.label };
                })
                .filter(Boolean) as {
                gKey: string;
                count: number;
                meta: ReturnType<typeof typeMeta>;
                label: string;
              }[];

              const isTodayGroup = k === todayKey;
              const isFutureGroup = canCollapseFuture && k > todayKey;
              // Gelecek grupların ilkinin ÜSTÜNE tek accordion başlığı koy.
              const accordionHeader =
                canCollapseFuture && futureItemCount > 0 && k === firstFutureKey ? (
                  <button
                    type="button"
                    onClick={() => setFutureCollapsed((v) => !v)}
                    className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 text-sm font-medium text-muted-foreground hover:bg-muted"
                    aria-expanded={!futureCollapsed}
                  >
                    {futureCollapsed ? (
                      <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>Yaklaşan randevular ({futureItemCount})</span>
                  </button>
                ) : null;

              return (
                <Fragment key={k}>
                  {accordionHeader}
                  {isFutureGroup && futureCollapsed ? null : (
                    <div
                      ref={isTodayGroup ? todayRef : undefined}
                      className="space-y-2"
                    >
                      <div className="sticky top-0 bg-background/95 py-1 space-y-1">
                        <h2 className="text-sm font-semibold text-foreground">
                          {dayLabel(items[0]?.at ?? `${k}T00:00:00`)}
                        </h2>
                        {daySummary.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2">
                            {daySummary.map(({ gKey, count, meta }) => (
                              <span
                                key={gKey}
                                className={`inline-flex items-center gap-1 text-[11px] font-medium ${meta.color}`}
                              >
                                <meta.Icon className="h-3 w-3" aria-hidden="true" />
                                {count}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <ul className="space-y-2">
                        {items.map((it) => (
                          <AgendaCard
                            key={`${it.kind}-${it.id}`}
                            it={it}
                            clinic={it.accountId ? (nameMap[it.accountId] ?? null) : null}
                            assignerName={
                              it.assignedBy ? (assignerMap[it.assignedBy] ?? null) : null
                            }
                            highlighted={it.id === focusId}
                            onAddPhone={addClinicPhone}
                            attachments={attachmentsMap[it.id]}
                            onOpen={setSelectedItem}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>

          {/* SC-2 — Klinikler (takvimdeki kalemlerde görünmeyenler) */}
          {searchTerm.trim().length >= 2 &&
            (() => {
              const extraClinics = (clinicSearchQuery.data ?? []).filter(
                (c) => !filteredItems.some((it) => it.accountId === c.id),
              );
              if (extraClinics.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground px-1">Klinikler</p>
                  <ul className="space-y-1">
                    {extraClinics.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5 text-sm"
                      >
                        <span className="truncate">{c.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFollowUpInit({
                              type: 'appointment',
                              title: '',
                              note: '',
                              clinic: { id: c.id, name: c.name },
                              recurrence: 'none',
                              sourceId: null,
                            });
                            setShowAdd(true);
                          }}
                          className="ml-3 shrink-0 text-xs text-primary hover:underline"
                        >
                          Randevu ekle
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
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
                      assignerName={it.assignedBy ? (assignerMap[it.assignedBy] ?? null) : null}
                      highlighted={it.id === focusId}
                      onAddPhone={addClinicPhone}
                      attachments={attachmentsMap[it.id]}
                      onOpen={setSelectedItem}
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
          assignableReps={(assignableQuery.data && assignableQuery.data.length > 0
            ? assignableQuery.data
            : (repsQuery.data ?? [])
          ).filter((r) => r.id !== selfId)}
          initial={followUpInit ?? undefined}
          editReminder={editReminder ?? undefined}
          onClose={() => {
            setShowAdd(false);
            setFollowUpInit(null);
            setEditReminder(null);
          }}
          onAdded={(assignedRepId, created) => {
            setShowAdd(false);
            setFollowUpInit(null);
            setEditReminder(null);
            const reassign = Boolean(assignedRepId && assignedRepId !== selfId);
            // Başka plasiyere atandıysa admin'in görünümünü o plasiyere geçir →
            // atanan kayıt anında görünür (aksi halde 'gözükmüyor' algısı).
            if (reassign) {
              setRepFilter(assignedRepId!);
              setView('agenda');
              setFilter('recent');
              setSelectedDay(null);
            }
            // PERF: optimistik ekleme — yeni kaydı hedef takvimin cache'ine ANINDA
            // enjekte et; tam refetch'i beklemeden ekrana düşer. Arka plandaki
            // invalidate (aşağıda) sunucu sonucuyla id üzerinden reconcile eder
            // (dedupe: aynı id'yi bir daha eklemeyiz, refetch tüm diziyi değiştirir).
            if (created) {
              const seedRepId = created.rep_id;
              const seedFilter: FilterMode = reassign
                ? 'recent'
                : view === 'month'
                  ? 'all'
                  : filter;
              if (reminderPassesFilter(created, seedFilter)) {
                queryClient.setQueryData<{ reminders: ReminderRow[]; visits: VisitRow[] }>(
                  ['calendar', seedRepId, seedFilter],
                  (prev) => {
                    const base = prev ?? { reminders: [], visits: [] };
                    if (base.reminders.some((r) => r.id === created.id)) return base;
                    return {
                      reminders: [...base.reminders, created].sort(
                        (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
                      ),
                      visits: base.visits,
                    };
                  },
                );
              }
            }
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
            void syncReminderNotifications();
          }}
        />
      )}

      {selectedItem && (
        <ReminderDetailSheet
          item={
            {
              id: selectedItem.id,
              kind: selectedItem.kind,
              type: selectedItem.type,
              title: selectedItem.title,
              note: selectedItem.note,
              at: selectedItem.at,
              accountId: selectedItem.accountId,
              status: selectedItem.status,
              assignedBy: selectedItem.assignedBy,
              outcome: selectedItem.outcome,
              completionNote: selectedItem.completionNote,
              sourceRef: selectedItem.sourceRef,
            } as ReminderDetailItem
          }
          clinic={selectedItem.accountId ? (nameMap[selectedItem.accountId] ?? null) : null}
          attachments={attachmentsMap[selectedItem.id]}
          assignerName={
            selectedItem.assignedBy ? (assignerMap[selectedItem.assignedBy] ?? null) : null
          }
          onClose={() => setSelectedItem(null)}
          onSnooze={(id, ms, label) => {
            void snooze(id, ms, label);
            setSelectedItem(null);
          }}
          onAddToRoute={(aid) => {
            void addReminderToRoute(aid);
          }}
          onComplete={(id, outcome, note, potential) => {
            void completeReminder(id, outcome, note, potential);
            // "Sipariş Alındı" → aynı ekranda ürün+fiyat girişi. Ayrı "Yeni Sipariş"
            // sayfasına gitmeye gerek yok; cari createOrder içinde otomatik açılır.
            if (outcome === 'order_taken' && selectedItem?.accountId) {
              const acct = nameMap[selectedItem.accountId];
              setOrderForClinic({ id: selectedItem.accountId, name: acct?.name ?? 'Klinik' });
            }
            setSelectedItem(null);
          }}
          onReopen={(id) => {
            void reopenReminder(id);
            setSelectedItem(null);
          }}
          onDelete={(id) => {
            void deleteReminder(id);
            setSelectedItem(null);
          }}
          onCreateFollowUp={(it) => {
            // Klinik adını nameMap'ten çöz; tür geçerli ReminderType değilse (visit) revisit'e düş.
            const acct = it.accountId ? nameMap[it.accountId] : undefined;
            const clinic = it.accountId && acct ? { id: it.accountId, name: acct.name } : null;
            const followType: ReminderType = it.type === 'visit' ? 'revisit' : it.type;
            // R3 — kaynak randevunun tekrar+notunu taşı. R5 — kaynak id bağı.
            const src = reminders.find((r) => r.id === it.id);
            setFollowUpInit({
              type: followType,
              title: it.title,
              note: it.note ?? '',
              clinic,
              recurrence: src?.recurrence ?? 'none',
              sourceId: it.id,
            });
            setSelectedItem(null);
            setShowAdd(true);
          }}
          onLinkClinic={
            !selectedItem.accountId && selectedItem.kind === 'reminder'
              ? () => {
                  setLinkClinicFor(selectedItem.id);
                  setSelectedItem(null);
                }
              : undefined
          }
          onEdit={
            selectedItem.kind === 'reminder'
              ? (it) => {
                  const acct = it.accountId ? nameMap[it.accountId] : undefined;
                  const clinic =
                    it.accountId && acct ? { id: it.accountId, name: acct.name } : null;
                  const src = reminders.find((r) => r.id === it.id);
                  setEditReminder({
                    id: it.id,
                    type: (it.type === 'visit' ? 'revisit' : it.type) as ReminderType,
                    title: it.title,
                    note: it.note,
                    at: it.at,
                    clinic,
                    recurrence: src?.recurrence ?? 'none',
                  });
                  setSelectedItem(null);
                  setShowAdd(true);
                }
              : undefined
          }
          // Atama: düzenleme modalını açar; admin "Kime" seçici ile başka
          // admin/plasiyere atar (alanlar prefilled → tekrar yazmaya gerek yok).
          onAssign={
            isAdmin && selectedItem.kind === 'reminder'
              ? (it) => {
                  const acct = it.accountId ? nameMap[it.accountId] : undefined;
                  const clinic =
                    it.accountId && acct ? { id: it.accountId, name: acct.name } : null;
                  const src = reminders.find((r) => r.id === it.id);
                  setEditReminder({
                    id: it.id,
                    type: (it.type === 'visit' ? 'revisit' : it.type) as ReminderType,
                    title: it.title,
                    note: it.note,
                    at: it.at,
                    clinic,
                    recurrence: src?.recurrence ?? 'none',
                  });
                  setSelectedItem(null);
                  setShowAdd(true);
                }
              : undefined
          }
        />
      )}

      {linkClinicFor && (
        <LinkClinicModal
          onClose={() => setLinkClinicFor(null)}
          onPick={(clinicId) => {
            void linkReminderClinic(linkClinicFor, clinicId);
            setLinkClinicFor(null);
          }}
        />
      )}

      {/* "Sipariş Alındı" sonrası inline sipariş girişi — ürün+fiyat aynı ekranda,
          cari createOrder içinde otomatik (idempotent) açılır. */}
      {orderForClinic && (
        <InlineOrderSheet
          customerId={orderForClinic.id}
          customerName={orderForClinic.name}
          onClose={() => setOrderForClinic(null)}
          onCreated={() => {
            void queryClient.invalidateQueries({ queryKey: ['calendar'] });
          }}
        />
      )}
      </div>
    </PullToRefresh>
  );
}

// ---- İlk-yükleme iskeleti (ajanda kartı şeklini taklit eder, pulse) ----
function AgendaSkeleton(): JSX.Element {
  return (
    <div className="space-y-5" aria-hidden="true">
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          {/* Gün başlığı */}
          <div className="h-4 w-32 animate-pulse rounded bg-muted" />
          <ul className="space-y-2">
            {[0, 1, 2].map((c) => (
              <li key={c} className="rounded-2xl border border-border bg-card p-3">
                <div className="flex items-start gap-3">
                  {/* Sol: saat + ikon */}
                  <div className="flex min-w-[38px] flex-col items-center gap-1 pt-0.5">
                    <div className="h-3 w-8 animate-pulse rounded bg-muted" />
                    <div className="h-4 w-4 animate-pulse rounded-full bg-muted" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Rozet + başlık */}
                    <div className="flex items-center gap-1.5">
                      <div className="h-4 w-16 animate-pulse rounded-full bg-muted" />
                      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                    </div>
                    {/* Klinik satırı */}
                    <div className="h-3 w-28 animate-pulse rounded bg-muted" />
                    {/* Not satırı */}
                    <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---- Ajanda kartı (ajanda + ay-gün listesi paylaşır) ----
function AgendaCard({
  it,
  clinic,
  assignerName,
  highlighted,
  onAddPhone,
  attachments,
  onOpen,
}: {
  it: AgendaItem;
  clinic: { name: string; phone: string | null; lat?: number | null; lng?: number | null } | null;
  assignerName?: string | null;
  highlighted?: boolean;
  onAddPhone?: (accountId: string, phone: string) => Promise<void>;
  attachments?: ReminderAttachment[];
  onOpen?: (it: AgendaItem) => void;
}): JSX.Element {
  const meta = typeMeta(it.type);
  const done = it.status === 'done';
  // Durum-şeridi (sol kenar): AYNI resolved/overdue mantığı (Gecikti rozetiyle tutarlı).
  // Gecikti = randevu + çözülmemiş + geçmiş vade → kırmızı. Çözülmüş/görüşüldü
  // (done VEYA resolved VEYA tamamlanmış ziyaret) → yeşil. Diğer/yaklaşan → nötr mavi.
  const isOverdue = it.kind === 'reminder' && !it.resolved && new Date(it.at) < new Date();
  const isResolved = done || Boolean(it.resolved) || it.kind === 'visit';
  const stripClass = isResolved
    ? 'border-l-4 border-l-green-500'
    : isOverdue
      ? 'border-l-4 border-l-red-500'
      : 'border-l-4 border-l-blue-400';
  const phone = clinic?.phone ? clinic.phone.replace(/[^\d+]/g, '') : null;
  const waPhone = phone ? phone.replace(/^0/, '90').replace(/^\+/, '') : null;
  // Bug #22: kliniğin konumu varsa Ara/WhatsApp yanına yol-tarifi butonu
  // (ReminderDetailSheet'teki ile aynı URL üretimi).
  const directionsHref =
    typeof clinic?.lat === 'number' && typeof clinic?.lng === 'number'
      ? googleMapsDirectionsUrl(clinic.lat, clinic.lng, clinic.name)
      : null;

  // B1 — numara ekleme inline state
  const [addingPhone, setAddingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  return (
    <li
      id={`reminder-${it.id}`}
      className={`rounded-2xl border border-border bg-card p-3 ${stripClass} ${done ? 'opacity-60' : ''} ${highlighted ? 'ring-2 ring-primary ring-offset-2' : ''}`}
    >
      <div
        className={`flex items-start gap-3 ${it.kind === 'reminder' ? 'cursor-pointer' : ''}`}
        role={it.kind === 'reminder' ? 'button' : undefined}
        onClick={it.kind === 'reminder' ? () => onOpen?.(it) : undefined}
      >
        {/* Sol kolon: saat (belirgin) + ikon */}
        <div className="flex flex-col items-center gap-0.5 pt-0.5 min-w-[38px]">
          <span className="text-sm font-semibold tabular-nums leading-none text-foreground">
            {timeLabel(it.at)}
          </span>
          <meta.Icon className={`h-4 w-4 ${meta.color}`} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          {/* Üst satır: tip chip + başlık + gecikti rozeti */}
          <p
            className={`flex flex-wrap items-center gap-1.5 text-sm font-medium ${done && it.outcome === 'no_meeting' ? 'text-red-600' : 'text-foreground'} ${done ? 'line-through' : ''}`}
          >
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${meta.color} border-current/20 bg-current/5`}
              style={{ borderColor: 'currentColor', backgroundColor: 'transparent' }}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
              {meta.label}
            </span>
            <span className="min-w-0 truncate">{it.title}</span>
            {/* Gecikti = geçmiş vade + ÇÖZÜLMEMİŞ. resolved: durum done/cancelled VEYA
                aynı kliniğe görüşüldü/ziyaret yapılmış (allItems'ta türetilir). */}
            {it.kind === 'reminder' && !it.resolved && new Date(it.at) < new Date() && (
              <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-red-100 text-red-700">
                Gecikti
              </span>
            )}
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
          {/* Done outcome özeti */}
          {done && it.outcome && (
            <p
              className={`mt-1 text-[11px] font-medium ${['no_meeting', 'odenmedi', 'teslim_edilemedi'].includes(it.outcome) ? 'text-red-600' : 'text-green-600'}`}
            >
              ✓ {OUTCOME_LABEL[it.outcome] ?? it.outcome}
              {it.completionNote ? ` — ${it.completionNote}` : ''}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {it.visitId && (
              <Link
                to={`/visits/${it.visitId}`}
                onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => e.stopPropagation()}
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
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                >
                  <MessageCircle className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                  WhatsApp
                </a>
              )}
              {directionsHref && (
                <a
                  href={directionsHref}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                >
                  <Navigation className="h-3.5 w-3.5 text-indigo-600" aria-hidden="true" />
                  Yol tarifi
                </a>
              )}
              {/* B1 — numara ekle (klinik varsa ama telefon yoksa) */}
              {it.accountId &&
                !clinic?.phone &&
                onAddPhone &&
                (addingPhone ? (
                  <>
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Numara girin"
                      className="h-8 w-32 rounded-lg border border-border bg-background px-2 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onAddPhone(it.accountId!, phoneInput);
                        setAddingPhone(false);
                        setPhoneInput('');
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                    >
                      Kaydet
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAddingPhone(false);
                        setPhoneInput('');
                      }}
                      className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2 text-[11px] hover:bg-muted"
                      aria-label="İptal"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddingPhone(true);
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-background px-2 text-[11px] font-medium hover:bg-muted"
                  >
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    Numara ekle
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Foto / ses ekleri */}
      {attachments && attachments.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            <Paperclip className="h-3 w-3" aria-hidden="true" />
            {attachments.length} ek
          </p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att) =>
              att.kind === 'photo' ? (
                <button
                  key={att.id}
                  type="button"
                  onClick={() => window.open(att.url, '_blank')}
                  className="block overflow-hidden rounded-lg border border-border"
                  aria-label="Fotoğrafı aç"
                >
                  <img
                    src={att.url}
                    alt="ek fotoğraf"
                    className="h-14 w-14 object-cover"
                    loading="lazy"
                  />
                </button>
              ) : (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio key={att.id} src={att.url} controls className="h-8 max-w-[240px]" />
              ),
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// H4: ISO tarih/saat → input[type=date/time] formatları
function parseISODate(iso: string): string {
  const dt = new Date(iso);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function parseISOTime(iso: string): string {
  const dt = new Date(iso);
  return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
}

// ---- Manuel ekleme / düzenleme modalı ----
function AddReminderModal({
  repId,
  selfId,
  isAdmin,
  assignableReps,
  initial,
  editReminder,
  onClose,
  onAdded,
}: {
  repId: string;
  selfId: string;
  isAdmin: boolean;
  assignableReps: RepOption[];
  initial?: ReminderInitial;
  editReminder?: ReminderEditData; // H4: dolu ise düzenleme modu
  onClose: () => void;
  onAdded: (assignedRepId?: string, created?: ReminderRow) => void;
}): JSX.Element {
  const isEdit = Boolean(editReminder);
  // Hedef plasiyer (kimin takvimine). Admin başka plasiyere atayabilir → assigned_by=self.
  const [targetRep, setTargetRep] = useState<string>(repId);
  // editReminder > initial > defaults
  const [type, setType] = useState<ReminderType>(
    editReminder?.type ?? initial?.type ?? 'appointment',
  );
  const [title, setTitle] = useState(editReminder?.title ?? initial?.title ?? '');
  const [note, setNote] = useState(editReminder?.note ?? initial?.note ?? '');
  const [atDate, setAtDate] = useState(editReminder ? parseISODate(editReminder.at) : '');
  const [atTime, setAtTime] = useState(editReminder ? parseISOTime(editReminder.at) : '');
  const [clinicQuery, setClinicQuery] = useState('');
  const [clinic, setClinic] = useState<{ id: string; name: string } | null>(
    editReminder?.clinic ?? initial?.clinic ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [recurrence, setRecurrence] = useState<'none' | 'weekly' | 'monthly'>(
    editReminder?.recurrence ?? initial?.recurrence ?? 'none',
  );

  // Foto / ses ekleri (kaydetmeden önce toplanır, insert sonrası yüklenir)
  const [attachments, setAttachments] = useState<{ kind: 'photo' | 'audio'; blob: Blob }[]>([]);
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Modal kapanırsa/unmount olursa aktif kaydı + mikrofon track'lerini durdur
  // (aksi halde getUserMedia stream'i açık kalır → mikrofon göstergesi yanar).
  useEffect(() => {
    return () => {
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {
        /* yut */
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function handlePhotoSelect(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachments((prev) => [...prev, { kind: 'photo', blob: file }]);
    // input sıfırla (aynı dosyayı tekrar seçilebilsin)
    e.target.value = '';
  }

  async function startRecording(): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAttachments((prev) => [...prev, { kind: 'audio', blob }]);
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      mr.start();
      setRecording(true);
    } catch {
      toast.error('Mikrofon izni alınamadı.');
    }
  }

  function stopRecording(): void {
    mediaRecorderRef.current?.stop();
  }

  function removeAttachment(idx: number): void {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  const searchQuery = useQuery({
    queryKey: ['add-reminder-clinic-search', clinicQuery],
    enabled: clinicQuery.trim().length >= 2 && !clinic,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      // saha_search_clinics RPC: diyakritik+Türkçe-İ duyarsız, token-AND.
      const sb = getSupabaseClient();
      const { data } = await sb.rpc('saha_search_clinics', {
        _q: clinicQuery.trim(),
        _limit: 8,
      });
      return ((data ?? []) as { id: string; name: string }[]).map((c) => ({
        id: c.id,
        name: c.name,
      }));
    },
  });

  async function save(): Promise<void> {
    if (!atDate) {
      toast.error('Tarih seçin.');
      return;
    }
    // isPastDay: yalnız yeni kayıt için; düzenleme geçmiş tarihli kayıtlara izin verir.
    if (!isEdit && isPastDay(atDate, atTime || undefined)) {
      toast.error('Geçmiş tarihe randevu eklenemez.');
      return;
    }
    // H4: düzenleme offline yapılamaz (offline queue'da reminder.update yok) —
    // setSaving'den ÖNCE kontrol et ki buton 1-frame spinner'a girmesin.
    if (isEdit && !navigator.onLine) {
      toast.error('Düzenleme için internet bağlantısı gerekli.');
      return;
    }
    const due = new Date(buildDueAt(atDate, atTime || undefined));
    setSaving(true);
    const typeLabel = ADD_TYPES.find((t) => t.value === type)?.label ?? 'Hatırlatma';
    const finalTitle = title.trim() || (clinic ? `${typeLabel} — ${clinic.name}` : typeLabel);

    // H4: düzenleme — online-only UPDATE (offline zaten yukarıda yakalandı)
    if (isEdit && editReminder) {
      const sb = getSupabaseClient();
      // Yeniden-atama: yalnız takvim-sahibi (repId) değiştiyse rep_id+assigned_by'a dokun.
      // Aksi halde (düz düzenleme) assigned_by'ı KORU — admin'in düzenlemesi orijinal
      // atayanı yanlışlıkla ezmemeli.
      const ownerChanged = targetRep !== repId;
      const updatePayload: Record<string, unknown> = {
        type,
        title: finalTitle,
        note: note.trim() || null,
        due_at: due.toISOString(),
        account_id: clinic?.id ?? null,
        recurrence,
      };
      if (ownerChanged) {
        updatePayload.rep_id = targetRep;
        updatePayload.assigned_by = targetRep !== selfId ? selfId : null;
      }
      const { error } = await sb
        .from('saha_reminders')
        .update(updatePayload)
        .eq('id', editReminder.id);
      if (error) {
        setSaving(false);
        toast.error(`Güncellenemedi: ${error.message}`);
        return;
      }
      // Başka kullanıcıya atandıysa → hedefe bildirim (create akışıyla aynı RPC).
      const reassignedToOther = ownerChanged && targetRep !== selfId;
      let notifFailed = false;
      if (reassignedToOther) {
        const { error: notifErr } = await sb.rpc('saha_notify_rep', {
          p_user_id: targetRep,
          p_saha_type: 'system',
          p_title: `${typeLabel} atandı`,
          p_body: `${finalTitle} — ${due.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })}`,
          p_data: {
            kind: 'visit_reminder',
            route: `/takvim?reminder=${editReminder.id}`,
            deeplink: `/takvim?reminder=${editReminder.id}`,
            reminder_id: editReminder.id,
          },
          p_push: true,
        });
        if (notifErr) notifFailed = true;
      }
      setSaving(false);
      if (notifFailed) toast.warning('Atandı, fakat bildirim gönderilemedi.');
      else toast.success(reassignedToOther ? 'Atandı' : 'Güncellendi');
      onAdded(ownerChanged ? targetRep : undefined);
      return;
    }

    const isAssignment = targetRep !== selfId;

    // Kararlı client id (uuid) — offline kuyruk kaydının PK'sı olur. executeOp upsert
    // onConflict 'id' ile replay idempotent olur; ayrıca optimistik satırın id'si sync
    // sonrası sunucu id'siyle BİREBİR aynı olduğundan refetch çift göstermez. Aynı id
    // idempotencyKey olarak da kullanılır (çift-enqueue guard).
    const clientId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // Tek nesne: hem DB payload'u hem optimistik ReminderRow (offline'da ajandaya düşer).
    const reminderPayload: ReminderRow & { created_by: string } = {
      id: clientId,
      rep_id: targetRep,
      created_by: selfId,
      assigned_by: isAssignment ? selfId : null,
      account_id: clinic?.id ?? null,
      visit_id: null,
      type,
      title: finalTitle,
      note: note.trim() || null,
      due_at: due.toISOString(),
      status: 'open',
      recurrence,
      outcome: null,
      completion_note: null,
      source_ref: initial?.sourceId ? `followup:${initial.sourceId}` : null,
    };

    // B2 — Offline (veya online iken ağ hatası): kuyruğa al + optimistik olarak ANINDA
    // ajandaya düşür. Bağlantı gelince initSyncQueue flush → upsert (idempotent).
    async function enqueueReminderOffline(): Promise<void> {
      await enqueueOp(
        'reminder.create',
        reminderPayload as unknown as Record<string, unknown>,
        clientId,
      );
      setSaving(false);
      if (attachments.length > 0) toast.warning('Çevrimdışı: ekler kaydedilmedi.');
      else toast.success('Çevrimdışı: bağlantı gelince kaydedilecek.');
      // Optimistik: onAdded'e tam satır geçir → cache'e anında enjekte (offline'da bile görünür).
      onAdded(isAssignment ? targetRep : undefined, reminderPayload);
    }

    if (!navigator.onLine) {
      await enqueueReminderOffline();
      return;
    }

    const sb = getSupabaseClient();
    let inserted: ReminderRow | null = null;
    try {
      const res = await sb
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
          recurrence,
          source_ref: initial?.sourceId ? `followup:${initial.sourceId}` : null,
        })
        // Tam satırı geri al → optimistik cache-insert için (id yerine tüm kolonlar).
        .select(
          'id, rep_id, account_id, visit_id, type, title, note, due_at, status, assigned_by, recurrence, outcome, completion_note, source_ref',
        )
        .single();
      if (res.error) {
        setSaving(false);
        toast.error(`Eklenemedi: ${res.error.message}`);
        return;
      }
      inserted = res.data as ReminderRow;
    } catch (err) {
      // Ağ hatası (fetch throw) → sessizce çevrimdışı kuyruğa düş: stuck-spinner + veri
      // kaybını önle (visit.create/order.create ile aynı desen).
      const msg = err instanceof Error ? err.message : String(err);
      if (!navigator.onLine || /fetch|network/i.test(msg)) {
        await enqueueReminderOffline();
        return;
      }
      setSaving(false);
      toast.error('Eklenemedi: beklenmeyen hata.');
      return;
    }

    // Ek yükleme — insert başarılıysa ve ek varsa paralel yükle.
    // allSettled + try/catch: bir ek throw etse bile save akışı (success toast +
    // onAdded) kesilmesin (reminder zaten kaydedildi).
    if (attachments.length > 0 && inserted?.id) {
      try {
        const results = await Promise.allSettled(
          attachments.map((a) => uploadReminderAttachment(inserted.id, a.blob, a.kind)),
        );
        if (results.some((r) => r.status === 'rejected' || !r.value.ok)) {
          toast.warning('Bazı ekler yüklenemedi.');
        }
      } catch {
        toast.warning('Ekler yüklenemedi.');
      }
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
    onAdded(isAssignment ? targetRep : undefined, inserted ? (inserted) : undefined);
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
          <h2 className="text-base font-semibold">{isEdit ? 'Düzenle' : 'Takvime Ekle'}</h2>
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
          {/* Kime seçici: yeni kayıtta atama, düzenlemede yeniden-atama (owner değişimi).
              Admin başka admin/plasiyere atayabilir; alanlar prefilled → tekrar yazma yok. */}
          {isAdmin && assignableReps.length > 0 && (
            <div className="space-y-1">
              <label htmlFor="ar-rep" className="text-xs text-muted-foreground">
                {isEdit ? 'Kime ata (takvim sahibi)' : 'Kime (plasiyer takvimi)'}
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
            <label className="text-xs text-muted-foreground">Tekrar</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['none', 'Yok'],
                  ['weekly', 'Haftalık'],
                  ['monthly', 'Aylık'],
                ] as ['none' | 'weekly' | 'monthly', string][]
              ).map(([v, lbl]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRecurrence(v)}
                  className={`h-9 rounded-lg border px-2 text-xs font-medium ${
                    recurrence === v
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background hover:bg-muted'
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="ar-at-date" className="text-xs text-muted-foreground">
              Tarih <span className="text-red-600">*</span>
            </label>
            <input
              id="ar-at-date"
              type="date"
              value={atDate}
              onChange={(e) => setAtDate(e.target.value)}
              className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
            />
            <label htmlFor="ar-at-time" className="text-xs text-muted-foreground">
              Saat (opsiyonel — boşsa 09:00 varsayılır)
            </label>
            <input
              id="ar-at-time"
              type="time"
              value={atTime}
              onChange={(e) => setAtTime(e.target.value)}
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

          {/* Foto / ses ekleri — düzenleme modunda gizlenir (ek yükleme desteklenmiyor) */}
          {!isEdit && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Ekler (opsiyonel)</p>
              <div className="flex flex-wrap gap-2">
                {/* Gizli dosya input'u */}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoSelect}
                />
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
                >
                  Foto ekle
                </button>
                {recording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-300 bg-red-50 px-3 text-xs font-medium text-red-700 hover:bg-red-100"
                  >
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-600" />
                    Kaydediliyor — Durdur
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startRecording()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium hover:bg-muted"
                  >
                    Ses kaydet
                  </button>
                )}
              </div>

              {attachments.length > 0 && (
                <ul className="space-y-1">
                  {attachments.map((a, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-1.5 text-xs"
                    >
                      <span className="text-muted-foreground">
                        {a.kind === 'photo' ? 'Fotoğraf' : 'Ses kaydı'} #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeAttachment(idx)}
                        className="ml-2 text-muted-foreground hover:text-destructive"
                        aria-label="Eki kaldır"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : isEdit ? null : (
              <Plus className="h-5 w-5" />
            )}
            {isEdit ? 'Güncelle' : 'Takvime Ekle'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- R1: Kliniksiz randevuya klinik bağlama modalı ----
function LinkClinicModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (clinicId: string) => void;
}): JSX.Element {
  const [q, setQ] = useState('');
  const searchQuery = useQuery({
    queryKey: ['link-clinic-search', q],
    enabled: q.trim().length >= 2,
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const sb = getSupabaseClient();
      // 'duplicate' dahil: ZDK gibi çift-kayıtlı klinikler de bulunabilsin.
      const { data } = await sb.rpc('saha_search_clinics', {
        _q: q.trim(),
        _limit: 8,
        _statuses: ['active', 'duplicate'],
      });
      return ((data ?? []) as { id: string; name: string }[]).map((c) => ({
        id: c.id,
        name: c.name,
      }));
    },
  });

  const hasSearched = q.trim().length >= 2;
  const noResults = hasSearched && !searchQuery.isFetching && (searchQuery.data ?? []).length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Klinik bağla"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4 shadow-xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Klinik Bağla</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Klinik adı ara…"
          className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
        />
        {(searchQuery.data ?? []).length > 0 && (
          <ul className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-border bg-card">
            {(searchQuery.data ?? []).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c.id)}
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-muted"
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {noResults && (
          <div className="mt-3 rounded-xl border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">"{q}" bulunamadı.</p>
            <p className="mt-1">
              Klinik sisteme henüz eklenmemiş olabilir. Keşif ekranından arama yaparak kliniği önce
              sisteme ekleyin, ardından burada bağlayın.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default CalendarPage;
