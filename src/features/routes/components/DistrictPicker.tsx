/**
 * DistrictPicker — İl + ilçe combo seçici.
 * Provinces/districts JSON'lardan okur, slug değerleri ile callback verir.
 */

import { useMemo } from 'react';
import { getProvinces, getDistrictsByProvince } from '@/data/tr-locations/geo-helpers';

interface Props {
  provinceSlug: string;
  districtSlug: string;
  onChange: (province: string, district: string) => void;
}

export function DistrictPicker({ provinceSlug, districtSlug, onChange }: Props) {
  const provinces = useMemo(() => getProvinces(), []);
  const districts = useMemo(
    () => (provinceSlug ? getDistrictsByProvince(provinceSlug) : []),
    [provinceSlug],
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">İl</span>
        <select
          value={provinceSlug}
          onChange={(e) => onChange(e.target.value, '')}
          className="h-10 rounded-lg border border-slate-200 px-2 text-sm"
        >
          <option value="">Seç…</option>
          {provinces.map((p) => (
            <option key={p.slug} value={p.slug}>
              {p.ad}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-slate-600">İlçe</span>
        <select
          value={districtSlug}
          onChange={(e) => onChange(provinceSlug, e.target.value)}
          disabled={!provinceSlug}
          className="h-10 rounded-lg border border-slate-200 px-2 text-sm disabled:opacity-50"
        >
          <option value="">Seç…</option>
          {districts.map((d) => (
            <option key={d.slug} value={d.slug}>
              {d.ad}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
