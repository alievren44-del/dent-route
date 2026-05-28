/**
 * VisitCard — Tek bir ziyaretin özet kart görünümü.
 *
 * Reusable. Hem VisitHistoryPage hem CustomerVisitTimeline tarafından kullanılır.
 * Props:
 *   - visit       : saha_visits satırı + opsiyonel account join + photos sayım/path
 *   - customerName: ayrı geçilebilir (timeline tek müşteri olduğu için)
 *   - onClick     : kart tıklaması (detay modal aç)
 */

import { Camera, CheckCircle2, User, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';

export interface VisitCardPhoto {
  id: string;
  storage_path: string;
  category: string;
}

export interface VisitCardData {
  id: string;
  account_id: string;
  check_in_at: string;
  check_out_at: string | null;
  status: 'in_progress' | 'completed' | 'cancelled';
  outcome: string | null;
  met_person: string | null;
  notes: string | null;
  photos?: VisitCardPhoto[];
  /** Foto'ları liste sorgusu yerine count olarak da geçilebilir. */
  photoCount?: number;
  /** Önizleme için public/signed URL listesi (max 3). */
  photoThumbUrls?: string[];
  /** account_id'ye karşılık gelen ad. */
  customerName?: string | null;
}

const NOTES_LIMIT = 100;

function outcomeChipClasses(color: string | undefined): string {
  switch ((color ?? '').toLowerCase()) {
    case 'green':
      return 'bg-green-100 text-green-800';
    case 'amber':
    case 'yellow':
      return 'bg-amber-100 text-amber-800';
    case 'red':
      return 'bg-red-100 text-red-800';
    case 'blue':
      return 'bg-blue-100 text-blue-800';
    case 'purple':
      return 'bg-purple-100 text-purple-800';
    case 'gray':
    case 'grey':
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

export interface OutcomeMeta {
  key: string;
  label: string;
  color?: string;
}

export interface VisitCardProps {
  visit: VisitCardData;
  outcomeMeta?: OutcomeMeta | undefined;
  onClick?: (() => void) | undefined;
}

function VisitCard({ visit, outcomeMeta, onClick }: VisitCardProps): JSX.Element {
  const checkIn = new Date(visit.check_in_at);
  const dateLabel = Number.isFinite(checkIn.getTime())
    ? format(checkIn, 'd MMM yyyy', { locale: tr })
    : '—';
  const timeLabel = Number.isFinite(checkIn.getTime()) ? format(checkIn, 'HH:mm') : '—';
  const truncatedNotes =
    visit.notes && visit.notes.length > NOTES_LIMIT
      ? `${visit.notes.slice(0, NOTES_LIMIT)}…`
      : visit.notes;

  const photoCount = visit.photos?.length ?? visit.photoCount ?? 0;
  const thumbs = visit.photoThumbUrls ?? [];

  const card = (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-sm hover:bg-muted/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" aria-hidden="true" />
            <span>{dateLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{timeLabel}</span>
            {visit.status === 'in_progress' && (
              <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-medium">
                Devam ediyor
              </span>
            )}
            {visit.status === 'completed' && (
              <CheckCircle2 className="h-3 w-3 text-green-600" aria-hidden="true" />
            )}
          </div>
          {visit.customerName && (
            <p className="text-sm font-semibold text-foreground mt-1 truncate">
              {visit.customerName}
            </p>
          )}
        </div>
        {outcomeMeta && (
          <span
            className={`text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0 ${outcomeChipClasses(
              outcomeMeta.color,
            )}`}
          >
            {outcomeMeta.label}
          </span>
        )}
      </div>

      {visit.met_person && (
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          <User className="h-3 w-3" aria-hidden="true" />
          <span className="truncate">{visit.met_person}</span>
        </p>
      )}

      {truncatedNotes && (
        <p className="text-xs text-foreground mt-2 line-clamp-2">
          {truncatedNotes}
          {visit.notes && visit.notes.length > NOTES_LIMIT && (
            <span className="text-primary font-medium ml-1">Devamı</span>
          )}
        </p>
      )}

      {photoCount > 0 && (
        <div className="mt-3 flex items-center gap-1.5">
          {thumbs.slice(0, 3).map((url, i) => (
            <div
              key={`${visit.id}-thumb-${i}`}
              className="w-12 h-12 rounded-lg overflow-hidden border border-border bg-muted shrink-0"
            >
              <img src={url} alt={`foto ${i + 1}`} className="w-full h-full object-cover" />
            </div>
          ))}
          {thumbs.length === 0 && (
            <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{photoCount} fotoğraf</span>
            </div>
          )}
          {photoCount > 3 && thumbs.length > 0 && (
            <span className="text-xs text-muted-foreground">+{photoCount - 3} foto</span>
          )}
        </div>
      )}
    </div>
  );

  if (!onClick) return card;

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left"
      aria-label={`Ziyaret detayı ${dateLabel}`}
    >
      {card}
    </button>
  );
}

export default VisitCard;
