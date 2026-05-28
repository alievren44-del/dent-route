/**
 * ProvinceCard — Yakındaki il kartı.
 * Props: il bilgisi + mesafe + klinik sayısı (DB).
 */

import { MapPin, Building2, ChevronRight } from 'lucide-react';

interface Props {
  name: string;
  distanceKm: number;
  clinicCount: number;
  nufus: number;
  bolge: string;
  onClick: () => void;
}

export function ProvinceCard({ name, distanceKm, clinicCount, nufus, bolge, onClick }: Props) {
  const distanceLabel = distanceKm < 1 ? '<1 km' : `${distanceKm.toFixed(1)} km`;
  const nufusLabel =
    nufus >= 1_000_000
      ? `${(nufus / 1_000_000).toFixed(1)}M`
      : nufus >= 1_000
        ? `${Math.round(nufus / 1_000)}k`
        : `${nufus}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition hover:bg-muted"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MapPin className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{name}</h3>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {bolge}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{distanceLabel}</span>
          <span className="inline-flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            {clinicCount} klinik
          </span>
          <span>nüfus {nufusLabel}</span>
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
