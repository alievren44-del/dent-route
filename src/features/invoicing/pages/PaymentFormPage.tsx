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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Search, AlertTriangle, Check } from 'lucide-react';

import { toast } from 'sonner';

import { getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import { enqueueOp, generateUUID, isNetworkWriteError } from '@core/offline/syncQueue';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';
import QueryErrorState from '@components/common/QueryErrorState';

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
  const queryClient = useQueryClient();
  // Offline yolunda created_by için oturum kullanıcı id'si (online yol getUser() kullanır).
  const sessionUserId = useAuthStore((s) => s.session?.userId);
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
  // Çoklu-fatura dağıtımı: varsayılan FIFO-oto, "Manuel dağıt" ile düzenlenebilir.
  const [manualAlloc, setManualAlloc] = useState(false);
  const [allocMap, setAllocMap] = useState<Record<string, number>>({});

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
      const supabase = getTypedClient();
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
      const supabase = getTypedClient();
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

  // Bakiyeli faturalar — KRİTİK: bu sorgu hata verirse aşağıdaki UI "Bakiyeli
  // fatura yok (serbest tahsilat)" yazardı; oysa gerçekte açık fatura(lar) var
  // olabilir ve ödeme yanlışlıkla faturasız/serbest kaydedilebilirdi.
  const {
    data: bakiyeliFaturalar,
    isError: bakiyeliIsError,
    error: bakiyeliError,
    refetch: refetchBakiyeli,
  } = useQuery({
    queryKey: ['payment-bakiyeli', cariId],
    enabled: !!cariId,
    queryFn: async (): Promise<BakiyeliFatura[]> => {
      const supabase = getTypedClient();
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

  // Seçili faturalar görüntü sırasıyla (vade asc) — FIFO bu sıraya göre kapatır.
  const selectedFaturalarOrdered = useMemo(
    () => (bakiyeliFaturalar ?? []).filter((f) => selectedFaturaIds.includes(f.id)),
    [bakiyeliFaturalar, selectedFaturaIds],
  );

  // FIFO-oto dağıtım: en eski faturadan başla, tutarı sırayla kapat; artan son faturaya.
  const fifoAlloc = useMemo(() => {
    const m: Record<string, number> = {};
    let remaining = tutar;
    for (const f of selectedFaturalarOrdered) {
      const a = Math.max(0, Math.min(remaining, Number(f.kalan)));
      m[f.id] = Math.round(a * 100) / 100;
      remaining = Math.round((remaining - a) * 100) / 100;
    }
    if (remaining > 0.009 && selectedFaturalarOrdered.length > 0) {
      const last = selectedFaturalarOrdered[selectedFaturalarOrdered.length - 1];
      if (last) m[last.id] = Math.round(((m[last.id] ?? 0) + remaining) * 100) / 100;
    }
    return m;
  }, [selectedFaturalarOrdered, tutar]);

  const effectiveAlloc = manualAlloc ? allocMap : fifoAlloc;
  const allocSum = useMemo(
    () =>
      Math.round(
        selectedFaturalarOrdered.reduce((s, f) => s + (Number(effectiveAlloc[f.id]) || 0), 0) * 100,
      ) / 100,
    [selectedFaturalarOrdered, effectiveAlloc],
  );
  const allocMismatch = selectedFaturalarOrdered.length >= 2 && Math.abs(allocSum - tutar) > 0.01;

  function enableManual(): void {
    setAllocMap({ ...fifoAlloc });
    setManualAlloc(true);
  }

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
      const supabase = getTypedClient();
      if (!cariId) throw new Error('Cari seçin.');
      if (tutar <= 0) throw new Error("Tutar 0'dan büyük olmalı.");

      // M5: her tahsis ilgili faturanın KALANINI aşamaz. Aksi halde odenen>toplam,
      // kalan negatif olur, status 'odendi'ye döner ve aging/hatırlatma sorguları
      // (kalan>0 filtresi) faturayı sessizce dışlar → cari bakiye/aging bozulur.
      // DB'de CHECK yok → client-side guard. Fazla ödeme için ayrı avans akışı gerekir.
      {
        const single = selectedFaturalarOrdered.length <= 1;
        for (const f of selectedFaturalarOrdered) {
          const alloc = single ? tutar : Number(effectiveAlloc[f.id]) || 0;
          const kalan = Number(f.kalan) || 0;
          if (alloc - kalan > 0.01) {
            throw new Error(
              `${f.fatura_no ?? 'Fatura'} tahsisi (${formatTRY(alloc)}) fatura kalanını (${formatTRY(kalan)}) aşıyor.`,
            );
          }
        }
      }

      const cekNeeded = yontem === 'cek' || yontem === 'senet';
      if (cekNeeded) {
        if (!csKesideci.trim()) throw new Error('Keşideci zorunlu.');
        if (!csVade) throw new Error('Vade tarihi zorunlu.');
      }

      // Çek/senet satırı (client-üretilmiş id → offline replay pk 23505'te idempotent).
      const buildCekSenetRow = (id: string): Record<string, unknown> => ({
        id,
        tip: yontem,
        cek_no: csNo.trim() || null,
        banka: csBanka.trim() || null,
        kesideci: csKesideci.trim(),
        cari_id: cariId,
        vade_tarihi: csVade,
        tutar,
        durum: 'portfoyde',
      });

      // saha_odemeler satır(lar)ı. 0–1 fatura → tek serbest/faturalı satır; 2+ →
      // FIFO/manuel dağıtımla fatura başına bir satır. Her satır client-üretilmiş id taşır.
      const selectedIds = selectedFaturalarOrdered.map((f) => f.id);
      const buildOdemeRows = (uid: string, cekSenetId: string | null): Record<string, unknown>[] => {
        if (selectedIds.length <= 1) {
          return [
            {
              id: generateUUID(),
              cari_id: cariId,
              fatura_id: selectedIds[0] ?? null,
              tarih,
              tutar,
              yontem,
              dekont_no: dekontNo.trim() || null,
              cek_senet_id: cekSenetId,
              aciklama: aciklama.trim() || null,
              created_by: uid,
            },
          ];
        }
        const sum =
          Math.round(
            selectedIds.reduce((s, fid) => s + (Number(effectiveAlloc[fid]) || 0), 0) * 100,
          ) / 100;
        if (Math.abs(sum - tutar) > 0.01) {
          throw new Error(
            `Dağıtılan tutar (${formatTRY(sum)}) toplam tutara (${formatTRY(tutar)}) eşit olmalı.`,
          );
        }
        return selectedIds
          .map((fid) => ({
            id: generateUUID(),
            cari_id: cariId,
            fatura_id: fid,
            tarih,
            tutar: Math.round((Number(effectiveAlloc[fid]) || 0) * 100) / 100,
            yontem,
            dekont_no: dekontNo.trim() || null,
            cek_senet_id: cekSenetId,
            aciklama: aciklama.trim() || null,
            created_by: uid,
          }))
          .filter((r) => (r.tutar) > 0);
      };

      // Çevrim dışıysa doğrudan kuyruğa al (OrderFormPage offline deseni). Online yol
      // getUser() ile uid çözer; offline'da oturum kullanıcı id'sini kullan (= auth.uid,
      // replay'de RLS WITH CHECK karşılanır).
      if (!navigator.onLine) {
        const uid = sessionUserId;
        if (!uid) throw new Error('Oturum bulunamadı. Tekrar giriş yapın.');
        const cekSenetId = cekNeeded ? generateUUID() : null;
        const cekSenet = cekNeeded ? buildCekSenetRow(cekSenetId!) : null;
        const odemeler = buildOdemeRows(uid, cekSenetId);
        if (odemeler.length === 0) throw new Error('Dağıtılacak tutar yok.');
        await enqueueOp(
          'payment.create',
          { cekSenet, odemeler },
          odemeler[0]?.id as string,
        );
        return { id: 'offline', offline: true as const };
      }

      let cekSenetId: string | null = null;
      if (cekNeeded) {
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

      // L2: ödeme kaydı oluşturulamazsa (getUser/RLS/ağ) yukarıda eklenen çek/senet
      // satırını best-effort geri al — aksi halde bir ödemeye bağlı olmayan yetim
      // 'portfoyde' çek/senet birikir (çek-senet listesi/raporu şişer).
      try {
      // created_by RLS WITH CHECK için zorunlu (DB default yok).
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error('Oturum bulunamadı. Tekrar giriş yapın.');
      const uid = userData.user.id;

      const selected = selectedFaturalarOrdered.map((f) => f.id);

      // 0–1 fatura → tek kayıt (fatura yoksa serbest tahsilat).
      if (selected.length <= 1) {
        const { data, error: err } = await supabase
          .from('saha_odemeler')
          .insert({
            cari_id: cariId,
            fatura_id: selected[0] ?? null,
            tarih,
            tutar,
            yontem,
            dekont_no: dekontNo.trim() || null,
            cek_senet_id: cekSenetId,
            aciklama: aciklama.trim() || null,
            created_by: uid,
          })
          .select('id')
          .single();
        if (err) throw err;
        return data as { id: string };
      }

      // Çoklu fatura → fatura başına 1 ödeme satırı (her satır kendi faturasını
      // trigger ile kapatır). Dağıtım FIFO-oto veya manuel; toplam = tutar olmalı.
      const sum =
        Math.round(selected.reduce((s, fid) => s + (Number(effectiveAlloc[fid]) || 0), 0) * 100) /
        100;
      if (Math.abs(sum - tutar) > 0.01) {
        throw new Error(
          `Dağıtılan tutar (${formatTRY(sum)}) toplam tutara (${formatTRY(tutar)}) eşit olmalı.`,
        );
      }
      const rows = selected
        .map((fid) => ({
          cari_id: cariId,
          fatura_id: fid,
          tarih,
          tutar: Math.round((Number(effectiveAlloc[fid]) || 0) * 100) / 100,
          yontem,
          dekont_no: dekontNo.trim() || null,
          cek_senet_id: cekSenetId,
          aciklama: aciklama.trim() || null,
          created_by: uid,
        }))
        .filter((r) => r.tutar > 0);
      if (rows.length === 0) throw new Error('Dağıtılacak tutar yok.');

      const { error: err } = await supabase.from('saha_odemeler').insert(rows);
      if (err) throw err;
      return { id: 'multi' };
      } catch (e) {
        if (cekSenetId) {
          await supabase.from('saha_cek_senetler').delete().eq('id', cekSenetId);
        }
        // Ağ/bağlantı hatası → kuyruğa al (veri kaybetme). Online eklenen çek/senet
        // yukarıda geri alındı; kuyruğa YENİ client-id'li çek/senet + ödeme satırları girer.
        if (isNetworkWriteError(e)) {
          const uid = sessionUserId;
          if (uid) {
            const qCekSenetId = cekNeeded ? generateUUID() : null;
            const qCekSenet = cekNeeded && qCekSenetId ? buildCekSenetRow(qCekSenetId) : null;
            const qOdemeler = buildOdemeRows(uid, qCekSenetId);
            if (qOdemeler.length > 0) {
              await enqueueOp(
                'payment.create',
                { cekSenet: qCekSenet, odemeler: qOdemeler },
                qOdemeler[0]?.id as string,
              );
              return { id: 'offline', offline: true as const };
            }
          }
        }
        throw e;
      }
    },
    onSuccess: (res) => {
      if (cariId) {
        void queryClient.invalidateQueries({ queryKey: ['cari-odemeler', cariId] });
        void queryClient.invalidateQueries({ queryKey: ['cari-faturalar', cariId] });
        void queryClient.invalidateQueries({ queryKey: ['cari-detail', cariId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['cariler-fatura-sums'] });
      // Previously orphaned: aging report never refreshed after payment.
      void queryClient.invalidateQueries({ queryKey: ['invoicing', 'aging'] });
      if ((res as { offline?: boolean }).offline) {
        toast.success('Çevrimdışı kaydedildi — bağlantı gelince gönderilecek');
      }
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
            {bakiyeliIsError ? (
              <QueryErrorState
                message={
                  bakiyeliError instanceof Error
                    ? `Faturalar yüklenemedi — serbest tahsilat ile YANLIŞLIKLA kaydetmeyin. ${bakiyeliError.message}`
                    : 'Faturalar yüklenemedi — serbest tahsilat ile YANLIŞLIKLA kaydetmeyin.'
                }
                onRetry={() => void refetchBakiyeli()}
              />
            ) : bakiyeliFaturalar && bakiyeliFaturalar.length === 0 ? (
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
                          {f.vade_tarihi && (
                            <span className="ml-2">Vade: {fmtDate(f.vade_tarihi)}</span>
                          )}
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

        {/* Çoklu-fatura dağıtımı */}
        {selectedFaturalarOrdered.length >= 2 && (
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-muted-foreground">Fatura dağıtımı</label>
              <button
                type="button"
                onClick={() => (manualAlloc ? setManualAlloc(false) : enableManual())}
                className="text-xs text-primary px-2 py-1 min-h-tap-min"
              >
                {manualAlloc ? 'FIFO otomatik' : 'Manuel dağıt'}
              </button>
            </div>
            <div className="space-y-1.5">
              {selectedFaturalarOrdered.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border bg-card"
                >
                  <span className="text-xs truncate">
                    {f.fatura_no ?? 'Taslak'}{' '}
                    <span className="text-muted-foreground">
                      (kalan {formatTRY(Number(f.kalan))})
                    </span>
                  </span>
                  {manualAlloc ? (
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={allocMap[f.id] ?? 0}
                      onChange={(e) =>
                        setAllocMap((prev) => ({ ...prev, [f.id]: Number(e.target.value) || 0 }))
                      }
                      className="w-24 px-2 py-1 rounded-md border border-border bg-background text-xs text-right"
                    />
                  ) : (
                    <span className="text-xs font-semibold">{formatTRY(fifoAlloc[f.id] ?? 0)}</span>
                  )}
                </div>
              ))}
            </div>
            <p
              className={`text-[11px] mt-1 ${allocMismatch ? 'text-red-600' : 'text-muted-foreground'}`}
            >
              Dağıtılan: {formatTRY(allocSum)} / Toplam: {formatTRY(tutar)}
            </p>
          </section>
        )}

        {/* Tutar + tarih */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tarih</label>
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
                <label className="text-[10px] text-muted-foreground block mb-0.5">Keşideci *</label>
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
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Açıklama</label>
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
          disabled={submitMutation.isPending || !cariId || tutar <= 0 || allocMismatch}
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
