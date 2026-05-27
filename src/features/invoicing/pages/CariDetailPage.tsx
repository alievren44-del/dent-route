/**
 * CariDetailPage — Cari detay ekranı, tab'lı.
 *
 * URL: /invoicing/cari/:id
 *
 * Tablar: Faturalar / Ödemeler / Çek-Senet / Ekstre / Bilgiler
 * Header banner: cari adı, kod, vergi no, bakiye (büyük), kredi limit progress bar
 */

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Plus,
  FileText,
  Wallet,
  Receipt,
  Info,
  Download,
  Edit2,
  Save,
} from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';
import { generateExtractPdfHtml, openInvoicePrintWindow } from '@features/invoicing/pdf/invoicePdf';

type TabKey = 'faturalar' | 'odemeler' | 'cek_senet' | 'ekstre' | 'bilgiler';

interface CariFull {
  id: string;
  cari_kodu: string;
  fatura_unvani: string;
  vergi_no: string | null;
  vergi_dairesi: string | null;
  fatura_adresi: string | null;
  il: string | null;
  ilce: string | null;
  iban: string | null;
  banka_adi: string | null;
  odeme_vadesi_gun: number;
  kredi_limiti: number;
  acilis_bakiyesi: number;
  durum: string;
  notlar: string | null;
}

interface FaturaRow {
  id: string;
  fatura_no: string | null;
  tarih: string;
  vade_tarihi: string | null;
  tip: string;
  toplam: number;
  odenen: number;
  kalan: number;
  durum: string;
}

interface OdemeRow {
  id: string;
  tarih: string;
  tutar: number;
  yontem: string;
  dekont_no: string | null;
  fatura_id: string | null;
  aciklama: string | null;
}

interface CekSenetRow {
  id: string;
  tip: string;
  cek_no: string | null;
  banka: string | null;
  kesideci: string;
  vade_tarihi: string;
  tutar: number;
  durum: string;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const DURUM_STYLES: Record<string, string> = {
  taslak: 'bg-gray-100 text-gray-700',
  gonderildi: 'bg-blue-100 text-blue-700',
  kismi_odendi: 'bg-amber-100 text-amber-700',
  odendi: 'bg-green-100 text-green-700',
  gecikti: 'bg-red-100 text-red-700',
  iptal: 'bg-gray-200 text-gray-500 line-through',
};
const DURUM_LABELS: Record<string, string> = {
  taslak: 'Taslak',
  gonderildi: 'Gönderildi',
  kismi_odendi: 'Kısmi',
  odendi: 'Ödendi',
  gecikti: 'Gecikti',
  iptal: 'İptal',
};

const YONTEM_LABELS: Record<string, string> = {
  nakit: 'Nakit',
  havale: 'Havale',
  cek: 'Çek',
  senet: 'Senet',
  kart: 'Kart',
};

const CEK_STATE_LABELS: Record<string, string> = {
  portfoyde: 'Portföyde',
  tahsile_verildi: 'Tahsile Verildi',
  tahsil_edildi: 'Tahsil Edildi',
  karsiliksiz: 'Karşılıksız',
  iade: 'İade',
};

function CariDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<TabKey>('faturalar');

  const { data: cari, isLoading } = useQuery({
    queryKey: ['cari-detail', id],
    enabled: !!id,
    queryFn: async (): Promise<CariFull | null> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_cariler')
        .select('*')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CariFull | null;
    },
  });

  const { data: faturalar } = useQuery({
    queryKey: ['cari-faturalar', id],
    enabled: !!id,
    queryFn: async (): Promise<FaturaRow[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_faturalar')
        .select('id, fatura_no, tarih, vade_tarihi, tip, toplam, odenen, kalan, durum')
        .eq('cari_id', id!)
        .order('tarih', { ascending: false });
      if (error) throw error;
      return (data ?? []) as FaturaRow[];
    },
  });

  const { data: odemeler } = useQuery({
    queryKey: ['cari-odemeler', id],
    enabled: !!id,
    queryFn: async (): Promise<OdemeRow[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_odemeler')
        .select('id, tarih, tutar, yontem, dekont_no, fatura_id, aciklama')
        .eq('cari_id', id!)
        .order('tarih', { ascending: false });
      if (error) throw error;
      return (data ?? []) as OdemeRow[];
    },
  });

  const { data: cekSenetler } = useQuery({
    queryKey: ['cari-cek-senet', id],
    enabled: !!id,
    queryFn: async (): Promise<CekSenetRow[]> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_cek_senetler')
        .select('id, tip, cek_no, banka, kesideci, vade_tarihi, tutar, durum')
        .eq('cari_id', id!)
        .order('vade_tarihi', { ascending: true });
      if (error) throw error;
      return (data ?? []) as CekSenetRow[];
    },
  });

  const bakiye = useMemo(() => {
    if (!cari) return 0;
    let b = Number(cari.acilis_bakiyesi ?? 0);
    for (const f of faturalar ?? []) {
      if (f.durum === 'iptal') continue;
      const sign = f.tip === 'iade' ? -1 : 1;
      b += sign * Number(f.kalan ?? 0);
    }
    return Math.round(b * 100) / 100;
  }, [cari, faturalar]);

  if (!id) return <div className="p-6 text-center text-muted-foreground">Cari ID yok.</div>;

  if (isLoading) {
    return <div className="p-6 text-center text-muted-foreground">Yükleniyor…</div>;
  }

  if (!cari) {
    return <div className="p-6 text-center text-muted-foreground">Cari bulunamadı.</div>;
  }

  const kredi = Number(cari.kredi_limiti ?? 0);
  const kullanim = kredi > 0 ? Math.max(0, Math.min(100, (bakiye / kredi) * 100)) : 0;
  const progressColor = kullanim >= 90 ? 'bg-red-500' : kullanim >= 70 ? 'bg-amber-500' : 'bg-green-500';

  return (
    <div className="flex flex-col min-h-full pb-24">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link
            to="/invoicing/cari"
            aria-label="Geri"
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">{cari.fatura_unvani}</h1>
            <p className="text-xs text-muted-foreground">{cari.cari_kodu}</p>
          </div>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              cari.durum === 'aktif'
                ? 'bg-green-100 text-green-700'
                : cari.durum === 'pasif'
                  ? 'bg-gray-200 text-gray-700'
                  : 'bg-red-100 text-red-700'
            }`}
          >
            {cari.durum.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Bakiye banner */}
      <div className="px-4 py-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Bakiye</p>
          <p
            className={`text-3xl font-bold mt-1 ${
              bakiye > 0 ? 'text-red-600' : bakiye < 0 ? 'text-green-600' : 'text-foreground'
            }`}
          >
            {formatTRY(bakiye)}
          </p>
          {cari.vergi_no && (
            <p className="text-xs text-muted-foreground mt-1">VKN: {cari.vergi_no}</p>
          )}
          {kredi > 0 && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                <span>Kredi Limiti</span>
                <span>
                  {formatTRY(Math.max(0, bakiye))} / {formatTRY(kredi)}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={`h-full ${progressColor}`} style={{ width: `${kullanim}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex overflow-x-auto border-b border-border bg-background sticky top-[60px] z-[5]">
        {(
          [
            { key: 'faturalar' as const, label: 'Faturalar', icon: FileText },
            { key: 'odemeler' as const, label: 'Ödemeler', icon: Wallet },
            { key: 'cek_senet' as const, label: 'Çek/Senet', icon: Receipt },
            { key: 'ekstre' as const, label: 'Ekstre', icon: Download },
            { key: 'bilgiler' as const, label: 'Bilgiler', icon: Info },
          ]
        ).map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-3 min-h-tap-min text-xs font-medium whitespace-nowrap ${
                active
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 px-4 py-3">
        {activeTab === 'faturalar' && (
          <FaturalarTab cariId={cari.id} faturalar={faturalar ?? []} />
        )}
        {activeTab === 'odemeler' && (
          <OdemelerTab cariId={cari.id} odemeler={odemeler ?? []} faturalar={faturalar ?? []} />
        )}
        {activeTab === 'cek_senet' && (
          <CekSenetTab cariId={cari.id} cekSenetler={cekSenetler ?? []} />
        )}
        {activeTab === 'ekstre' && (
          <EkstreTab cari={cari} faturalar={faturalar ?? []} odemeler={odemeler ?? []} />
        )}
        {activeTab === 'bilgiler' && <BilgilerTab cari={cari} />}
      </div>
    </div>
  );
}

// ============================================================================
// Tab: Faturalar
// ============================================================================
function FaturalarTab({
  cariId,
  faturalar,
}: {
  cariId: string;
  faturalar: FaturaRow[];
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Link
        to={`/invoicing/fatura/yeni?cari_id=${cariId}`}
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2.5 rounded-lg border border-dashed border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 min-h-tap-min"
      >
        <Plus className="h-4 w-4" />
        Yeni Fatura
      </Link>
      {faturalar.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">Fatura yok.</p>
      )}
      {faturalar.map((f) => (
        <Link
          key={f.id}
          to={`/invoicing/fatura/${f.id}`}
          className="block rounded-lg border border-border bg-card p-3 hover:bg-muted/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {f.fatura_no ?? 'Taslak'} • {f.tip === 'iade' ? 'İADE' : 'SATIŞ'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmtDate(f.tarih)}
                {f.vade_tarihi && <span className="ml-2">Vade: {fmtDate(f.vade_tarihi)}</span>}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  DURUM_STYLES[f.durum] ?? 'bg-gray-100 text-gray-700'
                }`}
              >
                {DURUM_LABELS[f.durum] ?? f.durum}
              </span>
              <span className="text-sm font-semibold">{formatTRY(Number(f.toplam))}</span>
              {Number(f.kalan) > 0 && (
                <span className="text-[11px] text-red-600">
                  Kalan: {formatTRY(Number(f.kalan))}
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

// ============================================================================
// Tab: Ödemeler
// ============================================================================
function OdemelerTab({
  cariId,
  odemeler,
}: {
  cariId: string;
  odemeler: OdemeRow[];
  faturalar: FaturaRow[];
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Link
        to={`/invoicing/odeme/yeni?cari_id=${cariId}`}
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2.5 rounded-lg border border-dashed border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 min-h-tap-min"
      >
        <Plus className="h-4 w-4" />
        Yeni Ödeme
      </Link>
      {odemeler.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">Ödeme yok.</p>
      )}
      {odemeler.map((o) => (
        <div key={o.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {YONTEM_LABELS[o.yontem] ?? o.yontem}
                {o.dekont_no && (
                  <span className="text-xs text-muted-foreground ml-2">#{o.dekont_no}</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmtDate(o.tarih)}
                {o.fatura_id && <span className="ml-2 text-primary">→ Fatura</span>}
              </p>
              {o.aciklama && (
                <p className="text-xs text-muted-foreground mt-1 truncate">{o.aciklama}</p>
              )}
            </div>
            <p className="text-sm font-semibold text-green-700">+{formatTRY(Number(o.tutar))}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Tab: Çek/Senet
// ============================================================================
function CekSenetTab({
  cariId,
  cekSenetler,
}: {
  cariId: string;
  cekSenetler: CekSenetRow[];
}): JSX.Element {
  return (
    <div className="space-y-2">
      <Link
        to={`/invoicing/cek-senet?cari_id=${cariId}`}
        className="flex items-center justify-center gap-1.5 w-full px-3 py-2.5 rounded-lg border border-dashed border-primary/40 text-primary text-sm font-medium hover:bg-primary/5 min-h-tap-min"
      >
        <Plus className="h-4 w-4" />
        Çek/Senet Listesi
      </Link>
      {cekSenetler.length === 0 && (
        <p className="text-center text-sm text-muted-foreground py-6">Çek/senet yok.</p>
      )}
      {cekSenetler.map((cs) => (
        <div key={cs.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {cs.tip.toUpperCase()} {cs.cek_no && <span>#{cs.cek_no}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {cs.banka ?? '—'} • Keşideci: {cs.kesideci}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Vade: {fmtDate(cs.vade_tarihi)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">
                {CEK_STATE_LABELS[cs.durum] ?? cs.durum}
              </span>
              <span className="text-sm font-semibold">{formatTRY(Number(cs.tutar))}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Tab: Ekstre
// ============================================================================
function EkstreTab({
  cari,
  faturalar,
  odemeler,
}: {
  cari: CariFull;
  faturalar: FaturaRow[];
  odemeler: OdemeRow[];
}): JSX.Element {
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);

  const rows = useMemo(() => {
    type Row = {
      tarih: string;
      tip: string;
      aciklama: string;
      borc: number;
      alacak: number;
    };
    const items: Row[] = [];

    for (const f of faturalar) {
      if (f.durum === 'iptal') continue;
      if (f.tarih < dateFrom || f.tarih > dateTo) continue;
      const tutar = Number(f.toplam);
      items.push({
        tarih: f.tarih,
        tip: f.tip === 'iade' ? 'İade Fatura' : 'Satış Fatura',
        aciklama: f.fatura_no ?? '(taslak)',
        borc: f.tip === 'iade' ? 0 : tutar,
        alacak: f.tip === 'iade' ? tutar : 0,
      });
    }
    for (const o of odemeler) {
      if (o.tarih < dateFrom || o.tarih > dateTo) continue;
      items.push({
        tarih: o.tarih,
        tip: YONTEM_LABELS[o.yontem] ?? o.yontem,
        aciklama: o.dekont_no ?? (o.aciklama ?? '—'),
        borc: 0,
        alacak: Number(o.tutar),
      });
    }
    items.sort((a, b) => a.tarih.localeCompare(b.tarih));

    let bakiye = Number(cari.acilis_bakiyesi ?? 0);
    return items.map((it) => {
      bakiye = bakiye + it.borc - it.alacak;
      return { ...it, bakiye: Math.round(bakiye * 100) / 100 };
    });
  }, [cari, faturalar, odemeler, dateFrom, dateTo]);

  function handleDownload(): void {
    const html = generateExtractPdfHtml(
      {
        cari_kodu: cari.cari_kodu,
        fatura_unvani: cari.fatura_unvani,
        vergi_no: cari.vergi_no,
      },
      dateFrom,
      dateTo,
      rows,
    );
    try {
      openInvoicePrintWindow(html);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'PDF açılamadı.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Başlangıç</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-border bg-card text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Bitiş</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full px-2 py-1.5 rounded-lg border border-border bg-card text-sm"
          />
        </div>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        className="w-full px-3 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center justify-center gap-1.5 min-h-tap-min"
      >
        <Download className="h-4 w-4" />
        PDF İndir
      </button>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-2 py-2">Tarih</th>
              <th className="text-left px-2 py-2">Tip</th>
              <th className="text-right px-2 py-2">Borç</th>
              <th className="text-right px-2 py-2">Alacak</th>
              <th className="text-right px-2 py-2">Bakiye</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-muted-foreground py-4">
                  Hareket yok.
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-2 py-1.5">{fmtDate(r.tarih)}</td>
                <td className="px-2 py-1.5">{r.tip}</td>
                <td className="px-2 py-1.5 text-right">
                  {r.borc > 0 ? formatTRY(r.borc) : '—'}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {r.alacak > 0 ? formatTRY(r.alacak) : '—'}
                </td>
                <td className="px-2 py-1.5 text-right font-medium">{formatTRY(r.bakiye)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// Tab: Bilgiler (edit form)
// ============================================================================
function BilgilerTab({ cari }: { cari: CariFull }): JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CariFull>(cari);

  const mutation = useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('saha_cariler')
        .update({
          fatura_unvani: form.fatura_unvani,
          vergi_no: form.vergi_no,
          vergi_dairesi: form.vergi_dairesi,
          fatura_adresi: form.fatura_adresi,
          il: form.il,
          ilce: form.ilce,
          iban: form.iban,
          banka_adi: form.banka_adi,
          odeme_vadesi_gun: form.odeme_vadesi_gun,
          kredi_limiti: form.kredi_limiti,
          durum: form.durum,
          notlar: form.notlar,
        })
        .eq('id', cari.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['cari-detail', cari.id] });
      void queryClient.invalidateQueries({ queryKey: ['cariler'] });
      setEditing(false);
    },
  });

  function field<K extends keyof CariFull>(key: K, label: string): JSX.Element {
    const val = form[key];
    return (
      <div>
        <label className="text-xs text-muted-foreground block mb-1">{label}</label>
        {editing ? (
          <input
            type="text"
            value={(val as string | null) ?? ''}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
          />
        ) : (
          <p className="text-sm">{(val as string | null) ?? '—'}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {editing ? (
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium flex items-center gap-1.5 min-h-tap-min disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            Kaydet
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-3 py-2 rounded-lg border border-border text-sm font-medium flex items-center gap-1.5 min-h-tap-min"
          >
            <Edit2 className="h-4 w-4" />
            Düzenle
          </button>
        )}
      </div>
      {field('fatura_unvani', 'Fatura Unvanı')}
      <div className="grid grid-cols-2 gap-3">
        {field('vergi_no', 'Vergi No')}
        {field('vergi_dairesi', 'Vergi Dairesi')}
      </div>
      {field('fatura_adresi', 'Fatura Adresi')}
      <div className="grid grid-cols-2 gap-3">
        {field('il', 'İl')}
        {field('ilce', 'İlçe')}
      </div>
      {field('iban', 'IBAN')}
      {field('banka_adi', 'Banka Adı')}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Ödeme Vadesi (gün)</label>
          {editing ? (
            <input
              type="number"
              value={form.odeme_vadesi_gun}
              onChange={(e) =>
                setForm({ ...form, odeme_vadesi_gun: Number(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
            />
          ) : (
            <p className="text-sm">{form.odeme_vadesi_gun} gün</p>
          )}
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Kredi Limiti</label>
          {editing ? (
            <input
              type="number"
              value={form.kredi_limiti}
              onChange={(e) =>
                setForm({ ...form, kredi_limiti: Number(e.target.value) || 0 })
              }
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
            />
          ) : (
            <p className="text-sm">{formatTRY(Number(form.kredi_limiti))}</p>
          )}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Durum</label>
        {editing ? (
          <select
            value={form.durum}
            onChange={(e) => setForm({ ...form, durum: e.target.value })}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
          >
            <option value="aktif">Aktif</option>
            <option value="pasif">Pasif</option>
            <option value="kara_liste">Kara Liste</option>
          </select>
        ) : (
          <p className="text-sm">{form.durum}</p>
        )}
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Notlar</label>
        {editing ? (
          <textarea
            value={form.notlar ?? ''}
            onChange={(e) => setForm({ ...form, notlar: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm"
          />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{form.notlar ?? '—'}</p>
        )}
      </div>
    </div>
  );
}

export default CariDetailPage;
