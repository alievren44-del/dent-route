/**
 * ClinicCard — Discovery listesinde gösterilen müşteri adayı kartı.
 *
 * Hem yeni keşfedilen (Google Places vb.) hem de mevcut (saha DB) kayıtları
 * gösterebilir. Vertical-aware: badge ve etiketlerde aktif vertical'ın
 * `labels.customer.singular` değeri kullanılır.
 */

import { Phone, MessageCircle, MapPin, Star, Plus, ChevronRight } from 'lucide-react';
import { useVertical } from '@core/verticals/useVertical';

export interface ClinicCardProps {
  name: string;
  address?: string;
  phone?: string;
  whatsapp?: string;
  distanceM?: number;
  rating?: number;
  isExistingCustomer?: boolean;
  onAdd?: () => void;
  onOpenDetail?: () => void;
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

function waLink(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `https://wa.me/90${digits}`;
  if (digits.length >= 10) return `https://wa.me/${digits}`;
  return null;
}

function ClinicCard({
  name,
  address,
  phone,
  whatsapp,
  distanceM,
  rating,
  isExistingCustomer = false,
  onAdd,
  onOpenDetail,
}: ClinicCardProps): JSX.Element {
  const vertical = useVertical();
  const customerLabel = vertical.labels.customer.singular;

  const waPhoneSource = phone ?? whatsapp;
  const waHref = waLink(waPhoneSource);
  const hasPhone = Boolean(phone);
  const showAdd = !isExistingCustomer && typeof onAdd === 'function';

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      {/* Top row: name + existing badge */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-lg leading-tight">{name}</h3>
        {isExistingCustomer && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 whitespace-nowrap">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
            {`Kayıtlı ${customerLabel}`}
          </span>
        )}
      </div>

      {/* Address */}
      {address && (
        <div className="mt-2 flex items-start gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="break-words">{address}</span>
        </div>
      )}

      {/* Distance + rating */}
      {(typeof distanceM === 'number' || typeof rating === 'number') && (
        <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
          {typeof distanceM === 'number' && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
              {formatDistance(distanceM)}
            </span>
          )}
          {typeof rating === 'number' && (
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
              {rating.toFixed(1)}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        {hasPhone ? (
          <a
            href={`tel:${phone}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 min-h-tap-min h-11 text-sm font-medium hover:bg-muted"
            aria-label="Ara"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            Ara
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 min-h-tap-min h-11 text-sm font-medium opacity-50 cursor-not-allowed"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            Ara
          </button>
        )}

        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 min-h-tap-min h-11 text-sm font-medium hover:bg-muted"
            aria-label="WhatsApp"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            WhatsApp
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-3 min-h-tap-min h-11 text-sm font-medium opacity-50 cursor-not-allowed"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            WhatsApp
          </button>
        )}

        {showAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="ml-auto inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 min-h-tap-min h-11 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Ekle
          </button>
        )}
      </div>

      {/* Detail row */}
      {onOpenDetail && (
        <button
          type="button"
          onClick={onOpenDetail}
          className="mt-3 -mx-4 -mb-4 flex w-[calc(100%+2rem)] items-center justify-between border-t border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted rounded-b-2xl"
        >
          <span>Detayı Gör</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export default ClinicCard;
