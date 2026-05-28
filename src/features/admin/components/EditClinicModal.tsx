/**
 * EditClinicModal — saha_clinics kaydı için manuel düzenleme modal'i.
 *
 * Sprint: 2 — Phase F (Manual Clinic Edit)
 *
 * Yetenekler:
 *  - Klinik adı / adres / telefon / mahalle / tip düzenlenebilir.
 *  - İl / İlçe / Koordinat read-only (manuel kayıt eklemek için ipucu link).
 *  - "Kaydet" → saha_clinics UPDATE + saha_clinic_edit_logs insert.
 *  - "Sil"   → confirm dialog → DELETE + audit log.
 *  - ESC ve overlay click ile kapanır; UsersPage.CreateUserModal pattern'i.
 *
 * RLS bağımlılığı:
 *  - 20260608000001_saha_clinics_edit_open.sql tüm authenticated için
 *    SELECT/INSERT/UPDATE/DELETE açar.
 *  - 20260608000002_saha_clinic_edit_logs.sql audit trail tablosu.
 *
 * UI dependencies: tailwind, lucide-react, sonner — yeni npm paketi yok.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Edit, Trash2, Save, X } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { logClinicEdit } from '@lib/clinicEditAudit';

// ─────────────────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────────────────

export interface SahaClinicRow {
  id: string;
  google_place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  province_slug: string | null;
  district_slug: string | null;
  vertical_key: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  sources: string[] | null;
  raw_payload: Record<string, unknown> | null;
}

export type ClinicType = 'private_clinic' | 'public_hospital' | 'polyclinic' | 'other';

interface Props {
  clinic: SahaClinicRow;
  open: boolean;
  onClose: () => void;
  onSaved?: (updated: SahaClinicRow) => void;
  onDeleted?: () => void;
}

const CLINIC_TYPE_OPTIONS: { value: ClinicType; label: string }[] = [
  { value: 'private_clinic', label: 'Özel Klinik' },
  { value: 'public_hospital', label: 'Devlet Hastanesi' },
  { value: 'polyclinic', label: 'Poliklinik' },
  { value: 'other', label: 'Diğer' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function readNeighborhood(raw: Record<string, unknown> | null): string {
  if (!raw) return '';
  const n = raw['neighborhood'];
  return typeof n === 'string' ? n : '';
}

function readClinicType(raw: Record<string, unknown> | null, sources: string[] | null): ClinicType {
  if (raw) {
    const t = raw['clinic_type'];
    if (t === 'private_clinic' || t === 'public_hospital' || t === 'polyclinic' || t === 'other') {
      return t;
    }
  }
  // Defensive — eski kayıtlarda sources içinde tutulmuş olabilir.
  if (sources?.includes('public_hospital')) return 'public_hospital';
  if (sources?.includes('polyclinic')) return 'polyclinic';
  return 'private_clinic';
}

/**
 * Audit log'a yazılacak before/after snapshot'ı. Konum/identifier alanlar
 * dahil; full row değil — kompakt tut.
 */
function pickAuditFields(row: SahaClinicRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    lat: row.lat,
    lng: row.lng,
    province_slug: row.province_slug,
    district_slug: row.district_slug,
    vertical_key: row.vertical_key,
    neighborhood: readNeighborhood(row.raw_payload),
    clinic_type: readClinicType(row.raw_payload, row.sources),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bileşen
// ─────────────────────────────────────────────────────────────────────────────

export default function EditClinicModal({
  clinic,
  open,
  onClose,
  onSaved,
  onDeleted,
}: Props): JSX.Element | null {
  // Form state — clinic prop değişince reset olsun.
  const [name, setName] = useState<string>(clinic.name);
  const [address, setAddress] = useState<string>(clinic.address ?? '');
  const [phone, setPhone] = useState<string>(clinic.phone ?? '');
  const [neighborhood, setNeighborhood] = useState<string>(readNeighborhood(clinic.raw_payload));
  const [clinicType, setClinicType] = useState<ClinicType>(
    readClinicType(clinic.raw_payload, clinic.sources),
  );

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // clinic prop değişirse form alanlarını yenile.
  useEffect(() => {
    setName(clinic.name);
    setAddress(clinic.address ?? '');
    setPhone(clinic.phone ?? '');
    setNeighborhood(readNeighborhood(clinic.raw_payload));
    setClinicType(readClinicType(clinic.raw_payload, clinic.sources));
    setConfirmDelete(false);
  }, [clinic]);

  // ESC ile kapat
  const handleClose = useCallback(() => {
    if (saving || deleting) return;
    onClose();
  }, [saving, deleting, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  const coordLabel = useMemo<string>(() => {
    return `${clinic.lat.toFixed(6)}, ${clinic.lng.toFixed(6)}`;
  }, [clinic.lat, clinic.lng]);

  if (!open) return null;

  // ───────────────────────────────────────────────────────────────────────
  // Save
  // ───────────────────────────────────────────────────────────────────────
  async function handleSave(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Klinik adı zorunlu');
      return;
    }

    setSaving(true);
    const supabase = getSupabaseClient();
    const before = pickAuditFields(clinic);

    // raw_payload'ı koru, neighborhood/clinic_type alanlarını güncelle.
    const existingRaw = isPlainObject(clinic.raw_payload) ? clinic.raw_payload : {};
    const nextRaw: Record<string, unknown> = {
      ...existingRaw,
      neighborhood: neighborhood.trim() || null,
      clinic_type: clinicType,
      edited_by_audit: true,
    };

    const updates = {
      name: trimmedName,
      address: address.trim() || null,
      phone: phone.trim() || null,
      raw_payload: nextRaw,
    };

    try {
      const { data, error } = await supabase
        .from('saha_clinics')
        .update(updates)
        .eq('id', clinic.id)
        .select(
          'id, google_place_id, name, address, phone, lat, lng, province_slug, district_slug, vertical_key, rating, user_ratings_total, sources, raw_payload',
        )
        .single();
      if (error) throw error;

      const updated = data as SahaClinicRow;
      await logClinicEdit({
        clinicId: clinic.id,
        action: 'update',
        before,
        after: pickAuditFields(updated),
      });

      toast.success('Kaydedildi');
      onSaved?.(updated);
      onClose();
    } catch (err) {
      toast.error(`Kaydedilemedi: ${(err as Error)?.message ?? 'bilinmeyen hata'}`);
    } finally {
      setSaving(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Delete
  // ───────────────────────────────────────────────────────────────────────
  async function handleDelete(): Promise<void> {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    const supabase = getSupabaseClient();
    const before = pickAuditFields(clinic);

    try {
      const { error } = await supabase.from('saha_clinics').delete().eq('id', clinic.id);
      if (error) throw error;

      // clinic FK ON DELETE SET NULL — clinicId null geçiyoruz.
      await logClinicEdit({
        clinicId: null,
        action: 'delete',
        before,
        after: null,
      });

      toast.success('Silindi');
      onDeleted?.();
      onClose();
    } catch (err) {
      toast.error(`Silinemedi: ${(err as Error)?.message ?? 'bilinmeyen hata'}`);
    } finally {
      setDeleting(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-clinic-title"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2
            id="edit-clinic-title"
            className="flex items-center gap-2 text-lg font-semibold text-slate-900"
          >
            <Edit className="h-4 w-4 text-emerald-600" />
            Klinik Düzenle
          </h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving || deleting}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            void handleSave(e);
          }}
          className="max-h-[75vh] space-y-3 overflow-y-auto px-5 py-4"
        >
          {/* Klinik adı */}
          <div>
            <label htmlFor="ec-name" className="mb-1 block text-xs font-medium text-slate-600">
              Klinik Adı <span className="text-rose-600">*</span>
            </label>
            <input
              id="ec-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving || deleting}
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          {/* Adres */}
          <div>
            <label htmlFor="ec-address" className="mb-1 block text-xs font-medium text-slate-600">
              Adres
            </label>
            <textarea
              id="ec-address"
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={saving || deleting}
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          {/* Telefon */}
          <div>
            <label htmlFor="ec-phone" className="mb-1 block text-xs font-medium text-slate-600">
              Telefon
            </label>
            <input
              id="ec-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving || deleting}
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          {/* Mahalle */}
          <div>
            <label
              htmlFor="ec-neighborhood"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Mahalle (opsiyonel)
            </label>
            <input
              id="ec-neighborhood"
              type="text"
              value={neighborhood}
              onChange={(e) => setNeighborhood(e.target.value)}
              disabled={saving || deleting}
              className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:bg-slate-50"
            />
          </div>

          {/* Tip */}
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">Tip</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {CLINIC_TYPE_OPTIONS.map((opt) => {
                const checked = clinicType === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                      checked
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                    } ${saving || deleting ? 'pointer-events-none opacity-60' : ''}`}
                  >
                    <input
                      type="radio"
                      name="ec-clinic-type"
                      value={opt.value}
                      checked={checked}
                      onChange={() => setClinicType(opt.value)}
                      disabled={saving || deleting}
                      className="h-3.5 w-3.5 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Read-only: il / ilçe */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">İl</span>
              <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-600">
                {clinic.province_slug ?? '—'}
              </div>
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-slate-600">İlçe</span>
              <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 text-sm text-slate-600">
                {clinic.district_slug ?? '—'}
              </div>
            </div>
          </div>

          {/* Read-only: koord */}
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Koordinat (read-only)
            </span>
            <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-2 font-mono text-xs text-slate-600">
              {coordLabel}
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              Konumu değiştirmek için bu kaydı silip{' '}
              <span className="underline decoration-dotted">manuel kayıt ekle</span> akışını kullan.
            </p>
          </div>

          {/* Aksiyonlar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3">
            <button
              type="button"
              onClick={() => {
                void handleDelete();
              }}
              disabled={saving || deleting}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                confirmDelete
                  ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700'
                  : 'border-rose-300 text-rose-700 hover:bg-rose-50'
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Siliniyor…' : confirmDelete ? 'Emin misin? Tekrar bas' : 'Sil'}
            </button>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving || deleting}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={saving || deleting}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
