/**
 * CariBalanceCard — yeniden kullanılabilir bakiye kartı.
 *
 * Props:
 *   - customerId: profile.id (Parla müşteri id)
 *
 * Davranış:
 *   - saha_cariler tablosunda profile_id === customerId arar.
 *   - Cari yoksa: "Cari Oluştur" CTA gösterir → /invoicing/cari?createFor=:id.
 *   - Cari varsa: bakiye + kredi limit progress bar + "Cari Detayı" linki gösterir.
 *
 * Bu component CustomerDetailPage'e main thread tarafından eklenecek.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Wallet, ChevronRight, Plus } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

interface CariRow {
  id: string;
  cari_kodu: string;
  fatura_unvani: string;
  kredi_limiti: number;
  acilis_bakiyesi: number;
}

interface CariBalanceCardProps {
  customerId: string;
}

interface BalanceData {
  cari: CariRow | null;
  bakiye: number;
}

async function fetchBalance(customerId: string): Promise<BalanceData> {
  const supabase = getSupabaseClient();
  const { data: cari, error } = await supabase
    .from('saha_cariler')
    .select('id, cari_kodu, fatura_unvani, kredi_limiti, acilis_bakiyesi')
    .eq('profile_id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!cari) return { cari: null, bakiye: 0 };

  // Bakiye = acilis_bakiyesi + sum(kalan) tüm açık faturalardan
  const { data: faturalar, error: ferr } = await supabase
    .from('saha_faturalar')
    .select('kalan, tip')
    .eq('cari_id', cari.id)
    .not('durum', 'in', '(iptal)');
  if (ferr) throw ferr;

  let kalanToplam = Number(cari.acilis_bakiyesi ?? 0);
  for (const f of faturalar ?? []) {
    const kalan = Number((f as { kalan: number | null }).kalan ?? 0);
    const sign = (f as { tip: string }).tip === 'iade' ? -1 : 1;
    kalanToplam += sign * kalan;
  }

  return {
    cari: cari as CariRow,
    bakiye: Math.round(kalanToplam * 100) / 100,
  };
}

export function CariBalanceCard({ customerId }: CariBalanceCardProps): JSX.Element {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cari-balance', customerId],
    enabled: !!customerId,
    queryFn: () => fetchBalance(customerId),
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 animate-pulse">
        <div className="h-3 w-24 bg-muted rounded mb-2" />
        <div className="h-7 w-32 bg-muted rounded" />
        <div className="h-2 w-full bg-muted rounded mt-3" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 text-red-700 p-3 text-sm">
        Cari bilgisi yüklenemedi.
      </div>
    );
  }

  if (!data?.cari) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2 text-muted-foreground">
          <Wallet className="h-4 w-4" />
          <p className="text-sm">Bu müşteri için cari kaydı yok.</p>
        </div>
        <Link
          to={`/invoicing/cari?createFor=${customerId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary px-3 py-2 rounded-lg border border-primary/30 hover:bg-primary/5 min-h-tap-min"
        >
          <Plus className="h-4 w-4" />
          Cari Oluştur
        </Link>
      </div>
    );
  }

  const { cari, bakiye } = data;
  const kredi = Number(cari.kredi_limiti ?? 0);
  const kullanim = kredi > 0 ? Math.max(0, Math.min(100, (bakiye / kredi) * 100)) : 0;
  const bakiyeColor =
    bakiye > 0 ? 'text-red-600' : bakiye < 0 ? 'text-green-600' : 'text-foreground';
  const progressColor =
    kullanim >= 90 ? 'bg-red-500' : kullanim >= 70 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Wallet className="h-3 w-3" />
            Cari Bakiye
            <span className="text-[10px] text-muted-foreground/80">({cari.cari_kodu})</span>
          </p>
          <p className={`text-2xl font-bold mt-1 ${bakiyeColor}`}>{formatTRY(bakiye)}</p>
        </div>
        <Link
          to={`/invoicing/cari/${cari.id}`}
          className="text-xs text-primary font-medium flex items-center gap-0.5 px-2 py-1 min-h-tap-min"
        >
          Detay
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {kredi > 0 && (
        <div>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
            <span>Kredi Limiti Kullanımı</span>
            <span>
              {formatTRY(Math.max(0, bakiye))} / {formatTRY(kredi)}
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full ${progressColor} transition-all`}
              style={{ width: `${kullanim}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default CariBalanceCard;
