/**
 * CustomerVisitTimeline — Müşteri detayda gösterilen ziyaret timeline'ı.
 *
 * Tek bir müşteri için son N ziyaret. CustomerDetailPage tarafından embed
 * edilecek (main thread daha sonra ekleyecek — bu component standalone hazır).
 *
 * - Query: saha_visits where account_id = $id order by check_in_at desc limit 20
 * - Render: VisitCard listesi (vertical), üstte "Yeni Ziyaret" CTA
 * - Click: ziyaret detay sayfasına yönlendirir (/visits/{id})
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, History, Loader2 } from 'lucide-react';
import { getTypedClient } from '@lib/supabase';
import { useVertical } from '@core/verticals/useVertical';
import VisitCard, { type OutcomeMeta, type VisitCardData } from './VisitCard';

interface RawVisit {
  id: string;
  account_id: string;
  check_in_at: string;
  check_out_at: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
  outcome: string | null;
  met_person: string | null;
  notes: string | null;
  saha_visit_photos?: { id: string }[];
}

export interface CustomerVisitTimelineProps {
  /** account_id (customer ID). */
  customerId: string;
  /** Maks satır. Varsayılan 20. */
  limit?: number;
  /** Üst başlığı gizle (CustomerDetailPage zaten tab başlığı gösteriyor olabilir). */
  hideHeader?: boolean;
}

function CustomerVisitTimeline({
  customerId,
  limit = 20,
  hideHeader = false,
}: CustomerVisitTimelineProps): JSX.Element {
  const supabase = getTypedClient();
  const navigate = useNavigate();
  const vertical = useVertical();

  const outcomeMap = useMemo<Map<string, OutcomeMeta>>(() => {
    const m = new Map<string, OutcomeMeta>();
    for (const o of vertical.visitOutcomes ?? []) {
      m.set(o.key, { key: o.key, label: o.label, color: o.color });
    }
    return m;
  }, [vertical.visitOutcomes]);

  const visitsQuery = useQuery({
    queryKey: ['customer-visit-timeline', customerId, limit],
    enabled: Boolean(customerId),
    queryFn: async (): Promise<VisitCardData[]> => {
      const { data, error } = await supabase
        .from('saha_visits')
        .select(
          'id, account_id, check_in_at, check_out_at, status, outcome, met_person, notes, saha_visit_photos(id)',
        )
        .eq('account_id', customerId)
        .order('check_in_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      const rows = (data ?? []) as RawVisit[];
      return rows.map((r) => ({
        id: r.id,
        account_id: r.account_id,
        check_in_at: r.check_in_at,
        check_out_at: r.check_out_at,
        status: r.status,
        outcome: r.outcome,
        met_person: r.met_person,
        notes: r.notes,
        photoCount: r.saha_visit_photos?.length ?? 0,
      }));
    },
  });

  const visits = visitsQuery.data ?? [];

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            <History className="h-4 w-4" aria-hidden="true" />
            Ziyaretler
          </h3>
          <Link
            to={`/visits/check-in/${customerId}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground h-10 min-h-tap-min px-3 text-sm font-medium"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Yeni Ziyaret
          </Link>
        </div>
      )}

      {visitsQuery.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Yükleniyor…
        </div>
      )}

      {visitsQuery.isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Ziyaretler yüklenemedi.
        </div>
      )}

      {!visitsQuery.isLoading && visits.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          Bu müşteri için henüz ziyaret yok.
        </div>
      )}

      <div className="space-y-2">
        {visits.map((v) => (
          <VisitCard
            key={v.id}
            visit={v}
            outcomeMeta={v.outcome ? outcomeMap.get(v.outcome) : undefined}
            onClick={() => navigate(`/visits/${v.id}`)}
          />
        ))}
      </div>

      {hideHeader && visits.length > 0 && (
        <Link
          to={`/visits/check-in/${customerId}`}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background h-11 min-h-tap-min text-sm font-medium hover:bg-muted"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Yeni Ziyaret
        </Link>
      )}
    </div>
  );
}

export default CustomerVisitTimeline;
