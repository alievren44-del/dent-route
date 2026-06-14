/**
 * CustomerFilters — Müşteri listesi filtre paneli.
 *
 * Collapsible panel. Controlled component: dışarıdan `value` + `onChange`
 * alır. İl/ilçe için TR locations datasını kullanır.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  getProvinces,
  getDistrictsByProvince,
  type District,
  type Province,
} from '@/data/tr-locations/geo-helpers';
import type { CustomerTypeOption } from '@core/verticals/types';

export type CustomerStatusFilter = 'all' | 'visited' | 'not_visited' | 'hot' | 'cold' | 'due';

export interface CustomerFiltersValue {
  types: string[];
  province: string;
  district: string;
  status: CustomerStatusFilter;
  minReviewCount: number;
  lastVisitFrom: string;
  lastVisitTo: string;
  assignedRepId: string;
  hasBalance: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components
export const DEFAULT_CUSTOMER_FILTERS: CustomerFiltersValue = {
  types: [],
  province: '',
  district: '',
  status: 'all',
  minReviewCount: 0,
  lastVisitFrom: '',
  lastVisitTo: '',
  assignedRepId: '',
  hasBalance: false,
};

export interface RepOption {
  id: string;
  label: string;
}

export interface CustomerFiltersProps {
  value: CustomerFiltersValue;
  onChange: (next: CustomerFiltersValue) => void;
  customerTypes: CustomerTypeOption[];
  /** Admin/manager için rep listesi. Boş array geçilirse "Atanan Rep" filtresi gizlenir. */
  reps?: RepOption[];
  /** Cari modülü var mı — yoksa hasBalance toggle'ı gizlenir. */
  enableHasBalance?: boolean;
  /** Tüm filtreleri sıfırla butonu. */
  onClear?: () => void;
}

const STATUS_OPTIONS: { value: CustomerStatusFilter; label: string }[] = [
  { value: 'all', label: 'Hepsi' },
  { value: 'visited', label: 'Ziyaret edildi' },
  { value: 'not_visited', label: 'Ziyaret edilmedi' },
  { value: 'hot', label: 'Sıcak' },
  { value: 'cold', label: 'Soğuk' },
  { value: 'due', label: 'Vadesi geldi' },
];

function CustomerFilters({
  value,
  onChange,
  customerTypes,
  reps,
  enableHasBalance = false,
  onClear,
}: CustomerFiltersProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  const provinces = useMemo<Province[]>(() => getProvinces(), []);
  const districts = useMemo<District[]>(
    () => (value.province ? getDistrictsByProvince(value.province) : []),
    [value.province],
  );

  const activeCount = countActive(value);

  function patch(p: Partial<CustomerFiltersValue>): void {
    onChange({ ...value, ...p });
  }

  function toggleType(key: string): void {
    const next = value.types.includes(key)
      ? value.types.filter((t) => t !== key)
      : [...value.types, key];
    patch({ types: next });
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-sm font-medium text-foreground min-h-tap-min"
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          Filtreler
          {activeCount > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
              {activeCount}
            </span>
          )}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div className="space-y-4 border-t border-border px-3 py-3 text-sm">
          {/* Customer types */}
          {customerTypes.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Müşteri Tipi
              </label>
              <div className="flex flex-wrap gap-1.5">
                {customerTypes.map((t) => {
                  const active = value.types.includes(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => toggleType(t.key)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background text-foreground hover:bg-muted'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Province + District */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="filter-province"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                İl
              </label>
              <select
                id="filter-province"
                value={value.province}
                onChange={(e) => patch({ province: e.target.value, district: '' })}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Hepsi</option>
                {provinces.map((p) => (
                  <option key={p.plaka} value={p.ad}>
                    {p.ad}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="filter-district"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                İlçe
              </label>
              <select
                id="filter-district"
                value={value.district}
                onChange={(e) => patch({ district: e.target.value })}
                disabled={!value.province}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
              >
                <option value="">Hepsi</option>
                {districts.map((d) => (
                  <option key={d.slug} value={d.ad}>
                    {d.ad}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Status */}
          <div>
            <label
              htmlFor="filter-status"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Durum
            </label>
            <select
              id="filter-status"
              value={value.status}
              onChange={(e) => patch({ status: e.target.value as CustomerStatusFilter })}
              className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Min review count */}
          <div>
            <label
              htmlFor="filter-reviews"
              className="mb-1 block text-xs font-medium text-muted-foreground"
            >
              Min Değerlendirme:{' '}
              <span className="font-semibold text-foreground">{value.minReviewCount}</span>
            </label>
            <input
              id="filter-reviews"
              type="range"
              min={0}
              max={500}
              step={10}
              value={value.minReviewCount}
              onChange={(e) => patch({ minReviewCount: Number(e.target.value) })}
              className="w-full"
            />
          </div>

          {/* Last visit date range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor="filter-visit-from"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Son Ziyaret (Başl.)
              </label>
              <input
                id="filter-visit-from"
                type="date"
                value={value.lastVisitFrom}
                onChange={(e) => patch({ lastVisitFrom: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label
                htmlFor="filter-visit-to"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Son Ziyaret (Bit.)
              </label>
              <input
                id="filter-visit-to"
                type="date"
                value={value.lastVisitTo}
                onChange={(e) => patch({ lastVisitTo: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Assigned rep (admin/manager only) */}
          {reps && reps.length > 0 && (
            <div>
              <label
                htmlFor="filter-rep"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                Atanan Rep
              </label>
              <select
                id="filter-rep"
                value={value.assignedRepId}
                onChange={(e) => patch({ assignedRepId: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm focus:border-primary focus:outline-none"
              >
                <option value="">Hepsi</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* has_balance */}
          {enableHasBalance && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={value.hasBalance}
                onChange={(e) => patch({ hasBalance: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm text-foreground">Sadece bakiyesi olanlar</span>
            </label>
          )}

          {/* Clear */}
          {onClear && activeCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Filtreleri temizle
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function countActive(v: CustomerFiltersValue): number {
  let n = 0;
  if (v.types.length > 0) n++;
  if (v.province) n++;
  if (v.district) n++;
  if (v.status !== 'all') n++;
  if (v.minReviewCount > 0) n++;
  if (v.lastVisitFrom) n++;
  if (v.lastVisitTo) n++;
  if (v.assignedRepId) n++;
  if (v.hasBalance) n++;
  return n;
}

export default CustomerFilters;
