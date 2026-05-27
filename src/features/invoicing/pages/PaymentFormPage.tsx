/**
 * PaymentFormPage — Yeni ödeme oluşturma ekranı.
 *
 * URL: /invoicing/odeme/yeni?cari_id=:id
 *
 * Akış:
 *   - Cari seç (yoksa autocomplete)
 *   - Bakiyeli faturaları multi-select (durum != 'odendi', != 'iptal', kalan > 0)
 *   - Tutar (auto: seçili faturaların kalan toplamı; düzenlenebilir)
 *   - Yöntem: nakit / havale / cek / senet / kart
 *   - cek/senet ise nested form: cek_no, banka, kesideci, vade, tutar
 *   - Dekont no + açıklama
 *   - Submit: INSERT saha_odemeler (gerekirse INSERT saha_cek_senetler önce)
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Search, AlertTriangle, Check } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

interface CariOption {
  id: string;
  cari_kodu: string;
  fatura_unvani: string;
}

interface BakiyeliFatura {
  id: string;
  fatura_no: string | null;
  tarih: string;
  vade_tarihi: string | null;
  toplam: number;
  odenen: number;
  kalan: number;
  tip: string;
}

type Yontem = 'nakit' | 'havale' | 'cek' | 'senet' | 'kart';

function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setD(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return d;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function PaymentFormPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialCariId = searchParams.get('cari_id');

  const [cariId, setCariId] = useState<string | null>(initialCariId);
  const [cariLabel, setCariLabel] = useState<string>('');
  const [cariSearch, setCariSearch] = useState('');
  const [cariOpen, setCariOpen] = useState(!initialCariId);
  const debouncedCariSearch = useDebounced(cariSearch, 300);

  const today = new Date().toISOString().slice(0, 10);
  const [tarih, setTarih] = useState(today);
  const [tutar, setTutar] = useState(0);
  const [tutarOverridden, setTutarOverridden] = useState(false);
  const [yontem, setYontem] = useState<Yontem>('havale');
  const [dekontNo, setDekontNo] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [selectedFaturaIds, setSelectedFaturaIds] = useState<string[]>([]);

  // Çek/Senet alt formu
  const [csNo, setCsNo] = useState('');
  const [csBanka, setCsBanka] = useState('');
  const [csKesideci, setCsKesideci] = useState('');
  const [csVade, setCsVade] = useState('');

  const [error, setError] = useState<string | null>(null);

  // Initial cari pre-fill
  useQuery({
    queryKey: ['payment-initial-cari', initialCariId],
    enabled: !!initialCariId,
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('saha_cariler')
        .select('id, cari_kodu, fatura_unvani')
        .eq('id', initialCariId!)
        .maybeSingle();
      if (err) throw err;
      if (data) {
        const c = data as CariOption;
        setCariLabel(`${c.fatura_unvani} (${c.cari_kodu})`);
      }
      return data;
    },
  });

  // Cari autocomplete
  const { data: cariOptions, isFetching: cariSearching } = useQuery({
    queryKey: ['payment-cari-search', debouncedCariSearch],
    enabled: cariOpen && debouncedCariSearch.trim().length >= 2,
    queryFn: async (): Promise<CariOption[]> => {
      const supabase = getSupabaseClient();
      const term = `%${debouncedCariSearch}%`;
      const { data, error: err } = await supabase
        .from('saha_cariler')
        .select('id, cari_kodu, fatura_unvani')
        .or(`fatura_unvani.ilike.${term},cari_kodu.ilike.${term}`)
        .limit(15);
      if (err) throw err;
      return (data ?? []) as CariOption[];
    },
  });

  // Bakiyeli faturalar
  const { data: bakiyeliFaturalar } = useQuery({
    queryKey: ['payment-bakiyeli', cariId],
    enabled: !!cariId,
    queryFn: async (): Promise<BakiyeliFatura[]> => {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('saha_faturalar')
        .select('id, fatura_no, tarih, vade_tarihi, toplam, odenen, kalan, tip, durum')
        .eq('cari_id', cariId!)
        .not('durum', 'in', '(odendi,iptal)')
        .order('vade_tarihi', { ascending: true });
      if (err) throw err;
      // Kalan > 0 olanları filtrele (kismi/gonderildi)
      return ((data ?? []) as Array<BakiyeliFatura & { durum: string }>)
        .filter((f) => Number(f.kalan) > 0)
        .map(({ durum: _durum, ...rest }) => rest);
    },
  });

  // Seçili faturalardan otomatik tutar
  const seciliTutar = useMemo(() => {
    if (!bakiyeliFaturalar) return 0;
    let t = 0;
    for (const f of bakiyeliFaturalar) {
      if (selectedFaturaIds.includes(f.id)) t += Number(f.kalan);
    }
    return Math.round(t * 100) / 100;
  }, [bakiyeliFaturalar, selectedFaturaIds]);

  useEffect(() => {
    if (!tutarOverridden) setTutar(seciliTutar);
  }, [seciliTutar, tutarOverridden]);

  function pickCari(c: CariOption): void {
    setCariId(c.id);
    setCariLabel(`${c.fatura_unvani} (${c.cari_kodu})`);
    setCariOpen(false);
    setCariSearch('');
    setSelectedFaturaIds([]);
  }

  function toggleFatura(id: string): void {
    setSelectedFaturaIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient();
      if (!cariId) throw new Error('Cari seçin.');
      if (tutar <= 0) throw new Error('Tutar 0\'dan büyük olmalı.');

      let cekSenetId: string | null = null;
      if (yontem === 'cek' || yontem === 'senet') {
        if (!csKesideci.trim()) throw new Error('Keşideci zorunlu.');
        if (!csVade) throw new Error('Vade tarihi zorunlu.');
        const { data: cs, error: csErr } = await supabase
          .from('saha_cek_senetler')
          .insert({
            tip: yontem,
            cek_no: csNo.trim() || null,
            banka: csBanka.trim() || null,
            kesideci: csKesideci.trim(),
            cari_id: cariId,
            vade_tarihi: csVade,
            tutar,
            durum: 'portfoyde',
          })
          .select('id')
          .single();
        if (csErr) throw csErr;
        cekSenetId = (cs as { id: string }).id;
      }

      // Tek fatura seçilmişse fatura_id set et; çoklu → her biri için ayrı kayıt değil,
      // tek ödeme + ilk seçili faturaya bağlanır (basit MVP). Çoklu dağıtım ileride.
      const faturaId = selectedFaturaIds[0] ?? null;

      const { data, error: err } = await supabase
        .from('saha_odemeler')
        .insert({
          cari_id: cariId,
          fatura_id: faturaId,
          tarih,
          tutar,
          yontem,
          dekont_no: dekontNo.trim() || null,
          cek_senet_id: cekSenetId,
          aciklama: aciklama.trim() || null,
        })
        .select('id')
        .single();
      if (err) throw err;

      return data as { id: string };
    },
    onSuccess: () => {
      if (cariId) navigate(`/invoicing/cari/${cariId}`);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Ödeme kaydedilemedi.');
    },
  });

  return (
    <div className="flex flex-col min-h-full pb-32">
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link
            to={cariId ? `/invoicing/cari/${cariId}` : '/invoicing/cari'}
            aria-label="Geri"
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">Yeni Ödeme</h1>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Cari */}
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Cari</label>
          {cariId && !cariOpen ? (
            <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border bg-card">
              <p className="text-sm font-medium truncate">{cariLabel}</p>
              <button
                type="button"
                onClick={() => {
                  setCariId(null);
                  setCariLabel('');
                  setCariOpen(true);
                  setSelectedFaturaIds([]);
                }}
                className="text-xs text-primary px-2 py-1 min-h-tap-min"
              >
                Değiştir
              </button>
            </div>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-border bg-card">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={cariSearch}
                  onChange={(e) => setCariSearch(e.target.value)}
                  onFocus={() => setCariOpen(true)}
                  placeholder="Cari ara…"
                  className="flex-1 bg-transparent text-sm outline-none"
                />
              </div>
              {cariOpen && debouncedCariSearch.trim().length >= 2 && (
                <div className="mt-1 rounded-lg border border-border bg-card shadow-lg max-h-60 overflow-y-auto">
                  {cariSearching && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Aranıyor…</p>
                  )}
                  {!cariSearching && (cariOptions ?? []).length === 0 && (
                    <p className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok.</p>
                  )}
                  {(cariOptions ?? []).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCari(c)}
                      className="w-full text-left px-3 py-2 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0"
                    >
                      <p className="text-sm font-medium truncate">{c.fatura_unvani}</p>
                      <p className="text-xs text-muted-foreground">{c.cari_kodu}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Bakiyeli faturalar */}
        {cariId && (
          <section>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Hangi fatura(lar) için?
            </label>
            {bakiyeliFaturalar && bakiyeliFaturalar.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3 rounded-lg border border-dashed border-border bg-card">
                Bakiyeli fatura yok (serbest tahsilat olarak kaydedilir).
              </p>
            ) : (
              <div className="space-y-1.5">
                {(bakiyeliFaturalar ?? []).map((f) => {
                  const selected = selectedFaturaIds.includes(f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFatura(f.id)}
                      className={`w-full p-3 rounded-lg border text-left flex items-center justify-between gap-2 ${
                        selected
                          ? 'border-primary bg-primary/5'
                          : 'border-border bg-card hover:bg-muted/40'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {f.fatura_no ?? 'Taslak'}
                          {f.tip === 'iade' && (
                            <span className="ml-1 text-xs text-amber-700">(iade)</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(f.tarih)}
                          {f.vade_tarihi && <span className="ml-2">Vade: {fmtDate(f.vade_tarihi)}</span>}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-red-600">
                          {formatTRY(Number(f.kalan))}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          / {formatTRY(Number(f.toplam))}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tutar + tarih */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Tarih
            </label>
            <input
              type="date"
              value={tarih}
              onChange={(e) => setTarih(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Tutar (₺)
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              value={Number.isFinite(tutar) ? tutar : ''}
              onChange={(e) => {
                setTutar(Number(e.target.value) || 0);
                setTutarOverridden(true);
              }}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm font-semibold"
            />
          </div>
        </section>

        {/* Yöntem */}
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Yöntem</label>
          <div className="grid grid-cols-5 gap-1.5">
            {(['nakit', 'havale', 'cek', 'senet', 'kart'] as const).map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setYontem(y)}
                className={`px-2 py-2 rounded-lg border text-xs font-medium min-h-tap-min ${
                  yontem === y
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border bg-card'
                }`}
              >
                {y === 'nakit'
                  ? 'Nakit'
                  : y === 'havale'
                    ? 'Havale'
                    : y === 'cek'
                      ? 'Çek'
                      : y === 'senet'
                        ? 'Senet'
                        : 'Kart'}
              </button>
            ))}
          </div>
        </section>

        {/* Çek/Senet alt formu */}
        {(yontem === 'cek' || yontem === 'senet') && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
            <p className="text-xs font-medium text-amber-800">
              {yontem === 'cek' ? 'Çek' : 'Senet'} Bilgileri
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">
                  {yontem === 'cek' ? 'Çek No' : 'Senet No'}
                </label>
                <input
                  type="text"
                  value={csNo}
                  onChange={(e) => setCsNo(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-0.5">Banka</label>
                <input
                  type="text"
                  value={csBanka}
                  onChange={(e) => setCsBanka(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground block mb-0.5">
                  Keşideci *
                </label>
                <input
                  type="text"
                  value={csKesideci}
                  onChange={(e) => setCsKesideci(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] text-muted-foreground block mb-0.5">
                  Vade Tarihi *
                </label>
                <input
                  type="date"
                  value={csVade}
                  onChange={(e) => setCsVade(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-xs"
                />
              </div>
            </div>
          </section>
        )}

        {/* Dekont + açıklama */}
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Dekont No
          </label>
          <input
            type="text"
            value={dekontNo}
            onChange={(e) => setDekontNo(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
          />
        </section>
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Açıklama
          </label>
          <textarea
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
          />
        </section>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            {error}
          </p>
        )}
      </div>

      <div className="fixed bottom-16 left-0 right-0 px-4 pb-3 pt-2 bg-gradient-to-t from-background via-background to-transparent z-20">
        <button
          type="button"
          onClick={() => {
            setError(null);
            submitMutation.mutate();
          }}
          disabled={submitMutation.isPending || !cariId || tutar <= 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground font-semibold shadow-lg min-h-tap-min disabled:opacity-50"
        >
          <Check className="h-5 w-5" />
          Ödemeyi Kaydet ({formatTRY(tutar)})
        </button>
      </div>
    </div>
  );
}

export default PaymentFormPage;
