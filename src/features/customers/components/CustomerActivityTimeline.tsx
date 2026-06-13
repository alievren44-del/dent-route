/**
 * CustomerActivityTimeline — Birleşik aktivite zaman çizelgesi.
 *
 * Müşteri detayındaki notlar + ziyaretler + numuneleri tek bir ters
 * kronolojik akışta birleştirir. Tek useQuery, 3 fetch Promise.all ile.
 *
 * NOT: Siparişler bilinçli olarak dışarıda bırakıldı. Siparişler
 * orders.user_id = profiles.id üzerinden bağlanır; bu sayfanın id'si ise
 * saha_clinics.id (account_id) olduğundan sipariş sorgusu daima boş
 * dönerdi. Bu yüzden timeline'a dahil edilmedi.
 */

import { useQuery } from '@tanstack/react-query';
import { StickyNote, MapPin, Gift } from 'lucide-react';
import { getTypedClient } from '@lib/supabase';

type ActivityEvent =
  | { kind: 'note'; id: string; ts: string; body: string }
  | {
      kind: 'visit';
      id: string;
      ts: string;
      status: string;
      outcome: string | null;
      notes: string | null;
    }
  | {
      kind: 'sample';
      id: string;
      ts: string;
      status: string;
      lines: { product_name: string; qty: number | null; unit: string | null }[];
      notes: string | null;
    };

interface NoteRow {
  id: string;
  body: string | null;
  rep_id: string | null;
  created_at: string | null;
}

interface VisitRow {
  id: string;
  check_in_at: string | null;
  check_out_at: string | null;
  status: string | null;
  outcome: string | null;
  met_person: string | null;
  notes: string | null;
}

interface SampleLineRow {
  product_name: string | null;
  qty: number | null;
  unit: string | null;
}

interface SampleRow {
  id: string;
  given_at: string | null;
  status: string | null;
  follow_up_at: string | null;
  notes: string | null;
  saha_sample_lines: SampleLineRow[] | null;
}

const VISIT_STATUS_STYLES: Record<string, string> = {
  in_progress: 'bg-amber-100 text-amber-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

const SAMPLE_STATUS_STYLES: Record<string, string> = {
  verildi: 'bg-blue-100 text-blue-800',
  denendi: 'bg-amber-100 text-amber-800',
  donusturuldu: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  kayip: 'bg-gray-200 text-gray-700',
  iade: 'bg-gray-200 text-gray-700',
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  accountId: string;
  active: boolean;
}

function CustomerActivityTimeline({ accountId, active }: Props): JSX.Element {
  const { data: events, isLoading } = useQuery({
    queryKey: ['customer-activity', accountId],
    enabled: !!accountId && active,
    queryFn: async (): Promise<ActivityEvent[]> => {
      const supabase = getTypedClient();
      const [notesRes, visitsRes, samplesRes] = await Promise.all([
        supabase
          .from('saha_account_notes')
          .select('id, body, rep_id, created_at')
          .eq('account_id', accountId)
          .order('created_at', { ascending: false }),
        supabase
          .from('saha_visits')
          .select('id, check_in_at, check_out_at, status, outcome, met_person, notes')
          .eq('account_id', accountId)
          .order('check_in_at', { ascending: false }),
        supabase
          .from('saha_samples')
          .select(
            'id, given_at, status, follow_up_at, notes, saha_sample_lines(product_name, qty, unit)',
          )
          .eq('account_id', accountId)
          .order('given_at', { ascending: false }),
      ]);

      if (notesRes.error) throw notesRes.error;
      if (visitsRes.error) throw visitsRes.error;
      if (samplesRes.error) throw samplesRes.error;

      const noteEvents: ActivityEvent[] = ((notesRes.data ?? []) as NoteRow[])
        .filter((n) => !!n.created_at)
        .map((n) => ({
          kind: 'note',
          id: n.id,
          ts: n.created_at as string,
          body: n.body ?? '',
        }));

      const visitEvents: ActivityEvent[] = ((visitsRes.data ?? []) as VisitRow[])
        .filter((v) => !!v.check_in_at)
        .map((v) => ({
          kind: 'visit',
          id: v.id,
          ts: v.check_in_at as string,
          status: String(v.status ?? ''),
          outcome: v.outcome,
          notes: v.notes,
        }));

      const sampleEvents: ActivityEvent[] = ((samplesRes.data ?? []) as SampleRow[])
        .filter((s) => !!s.given_at)
        .map((s) => ({
          kind: 'sample',
          id: s.id,
          ts: s.given_at as string,
          status: String(s.status ?? ''),
          lines: (s.saha_sample_lines ?? []).map((l) => ({
            product_name: l.product_name ?? '—',
            qty: l.qty,
            unit: l.unit,
          })),
          notes: s.notes,
        }));

      return [...noteEvents, ...visitEvents, ...sampleEvents].sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
      );
    },
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Yükleniyor…</p>;
  }

  if (!events || events.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">Henüz aktivite yok.</p>;
  }

  return (
    <div className="space-y-2">
      {events.map((ev) => (
        <ActivityCard key={`${ev.kind}-${ev.id}`} event={ev} />
      ))}
    </div>
  );
}

function ActivityCard({ event }: { event: ActivityEvent }): JSX.Element {
  if (event.kind === 'note') {
    return (
      <div className="p-3 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <StickyNote className="h-4 w-4 text-amber-600" />
            Not
          </span>
          <span className="text-xs text-muted-foreground">{formatDateTime(event.ts)}</span>
        </div>
        {event.body && (
          <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">{event.body}</p>
        )}
      </div>
    );
  }

  if (event.kind === 'visit') {
    const status = event.status.toLowerCase();
    const style = VISIT_STATUS_STYLES[status] ?? 'bg-gray-200 text-gray-700';
    return (
      <div className="p-3 rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <MapPin className="h-4 w-4 text-blue-600" />
            Ziyaret
          </span>
          <div className="flex items-center gap-2">
            {status && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${style}`}>
                {status}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{formatDateTime(event.ts)}</span>
          </div>
        </div>
        {event.outcome && (
          <p className="text-xs text-muted-foreground mt-1">Sonuç: {event.outcome}</p>
        )}
        {event.notes && <p className="text-xs text-foreground mt-1 line-clamp-2">{event.notes}</p>}
      </div>
    );
  }

  // sample
  const status = event.status.toLowerCase();
  const style = SAMPLE_STATUS_STYLES[status] ?? 'bg-gray-200 text-gray-700';
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Gift className="h-4 w-4 text-green-600" />
          Numune
        </span>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${style}`}>
              {status}
            </span>
          )}
          <span className="text-xs text-muted-foreground">{formatDateTime(event.ts)}</span>
        </div>
      </div>
      {event.lines.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {event.lines.map((l, idx) => (
            <li key={idx} className="text-xs text-foreground">
              {l.product_name}
              {l.qty != null && ` × ${l.qty}${l.unit ? ` ${l.unit}` : ''}`}
            </li>
          ))}
        </ul>
      )}
      {event.notes && <p className="text-xs text-foreground mt-1 line-clamp-2">{event.notes}</p>}
    </div>
  );
}

export default CustomerActivityTimeline;
