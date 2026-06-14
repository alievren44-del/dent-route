/**
 * RouteCard — Tek rota seçeneği kartı.
 *
 * Header: renk barı + isim (Önerilen / Alternatif X) + via şehir chip
 * Body: km / dk / klinik sayısı / delta (önerilene göre)
 * Footer: "Detay" buton → klinik listesi sayfası
 */

import { ChevronRight, MapPin } from 'lucide-react';

export interface RouteCardProps {
  index: number;
  isSelected: boolean;
  color: string;
  km: number;
  durationMin: number;
  clinicCount: number;
  /** Önerilene göre delta (1. değilse görünür) */
  deltaKm?: number;
  deltaMin?: number;
  /** Via şehir ismi (varsa) */
  viaCity?: string | null;
  provider: 'mapbox' | 'google';
  onSelect: () => void;
  onDetail: () => void;
}

export function RouteCard({
  index,
  isSelected,
  color,
  km,
  durationMin,
  clinicCount,
  deltaKm,
  deltaMin,
  viaCity,
  provider,
  onSelect,
  onDetail,
}: RouteCardProps) {
  const label = index === 0 ? 'Önerilen' : `Alternatif ${index}`;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${label} rotasını seç`}
      className={`rounded-xl border p-3 transition cursor-pointer ${
        isSelected
          ? 'border-blue-600 bg-white shadow-md ring-2 ring-blue-200'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-block h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: color }}
          />
          <span className="text-xs font-semibold text-slate-700">{label}</span>
          {provider === 'google' && (
            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-semibold text-orange-700">
              Google
            </span>
          )}
        </div>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
          {clinicCount} klinik
        </span>
      </div>

      {viaCity && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
          <MapPin size={10} /> {viaCity} üzerinden
        </div>
      )}

      <div className="mt-2 flex items-baseline gap-3">
        <span className="text-lg font-bold text-slate-800">{durationMin} dk</span>
        <span className="text-sm text-slate-600">{km.toFixed(1)} km</span>
      </div>

      {index > 0 && deltaMin !== undefined && deltaKm !== undefined && (
        <div className="mt-1 text-[11px] text-slate-500">
          {deltaMin >= 0 ? '+' : ''}
          {deltaMin} dk / {deltaKm >= 0 ? '+' : ''}
          {deltaKm.toFixed(1)} km
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDetail();
        }}
        className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
      >
        Klinikleri detaylı gör <ChevronRight size={12} />
      </button>
    </div>
  );
}
