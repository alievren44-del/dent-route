/**
 * CardSkeleton — Liste kartları için animate-pulse yükleme iskeleti.
 *
 * Props:
 *   count?    — kaç kart gösterilsin (varsayılan 3)
 *   className? — dış sarmalayıcıya eklenecek ek sınıflar
 */

interface CardSkeletonProps {
  count?: number;
  className?: string;
}

export function CardSkeleton({ count = 3, className }: CardSkeletonProps): JSX.Element {
  return (
    <div className={`space-y-3 ${className ?? ''}`} aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border bg-card p-4 shadow-sm animate-pulse"
        >
          {/* Üst satır: başlık + sağ rozet */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="h-4 w-2/5 rounded-md bg-muted" />
            <div className="h-5 w-16 rounded-full bg-muted" />
          </div>
          {/* Alt satır: iki bilgi bloğu */}
          <div className="flex items-center gap-3">
            <div className="h-3 w-1/4 rounded bg-muted/70" />
            <div className="h-3 w-1/3 rounded bg-muted/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default CardSkeleton;
