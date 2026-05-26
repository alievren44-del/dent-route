import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Search, MapPin, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { getProvinces, getDistrictsByProvince } from '@/data/tr-locations/geo-helpers';
import { getSupabaseClient } from '@lib/supabase';

const TYPE_OPTIONS = [
  { key: 'dentist', label: 'Diş Hekimi' },
  { key: 'doctor', label: 'Doktor' },
  { key: 'hospital', label: 'Hastane' },
];

interface ScanResult {
  status: string;
  scanned: number;
  new: number;
  updated: number;
  errors?: string[];
}

async function callScan(input: {
  lat: number;
  lng: number;
  radiusM: number;
  provinceSlug: string;
  districtSlug?: string;
  types: string[];
}): Promise<ScanResult> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke('clinic-scan', { body: input });
  if (error) throw error;
  return data as ScanResult;
}

async function fetchScanStats() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_clinics')
    .select('province_slug, district_slug, last_verified_at')
    .order('last_verified_at', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (error) throw error;
  const byKey = new Map<string, { province: string; district: string | null; count: number; lastVerified: string | null }>();
  for (const row of (data ?? []) as Array<{ province_slug: string | null; district_slug: string | null; last_verified_at: string | null }>) {
    const key = `${row.province_slug ?? '-'}|${row.district_slug ?? '-'}`;
    const ex = byKey.get(key);
    if (ex) {
      ex.count++;
      if (row.last_verified_at && (!ex.lastVerified || row.last_verified_at > ex.lastVerified)) {
        ex.lastVerified = row.last_verified_at;
      }
    } else {
      byKey.set(key, {
        province: row.province_slug ?? '',
        district: row.district_slug,
        count: 1,
        lastVerified: row.last_verified_at,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.count - a.count);
}

export default function ClinicScanPage() {
  const [provinceSlug, setProvinceSlug] = useState<string>('');
  const [districtSlug, setDistrictSlug] = useState<string>('');
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set(['dentist']));
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);

  const provinces = getProvinces();
  const selectedProvince = provinceSlug ? provinces.find((p) => p.slug === provinceSlug) : undefined;
  const districts = selectedProvince ? getDistrictsByProvince(selectedProvince.plaka) : [];
  const selectedDistrict = districtSlug ? districts.find((d) => d.slug === districtSlug) : undefined;

  const statsQuery = useQuery({ queryKey: ['clinic-scan-stats'], queryFn: fetchScanStats });

  const scanMutation = useMutation({
    mutationFn: callScan,
    onSuccess: (data) => {
      setLastResult(data);
      void statsQuery.refetch();
    },
    onError: (err: unknown) => {
      setLastResult({ status: 'error', scanned: 0, new: 0, updated: 0, errors: [err instanceof Error ? err.message : String(err)] });
    },
  });

  const canScan = !!selectedProvince && selectedTypes.size > 0 && !scanMutation.isPending;

  const handleScan = () => {
    if (!selectedProvince) return;
    const target = selectedDistrict ?? selectedProvince;
    scanMutation.mutate({
      lat: target.lat,
      lng: target.lng,
      radiusM: radiusKm * 1000,
      provinceSlug: selectedProvince.slug,
      ...(selectedDistrict ? { districtSlug: selectedDistrict.slug } : {}),
      types: Array.from(selectedTypes),
    });
  };

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold flex items-center gap-2">
        <Search className="h-6 w-6" />
        Klinik Tarama
      </h1>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        <strong>Öncelikli iller:</strong> Malatya, Mardin, Sivas — bu illeri ilk tarayın.
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">İl</label>
          <select
            value={provinceSlug}
            onChange={(e) => { setProvinceSlug(e.target.value); setDistrictSlug(''); }}
            className="w-full h-11 rounded-lg border border-border bg-background px-3"
          >
            <option value="">İl seç...</option>
            {provinces.map((p) => (
              <option key={p.slug} value={p.slug}>{p.ad} ({p.bolge})</option>
            ))}
          </select>
        </div>

        {selectedProvince && (
          <div>
            <label className="text-sm font-medium block mb-1">İlçe (opsiyonel)</label>
            <select
              value={districtSlug}
              onChange={(e) => setDistrictSlug(e.target.value)}
              className="w-full h-11 rounded-lg border border-border bg-background px-3"
            >
              <option value="">Tüm il (merkez)</option>
              {districts.map((d) => (
                <option key={d.slug} value={d.slug}>{d.ad}</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="text-sm font-medium block mb-1">Yarıçap: {radiusKm}km</label>
          <input type="range" min={1} max={50} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} className="w-full" />
        </div>

        <div>
          <label className="text-sm font-medium block mb-2">Tip</label>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((t) => {
              const checked = selectedTypes.has(t.key);
              return (
                <label key={t.key} className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border cursor-pointer ${checked ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selectedTypes);
                      if (checked) next.delete(t.key); else next.add(t.key);
                      setSelectedTypes(next);
                    }}
                    className="sr-only"
                  />
                  <span className="text-sm">{t.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={handleScan}
          disabled={!canScan}
          className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50"
        >
          {scanMutation.isPending ? (
            <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Taranıyor...</span>
          ) : (
            'Tarama Başlat'
          )}
        </button>
      </div>

      {lastResult && (
        <div className={`rounded-xl border p-4 ${lastResult.status === 'ok' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
          {lastResult.status === 'ok' ? (
            <div className="flex items-start gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-700 mt-0.5" />
              <div className="text-sm">
                <strong>Tarama tamam</strong>
                <ul className="mt-1 space-y-0.5">
                  <li>Toplam: <strong>{lastResult.scanned}</strong> klinik bulundu</li>
                  <li>Yeni: <strong className="text-green-700">{lastResult.new}</strong></li>
                  <li>Güncellendi: <strong>{lastResult.updated}</strong></li>
                </ul>
                {lastResult.errors && lastResult.errors.length > 0 && (
                  <p className="mt-2 text-amber-700">Uyarılar: {lastResult.errors.join(', ')}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2">
              <AlertCircle className="h-5 w-5 text-red-700 mt-0.5" />
              <div className="text-sm text-red-800">
                <strong>Hata:</strong> {lastResult.errors?.join(', ') ?? 'unknown'}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold mt-4 mb-2 flex items-center gap-1"><MapPin className="h-5 w-5" /> Mevcut Veritabanı</h2>
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr><th className="text-left p-2">İl</th><th className="text-left p-2">İlçe</th><th className="text-right p-2">Klinik</th><th className="text-left p-2">Son Tarama</th></tr>
            </thead>
            <tbody>
              {(statsQuery.data ?? []).slice(0, 50).map((row) => (
                <tr key={`${row.province}|${row.district ?? '-'}`} className="border-t border-border">
                  <td className="p-2">{row.province}</td>
                  <td className="p-2">{row.district ?? '—'}</td>
                  <td className="text-right p-2 font-medium">{row.count}</td>
                  <td className="p-2 text-muted-foreground text-xs">{row.lastVerified ? new Date(row.lastVerified).toLocaleString('tr-TR') : '—'}</td>
                </tr>
              ))}
              {(!statsQuery.data || statsQuery.data.length === 0) && (
                <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Henüz tarama yok</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
