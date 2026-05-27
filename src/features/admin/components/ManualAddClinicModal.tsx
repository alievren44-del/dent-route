/**
 * ManualAddClinicModal — Admin manuel klinik ekleme modal'ı.
 *
 * Sprint: 2, PROMPT-30 (Phase E)
 *
 * Akış:
 *   1. Admin ad/adres/tip vs. girer
 *   2. "Adresten Çöz" → Mapbox geocoding → koord otomatik
 *   3. Haritaya tıklayarak / marker'ı sürükleyerek koord düzeltebilir
 *   4. Kaydet → saha_clinics upsert (google_place_id = "manual_<hash>")
 *   5. Audit log → saha_clinic_edit_logs (best effort)
 *
 * Notlar:
 *   - mapbox-gl direkt import; mount'ta accessToken set edilir
 *   - province/district slug'ları geo-helpers'tan türetilir (data tutarlılığı)
 *   - simpleHash → FNV-1a 32-bit, ad+adres'in deterministic kimliği
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { toast } from 'sonner';
import {
  Building2,
  MapPin,
  Phone,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';

import { getEnv } from '@config/env';
import { getSupabaseClient } from '@/lib/supabase';
import { mapboxGeocode } from '@/lib/mapboxGeocode';
import {
  getDistrictsByProvince,
  getProvinces,
  type District,
  type Province,
} from '@/data/tr-locations/geo-helpers';

type ClinicType = 'private_clinic' | 'state_hospital' | 'polyclinic' | 'other';

const CLINIC_TYPE_OPTIONS: { value: ClinicType; label: string }[] = [
  { value: 'private_clinic', label: 'Özel Klinik' },
  { value: 'state_hospital', label: 'Devlet Hastanesi' },
  { value: 'polyclinic', label: 'Poliklinik' },
  { value: 'other', label: 'Diğer' },
];

interface Coords {
  lat: number;
  lng: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill için: province/district seçili tab'tan gelebilir */
  initialProvinceSlug?: string;
  initialDistrictSlug?: string;
  initialLat?: number;
  initialLng?: number;
  /** Modal saha_clinics'e başarılı insert sonrası çağırır */
  onAdded?: (clinicId: string) => void;
}

/** FNV-1a 32-bit, deterministic stringle hash */
function simpleHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export default function ManualAddClinicModal(props: Props): JSX.Element | null {
  const {
    open,
    onClose,
    initialProvinceSlug,
    initialDistrictSlug,
    initialLat,
    initialLng,
    onAdded,
  } = props;

  // ─── Form state ───────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [clinicType, setClinicType] = useState<ClinicType>('private_clinic');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [provinceSlug, setProvinceSlug] = useState<string>(
    initialProvinceSlug ?? '',
  );
  const [districtSlug, setDistrictSlug] = useState<string>(
    initialDistrictSlug ?? '',
  );
  const [coords, setCoords] = useState<Coords | null>(
    typeof initialLat === 'number' && typeof initialLng === 'number'
      ? { lat: initialLat, lng: initialLng }
      : null,
  );
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeBanner, setGeocodeBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ─── Province / district list (memoized) ──────────────────────────────────
  const provinces = useMemo<Province[]>(() => getProvinces(), []);
  const selectedProvince = useMemo<Province | undefined>(
    () => provinces.find((p) => p.slug === provinceSlug),
    [provinces, provinceSlug],
  );
  const districts = useMemo<District[]>(
    () =>
      selectedProvince ? getDistrictsByProvince(selectedProvince.plaka) : [],
    [selectedProvince],
  );

  // İlk açılışta initial slug verildiyse province coord'a default merkezle
  // (coord null ve harita default merkezi için kullanılır)
  const initialMapCenter = useMemo<[number, number]>(() => {
    if (coords) return [coords.lng, coords.lat];
    if (selectedProvince) return [selectedProvince.lng, selectedProvince.lat];
    return [35.2, 39.0]; // Türkiye merkezi
  }, [coords, selectedProvince]);

  const initialMapZoom = useMemo<number>(() => {
    if (coords) return 15;
    if (selectedProvince) return 11;
    return 5;
  }, [coords, selectedProvince]);

  // ─── Mapbox map refs ──────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // Modal kapanırken state'i temizle
  useEffect(() => {
    if (!open) {
      setName('');
      setClinicType('private_clinic');
      setAddress('');
      setPhone('');
      setNeighborhood('');
      setProvinceSlug(initialProvinceSlug ?? '');
      setDistrictSlug(initialDistrictSlug ?? '');
      setCoords(
        typeof initialLat === 'number' && typeof initialLng === 'number'
          ? { lat: initialLat, lng: initialLng }
          : null,
      );
      setGeocoding(false);
      setGeocodeBanner(null);
      setSaving(false);
      setMapReady(false);
    }
    // Sadece open değişiminde reset
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ─── Map init / cleanup ───────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: initialMapCenter,
      zoom: initialMapZoom,
    });

    map.on('load', () => {
      setMapReady(true);
      map.resize();
    });

    // Tıkla → koord set
    map.on('click', (e) => {
      setCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    mapRef.current = map;

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainerRef.current);

    const t1 = setTimeout(() => map.resize(), 100);
    const t2 = setTimeout(() => map.resize(), 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Sadece open değişiminde map yeniden kurulur
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ─── coords değişiminde marker güncelle ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!coords) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    const lngLat: [number, number] = [coords.lng, coords.lat];

    if (!markerRef.current) {
      const marker = new mapboxgl.Marker({ color: '#10b981', draggable: true })
        .setLngLat(lngLat)
        .addTo(map);
      marker.on('dragend', () => {
        const ll = marker.getLngLat();
        setCoords({ lat: ll.lat, lng: ll.lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(lngLat);
    }

    map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 14), essential: true });
  }, [coords, mapReady]);

  // Province değişimi → district reset
  function handleProvinceChange(slug: string): void {
    setProvinceSlug(slug);
    setDistrictSlug('');
  }

  // ─── Adresten Çöz ─────────────────────────────────────────────────────────
  async function handleGeocode(): Promise<void> {
    if (!address.trim()) {
      toast.error('Önce adres gir');
      return;
    }
    setGeocoding(true);
    setGeocodeBanner(null);
    try {
      // İl seçiliyse adresi zenginleştir + proximity ver
      const provinceName = selectedProvince?.ad;
      const query = provinceName
        ? `${address.trim()}, ${provinceName}`
        : address.trim();
      const proximity: [number, number] | undefined = selectedProvince
        ? [selectedProvince.lng, selectedProvince.lat]
        : coords
          ? [coords.lng, coords.lat]
          : undefined;

      const results = await mapboxGeocode(
        query,
        proximity ? { proximity } : {},
      );
      const top = results[0];
      if (!top) {
        toast.error('Adres bulunamadı');
        setGeocodeBanner(null);
        return;
      }
      setCoords({ lat: top.lat, lng: top.lng });
      setGeocodeBanner(`Çözüldü: ${top.placeName}`);
      // Eğer mahalle boşsa Mapbox'tan gelen değerle doldur (kullanıcı override edebilir)
      if (!neighborhood && top.neighborhood) {
        setNeighborhood(top.neighborhood);
      }
    } catch (e) {
      toast.error(`Geocoding hatası: ${(e as Error).message}`);
    } finally {
      setGeocoding(false);
    }
  }

  // ─── Koord sıfırla ────────────────────────────────────────────────────────
  function handleResetCoord(): void {
    setCoords(null);
    setGeocodeBanner(null);
    if (mapRef.current && selectedProvince) {
      mapRef.current.flyTo({
        center: [selectedProvince.lng, selectedProvince.lat],
        zoom: 11,
        essential: true,
      });
    } else if (mapRef.current) {
      mapRef.current.flyTo({ center: [35.2, 39.0], zoom: 5, essential: true });
    }
  }

  // ─── Submit ───────────────────────────────────────────────────────────────
  async function handleSave(): Promise<void> {
    if (!name.trim() || !address.trim() || !coords) {
      toast.error('Ad, adres ve konum gerekli');
      return;
    }
    setSaving(true);
    try {
      const hash = simpleHash(`${name.trim()}|${address.trim()}`);
      const placeId = `manual_${hash}`;
      const nowIso = new Date().toISOString();
      const payload = {
        google_place_id: placeId,
        name: name.trim(),
        lat: coords.lat,
        lng: coords.lng,
        address: address.trim(),
        phone: phone.trim() || null,
        province_slug: provinceSlug || null,
        district_slug: districtSlug || null,
        vertical_key: 'dental',
        types: [clinicType],
        sources: ['manual'],
        last_seen_at: nowIso,
        last_verified_at: nowIso,
        raw_payload: {
          source: 'manual',
          neighborhood: neighborhood.trim() || null,
          clinic_type: clinicType,
          added_at: nowIso,
        },
      };

      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('saha_clinics')
        .upsert(payload, { onConflict: 'google_place_id' })
        .select()
        .single();

      if (error) throw error;
      const clinicId = (data as { id: string } | null)?.id;
      if (!clinicId) throw new Error('Insert sonrası id yok');

      // Audit log — best effort
      try {
        await supabase.from('saha_clinic_edit_logs').insert({
          clinic_id: clinicId,
          action: 'create_manual',
          after: payload,
        });
      } catch {
        /* yutulur */
      }

      toast.success('Klinik eklendi');
      onAdded?.(clinicId);
      onClose();
    } catch (e) {
      toast.error(`Eklenemedi: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const submitDisabled =
    saving ||
    !name.trim() ||
    !address.trim() ||
    !coords;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2 className="text-base font-semibold text-slate-900">
              Manuel Klinik Ekle
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Klinik adı */}
          <div>
            <label
              htmlFor="mac-name"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Klinik adı <span className="text-rose-500">*</span>
            </label>
            <input
              id="mac-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Örn. Dr. Ali Veli Diş Polikliniği"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Tip */}
          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Tip
            </span>
            <div className="flex flex-wrap gap-2">
              {CLINIC_TYPE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
                    clinicType === opt.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="mac-clinic-type"
                    value={opt.value}
                    checked={clinicType === opt.value}
                    onChange={() => setClinicType(opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Adres + Çöz */}
          <div>
            <label
              htmlFor="mac-address"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Adres <span className="text-rose-500">*</span>
            </label>
            <div className="flex gap-2">
              <textarea
                id="mac-address"
                required
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Örn. Battalgazi Eski Malatya Cad. No:5"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleGeocode()}
                disabled={geocoding || !address.trim()}
                className="inline-flex h-fit items-center gap-1.5 self-start rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {geocoding ? 'Çözülüyor…' : 'Adresten Çöz'}
              </button>
            </div>
            {geocodeBanner && (
              <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">
                {geocodeBanner}
              </div>
            )}
          </div>

          {/* Telefon + Mahalle */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="mac-phone"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                Telefon
              </label>
              <div className="relative">
                <Phone
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="mac-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+90 555 000 00 00"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 pl-9 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="mac-neighborhood"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                Mahalle
              </label>
              <input
                id="mac-neighborhood"
                type="text"
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {/* İl + İlçe */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="mac-province"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                İl
              </label>
              <select
                id="mac-province"
                value={provinceSlug}
                onChange={(e) => handleProvinceChange(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="">Seç…</option>
                {provinces.map((p) => (
                  <option key={p.plaka} value={p.slug}>
                    {p.ad}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="mac-district"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                İlçe
              </label>
              <select
                id="mac-district"
                value={districtSlug}
                onChange={(e) => setDistrictSlug(e.target.value)}
                disabled={!provinceSlug}
                className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                <option value="">Seç…</option>
                {districts.map((d) => (
                  <option key={d.slug} value={d.slug}>
                    {d.ad}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Harita */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">Konum</span>
              {!coords && (
                <span className="text-xs text-rose-500">
                  Adres çöz veya haritaya tıkla
                </span>
              )}
            </div>
            <div className="relative overflow-hidden rounded-md border border-slate-300">
              <div
                ref={mapContainerRef}
                className="w-full"
                style={{ height: '250px' }}
              />
              <button
                type="button"
                onClick={handleResetCoord}
                className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-slate-700 shadow hover:bg-white"
                title="Konumu sıfırla"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Sıfırla
              </button>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
              <MapPin className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {coords ? (
                <span>
                  {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)} — düzenlemek için haritaya tıkla
                </span>
              ) : (
                <span className="text-slate-400">Henüz konum seçilmedi</span>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
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
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}
