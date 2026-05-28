/**
 * AddressSearchInput — Dual-source autosuggest:
 *   1. DB klinik adı arama (saha_clinics, "Denthaus Diş Kliniği" gibi işletme)
 *   2. Mapbox Geocoding adres arama (cadde/mahalle/landmark)
 * Sonuçlar birleştirilir, klinikler önde gösterilir.
 */

import { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, X, Building2 } from 'lucide-react';
import { mapboxGeocode, type GeocodeResult } from '@/lib/mapboxGeocode';
import { getSupabaseClient } from '@/lib/supabase';

interface ClinicResult {
  kind: 'clinic';
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  clinic_segment: 'private' | 'kamu';
}

interface AddressResult {
  kind: 'address';
  result: GeocodeResult;
}

type SearchResult = ClinicResult | AddressResult;

interface Props {
  placeholder: string;
  value: GeocodeResult | null;
  onChange: (v: GeocodeResult | null) => void;
  proximity?: { lat: number; lng: number };
}

async function searchClinics(query: string): Promise<ClinicResult[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_clinics')
    .select('name, lat, lng, address, clinic_segment')
    .eq('status', 'active')
    .ilike('name', `%${query.trim()}%`)
    .limit(6);
  if (error || !Array.isArray(data)) return [];
  return data.map(
    (c: {
      name: unknown;
      lat: unknown;
      lng: unknown;
      address: string | null;
      clinic_segment: unknown;
    }) => ({
      kind: 'clinic' as const,
      name: String(c.name),
      lat: Number(c.lat),
      lng: Number(c.lng),
      address: c.address ?? null,
      clinic_segment: c.clinic_segment === 'kamu' ? 'kamu' : 'private',
    }),
  );
}

export function AddressSearchInput({ placeholder, value, onChange, proximity }: Props) {
  const [text, setText] = useState(value?.placeName ?? '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    setText(value?.placeName ?? '');
  }, [value]);

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (!text || text.trim().length < 3 || (value && value.placeName === text)) {
      setResults([]);
      return;
    }
    debounce.current = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          // Paralel: DB klinik + Mapbox adres
          const [clinics, addresses] = await Promise.all([
            searchClinics(text),
            mapboxGeocode(text, {
              proximity: proximity ? [proximity.lng, proximity.lat] : undefined,
            }).catch(() => [] as GeocodeResult[]),
          ]);
          const combined: SearchResult[] = [
            ...clinics,
            ...addresses.slice(0, 4).map((a) => ({ kind: 'address' as const, result: a })),
          ];
          setResults(combined);
          setOpen(true);
        } catch {
          setResults([]);
        } finally {
          setLoading(false);
        }
      })();
    }, 350);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [text, proximity, value]);

  function selectResult(r: SearchResult) {
    if (r.kind === 'clinic') {
      const gr: GeocodeResult = {
        placeName: r.address ? `${r.name} — ${r.address}` : r.name,
        lat: r.lat,
        lng: r.lng,
        center: [r.lng, r.lat],
        relevance: 1,
      } as GeocodeResult;
      onChange(gr);
      setText(gr.placeName);
    } else {
      onChange(r.result);
      setText(r.result.placeName);
    }
    setOpen(false);
  }

  return (
    <div className="relative">
      <div className="flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2">
        <MapPin size={14} className="shrink-0 text-slate-400" />
        <input
          type="text"
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setText('');
              setResults([]);
            }}
            aria-label="Temizle"
          >
            <X size={14} className="text-slate-400" />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-11 z-10 max-h-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {results.map((r, i) => {
            if (r.kind === 'clinic') {
              return (
                <li key={`clinic-${r.name}-${i}`}>
                  <button
                    type="button"
                    onClick={() => selectResult(r)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50"
                  >
                    <Building2 size={14} className="mt-0.5 shrink-0 text-blue-600" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.name}</span>
                        <span
                          className={`shrink-0 rounded px-1 text-[9px] ${
                            r.clinic_segment === 'kamu'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {r.clinic_segment === 'kamu' ? 'KAMU' : 'Özel'}
                        </span>
                      </div>
                      {r.address && (
                        <div className="truncate text-[11px] text-slate-500">{r.address}</div>
                      )}
                    </div>
                  </button>
                </li>
              );
            }
            const a = r.result;
            return (
              <li key={`addr-${a.placeName}-${i}`}>
                <button
                  type="button"
                  onClick={() => selectResult(r)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{a.placeName}</div>
                    {a.district && (
                      <div className="text-[11px] text-slate-500">
                        {a.district}
                        {a.province ? ` · ${a.province}` : ''}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
