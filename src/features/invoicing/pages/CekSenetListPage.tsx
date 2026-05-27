/**
 * CekSenetListPage — Çek/Senet portföy yönetim ekranı.
 *
 * URL: /invoicing/cek-senet
 *
 * Tablar: Portföyde / Tahsile Verilen / Tahsil Edilen / Karşılıksız
 * Vade yaklaşan banner: vade_tarihi <= now + 7 gün AND durum = 'portfoyde'
 * Row actions: Tahsile Ver / Tahsil Oldu / Karşılıksız
 */

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Banknote, CheckCircle, XCircle } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

type Durum = 'portfoyde' | 'tahsile_verildi' | 'tahsil_edildi' | 'karsiliksiz';

interface CekSenetRow {
  id: string;
  tip: string;
  cek_no: string | null;
  banka: string | null;
  kesideci: string;
  vade_tarihi: string;
  tutar: number;
  durum: string;
  cari_id: string | null;
  tahsile_verildi_banka: string | null;
  tahsile_verildi_tarih: string | null;
  tahsil_tarihi: string | null;
  karsiliksiz_tarihi: string | null;
  karsiliksiz_notu: string | null;
}

const TABS: Array<{ key: Durum; label: string }> = [
  { key: 'portfoyde', label: 'Portföyde' },
  { key: 'tahsile_verildi', label: 'Tahsile Verilen' },
  { key: 'tahsil_edildi', label: 'Tahsil Edilen' },
  { key: 'karsiliksiz', label: 'Karşılıksız' },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function CekSenetListPage(): JSX.Element {
  const [tab, setTab] = useState<Durum>('portfoyde');

  const { data: items, isLoading } = useQuery({
    queryKey: ['cek-senetler', tab],
    queryFn: async (): Promise<CekSenetRow[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_cek_senetler')
        .select('*')
        .eq('durum', tab)
        .order('vade_tarihi', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CekSenetRow[];
    },
  });

  const yaklasanCount = useMemo(() => {
    if (tab !== 'portfoyde') return 0;
    const limit = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    return (items ?? []).filter((i) => i.vade_tarihi <= limit).length;
  }, [items, tab]);

  return (
    <div className="flex flex-col min-h-full pb-24">
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <h1 className="text-lg font-semibold">Çek / Senet</h1>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-border bg-background sticky top-[52px] z-[5]">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-3 py-3 min-h-tap-min text-xs font-medium whitespace-nowrap ${
              tab === t.key
                ? 'text-primary border-b-2 border-primary'
                : 'text-muted-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 space-y-2">
        {/* Yaklaşan vade banner */}
        {tab === 'portfoyde' && yaklasanCount > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 flex items-start gap-2">
            <AlertCircle className="h-5 w-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900">
                {yaklasanCount} adet vadesi 7 gün içinde olan çek/senet var.
              </p>
            </div>
          </div>
        )}

        {isLoading && (
          <p className="text-center text-sm text-muted-foreground py-6">Yükleniyor…</p>
        )}
        {!isLoading && (items ?? []).length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-10">Kayıt yok.</p>
        )}

        {(items ?? []).map((cs) => (
          <CekSenetCard key={cs.id} item={cs} />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Card + actions
// ============================================================================
function CekSenetCard({ item }: { item: CekSenetRow }): JSX.Element {
  const queryClient = useQueryClient();
  const [actionOpen, setActionOpen] = useState<null | 'tahsile' | 'tahsil' | 'karsiliksiz'>(null);
  const [banka, setBanka] = useState(item.tahsile_verildi_banka ?? '');
  const [tarih, setTarih] = useState(new Date().toISOString().slice(0, 10));
  const [sebep, setSebep] = useState('');

  const today = new Date().toISOString().slice(0, 10);
  const limit7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const overdue = item.durum === 'portfoyde' && item.vade_tarihi < today;
  const approaching =
    item.durum === 'portfoyde' && !overdue && item.vade_tarihi <= limit7;

  const mutation = useMutation({
    mutationFn: async (patch: Partial<CekSenetRow>) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('saha_cek_senetler')
        .update(patch)
        .eq('id', item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cek-senetler'] });
      setActionOpen(null);
    },
  });

  function doTahsile(): void {
    mutation.mutate({
      durum: 'tahsile_verildi',
      tahsile_verildi_banka: banka.trim() || null,
      tahsile_verildi_tarih: tarih,
    });
  }
  function doTahsil(): void {
    mutation.mutate({
      durum: 'tahsil_edildi',
      tahsil_tarihi: today,
    });
  }
  function doKarsiliksiz(): void {
    mutation.mutate({
      durum: 'karsiliksiz',
      karsiliksiz_tarihi: today,
      karsiliksiz_notu: sebep.trim() || null,
    });
  }

  const borderCls = overdue
    ? 'border-red-300'
    : approaching
      ? 'border-amber-300'
      : 'border-border';

  return (
    <div className={`rounded-lg border ${borderCls} bg-card p-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {item.tip === 'cek' ? 'Çek' : 'Senet'}
            {item.cek_no && <span className="ml-1 text-xs text-muted-foreground">#{item.cek_no}</span>}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {item.banka ?? '—'} • Keşideci: {item.kesideci}
          </p>
          <p
            className={`text-xs mt-1 ${
              overdue ? 'text-red-600 font-medium' : approaching ? 'text-amber-700' : 'text-muted-foreground'
            }`}
          >
            Vade: {fmtDate(item.vade_tarihi)}
            {overdue && ' (gecikmiş)'}
            {approaching && ' (yaklaşıyor)'}
          </p>
        </div>
        <p className="text-base font-bold">{formatTRY(Number(item.tutar))}</p>
      </div>

      {/* Aksiyonlar — sadece portfoyde + tahsile_verildi durumda göster */}
      {(item.durum === 'portfoyde' || item.durum === 'tahsile_verildi') && (
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {item.durum === 'portfoyde' && (
            <button
              type="button"
              onClick={() => setActionOpen('tahsile')}
              className="px-2 py-1.5 rounded-md border border-border text-xs font-medium flex items-center justify-center gap-1 min-h-tap-min"
            >
              <Banknote className="h-3 w-3" />
              Tahsile Ver
            </button>
          )}
          <button
            type="button"
            onClick={() => setActionOpen('tahsil')}
            className="px-2 py-1.5 rounded-md border border-green-300 text-green-700 text-xs font-medium flex items-center justify-center gap-1 min-h-tap-min"
          >
            <CheckCircle className="h-3 w-3" />
            Tahsil
          </button>
          <button
            type="button"
            onClick={() => setActionOpen('karsiliksiz')}
            className="px-2 py-1.5 rounded-md border border-red-300 text-red-600 text-xs font-medium flex items-center justify-center gap-1 min-h-tap-min"
          >
            <XCircle className="h-3 w-3" />
            Karşılıksız
          </button>
        </div>
      )}

      {actionOpen && (
        <div className="mt-3 p-3 rounded-md border border-border bg-muted/40 space-y-2">
          {actionOpen === 'tahsile' && (
            <>
              <p className="text-xs font-medium">Tahsile Verme</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block">Banka</label>
                  <input
                    type="text"
                    value={banka}
                    onChange={(e) => setBanka(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block">Tarih</label>
                  <input
                    type="date"
                    value={tarih}
                    onChange={(e) => setTarih(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setActionOpen(null)}
                  className="px-3 py-1.5 text-xs min-h-tap-min"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={doTahsile}
                  disabled={mutation.isPending}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium min-h-tap-min disabled:opacity-50"
                >
                  Onayla
                </button>
              </div>
            </>
          )}
          {actionOpen === 'tahsil' && (
            <>
              <p className="text-xs font-medium">Tahsil edildi olarak işaretle?</p>
              <p className="text-[11px] text-muted-foreground">
                Tahsil tarihi: {today}
              </p>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setActionOpen(null)}
                  className="px-3 py-1.5 text-xs min-h-tap-min"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={doTahsil}
                  disabled={mutation.isPending}
                  className="px-3 py-1.5 rounded-md bg-green-600 text-white text-xs font-medium min-h-tap-min disabled:opacity-50"
                >
                  Tahsil Edildi
                </button>
              </div>
            </>
          )}
          {actionOpen === 'karsiliksiz' && (
            <>
              <p className="text-xs font-medium text-red-700">Karşılıksız olarak işaretle</p>
              <div>
                <label className="text-[10px] text-muted-foreground block">
                  Sebep / Not (opsiyonel)
                </label>
                <textarea
                  value={sebep}
                  onChange={(e) => setSebep(e.target.value)}
                  rows={2}
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                />
              </div>
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setActionOpen(null)}
                  className="px-3 py-1.5 text-xs min-h-tap-min"
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={doKarsiliksiz}
                  disabled={mutation.isPending}
                  className="px-3 py-1.5 rounded-md bg-red-600 text-white text-xs font-medium min-h-tap-min disabled:opacity-50"
                >
                  Karşılıksız Onayla
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default CekSenetListPage;
