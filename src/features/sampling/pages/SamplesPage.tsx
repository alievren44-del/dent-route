/**
 * SamplesPage — Numune ana sayfası.
 *
 * Tab navigation: Yeni / Aktif / Geçmiş / Avcılar / ROI.
 * Üst banner: aylık bütçe + bekleyen takip sayısı.
 * URL sync: ?tab=...
 */

import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Gift, Clock, History, AlertTriangle, BarChart3 } from 'lucide-react';
import { useAuthStore } from '@core/auth/authStore';
import { getSupabaseClient } from '@lib/supabase';
import { getQuota, currentYearMonth, getRemainingBudget } from '@core/sampling/quotas';
import SampleFormMobile from '@features/sampling/components/SampleFormMobile';
import SampleListView from '@features/sampling/components/SampleListView';
import HunterListView from '@features/sampling/components/HunterListView';
import ROIReportView from '@features/sampling/components/ROIReportView';
import type { SampleStatus } from '@core/sampling/types';

type TabKey = 'new' | 'active' | 'history' | 'hunters' | 'roi';

interface TabDef {
  key: TabKey;
  label: string;
  Icon: typeof Gift;
  badge?: number;
}

const ACTIVE_STATUSES: SampleStatus[] = ['verildi', 'denendi'];
const HISTORY_STATUSES: SampleStatus[] = ['donusturuldu', 'red', 'kayip', 'iade'];

function isValidTab(value: string | null): value is TabKey {
  return (
    value === 'new' ||
    value === 'active' ||
    value === 'history' ||
    value === 'hunters' ||
    value === 'roi'
  );
}

function SamplesPage(): JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTabParam = searchParams.get('tab');
  const initialTab: TabKey = isValidTab(initialTabParam) ? initialTabParam : 'new';
  const [activeTab, setActiveTabState] = useState<TabKey>(initialTab);

  function setActiveTab(next: TabKey): void {
    setActiveTabState(next);
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  }

  const repId = useAuthStore((s) => s.session?.userId ?? null);

  // ----- Quota
  const quotaYearMonth = currentYearMonth();
  const quotaQuery = useQuery({
    queryKey: ['quota', repId ?? null, quotaYearMonth],
    enabled: Boolean(repId),
    queryFn: async () => {
      if (!repId) return null;
      return await getQuota(repId, quotaYearMonth);
    },
  });
  const quota = quotaQuery.data ?? null;
  const remainingBudget = getRemainingBudget(quota);
  const totalBudget = quota?.budgetTl ?? 0;

  // ----- Pending follow-ups
  const pendingQuery = useQuery({
    queryKey: ['pending-follow-ups', repId ?? null],
    enabled: Boolean(repId),
    queryFn: async (): Promise<number> => {
      if (!repId) return 0;
      const supabase = getSupabaseClient();
      const cutoffMs = Date.now() + 3 * 86400000;
      const cutoffIso = new Date(cutoffMs).toISOString();
      const { count, error } = await supabase
        .from('saha_samples')
        .select('id', { count: 'exact', head: true })
        .eq('rep_id', repId)
        .in('status', ACTIVE_STATUSES)
        .lte('follow_up_at', cutoffIso);
      if (error) throw error;
      return count ?? 0;
    },
  });
  const pendingCount = pendingQuery.data ?? 0;

  const tabs = useMemo<TabDef[]>(
    () => [
      { key: 'new', label: 'Yeni', Icon: Gift },
      { key: 'active', label: 'Aktif', Icon: Clock, badge: pendingCount },
      { key: 'history', label: 'Geçmiş', Icon: History },
      { key: 'hunters', label: 'Avcılar', Icon: AlertTriangle },
      { key: 'roi', label: 'ROI', Icon: BarChart3 },
    ],
    [pendingCount],
  );

  function handleSubmitted(sampleId: string): void {
    // eslint-disable-next-line no-alert
    alert(`Numune kaydedildi: ${sampleId}`);
    setActiveTab('active');
  }

  return (
    <div className="flex flex-col h-full">
      {/* Üst banner */}
      <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-900/80">Bu ay bütçe:</span>
          <span className="font-semibold text-amber-900">
            {totalBudget.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
          </span>
          <span className="text-amber-900/60">/</span>
          <span className="text-amber-900/80">Kalan:</span>
          <span className="font-semibold text-amber-900">
            {remainingBudget.toLocaleString('tr-TR', { maximumFractionDigits: 0 })} TL
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-amber-900/80">Bekleyen takip:</span>
          <span className="font-semibold text-amber-900">{pendingCount}</span>
        </div>
      </div>

      {/* Tab başlıkları */}
      <div className="flex border-b border-border overflow-x-auto bg-background sticky top-0 z-10">
        {tabs.map((t) => {
          const isActive = activeTab === t.key;
          const showBadge = t.badge !== undefined && t.badge > 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 min-h-tap-min text-sm font-medium whitespace-nowrap ${
                isActive
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground'
              }`}
            >
              {t.label}
              {showBadge && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px]">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* İçerik */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'new' && (
          <div className="p-4">
            <SampleFormMobile onSubmitted={handleSubmitted} />
          </div>
        )}
        {activeTab === 'active' && (
          <div className="p-4">
            <SampleListView filterStatus={ACTIVE_STATUSES} />
          </div>
        )}
        {activeTab === 'history' && (
          <div className="p-4">
            <SampleListView filterStatus={HISTORY_STATUSES} />
          </div>
        )}
        {activeTab === 'hunters' && <HunterListView />}
        {activeTab === 'roi' && <ROIReportView />}
      </div>
    </div>
  );
}

export default SamplesPage;
