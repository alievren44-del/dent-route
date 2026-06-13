import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldOff, Ban } from 'lucide-react';
import { getHunterCandidates } from '@core/sampling/hunter-detection';
import type { HunterCandidate } from '@core/sampling/types';
import { getTypedClient } from '@lib/supabase';

export default function HunterListView() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['hunter-candidates'],
    queryFn: () => getHunterCandidates(),
  });

  const blacklist = useMutation({
    mutationFn: async (payload: { accountId: string; reason: string; bannedUntil?: string }) => {
      const supabase = getTypedClient();
      const { error } = await supabase.from('saha_blacklist').upsert(
        {
          account_id: payload.accountId,
          reason: payload.reason,
          banned_until: payload.bannedUntil ?? null,
        },
        { onConflict: 'account_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hunter-candidates'] }),
  });

  const severityIcon = (sev: HunterCandidate['severity']) => {
    if (sev === 'blacklist') return <Ban className="h-4 w-4 text-red-600" />;
    if (sev === 'risky') return <ShieldOff className="h-4 w-4 text-orange-500" />;
    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  };

  const severityLabel = (sev: HunterCandidate['severity']) => {
    if (sev === 'blacklist') return 'Kara Liste';
    if (sev === 'risky') return 'Riskli';
    return 'Uyarı';
  };

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Yükleniyor...</div>;
  if (!data || data.length === 0)
    return <div className="p-4 text-sm text-muted-foreground">Numune avcısı tespit edilmedi.</div>;

  return (
    <div className="p-4 space-y-3">
      {data.map((c) => (
        <div key={c.accountId} className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{c.accountName}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Son {c.lookbackMonths} ay: {c.sampleCount} numune, {c.orderCount} sipariş
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs">
              {severityIcon(c.severity)}
              <span className="font-medium">{severityLabel(c.severity)}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const reason = prompt('Kara liste sebebi:', 'Numune dönüşüm yok');
              if (reason) blacklist.mutate({ accountId: c.accountId, reason });
            }}
            disabled={blacklist.isPending}
            className="mt-2 w-full min-h-tap-min h-10 rounded-lg bg-red-50 text-red-700 border border-red-200 text-sm font-medium hover:bg-red-100 disabled:opacity-50"
          >
            Kara Listeye Al
          </button>
        </div>
      ))}
    </div>
  );
}
