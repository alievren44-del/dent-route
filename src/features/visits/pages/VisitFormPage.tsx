/**
 * VisitFormPage — Ziyaret formu (check-in sonrası check-out + detay).
 *
 * URL: /visits/:id   ( :id = visit_id )
 *
 * Bölümler (sırayla, sticky alt buton):
 *  1. Header: müşteri adı, check-in saati, elapsed timer (30sn'de bir güncellenir).
 *  2. Görüşülen kişi (text input).
 *  3. Outcome chips (vertical-aware — yoksa dental fallback).
 *  4. Notes (textarea).
 *  5. Photos (multi-upload, client-side resize, kategori dropdown).
 *  6. Custom fields (vertical.customFields.visit varsa).
 *  7. Sonraki ziyaret tarihi (HTML date, opsiyonel).
 *  8. Sticky bottom: "Check-out + Kaydet".
 *
 * Submit:
 *  - resize edilmiş foto'ları visit-photos bucket'ına {visitId}/{uuid}.jpg yolu ile yükler
 *  - saha_visit_photos satırlarını ekler
 *  - saha_visits update: check_out_at, status='completed', outcome, met_person, notes, ...
 *  - Outcome'a göre yönlendirme:
 *      order_taken → /orders/new?customerId=...
 *      sample_given/sample_left → /samples?customerId=...
 *      diğer → /history
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CalendarClock,
  Camera,
  CheckCircle2,
  Clock,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { syncReminderNotifications } from '@lib/localReminders';
import { useVertical } from '@core/verticals/useVertical';
import { resizeImage, extensionFor } from '@lib/imageResize';
import type { CustomField, VisitOutcomeOption } from '@core/verticals/types';
import { enqueueOp } from '@core/offline/syncQueue';

interface VisitRow {
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
}

interface AccountRow {
  id: string;
  klinik_adi: string | null;
  ad_soyad: string | null;
  email: string | null;
  city: string | null;
}

type PhotoCategory = 'storefront' | 'shelf' | 'price_tag' | 'other';

interface PendingPhoto {
  uid: string;
  blob: Blob;
  previewUrl: string;
  category: PhotoCategory;
  originalName: string;
}

const PHOTO_CATEGORY_OPTIONS: { value: PhotoCategory; label: string }[] = [
  { value: 'storefront', label: 'Vitrin' },
  { value: 'shelf', label: 'Raf' },
  { value: 'price_tag', label: 'Etiket' },
  { value: 'other', label: 'Diğer' },
];

// Fallback outcome set (dental temalı, plan PROMPT-9 spec)
const FALLBACK_OUTCOMES: VisitOutcomeOption[] = [
  { key: 'met', label: 'Görüşüldü', color: 'green' },
  { key: 'callback', label: 'Tekrar Aranacak', color: 'amber' },
  { key: 'no_meeting', label: 'Görüşülemedi', color: 'red' },
  { key: 'order_taken', label: 'Sipariş Alındı', color: 'blue', requiresOrder: true },
  { key: 'sample_given', label: 'Numune Verildi', color: 'purple' },
];

function outcomeColorClasses(color: string | undefined, selected: boolean): string {
  const base = 'border';
  if (!selected) {
    return `${base} bg-background border-border text-foreground hover:bg-muted`;
  }
  switch ((color ?? '').toLowerCase()) {
    case 'green':
      return `${base} bg-green-600 border-green-700 text-white`;
    case 'amber':
    case 'yellow':
      return `${base} bg-amber-500 border-amber-600 text-white`;
    case 'red':
      return `${base} bg-red-600 border-red-700 text-white`;
    case 'blue':
      return `${base} bg-blue-600 border-blue-700 text-white`;
    case 'purple':
      return `${base} bg-purple-600 border-purple-700 text-white`;
    case 'gray':
    case 'grey':
    default:
      return `${base} bg-gray-600 border-gray-700 text-white`;
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

function VisitFormPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const vertical = useVertical();
  const supabase = getTypedClient();
  const queryClient = useQueryClient();

  const customerLabel = vertical.labels.customer.singular;
  const outcomes: VisitOutcomeOption[] =
    vertical.visitOutcomes && vertical.visitOutcomes.length > 0
      ? vertical.visitOutcomes
      : FALLBACK_OUTCOMES;
  const visitCustomFields: CustomField[] = vertical.customFields?.visit ?? [];

  // ---- Visit + Account query
  const visitQuery = useQuery({
    queryKey: ['visit', id],
    enabled: Boolean(id),
    queryFn: async (): Promise<VisitRow | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('saha_visits')
        .select(
          'id, account_id, rep_id, check_in_at, check_out_at, status, outcome, met_person, notes, custom_fields, next_visit_date',
        )
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as VisitRow | null;
    },
  });

  const visit = visitQuery.data ?? null;
  const accountId = visit?.account_id ?? null;

  const accountQuery = useQuery({
    queryKey: ['visit-account', accountId],
    enabled: Boolean(accountId),
    queryFn: async (): Promise<AccountRow | null> => {
      if (!accountId) return null;

      // #58 fix: Rota check-in'leri saha_clinics ID yazıyor; eski kod sadece
      // profiles sorguladığı için klinik adı boş kalıp 'Klinik' fallback'e
      // düşüyordu. CheckInPage iki-pass deseni: önce saha_clinics (modern),
      // bulunamazsa profiles (DOCTOR / Parla mevcut müşterileri) fallback.

      // 1) saha_clinics — modern akış (Discovery / rota sepeti clinic id yazar).
      const clinicRes = await supabase
        .from('saha_clinics')
        .select('id, name, address, province_slug')
        .eq('id', accountId)
        .maybeSingle();
      if (clinicRes.data) {
        const c = clinicRes.data as {
          id: string;
          name: string;
          address: string | null;
          province_slug: string | null;
        };
        return {
          id: c.id,
          klinik_adi: c.name,
          ad_soyad: null,
          email: null,
          city: c.province_slug ?? c.address,
        };
      }

      // 2) profiles fallback (eski akış / DOCTOR rolü).
      const { data, error } = await supabase
        .from('profiles')
        .select('id, klinik_adi, ad_soyad, email, city')
        .eq('id', accountId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AccountRow | null;
    },
  });
  const account = accountQuery.data;
  const accountName = account?.klinik_adi ?? account?.ad_soyad ?? account?.email ?? customerLabel;

  // ---- Form state
  const [metPerson, setMetPerson] = useState<string>('');
  const [outcome, setOutcome] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [nextVisitDate, setNextVisitDate] = useState<string>('');
  // Hekimden alınan randevu (tarih-saat) + not — takvime 'appointment' hatırlatması yazar.
  const [apptAt, setApptAt] = useState<string>('');
  const [apptNote, setApptNote] = useState<string>('');
  const [processingFile, setProcessingFile] = useState<boolean>(false);

  // Initialize once when visit loads
  const initRef = useRef<string | null>(null);
  useEffect(() => {
    if (!visit) return;
    if (initRef.current === visit.id) return;
    initRef.current = visit.id;
    setMetPerson(visit.met_person ?? '');
    setOutcome(visit.outcome ?? '');
    setNotes(visit.notes ?? '');
    setNextVisitDate(visit.next_visit_date ?? '');
    if (visit.custom_fields) {
      const init: Record<string, string> = {};
      for (const [k, v] of Object.entries(visit.custom_fields)) {
        init[k] = v == null ? '' : String(v);
      }
      setCustomValues(init);
    }
  }, [visit]);

  // ---- Elapsed timer (30s tick)
  const [, forceTick] = useState<number>(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const elapsedLabel = useMemo<string>(() => {
    if (!visit?.check_in_at) return '—';
    try {
      return formatDistanceToNow(new Date(visit.check_in_at), {
        addSuffix: false,
        locale: tr,
      });
    } catch {
      return '—';
    }
  }, [visit?.check_in_at]);

  // ---- Photo cleanup on unmount
  useEffect(() => {
    return () => {
      for (const p of photos) {
        URL.revokeObjectURL(p.previewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setProcessingFile(true);
    const next: PendingPhoto[] = [];
    try {
      for (const file of Array.from(files)) {
        try {
          const blob = await resizeImage(file, {
            maxDimension: 1600,
            quality: 0.8,
            mimeType: 'image/jpeg',
          });
          const previewUrl = URL.createObjectURL(blob);
          next.push({
            uid: randomId(),
            blob,
            previewUrl,
            category: 'other',
            originalName: file.name,
          });
        } catch (err) {
          console.warn('Resize hatası, orijinal kullanılacak:', err);
          const previewUrl = URL.createObjectURL(file);
          next.push({
            uid: randomId(),
            blob: file,
            previewUrl,
            category: 'other',
            originalName: file.name,
          });
        }
      }
    } finally {
      setProcessingFile(false);
      // input reset (aynı dosyayı tekrar seçebilmek için)
      e.target.value = '';
    }
    setPhotos((prev) => [...prev, ...next]);
  }

  function updatePhotoCategory(uid: string, category: PhotoCategory): void {
    setPhotos((prev) => prev.map((p) => (p.uid === uid ? { ...p, category } : p)));
  }

  function removePhoto(uid: string): void {
    setPhotos((prev) => {
      const target = prev.find((p) => p.uid === uid);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.uid !== uid);
    });
  }

  function updateCustomValue(key: string, value: string): void {
    setCustomValues((prev) => ({ ...prev, [key]: value }));
  }

  // ---- Submit
  const [submitting, setSubmitting] = useState<boolean>(false);

  const canSubmit = Boolean(
    !submitting && visit && visit.status === 'in_progress' && outcome.length > 0,
  );

  async function handleSubmit(): Promise<void> {
    if (!visit || !id) return;
    if (!canSubmit) {
      toast.error('Sonuç seçin.');
      return;
    }

    // Required custom fields kontrolü
    for (const f of visitCustomFields) {
      if (f.required && !(customValues[f.key] ?? '').trim()) {
        toast.error(`${f.label} alanı zorunlu.`);
        return;
      }
    }

    setSubmitting(true);

    // custom_fields type-aware dönüştürme (paylaşılan mantık)
    const customPayload: Record<string, unknown> = {};
    for (const f of visitCustomFields) {
      const raw = customValues[f.key];
      if (raw == null || raw === '') continue;
      if (f.type === 'number') {
        const n = Number(raw);
        if (!Number.isNaN(n)) customPayload[f.key] = n;
      } else if (f.type === 'boolean') {
        customPayload[f.key] = raw === 'true';
      } else {
        customPayload[f.key] = raw;
      }
    }

    const updatePayload: Record<string, unknown> = {
      check_out_at: new Date().toISOString(),
      status: 'completed',
      outcome,
      met_person: metPerson.trim() || null,
      notes: notes.trim() || null,
      custom_fields: customPayload,
      next_visit_date: nextVisitDate || null,
    };

    // Outcome-based navigation helper (aşağıda iki yerde kullanılır)
    const doNavigate = () => {
      // Ziyaret geçmişi + takvim cache'ini tazele — yeni/güncel ziyaret hemen görünsün.
      // (Aksi halde "Bugün" sekmesi save öncesi boş cache'i gösteriyordu.)
      void queryClient.invalidateQueries({ queryKey: ['visit-history'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      // Yeni hatırlatma(lar) için yerel bildirimleri yeniden zamanla (aksiyon butonlu).
      void syncReminderNotifications();
      const opt = outcomes.find((o) => o.key === outcome);
      if (opt?.requiresOrder || outcome === 'order_taken') {
        navigate(`/orders/new?customerId=${visit.account_id}`, { replace: true });
      } else if (outcome === 'sample_given' || outcome === 'sample_left') {
        navigate(`/samples?customerId=${visit.account_id}`, { replace: true });
      } else {
        navigate('/history', { replace: true });
      }
    };

    // Takvim hatırlatması insert — tekrar ziyaret tarihi ve/veya hekim randevusu.
    const upsertReminders = async (): Promise<void> => {
      if (!visit) return;
      const rows: Record<string, unknown>[] = [];
      // Tekrar ziyaret: plasiyer tarih girdiyse onu kullan; girmediyse otomatik +1 ay.
      // (Her ziyaret edilen klinik 1 ay sonra "ziyaret edileli 1 ay oldu" hatırlatması alır.)
      const revisitDue = nextVisitDate
        ? new Date(`${nextVisitDate}T09:00:00`)
        : (() => {
            const d = new Date();
            d.setMonth(d.getMonth() + 1);
            d.setHours(9, 0, 0, 0);
            return d;
          })();
      rows.push({
        rep_id: visit.rep_id,
        account_id: visit.account_id,
        visit_id: id,
        created_by: visit.rep_id,
        type: 'revisit',
        title: `Tekrar ziyaret — ${accountName}`,
        note: notes.trim() || (nextVisitDate ? null : '1 ay önce ziyaret edildi'),
        due_at: revisitDue.toISOString(),
        status: 'open',
      });
      if (apptAt) {
        const due = new Date(apptAt);
        if (!Number.isNaN(due.getTime())) {
          rows.push({
            rep_id: visit.rep_id,
            account_id: visit.account_id,
            visit_id: id,
            created_by: visit.rep_id,
            type: 'appointment',
            title: `Randevu — ${accountName}`,
            note: apptNote.trim() || null,
            due_at: due.toISOString(),
            status: 'open',
          });
        }
      }
      if (rows.length === 0) return;
      try {
        // saha_reminders generated tiplerde yok → untyped client.
        const sb = getSupabaseClient();
        const { error } = await sb.from('saha_reminders').insert(rows);
        if (error) console.warn('Hatırlatma kaydedilemedi:', error);
      } catch (e) {
        console.warn('Hatırlatma insert hatası:', e);
      }
    };

    // Fotoğraflar: sadece çevrim içiyken upload denenebilir.
    // Offline ise fotoğraf atlanır (blob LocalStorage'e sığmaz); key bilgisi kuyruğa eklenmez.
    const attemptPhotoUpload = async (): Promise<void> => {
      if (!navigator.onLine || photos.length === 0) return;
      const uploaded: { storage_path: string; category: PhotoCategory }[] = [];
      for (const photo of photos) {
        const ext = extensionFor(photo.blob.type || 'image/jpeg');
        const path = `${id}/${randomId()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('visit-photos')
          .upload(path, photo.blob, {
            contentType: photo.blob.type || 'image/jpeg',
            upsert: false,
          });
        if (upErr) {
          console.warn('Foto upload hatası', upErr);
          continue;
        }
        uploaded.push({ storage_path: path, category: photo.category });
      }
      if (uploaded.length > 0) {
        const photoRows = uploaded.map((u) => ({
          visit_id: id,
          storage_path: u.storage_path,
          category: u.category,
        }));
        const { error: photoErr } = await supabase.from('saha_visit_photos').insert(photoRows);
        if (photoErr) {
          console.warn('Foto satır insert hatası', photoErr);
        }
      }
    };

    // Çevrim dışıysa doğrudan kuyruğa al (fotoğraf upload atlanır).
    if (!navigator.onLine) {
      try {
        if (photos.length > 0) {
          toast.warning('Çevrim dışısınız — fotoğraflar senkronize edilmeyecek, diğer alanlar kaydedildi.');
        }
        await enqueueOp('visit.update', { id, ...updatePayload });
        toast.success('Ziyaret kaydedildi — bağlantı geldiğinde senkronize edilecek');
        doNavigate();
      } catch {
        toast.error('Ziyaret çevrim dışı kuyruğa eklenemedi.');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Çevrim içi: normal akış dene, başarısız olursa kuyruğa al.
    try {
      await attemptPhotoUpload();

      const { error: updErr } = await supabase
        .from('saha_visits')
        .update(updatePayload as never)
        .eq('id', id);
      if (updErr) throw updErr;

      // Takvim hatırlatmaları — tekrar ziyaret + hekim randevusu (best-effort, ziyareti bloklamaz).
      await upsertReminders();

      toast.success('Ziyaret kaydedildi');
      doNavigate();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        !navigator.onLine;
      if (isNetworkError) {
        try {
          await enqueueOp('visit.update', { id, ...updatePayload });
          toast.success('Bağlantı hatası — ziyaret kaydedildi, bağlantı geldiğinde gönderilecek');
          doNavigate();
          return;
        } catch {
          toast.error('Ziyaret çevrim dışı kuyruğa eklenemedi.');
          return;
        }
      }
      toast.error(msg || 'Ziyaret kaydedilirken hata oluştu.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!id) {
    return <div className="p-6 text-center text-muted-foreground">Ziyaret ID bulunamadı.</div>;
  }

  if (visitQuery.isLoading) {
    return (
      <div className="p-6 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Yükleniyor…
      </div>
    );
  }

  if (!visit) {
    return <div className="p-6 text-center text-muted-foreground">Ziyaret bulunamadı.</div>;
  }

  const alreadyCompleted = visit.status === 'completed';

  return (
    <div className="flex flex-col min-h-full pb-28">
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
            <h1 className="text-lg font-semibold text-foreground truncate">{accountName}</h1>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>Check-in: {formatTime(visit.check_in_at)}</span>
              <span aria-hidden="true">·</span>
              <span>{elapsedLabel}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-4 space-y-5">
        {alreadyCompleted && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Bu ziyaret zaten tamamlanmış. Yine de güncelleyebilirsiniz.
          </div>
        )}

        {/* 1. Görüşülen kişi */}
        <section className="space-y-2">
          <label htmlFor="met-person" className="text-sm font-medium text-foreground">
            Görüşülen Kişi
          </label>
          <input
            id="met-person"
            type="text"
            value={metPerson}
            onChange={(e) => setMetPerson(e.target.value)}
            placeholder="Örn: Dr. Ayşe Yılmaz"
            className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
          />
        </section>

        {/* 2. Outcome chips */}
        <section className="space-y-2" aria-labelledby="outcome-heading">
          <div id="outcome-heading" className="text-sm font-medium text-foreground">
            Sonuç <span className="text-red-600">*</span>
          </div>
          <div className="flex flex-col gap-2">
            {outcomes.map((o) => {
              const selected = outcome === o.key;
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => setOutcome(o.key)}
                  className={`w-full text-left px-4 h-12 min-h-tap-min rounded-xl text-sm font-medium ${outcomeColorClasses(
                    o.color,
                    selected,
                  )}`}
                >
                  <div className="flex items-center justify-between">
                    <span>{o.label}</span>
                    {selected && <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 3. Notes */}
        <section className="space-y-2">
          <label htmlFor="visit-notes" className="text-sm font-medium text-foreground">
            Notlar
          </label>
          <textarea
            id="visit-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Ziyaret notları, geri bildirim, sonraki adımlar…"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-base"
          />
        </section>

        {/* 4. Photos */}
        <section className="space-y-2" aria-labelledby="photos-heading">
          <div id="photos-heading" className="text-sm font-medium text-foreground">
            Fotoğraflar
          </div>
          <label className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background h-12 min-h-tap-min cursor-pointer">
            {processingFile ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                <span className="text-sm">İşleniyor…</span>
              </>
            ) : (
              <>
                <Camera className="h-5 w-5" aria-hidden="true" />
                <span className="text-sm">Fotoğraf ekle</span>
              </>
            )}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                void handlePhotoChange(e);
              }}
            />
          </label>
          {photos.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {photos.map((p) => (
                <div
                  key={p.uid}
                  className="rounded-xl border border-border bg-card overflow-hidden flex flex-col"
                >
                  <div className="relative aspect-square bg-muted">
                    <img
                      src={p.previewUrl}
                      alt={p.originalName}
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePhoto(p.uid)}
                      className="absolute top-1 right-1 inline-flex items-center justify-center rounded-full bg-background/90 h-8 w-8"
                      aria-label="Fotoğrafı kaldır"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <select
                    value={p.category}
                    onChange={(e) => updatePhotoCategory(p.uid, e.target.value as PhotoCategory)}
                    className="border-t border-border bg-background h-11 min-h-tap-min text-sm px-2"
                  >
                    {PHOTO_CATEGORY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. Custom fields */}
        {visitCustomFields.length > 0 && (
          <section className="space-y-2" aria-labelledby="extra-heading">
            <div id="extra-heading" className="text-sm font-medium text-foreground">
              Ek Bilgiler
            </div>
            <div className="space-y-3">
              {visitCustomFields.map((f) => (
                <div key={f.key} className="space-y-1">
                  <label htmlFor={`cf-${f.key}`} className="text-xs text-muted-foreground">
                    {f.label}
                    {f.required && <span className="text-red-600 ml-1">*</span>}
                  </label>
                  {f.type === 'number' ? (
                    <input
                      id={`cf-${f.key}`}
                      type="number"
                      inputMode="decimal"
                      value={customValues[f.key] ?? ''}
                      onChange={(e) => updateCustomValue(f.key, e.target.value)}
                      placeholder={f.placeholder ?? ''}
                      className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
                    />
                  ) : (
                    <input
                      id={`cf-${f.key}`}
                      type="text"
                      value={customValues[f.key] ?? ''}
                      onChange={(e) => updateCustomValue(f.key, e.target.value)}
                      placeholder={f.placeholder ?? ''}
                      className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
                    />
                  )}
                  {f.helperText && (
                    <p className="text-[11px] text-muted-foreground">{f.helperText}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 6. Tekrar ziyaret + Hekim randevusu → takvime hatırlatma yazar */}
        <section className="space-y-3 rounded-2xl border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden="true" />
            Hatırlatma / Randevu
          </div>

          <div className="space-y-1.5">
            <label htmlFor="next-visit" className="text-xs text-muted-foreground">
              Tekrar Ziyaret Tarihi
            </label>
            <input
              id="next-visit"
              type="date"
              value={nextVisitDate}
              onChange={(e) => setNextVisitDate(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="appt-at" className="text-xs text-muted-foreground">
              Hekimden Randevu (tarih + saat)
            </label>
            <input
              id="appt-at"
              type="datetime-local"
              value={apptAt}
              onChange={(e) => setApptAt(e.target.value)}
              className="w-full rounded-xl border border-border bg-background px-3 h-12 min-h-tap-min text-base"
            />
            {apptAt && (
              <input
                type="text"
                value={apptNote}
                onChange={(e) => setApptNote(e.target.value)}
                maxLength={200}
                placeholder="Randevu notu (opsiyonel)"
                className="w-full rounded-xl border border-border bg-background px-3 h-11 min-h-tap-min text-sm"
              />
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Girilen tarihler plasiyer takvimine otomatik eklenir.
          </p>
        </section>

        {/* Foto sayısı + temizle */}
        {photos.length > 0 && (
          <button
            type="button"
            onClick={() => {
              for (const p of photos) URL.revokeObjectURL(p.previewUrl);
              setPhotos([]);
            }}
            className="inline-flex items-center gap-1.5 text-xs text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Tüm fotoğrafları temizle ({photos.length})
          </button>
        )}
      </div>

      {/* Sticky save */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur px-4 py-3 safe-area-inset">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground font-semibold h-14 min-h-tap-min text-base disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Kaydediliyor…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
              Check-out + Kaydet
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default VisitFormPage;
