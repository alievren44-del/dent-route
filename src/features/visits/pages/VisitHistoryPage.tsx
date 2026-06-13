/**
 * VisitHistoryPage — Ziyaret geçmişi (rep kendi ziyaretleri).
 *
 * URL: /history
 *
 * - Tabs: Bugün / Bu Hafta / Bu Ay / Tümü (date filter)
 * - Filter panel (collapsible): outcome multi-select chips + müşteri adı arama
 * - useInfiniteQuery (page = 20 satır), IntersectionObserver sentinel ile fetchNextPage
 * - VisitCard listesi (clickable → detail modal)
 * - Detail modal: full visit + fotoğraflar grid; fotoğrafa tıkla → lightbox
 * - "Müşteriye Git" → /clinics/{account_id}
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  Filter,
  History,
  Loader2,
  Search,
  User,
  X,
} from 'lucide-react';
import { format, startOfDay, startOfWeek, startOfMonth } from 'date-fns';
import { tr } from 'date-fns/locale';
import { getTypedClient } from '@lib/supabase';
import { useVertical } from '@core/verticals/useVertical';
import { useAuthStore } from '@core/auth/authStore';
import VisitCard, {
  type OutcomeMeta,
  type VisitCardData,
} from '@features/visits/components/VisitCard';

type DateTab = 'today' | 'week' | 'month' | 'all';

interface RawVisit {
  id: string;
  account_id: string;
  rep_id: string;
  check_in_at: string;
  check_out_at: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
  outcome: string | null;
  met_person: string | null;
  notes: string | null;
  custom_fields: Record<string, unknown> | null;
  next_visit_date: string | null;
  saha_visit_photos?: { id: string; storage_path: string; category: string }[];
}

const PAGE_SIZE = 20;

function dateRangeFor(tab: DateTab): { from: string | null; to: string | null } {
  const now = new Date();
  if (tab === 'all') return { from: null, to: null };
  if (tab === 'today') {
    return { from: startOfDay(now).toISOString(), to: null };
  }
  if (tab === 'week') {
    return {
      from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
      to: null,
    };
  }
  return { from: startOfMonth(now).toISOString(), to: null };
}

const DATE_TAB_LABELS: Record<DateTab, string> = {
  today: 'Bugün',
  week: 'Bu Hafta',
  month: 'Bu Ay',
  all: 'Tümü',
};

function outcomeChipBg(color: string | undefined, selected: boolean): string {
  if (!selected) {
    return 'bg-background border border-border text-foreground hover:bg-muted';
  }
  switch ((color ?? '').toLowerCase()) {
    case 'green':
      return 'bg-green-600 text-white border border-green-700';
    case 'amber':
    case 'yellow':
      return 'bg-amber-500 text-white border border-amber-600';
    case 'red':
      return 'bg-red-600 text-white border border-red-700';
    case 'blue':
      return 'bg-blue-600 text-white border border-blue-700';
    case 'purple':
      return 'bg-purple-600 text-white border border-purple-700';
    case 'gray':
    case 'grey':
    default:
      return 'bg-gray-600 text-white border border-gray-700';
  }
}

interface PageResult {
  rows: RawVisit[];
  nextPage: number | null;
}

interface DetailModalProps {
  visitId: string | null;
  outcomeMap: Map<string, OutcomeMeta>;
  onClose: () => void;
}

function DetailModal({ visitId, outcomeMap, onClose }: DetailModalProps): JSX.Element | null {
  const supabase = getTypedClient();
  const navigate = useNavigate();
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['visit-detail', visitId],
    enabled: Boolean(visitId),
    queryFn: async (): Promise<{
      visit: RawVisit;
      account: { id: string; name: string } | null;
      photoUrls: string[];
    } | null> => {
      if (!visitId) return null;
      const { data, error } = await supabase
        .from('saha_visits')
        .select(
          'id, account_id, rep_id, check_in_at, check_out_at, status, outcome, met_person, notes, custom_fields, next_visit_date, saha_visit_photos(id, storage_path, category)',
        )
        .eq('id', visitId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const visit = data as RawVisit;

      // 1) saha_clinics — Discovery / SahaTara / Atanan rota sepete clinic id yazar.
      let account: { id: string; name: string } | null = null;
      const clinicRes = await supabase
        .from('saha_clinics')
        .select('id, name')
        .eq('id', visit.account_id)
        .maybeSingle();
      if (clinicRes.data) {
        const c = clinicRes.data as { id: string; name: string };
        account = { id: c.id, name: c.name };
      } else {
        // 2) profiles fallback (DOCTOR / Parla mevcut müşterileri).
        const accountRes = await supabase
          .from('profiles')
          .select('id, klinik_adi, ad_soyad, email')
          .eq('id', visit.account_id)
          .maybeSingle();
        const ar = accountRes.data as {
          id: string;
          klinik_adi: string | null;
          ad_soyad: string | null;
          email: string | null;
        } | null;
        account = ar
          ? {
              id: ar.id,
              name: ar.klinik_adi ?? ar.ad_soyad ?? ar.email ?? 'Müşteri',
            }
          : null;
      }

      // Signed URLs (privat bucket)
      const photoUrls: string[] = [];
      for (const p of visit.saha_visit_photos ?? []) {
        const { data: signed } = await supabase.storage
          .from('visit-photos')
          .createSignedUrl(p.storage_path, 60 * 10);
        if (signed?.signedUrl) photoUrls.push(signed.signedUrl);
      }
      return { visit, account, photoUrls };
    },
  });

  if (!visitId) return null;

  const detail = detailQuery.data;
  const outcomeMeta = detail?.visit.outcome ? outcomeMap.get(detail.visit.outcome) : null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 flex items-end sm:items-center justify-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visit-detail-title"
      >
        <button
          type="button"
          aria-label="Modalı kapat"
          tabIndex={-1}
          onClick={() => onClose()}
          className="absolute inset-0 h-full w-full cursor-default bg-transparent"
        />
        <div className="relative bg-background rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
          {/* Modal header */}
          <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center justify-between gap-3">
            <h2 id="visit-detail-title" className="text-base font-semibold">
              Ziyaret Detayı
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 -mr-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
              aria-label="Kapat"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-4 space-y-4">
            {detailQuery.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Yükleniyor…
              </div>
            )}

            {detail && (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">Müşteri</p>
                  <p className="text-base font-semibold mt-0.5">{detail.account?.name ?? '—'}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Check-in</p>
                    <p className="text-sm">
                      {format(new Date(detail.visit.check_in_at), 'd MMM HH:mm', {
                        locale: tr,
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Check-out</p>
                    <p className="text-sm">
                      {detail.visit.check_out_at
                        ? format(new Date(detail.visit.check_out_at), 'd MMM HH:mm', { locale: tr })
                        : '—'}
                    </p>
                  </div>
                </div>

                {outcomeMeta && (
                  <div>
                    <p className="text-xs text-muted-foreground">Sonuç</p>
                    <span
                      className={`inline-flex items-center text-xs font-medium px-2 py-1 rounded-full mt-1 ${outcomeChipBg(
                        outcomeMeta.color,
                        true,
                      )}`}
                    >
                      {outcomeMeta.label}
                    </span>
                  </div>
                )}

                {detail.visit.met_person && (
                  <div>
                    <p className="text-xs text-muted-foreground">Görüşülen Kişi</p>
                    <p className="text-sm flex items-center gap-1.5 mt-0.5">
                      <User className="h-3.5 w-3.5" aria-hidden="true" />
                      {detail.visit.met_person}
                    </p>
                  </div>
                )}

                {detail.visit.notes && (
                  <div>
                    <p className="text-xs text-muted-foreground">Notlar</p>
                    <p className="text-sm whitespace-pre-wrap mt-0.5">{detail.visit.notes}</p>
                  </div>
                )}

                {detail.visit.custom_fields &&
                  Object.keys(detail.visit.custom_fields).length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Ek Bilgiler</p>
                      <ul className="text-sm space-y-1">
                        {Object.entries(detail.visit.custom_fields).map(([k, v]) => (
                          <li key={k} className="flex justify-between gap-2">
                            <span className="text-muted-foreground">{k}</span>
                            <span className="font-medium">{String(v)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {detail.visit.next_visit_date && (
                  <div className="flex items-center gap-1.5 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span>
                      Sonraki ziyaret:{' '}
                      <strong>
                        {format(new Date(detail.visit.next_visit_date), 'd MMM yyyy', {
                          locale: tr,
                        })}
                      </strong>
                    </span>
                  </div>
                )}

                {detail.photoUrls.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Fotoğraflar ({detail.photoUrls.length})
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {detail.photoUrls.map((url, i) => (
                        <button
                          type="button"
                          key={i}
                          onClick={() => setLightboxUrl(url)}
                          className="aspect-square rounded-lg overflow-hidden border border-border bg-muted"
                        >
                          <img
                            src={url}
                            alt={`foto ${i + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      navigate(`/clinics/${detail.visit.account_id}`);
                    }}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold h-12 min-h-tap-min text-sm"
                  >
                    Müşteriye Git
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
          aria-label="Fotoğraf önizleme"
        >
          <button
            type="button"
            aria-label="Lightbox kapat"
            tabIndex={-1}
            onClick={() => setLightboxUrl(null)}
            className="absolute inset-0 h-full w-full cursor-default bg-transparent"
          />
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute top-4 right-4 inline-flex items-center justify-center rounded-full bg-white/10 text-white h-10 w-10"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={lightboxUrl}
            alt="full-size"
            className="relative max-w-full max-h-full object-contain pointer-events-none"
          />
        </div>
      )}
    </>
  );
}

function VisitHistoryPage(): JSX.Element {
  const supabase = getTypedClient();
  const navigate = useNavigate();
  const vertical = useVertical();
  const repId = useAuthStore((s) => s.session?.userId ?? null);

  const [dateTab, setDateTab] = useState<DateTab>('today');
  const [filterOpen, setFilterOpen] = useState<boolean>(false);
  const [selectedOutcomes, setSelectedOutcomes] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');

  const [modalVisitId, setModalVisitId] = useState<string | null>(null);

  // Debounce search
  useEffect(() => {
    const h = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(h);
  }, [searchTerm]);

  const outcomeMap = useMemo<Map<string, OutcomeMeta>>(() => {
    const m = new Map<string, OutcomeMeta>();
    for (const o of vertical.visitOutcomes ?? []) {
      m.set(o.key, { key: o.key, label: o.label, color: o.color });
    }
    return m;
  }, [vertical.visitOutcomes]);

  const queryKey = [
    'visit-history',
    repId ?? null,
    dateTab,
    Array.from(selectedOutcomes).sort().join(','),
    debouncedSearch,
  ] as const;

  // Müşteri arama: önce profiles'tan id listesi alıp filter et
  const accountSearchQuery = useQuery({
    queryKey: ['visit-history-account-search', debouncedSearch],
    enabled: debouncedSearch.length >= 2,
    queryFn: async (): Promise<string[]> => {
      const q = debouncedSearch;
      const { data, error } = await supabase
        .from('profiles')
        .select('id')
        .or(`klinik_adi.ilike.%${q}%,ad_soyad.ilike.%${q}%`)
        .limit(50);
      if (error) throw error;
      const rows = (data ?? []) as { id: string }[];
      return rows.map((r) => r.id);
    },
  });

  const accountIdFilter = debouncedSearch.length >= 2 ? (accountSearchQuery.data ?? []) : null;

  const listQuery = useInfiniteQuery({
    queryKey: [...queryKey, accountIdFilter?.join(',') ?? null],
    enabled: Boolean(repId) && (debouncedSearch.length < 2 || accountSearchQuery.isSuccess),
    initialPageParam: 0,
    getNextPageParam: (last: PageResult) => last.nextPage,
    queryFn: async ({ pageParam }): Promise<PageResult> => {
      const page = typeof pageParam === 'number' ? pageParam : 0;
      const range: { from: number; to: number } = {
        from: page * PAGE_SIZE,
        to: (page + 1) * PAGE_SIZE - 1,
      };
      const dr = dateRangeFor(dateTab);

      let q = supabase
        .from('saha_visits')
        .select(
          'id, account_id, rep_id, check_in_at, check_out_at, status, outcome, met_person, notes, custom_fields, next_visit_date, saha_visit_photos(id, storage_path, category)',
        )
        .order('check_in_at', { ascending: false })
        .range(range.from, range.to);

      if (repId) q = q.eq('rep_id', repId);
      if (dr.from) q = q.gte('check_in_at', dr.from);
      if (selectedOutcomes.size > 0) {
        q = q.in('outcome', Array.from(selectedOutcomes));
      }
      if (accountIdFilter !== null) {
        if (accountIdFilter.length === 0) {
          return { rows: [], nextPage: null };
        }
        q = q.in('account_id', accountIdFilter);
      }

      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as RawVisit[];
      const hasMore = rows.length === PAGE_SIZE;
      return { rows, nextPage: hasMore ? page + 1 : null };
    },
  });

  // Tüm satırlar tek diziye
  const allRows = useMemo<RawVisit[]>(() => {
    const out: RawVisit[] = [];
    for (const p of listQuery.data?.pages ?? []) {
      for (const r of p.rows) out.push(r);
    }
    return out;
  }, [listQuery.data]);

  // account_id → name lookup
  const uniqueAccountIds = useMemo<string[]>(() => {
    const s = new Set<string>();
    for (const r of allRows) s.add(r.account_id);
    return Array.from(s);
  }, [allRows]);

  const accountNamesQuery = useQuery({
    queryKey: ['visit-history-account-names', uniqueAccountIds.join(',')],
    enabled: uniqueAccountIds.length > 0,
    queryFn: async (): Promise<Map<string, string>> => {
      const m = new Map<string, string>();

      // 1) saha_clinics — batch lookup for clinic-type accounts.
      const { data: clinicData } = await supabase
        .from('saha_clinics')
        .select('id, name')
        .in('id', uniqueAccountIds);
      const foundInClinics = new Set<string>();
      for (const c of (clinicData ?? []) as { id: string; name: string }[]) {
        m.set(c.id, c.name);
        foundInClinics.add(c.id);
      }

      // 2) profiles fallback — only IDs not found in saha_clinics.
      const profileIds = uniqueAccountIds.filter((id) => !foundInClinics.has(id));
      if (profileIds.length > 0) {
        const { data: profileData, error } = await supabase
          .from('profiles')
          .select('id, klinik_adi, ad_soyad, email')
          .in('id', profileIds);
        if (error) throw error;
        for (const r of (profileData ?? []) as {
          id: string;
          klinik_adi: string | null;
          ad_soyad: string | null;
          email: string | null;
        }[]) {
          m.set(r.id, r.klinik_adi ?? r.ad_soyad ?? r.email ?? 'Müşteri');
        }
      }

      return m;
    },
  });

  const accountNames = useMemo<Map<string, string>>(
    () => accountNamesQuery.data ?? new Map<string, string>(),
    [accountNamesQuery.data],
  );

  // IntersectionObserver
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const fetchNext = listQuery.fetchNextPage;
  const hasNext = listQuery.hasNextPage;
  const isFetchingNext = listQuery.isFetchingNextPage;

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && hasNext && !isFetchingNext) {
            void fetchNext();
          }
        }
      },
      { rootMargin: '200px' },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [fetchNext, hasNext, isFetchingNext]);

  const toggleOutcome = useCallback((key: string) => {
    setSelectedOutcomes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const visitsForCards = useMemo<VisitCardData[]>(() => {
    return allRows.map((r) => ({
      id: r.id,
      account_id: r.account_id,
      check_in_at: r.check_in_at,
      check_out_at: r.check_out_at,
      status: r.status,
      outcome: r.outcome,
      met_person: r.met_person,
      notes: r.notes,
      photoCount: r.saha_visit_photos?.length ?? 0,
      customerName: accountNames.get(r.account_id) ?? null,
    }));
  }, [allRows, accountNames]);

  return (
    <div className="flex flex-col min-h-full pb-20">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
            aria-label="Geri"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <History className="h-5 w-5" aria-hidden="true" />
              Ziyaret Geçmişi
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            className={`inline-flex items-center gap-1 rounded-lg border h-10 min-h-tap-min px-3 text-sm font-medium ${
              filterOpen
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border hover:bg-muted'
            }`}
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filtre
            {selectedOutcomes.size > 0 && (
              <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-white/30 text-xs">
                {selectedOutcomes.size}
              </span>
            )}
          </button>
        </div>

        {/* Date tabs */}
        <div className="mt-3 flex gap-1 overflow-x-auto">
          {(Object.keys(DATE_TAB_LABELS) as DateTab[]).map((t) => {
            const isActive = dateTab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setDateTab(t)}
                className={`shrink-0 rounded-full px-3 h-9 min-h-tap-min text-sm font-medium border ${
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-muted'
                }`}
              >
                {DATE_TAB_LABELS[t]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter panel */}
      {filterOpen && (
        <div className="px-4 py-3 border-b border-border bg-muted/30 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Müşteri adına göre ara…"
              className="w-full rounded-xl border border-border bg-background pl-9 pr-3 h-11 min-h-tap-min text-sm"
            />
            {searchTerm.length > 0 && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-muted"
                aria-label="Temizle"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>

          {/* Outcome chips */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5">Sonuç</p>
            <div className="flex flex-wrap gap-1.5">
              {(vertical.visitOutcomes ?? []).map((o) => {
                const selected = selectedOutcomes.has(o.key);
                return (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => toggleOutcome(o.key)}
                    className={`rounded-full px-3 h-9 min-h-tap-min text-xs font-medium ${outcomeChipBg(
                      o.color,
                      selected,
                    )}`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            {selectedOutcomes.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedOutcomes(new Set())}
                className="text-xs text-primary mt-2"
              >
                Filtreleri temizle
              </button>
            )}
          </div>
        </div>
      )}

      {/* List */}
      <div className="flex-1 px-4 py-3 space-y-2">
        {listQuery.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Yükleniyor…
          </div>
        )}

        {listQuery.isError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Ziyaretler yüklenemedi.
          </div>
        )}

        {!listQuery.isLoading && visitsForCards.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {dateTab === 'today' ? 'Bugün için ziyaret yok.' : 'Bu filtrelerle ziyaret bulunamadı.'}
          </div>
        )}

        {visitsForCards.map((v) => (
          <VisitCard
            key={v.id}
            visit={v}
            outcomeMeta={v.outcome ? outcomeMap.get(v.outcome) : undefined}
            onClick={() => setModalVisitId(v.id)}
          />
        ))}

        {/* Sentinel */}
        <div ref={sentinelRef} className="h-1" aria-hidden="true" />

        {isFetchingNext && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Daha fazla…
          </div>
        )}

        {!hasNext && visitsForCards.length > 0 && (
          <p className="text-center text-xs text-muted-foreground py-2">Liste sonu</p>
        )}
      </div>

      <DetailModal
        visitId={modalVisitId}
        outcomeMap={outcomeMap}
        onClose={() => setModalVisitId(null)}
      />
    </div>
  );
}

export default VisitHistoryPage;
