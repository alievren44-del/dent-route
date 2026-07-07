/**
 * FieldAddClinicModal — Saha temsilcisi mevcut GPS konumuna yeni klinik ekler.
 *
 * Akış:
 *   1. Temsilci ad + telefon girer (GPS koordinatları read-only gösterilir).
 *   2. Kaydet → çevrimiçi kontrol → mapboxReverseGeocode(lat,lng).
 *   3. Reverse sonucundan province/district adı → slug (geo-helpers).
 *   4. saha_clinics INSERT (google_place_id = "manual_field_<fnv1a>").
 *   5. onCreated(newClinicId) → DiscoveryPage check-in'e yönlendirir.
 *
 * Kısıtlar:
 *   - ONLINE-ONLY (navigator.onLine kontrolü).
 *   - Harita yok; koordinatlar GPS'ten gelir, değiştirilemez.
 *   - Admin ManualAddClinicModal'dan bağımsız; ortak kod paylaşmaz.
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { Building2, MapPin, Phone, X } from 'lucide-react';

import { getTypedClient } from '@/lib/supabase';
import { mapboxReverseGeocode } from '@/lib/mapboxGeocode';
import { getProvince, getDistrict } from '@/data/tr-locations/geo-helpers';
import { enqueueOp } from '@/core/offline/syncQueue';

/** FNV-1a 32-bit — aynı name+lat+lng her zaman aynı hash → çift ekleme önlemi */
function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export interface FieldAddClinicModalProps {
  open: boolean;
  onClose: () => void;
  /** Gerçek GPS koordinatları — origin değil, position.lat/lng olmalı */
  lat: number;
  lng: number;
  /** Dikey (örn. 'dental') — saha_clinics.vertical_key */
  verticalKey: string;
  /** Başarılı INSERT sonrası yeni klinik id'si ile çağrılır */
  onCreated: (newClinicId: string) => void;
}

export default function FieldAddClinicModal({
  open,
  onClose,
  lat,
  lng,
  verticalKey,
  onCreated,
}: FieldAddClinicModalProps): JSX.Element | null {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  function handleClose(): void {
    if (saving) return;
    setName('');
    setPhone('');
    onClose();
  }

  async function handleSave(): Promise<void> {
    if (!name.trim()) {
      toast.error('Klinik adı gerekli');
      return;
    }

    const trimmedName = name.trim();
    // Stabil hash → aynı ad+koord çift eklenmez (upsert onConflict google_place_id)
    const hash = simpleHash(`${trimmedName}|${lat.toFixed(6)}|${lng.toFixed(6)}`);
    const placeId = `manual_field_${hash}`;
    const nowIso = new Date().toISOString();

    // #P9: Çevrimdışı → hard-block YERİNE kuyruğa al. Reverse-geocode ağ gerektirir
    // (offline çalışmaz) → il/ilçe null bırakılır; upsert objesi onConflict
    // google_place_id ile idempotent olduğundan replay güvenli. placeId idempotency
    // anahtarı = aynı klinik ikinci kez kuyruğa girmez.
    if (!navigator.onLine) {
      setSaving(true);
      try {
        await enqueueOp(
          'clinic.create',
          {
            google_place_id: placeId,
            name: trimmedName,
            lat,
            lng,
            phone: phone.trim() || null,
            vertical_key: verticalKey,
            sources: ['manual'],
            province_slug: null,
            district_slug: null,
            raw_payload: { source: 'manual_field', added_at: nowIso, reverse: null },
          },
          placeId,
        );
        toast.success('Çevrimdışı kaydedildi, bağlantıda gönderilecek');
        setName('');
        setPhone('');
        onClose();
      } catch (e) {
        toast.error(`Kaydedilemedi: ${(e as Error).message}`);
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      // Reverse geocode → province / district Türkçe adları
      const geo = await mapboxReverseGeocode(lat, lng);

      let provinceSlug: string | null = null;
      let districtSlug: string | null = null;

      if (geo?.province) {
        const prov = getProvince(geo.province);
        if (prov) {
          provinceSlug = prov.slug;
          if (geo.district) {
            const dist = getDistrict(geo.province, geo.district);
            if (dist) districtSlug = dist.slug;
          }
        }
      }

      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('saha_clinics')
        .upsert(
          {
            google_place_id: placeId,
            name: trimmedName,
            lat,
            lng,
            phone: phone.trim() || null,
            vertical_key: verticalKey,
            sources: ['manual'],
            province_slug: provinceSlug,
            district_slug: districtSlug,
            raw_payload: {
              source: 'manual_field',
              added_at: nowIso,
              reverse: geo?.placeName ?? null,
            },
          },
          { onConflict: 'google_place_id' },
        )
        .select('id')
        .single();

      if (error) throw error;
      const clinicId = (data as { id: string } | null)?.id;
      if (!clinicId) throw new Error('Insert sonrası id alınamadı');

      toast.success('Klinik eklendi');
      setName('');
      setPhone('');
      // DiscoveryPage onCreated'dan navigate + modal kapat yapılır
      onCreated(clinicId);
    } catch (e) {
      toast.error(`Eklenemedi: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const submitDisabled = saving || !name.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">Bu Konuma Klinik Ekle</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* GPS koordinatları — read-only bilgi */}
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              GPS:{' '}
              <span className="font-mono">
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </span>
            </span>
          </div>

          {/* Klinik adı */}
          <div>
            <label htmlFor="fac-name" className="mb-1 block text-xs font-medium text-slate-600">
              Klinik adı <span className="text-rose-500">*</span>
            </label>
            <input
              id="fac-name"
              type="text"
              required
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !submitDisabled) void handleSave();
              }}
              placeholder="Örn. Dr. Ayşe Kaya Diş Kliniği"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Telefon */}
          <div>
            <label htmlFor="fac-phone" className="mb-1 block text-xs font-medium text-slate-600">
              Telefon <span className="font-normal text-slate-400">(isteğe bağlı)</span>
            </label>
            <div className="relative">
              <Phone
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                aria-hidden="true"
              />
              <input
                id="fac-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+90 555 000 00 00"
                className="w-full rounded-md border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            İl/ilçe bilgisi GPS konumundan otomatik belirlenir.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={submitDisabled}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? 'Ekleniyor…' : 'Klinik Ekle'}
          </button>
        </div>
      </div>
    </div>
  );
}
