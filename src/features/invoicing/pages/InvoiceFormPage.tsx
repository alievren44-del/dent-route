/**
 * InvoiceFormPage — Yeni fatura oluşturma ekranı.
 *
 * URL: /invoicing/fatura/yeni?cari_id=:id
 *
 * Akış:
 *   - Cari autocomplete (yoksa)
 *   - Tip: satış / iade
 *   - Tarih + vade (vade auto: tarih + cari.odeme_vadesi_gun)
 *   - Kalemler tablosu: ürün arama, miktar, birim, fiyat, iskonto, KDV
 *   - Auto totals (invoiceCalc)
 *   - Açıklama
 *   - Submit: "Kaydet (taslak)" veya "Kaydet & Gönder"
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Search, Save, Send, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';

import { getTypedClient } from '@lib/supabase';
import {
  calcInvoiceTotals,
  calcLineTotal,
  calcVadeTarihi,
  formatTRY,
  type LineItem,
} from '@features/invoicing/lib/invoiceCalc';

interface CariOption {
  id: string;
  cari_kodu: string;
  fatura_unvani: string;
  odeme_vadesi_gun: number;
}

interface ProductOption {
  id: string;
  name: string;
  sku?: string | null;
  base_price?: number | null;
  sale_price?: number | null;
  tax_rate?: number | null;
}

interface KalemDraft extends LineItem {
  key: string; // local list key
  sira: number;
  urun_id: string | null;
  urun_adi: string;
  birim: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setD(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return d;
}

function newDraft(sira: number): KalemDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sira,
    urun_id: null,
    urun_adi: '',
    birim: 'adet',
    miktar: 1,
    birim_fiyat: 0,
    iskonto_orani: 0,
    kdv_orani: 0.1, // varsayılan %10 (ClearOne dışı tüm markalar); ürün seçilince override
  };
}

function InvoiceFormPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initialCariId = searchParams.get('cari_id');

  const [cariId, setCariId] = useState<string | null>(initialCariId);
  const [cariLabel, setCariLabel] = useState<string>('');
  const [cariSearch, setCariSearch] = useState<string>('');
  const [cariOpen, setCariOpen] = useState<boolean>(!initialCariId);
  const debouncedCariSearch = useDebounced(cariSearch, 300);
  const [cariVadeGun, setCariVadeGun] = useState<number>(30);

  const [tip, setTip] = useState<'satis' | 'iade'>('satis');
  const today = new Date().toISOString().slice(0, 10);
  const [tarih, setTarih] = useState<string>(today);
  const [vadeTarihi, setVadeTarihi] = useState<string>(calcVadeTarihi(today, 30));
  const [vadeOverridden, setVadeOverridden] = useState<boolean>(false);
  const [aciklama, setAciklama] = useState<string>('');
  const [faturasiz, setFaturasiz] = useState<boolean>(false);
  const [kalemler, setKalemler] = useState<KalemDraft[]>([newDraft(1)]);
  const [error, setError] = useState<string | null>(null);

  // Initial cari pre-fill
  useQuery({
    queryKey: ['invoice-initial-cari', initialCariId],
    enabled: !!initialCariId,
    queryFn: async () => {
      const supabase = getTypedClient();
      const { data, error: err } = await supabase
        .from('saha_cariler')
        .select('id, cari_kodu, fatura_unvani, odeme_vadesi_gun')
        .eq('id', initialCariId!)
        .maybeSingle();
      if (err) throw err;
      if (data) {
        const c = data as CariOption;
        setCariLabel(`${c.fatura_unvani} (${c.cari_kodu})`);
        setCariVadeGun(c.odeme_vadesi_gun);
        if (!vadeOverridden) setVadeTarihi(calcVadeTarihi(tarih, c.odeme_vadesi_gun));
      }
      return data;
    },
  });

  // Cari autocomplete
  const { data: cariOptions, isFetching: cariSearching } = useQuery({
    queryKey: ['invoice-cari-search', debouncedCariSearch],
    enabled: cariOpen && debouncedCariSearch.trim().length >= 2,
    queryFn: async (): Promise<CariOption[]> => {
      const supabase = getTypedClient();
      const term = `%${debouncedCariSearch}%`;
      const { data, error: err } = await supabase
        .from('saha_cariler')
        .select('id, cari_kodu, fatura_unvani, odeme_vadesi_gun')
        .or(`fatura_unvani.ilike.${term},cari_kodu.ilike.${term},vergi_no.ilike.${term}`)
        .limit(15);
      if (err) throw err;
      return (data ?? []) as CariOption[];
    },
  });

  function pickCari(c: CariOption): void {
    setCariId(c.id);
    setCariLabel(`${c.fatura_unvani} (${c.cari_kodu})`);
    setCariOpen(false);
    setCariSearch('');
    setCariVadeGun(c.odeme_vadesi_gun);
    if (!vadeOverridden) setVadeTarihi(calcVadeTarihi(tarih, c.odeme_vadesi_gun));
  }

  function updateTarih(v: string): void {
    setTarih(v);
    if (!vadeOverridden) setVadeTarihi(calcVadeTarihi(v, cariVadeGun));
  }

  function updateVade(v: string): void {
    setVadeTarihi(v);
    setVadeOverridden(true);
  }

  // Genel (tutar üzerinden) iskonto — kalem-bazlı İsk%'in ÜZERİNE çarpımsal uygulanır;
  // her kaleme dağıtılır ki DB trigger'ı (kalemler'den fatura toplamı) doğru hesaplasın.
  const [genelIskOrani, setGenelIskOrani] = useState(0); // 0..1
  // TL-tutar girişi — genelIskOrani'ye dönüştürülür; tek kaynak of truth = genelIskOrani.
  const [genelIskTlInput, setGenelIskTlInput] = useState<string>('');
  const adjustedKalemler = useMemo(
    () =>
      kalemler.map((k) => ({
        ...k,
        iskonto_orani: 1 - (1 - k.iskonto_orani) * (1 - genelIskOrani),
        // Faturasız satış = resmi fatura yok → KDV uygulanmaz; cari borcu KDV-hariç
        // (net) tutar olur (debug_reports 2026-06-19).
        kdv_orani: faturasiz ? 0 : k.kdv_orani,
      })),
    [kalemler, genelIskOrani, faturasiz],
  );
  const totals = useMemo(() => calcInvoiceTotals(adjustedKalemler), [adjustedKalemler]);
  const baseTotals = useMemo(() => calcInvoiceTotals(kalemler), [kalemler]);
  const genelIskTutar = Math.round((baseTotals.ara_toplam - totals.ara_toplam) * 100) / 100;

  function updateKalem(key: string, patch: Partial<KalemDraft>): void {
    setKalemler((prev) => prev.map((k) => (k.key === key ? { ...k, ...patch } : k)));
  }

  function removeKalem(key: string): void {
    setKalemler((prev) => prev.filter((k) => k.key !== key).map((k, i) => ({ ...k, sira: i + 1 })));
  }

  function addKalem(): void {
    setKalemler((prev) => [...prev, newDraft(prev.length + 1)]);
  }

  const submitMutation = useMutation({
    mutationFn: async (action: 'taslak' | 'gonderildi') => {
      const supabase = getTypedClient();
      if (!cariId) throw new Error('Cari seçilmedi.');
      const validKalemler = kalemler.filter((k) => k.urun_adi.trim() && k.miktar > 0);
      if (validKalemler.length === 0) throw new Error('En az bir kalem ekleyin.');

      const { data: fatura, error: fErr } = await supabase
        .from('saha_faturalar')
        .insert({
          cari_id: cariId,
          tip,
          tarih,
          vade_tarihi: vadeTarihi || null,
          durum: action,
          aciklama: aciklama.trim() || null,
          faturasiz,
        })
        .select('id')
        .single();
      if (fErr) throw fErr;
      const faturaId = (fatura as { id: string }).id;

      const insertRows = validKalemler.map((k) => ({
        fatura_id: faturaId,
        sira: k.sira,
        urun_id: k.urun_id,
        urun_adi: k.urun_adi.trim(),
        birim: k.birim,
        miktar: k.miktar,
        birim_fiyat: k.birim_fiyat,
        // Genel iskonto kalem-iskonto'sunun üzerine çarpımsal eklenir (DB'ye yazılan
        // efektif oran) → trigger fatura toplamını doğru hesaplar.
        iskonto_orani: 1 - (1 - k.iskonto_orani) * (1 - genelIskOrani),
        // Faturasız → KDV 0 (cari borç net/KDV-hariç). DB trigger toplamı net hesaplar.
        kdv_orani: faturasiz ? 0 : k.kdv_orani,
      }));

      const { error: kErr } = await supabase.from('saha_fatura_kalemleri').insert(insertRows);
      if (kErr) throw kErr;

      return faturaId;
    },
    onSuccess: (faturaId) => {
      if (cariId) {
        void queryClient.invalidateQueries({ queryKey: ['cari-faturalar', cariId] });
        void queryClient.invalidateQueries({ queryKey: ['cari-detail', cariId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['cariler-fatura-sums'] });
      navigate(`/invoicing/fatura/${faturaId}`);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Fatura kaydedilemedi.');
    },
  });

  const submitLockRef = useRef(false);
  function submit(action: 'taslak' | 'gonderildi'): void {
    if (submitLockRef.current || submitMutation.isPending) return;
    submitLockRef.current = true;
    setError(null);
    submitMutation.mutate(action, {
      onSettled: () => {
        submitLockRef.current = false;
      },
    });
  }

  return (
    <div className="flex flex-col min-h-full pb-32">
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link
            to="/invoicing/cari"
            aria-label="Geri"
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">Yeni Fatura</h1>
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

        {/* Tip */}
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tip</label>
          <div className="flex gap-2">
            {(['satis', 'iade'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setTip(opt)}
                className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium min-h-tap-min ${
                  tip === opt
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'border-border bg-card'
                }`}
              >
                {opt === 'satis' ? 'Satış' : 'İade'}
              </button>
            ))}
          </div>
          {/* Faturasız seçeneği */}
          <label className="flex items-center gap-2.5 mt-2 p-2.5 rounded-lg border border-border bg-card cursor-pointer select-none">
            <input
              type="checkbox"
              checked={faturasiz}
              onChange={(e) => setFaturasiz(e.target.checked)}
              className="h-4 w-4 rounded accent-primary"
            />
            <span className="text-sm">Faturasız</span>
            <span className="text-xs text-muted-foreground">(resmi fatura no üretilmez)</span>
          </label>
        </section>

        {/* Tarihler */}
        <section className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Tarih</label>
            <input
              type="date"
              value={tarih}
              onChange={(e) => updateTarih(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Vade Tarihi
            </label>
            <input
              type="date"
              value={vadeTarihi}
              onChange={(e) => updateVade(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
            />
          </div>
        </section>

        {/* Kalemler */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold">Kalemler</h2>
            <button
              type="button"
              onClick={addKalem}
              className="flex items-center gap-1 text-xs text-primary font-medium px-2 py-1 min-h-tap-min"
            >
              <Plus className="h-3.5 w-3.5" />
              Kalem ekle
            </button>
          </div>
          <div className="space-y-2">
            {kalemler.map((k) => (
              <KalemRow
                key={k.key}
                kalem={k}
                onChange={(patch) => updateKalem(k.key, patch)}
                onRemove={() => removeKalem(k.key)}
                canRemove={kalemler.length > 1}
              />
            ))}
          </div>
        </section>

        {/* Totals */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Ara Toplam</span>
            <span className="font-medium">{formatTRY(baseTotals.ara_toplam)}</span>
          </div>
          {baseTotals.iskonto_toplam > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Kalem İskontosu</span>
              <span className="font-medium">-{formatTRY(baseTotals.iskonto_toplam)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm gap-2">
            <span className="text-muted-foreground shrink-0">Genel İskonto</span>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={0}
                  max={100}
                  value={Math.round(genelIskOrani * 1000) / 10}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
                    setGenelIskOrani(v / 100);
                    // Sync TL input to reflect the new rate against current ara_toplam
                    const tlEquiv = baseTotals.ara_toplam * (v / 100);
                    setGenelIskTlInput(tlEquiv > 0 ? String(Math.round(tlEquiv * 100) / 100) : '');
                  }}
                  className="w-20 px-2 py-1 rounded-md border border-border bg-background text-sm text-right"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  %
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  inputMode="decimal"
                  step="1"
                  min={0}
                  placeholder="0"
                  value={genelIskTlInput}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setGenelIskTlInput(raw);
                    const tlAmt = Number(raw) || 0;
                    const base = baseTotals.ara_toplam;
                    if (base > 0) {
                      const rate = Math.min(1, Math.max(0, tlAmt / base));
                      setGenelIskOrani(rate);
                    }
                  }}
                  className="w-24 px-2 py-1 rounded-md border border-border bg-background text-sm text-right"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                  ₺
                </span>
              </div>
            </div>
          </div>
          {genelIskTutar > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Genel İskonto Tutarı</span>
              <span className="font-medium text-red-600">-{formatTRY(genelIskTutar)}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">KDV</span>
            <span className="font-medium">{formatTRY(totals.kdv_tutari)}</span>
          </div>
          <div className="border-t border-border pt-1.5 mt-1.5 flex items-center justify-between">
            <span className="text-base font-semibold">Genel Toplam</span>
            <span className="text-lg font-bold text-primary">{formatTRY(totals.toplam)}</span>
          </div>
        </section>

        {/* Açıklama */}
        <section>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Açıklama</label>
          <textarea
            value={aciklama}
            onChange={(e) => setAciklama(e.target.value)}
            rows={3}
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

      {/* Sticky CTA */}
      <div className="fixed bottom-16 left-0 right-0 px-4 pb-3 pt-2 bg-gradient-to-t from-background via-background to-transparent z-20 flex gap-2">
        <button
          type="button"
          onClick={() => submit('taslak')}
          disabled={submitMutation.isPending || !cariId}
          className="flex-1 px-3 py-2.5 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-1.5 min-h-tap-min disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          Taslak
        </button>
        <button
          type="button"
          onClick={() => submit('gonderildi')}
          disabled={submitMutation.isPending || !cariId}
          className="flex-1 px-3 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 min-h-tap-min disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
          Kaydet & Gönder
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Kalem satır
// ============================================================================
function KalemRow({
  kalem,
  onChange,
  onRemove,
  canRemove,
}: {
  kalem: KalemDraft;
  onChange: (patch: Partial<KalemDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}): JSX.Element {
  const [productSearch, setProductSearch] = useState('');
  const [productOpen, setProductOpen] = useState(false);
  const debounced = useDebounced(productSearch, 300);

  const { data: products } = useQuery({
    queryKey: ['invoice-product-search', debounced],
    enabled: productOpen && debounced.trim().length >= 2,
    queryFn: async (): Promise<ProductOption[]> => {
      const supabase = getTypedClient();
      const term = `%${debounced}%`;
      // v_saha_products = fiyatı hesaplanmış katalog (base_price FX-dönüşümlü).
      // Eski raw `products` tablosu base_price'ı çoğunlukla null → ürün eklenince
      // birim_fiyat 0 kalıyordu ("fiyatlar sıfır" bug). OrderForm da v_saha_products kullanır.
      const { data, error } = await supabase
        .from('v_saha_products')
        .select('id, name, sku, base_price, sale_price, tax_rate')
        .or(`name.ilike.${term},sku.ilike.${term}`)
        .limit(10);
      if (error) return [];
      return (data ?? []) as ProductOption[];
    },
  });

  const line = calcLineTotal(kalem.miktar, kalem.birim_fiyat, kalem.iskonto_orani, kalem.kdv_orani);

  function pickProduct(p: ProductOption): void {
    // KDV ürünün tax_rate'inden (WEB ile aynı: ClearOne %20, gerisi %10).
    const kdv = p.tax_rate != null ? Number(p.tax_rate) / 100 : 0.1;
    // urun_id UUID kolonu — fanta/olident ürün id'leri text ("fanta-12") → uuid değil →
    // null'a düşür (insert patlamasın); ürün adı zaten urun_adi'de tutulur.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id);
    onChange({
      urun_id: isUuid ? p.id : null,
      urun_adi: p.name,
      birim_fiyat: Number(p.sale_price ?? p.base_price ?? 0),
      kdv_orani: kdv,
    });
    setProductOpen(false);
    setProductSearch('');
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={kalem.urun_adi}
            onChange={(e) => {
              onChange({ urun_adi: e.target.value, urun_id: null });
              setProductSearch(e.target.value);
              setProductOpen(true);
            }}
            onFocus={() => setProductOpen(true)}
            onBlur={() => setTimeout(() => setProductOpen(false), 150)}
            placeholder="Ürün adı"
            className="w-full px-2 py-1.5 rounded-md border border-border bg-background text-sm"
          />
          {productOpen && debounced.trim().length >= 2 && (products?.length ?? 0) > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-border bg-card shadow-lg max-h-48 overflow-y-auto">
              {(products ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={() => pickProduct(p)}
                  className="w-full text-left px-2 py-1.5 hover:bg-muted/60 border-b border-border last:border-b-0"
                >
                  <p className="text-xs font-medium text-foreground truncate">{p.name}</p>
                  {p.sku && <p className="text-[10px] text-muted-foreground">{p.sku}</p>}
                </button>
              ))}
            </div>
          )}
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label="Kalemi sil"
            className="p-2 -m-2 text-red-600 min-h-tap-min min-w-tap-min flex items-center justify-center"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-2">
        <NumberCell label="Miktar" value={kalem.miktar} onChange={(v) => onChange({ miktar: v })} />
        <TextCell label="Birim" value={kalem.birim} onChange={(v) => onChange({ birim: v })} />
        <NumberCell
          label="Birim ₺"
          value={kalem.birim_fiyat}
          onChange={(v) => onChange({ birim_fiyat: v })}
        />
        <NumberCell
          label="İsk %"
          value={kalem.iskonto_orani * 100}
          onChange={(v) => onChange({ iskonto_orani: v / 100 })}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground block">KDV %</label>
          <select
            value={Math.round(kalem.kdv_orani * 100)}
            onChange={(e) => onChange({ kdv_orani: Number(e.target.value) / 100 })}
            className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs"
          >
            <option value={0}>0%</option>
            <option value={1}>1%</option>
            <option value={10}>10%</option>
            <option value={20}>20%</option>
          </select>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">Satır Toplam</p>
          <p className="text-sm font-semibold">{formatTRY(line.total)}</p>
        </div>
      </div>
    </div>
  );
}

function NumberCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground block">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs"
      />
    </div>
  );
}

function TextCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div>
      <label className="text-[10px] text-muted-foreground block">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1 rounded-md border border-border bg-background text-xs"
      />
    </div>
  );
}

export default InvoiceFormPage;
