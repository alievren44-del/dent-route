/**
 * InvoiceDetailPage — Fatura detay ekranı.
 *
 * URL: /invoicing/fatura/:id
 *
 * Aksiyonlar: PDF İndir / E-Fatura XML / Düzenle (taslak) / İptal
 */

import { useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileCode, Edit2, XCircle, Share2 } from 'lucide-react';
import { Share } from '@capacitor/share';

import { toast } from 'sonner';

import { getTypedClient } from '@lib/supabase';
import { loadSahaConfig } from '@config/loadConfig';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';
import { printInvoice, type PdfKalem } from '@features/invoicing/pdf/invoicePdf';
import { createEInvoiceProvider } from '@features/invoicing/efatura/factory';

interface InvoiceFull {
  id: string;
  fatura_no: string | null;
  cari_id: string;
  tip: string;
  tarih: string;
  vade_tarihi: string | null;
  ara_toplam: number;
  iskonto_toplam: number;
  kdv_tutari: number;
  toplam: number;
  odenen: number;
  kalan: number;
  para_birimi: string;
  durum: string;
  aciklama: string | null;
  created_at: string;
}

interface KalemRow {
  id: string;
  sira: number;
  urun_adi: string;
  birim: string;
  miktar: number;
  birim_fiyat: number;
  iskonto_orani: number;
  kdv_orani: number;
  net_tutar: number;
  kdv_tutari: number;
  satir_toplam: number;
}

interface CariFull {
  id: string;
  cari_kodu: string;
  fatura_unvani: string;
  vergi_no: string | null;
  vergi_dairesi: string | null;
  fatura_adresi: string | null;
  il: string | null;
  ilce: string | null;
}

const DURUM_STYLES: Record<string, string> = {
  taslak: 'bg-gray-100 text-gray-700',
  gonderildi: 'bg-blue-100 text-blue-700',
  kismi_odendi: 'bg-amber-100 text-amber-700',
  odendi: 'bg-green-100 text-green-700',
  gecikti: 'bg-red-100 text-red-700',
  iptal: 'bg-gray-200 text-gray-500',
};
const DURUM_LABELS: Record<string, string> = {
  taslak: 'Taslak',
  gonderildi: 'Gönderildi',
  kismi_odendi: 'Kısmi Ödendi',
  odendi: 'Ödendi',
  gecikti: 'Gecikti',
  iptal: 'İptal',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function InvoiceDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice', id],
    enabled: !!id,
    queryFn: async (): Promise<InvoiceFull | null> => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('saha_faturalar')
        .select('*')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as InvoiceFull | null;
    },
  });

  const { data: kalemler } = useQuery({
    queryKey: ['invoice-kalemler', id],
    enabled: !!id,
    queryFn: async (): Promise<KalemRow[]> => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('saha_fatura_kalemleri')
        .select('*')
        .eq('fatura_id', id!)
        .order('sira', { ascending: true });
      if (error) throw error;
      return (data ?? []) as KalemRow[];
    },
  });

  const { data: cari } = useQuery({
    queryKey: ['invoice-cari', invoice?.cari_id],
    enabled: !!invoice?.cari_id,
    queryFn: async (): Promise<CariFull | null> => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('saha_cariler')
        .select('id, cari_kodu, fatura_unvani, vergi_no, vergi_dairesi, fatura_adresi, il, ilce')
        .eq('id', invoice!.cari_id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CariFull | null;
    },
  });

  const ublMutation = useMutation({
    mutationFn: async () => {
      if (!invoice || !cari) throw new Error('Fatura veya cari yüklenmedi.');

      // Provider'ı config'e göre kur (default: ManualEInvoiceProvider).
      // Canlı entegratör (parasut/izibiz/...) için API anahtarı + mali mühür
      // gerekir — o adım BLOKE; manual lokal UBL XML üretir + indirir.
      const config = loadSahaConfig();
      const provider = createEInvoiceProvider(config.einvoice);

      const result = await provider.createInvoice({
        invoice: {
          id: invoice.id,
          fatura_no: invoice.fatura_no,
          tarih: invoice.tarih,
          vade_tarihi: invoice.vade_tarihi,
          tip: invoice.tip,
          ara_toplam: Number(invoice.ara_toplam),
          iskonto_toplam: Number(invoice.iskonto_toplam),
          kdv_tutari: Number(invoice.kdv_tutari),
          toplam: Number(invoice.toplam),
          para_birimi: invoice.para_birimi,
        },
        cari,
        kalemler: pdfKalemler,
      });

      // PERSIST: ETTN + durum saha_faturalar'a yazılır.
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('saha_faturalar')
        .update({ efatura_uuid: result.ettn, efatura_durum: result.status })
        .eq('id', invoice.id);
      if (error) throw error;

      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      const cariId = invoice?.cari_id;
      if (cariId) void queryClient.invalidateQueries({ queryKey: ['cari-faturalar', cariId] });
      toast.success('E-Fatura XML üretildi ve indirildi.');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'E-Fatura XML üretilemedi.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('saha_faturalar')
        .update({ durum: 'iptal' })
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoice', id] });
      const cariId = invoice?.cari_id;
      if (cariId) {
        void queryClient.invalidateQueries({ queryKey: ['cari-faturalar', cariId] });
        void queryClient.invalidateQueries({ queryKey: ['cari-odemeler', cariId] });
        void queryClient.invalidateQueries({ queryKey: ['cari-detail', cariId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['cariler-fatura-sums'] });
      void queryClient.invalidateQueries({ queryKey: ['cariler'] });
      // Previously orphaned: aging report never refreshed after cancel.
      // (CariBalanceCard is keyed by saha_clinics.id, not cari_id — it refreshes via refetchOnMount:'always'.)
      void queryClient.invalidateQueries({ queryKey: ['invoicing', 'aging'] });
    },
  });

  const pdfKalemler = useMemo<PdfKalem[]>(() => {
    return (kalemler ?? []).map((k) => ({
      sira: k.sira,
      urun_adi: k.urun_adi,
      birim: k.birim,
      miktar: Number(k.miktar),
      birim_fiyat: Number(k.birim_fiyat),
      iskonto_orani: Number(k.iskonto_orani),
      kdv_orani: Number(k.kdv_orani),
      net_tutar: Number(k.net_tutar),
      kdv_tutari: Number(k.kdv_tutari),
      satir_toplam: Number(k.satir_toplam),
    }));
  }, [kalemler]);

  function handlePrint(): void {
    if (!invoice || !cari) return;
    try {
      printInvoice(
        {
          fatura_no: invoice.fatura_no,
          tarih: invoice.tarih,
          vade_tarihi: invoice.vade_tarihi,
          tip: invoice.tip,
          ara_toplam: Number(invoice.ara_toplam),
          iskonto_toplam: Number(invoice.iskonto_toplam),
          kdv_tutari: Number(invoice.kdv_tutari),
          toplam: Number(invoice.toplam),
          para_birimi: invoice.para_birimi,
          aciklama: invoice.aciklama,
        },
        cari,
        pdfKalemler,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Yazdırma açılamadı.');
    }
  }

  async function handleShare(): Promise<void> {
    if (!invoice || !cari) return;
    const satirlar = pdfKalemler
      .map((k) => `• ${k.urun_adi} x${k.miktar} = ${formatTRY(Number(k.satir_toplam))}`)
      .join('\n');
    const text = [
      `Fatura: ${invoice.fatura_no ?? 'Taslak'}`,
      `Cari: ${cari.fatura_unvani}`,
      `Tarih: ${invoice.tarih}${invoice.vade_tarihi ? `  Vade: ${invoice.vade_tarihi}` : ''}`,
      '',
      satirlar,
      '',
      `Genel Toplam: ${formatTRY(Number(invoice.toplam))}`,
    ]
      .filter((l) => l !== undefined)
      .join('\n');
    try {
      await Share.share({
        title: `Fatura ${invoice.fatura_no ?? ''}`.trim(),
        text,
        dialogTitle: 'Faturayı Paylaş',
      });
    } catch (err) {
      // Native paylaşım yoksa/iptal → web share veya panoya kopyala fallback.
      try {
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ title: 'Fatura', text });
        } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          alert('Fatura özeti panoya kopyalandı.');
        }
      } catch {
        /* kullanıcı iptal etti — sessiz */
      }
    }
  }

  function handleUbl(): void {
    if (!invoice || !cari) return;
    ublMutation.mutate();
  }

  function handleCancel(): void {
    if (!confirm('Faturayı iptal etmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) return;
    cancelMutation.mutate();
  }

  if (!id) return <div className="p-6 text-center text-muted-foreground">Fatura ID yok.</div>;
  if (isLoading) return <div className="p-6 text-center text-muted-foreground">Yükleniyor…</div>;
  if (!invoice)
    return <div className="p-6 text-center text-muted-foreground">Fatura bulunamadı.</div>;

  const canEdit = invoice.durum === 'taslak';
  const canCancel = invoice.durum !== 'iptal' && invoice.durum !== 'odendi';

  return (
    <div className="flex flex-col min-h-full pb-24">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link
            to={`/invoicing/cari/${invoice.cari_id}`}
            aria-label="Geri"
            className="p-2 -ml-2 rounded-full hover:bg-muted min-h-tap-min min-w-tap-min flex items-center justify-center"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold truncate">
              {invoice.fatura_no ?? 'Taslak Fatura'}
            </h1>
            <p className="text-xs text-muted-foreground">{fmtDate(invoice.tarih)}</p>
          </div>
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              DURUM_STYLES[invoice.durum] ?? 'bg-gray-100 text-gray-700'
            }`}
          >
            {DURUM_LABELS[invoice.durum] ?? invoice.durum}
          </span>
        </div>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Cari info */}
        {cari && (
          <section className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">Cari</p>
            <p className="text-sm font-medium">{cari.fatura_unvani}</p>
            <p className="text-xs text-muted-foreground">{cari.cari_kodu}</p>
            {cari.vergi_no && (
              <p className="text-xs text-muted-foreground mt-1">VKN: {cari.vergi_no}</p>
            )}
            {cari.fatura_adresi && (
              <p className="text-xs text-muted-foreground mt-1">{cari.fatura_adresi}</p>
            )}
          </section>
        )}

        {/* Bilgi grid */}
        <section className="grid grid-cols-2 gap-2 text-sm">
          <Info label="Tip" value={invoice.tip === 'iade' ? 'İade' : 'Satış'} />
          <Info label="Vade" value={fmtDate(invoice.vade_tarihi)} />
          <Info label="Para Birimi" value={invoice.para_birimi} />
          <Info label="Açıklama" value={invoice.aciklama ?? '—'} />
        </section>

        {/* Kalemler */}
        <section>
          <h2 className="text-sm font-semibold mb-2">Kalemler ({(kalemler ?? []).length})</h2>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-2 py-2">Ürün</th>
                  <th className="text-right px-2 py-2">Miktar</th>
                  <th className="text-right px-2 py-2">B.Fiyat</th>
                  <th className="text-right px-2 py-2">Toplam</th>
                </tr>
              </thead>
              <tbody>
                {(kalemler ?? []).map((k) => (
                  <tr key={k.id} className="border-t border-border">
                    <td className="px-2 py-1.5">
                      <p className="font-medium">{k.urun_adi}</p>
                      <p className="text-[10px] text-muted-foreground">
                        İsk {(Number(k.iskonto_orani) * 100).toFixed(0)}% • KDV{' '}
                        {(Number(k.kdv_orani) * 100).toFixed(0)}%
                      </p>
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {Number(k.miktar).toLocaleString('tr-TR')} {k.birim}
                    </td>
                    <td className="px-2 py-1.5 text-right">{formatTRY(Number(k.birim_fiyat))}</td>
                    <td className="px-2 py-1.5 text-right font-medium">
                      {formatTRY(Number(k.satir_toplam))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Toplamlar */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-1.5">
          <Row label="Ara Toplam" value={formatTRY(Number(invoice.ara_toplam))} />
          {Number(invoice.iskonto_toplam) > 0 && (
            <Row label="İskonto" value={`-${formatTRY(Number(invoice.iskonto_toplam))}`} />
          )}
          <Row label="KDV" value={formatTRY(Number(invoice.kdv_tutari))} />
          <div className="border-t border-border pt-1.5 mt-1.5">
            <Row label="Toplam" value={formatTRY(Number(invoice.toplam))} bold />
          </div>
          {Number(invoice.odenen) > 0 && (
            <>
              <Row label="Ödenen" value={formatTRY(Number(invoice.odenen))} />
              <Row
                label="Kalan"
                value={formatTRY(Number(invoice.kalan))}
                emphasis={Number(invoice.kalan) > 0 ? 'red' : 'green'}
              />
            </>
          )}
        </section>

        {/* Aksiyonlar */}
        <section className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handlePrint}
            className="px-3 py-2.5 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-1.5 min-h-tap-min"
          >
            <Download className="h-4 w-4" />
            PDF İndir
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="px-3 py-2.5 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-1.5 min-h-tap-min"
          >
            <Share2 className="h-4 w-4" />
            Paylaş
          </button>
          <button
            type="button"
            onClick={handleUbl}
            disabled={ublMutation.isPending}
            className="px-3 py-2.5 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-1.5 min-h-tap-min disabled:opacity-50"
          >
            <FileCode className="h-4 w-4" />
            E-Fatura XML
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => navigate(`/invoicing/fatura/yeni?cari_id=${invoice.cari_id}`)}
              className="px-3 py-2.5 rounded-lg border border-border text-sm font-medium flex items-center justify-center gap-1.5 min-h-tap-min"
            >
              <Edit2 className="h-4 w-4" />
              Düzenle
            </button>
          )}
          {canCancel && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
              className="px-3 py-2.5 rounded-lg border border-red-300 text-red-600 text-sm font-medium flex items-center justify-center gap-1.5 min-h-tap-min disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              İptal Et
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium mt-0.5">{value}</p>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  emphasis,
}: {
  label: string;
  value: string;
  bold?: boolean;
  emphasis?: 'red' | 'green';
}): JSX.Element {
  const color = emphasis === 'red' ? 'text-red-600' : emphasis === 'green' ? 'text-green-600' : '';
  return (
    <div className="flex items-center justify-between text-sm">
      <span className={`${bold ? 'font-semibold' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`${bold ? 'text-lg font-bold text-primary' : `font-medium ${color}`}`}>
        {value}
      </span>
    </div>
  );
}

export default InvoiceDetailPage;
