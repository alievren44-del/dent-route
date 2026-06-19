/**
 * ReminderDetailSheet.tsx — FAZ F
 *
 * Takvimde randevu kartına tıklanınca açılan detay + tamamlama bottom-sheet.
 * Saf sunum: DB/RLS yok, tüm yan etkiler parent callback'ler üzerinden döner.
 *
 * Export kontratı W-cal bileşeninin beklediği imzaya göre sabitlenmiştir.
 * outcomeColorClasses: VisitFormPage.tsx:97-119 paterninden kopyalanmıştır.
 */

import { useState } from 'react';
import {
  X,
  Phone,
  MessageCircle,
  Clock,
  RotateCcw,
  MapPin,
  CheckCircle2,
  CalendarPlus,
  Link2,
  CornerDownRight,
} from 'lucide-react';
import type { ReminderAttachment } from '@lib/reminderAttachments';

// ---------------------------------------------------------------------------
// Public types (W-cal bu tipleri import eder)
// ---------------------------------------------------------------------------

export interface ReminderDetailItem {
  id: string;
  kind: 'reminder' | 'visit';
  type:
    | 'revisit'
    | 'appointment'
    | 'tahsilat'
    | 'tanitim'
    | 'task'
    | 'note'
    | 'malzeme_teslim'
    | 'no_order_alert'
    | 'visit';
  title: string;
  note: string | null;
  at: string; // ISO
  accountId: string | null;
  status?: 'open' | 'done' | 'cancelled';
  assignedBy?: string | null;
  outcome?: string | null;
  completionNote?: string | null;
  sourceRef?: string | null;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface OutcomeOption {
  key: string;
  label: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<ReminderDetailItem['type'], string> = {
  appointment: 'Randevu',
  malzeme_teslim: 'Malzeme Teslimi',
  no_order_alert: 'Pasif Klinik',
  tahsilat: 'Tahsilat',
  tanitim: 'Tanıtım',
  revisit: 'Tekrar Ziyaret',
  task: 'Görev',
  note: 'Not',
  visit: 'Ziyaret',
};

const TAHSILAT_OUTCOMES: OutcomeOption[] = [
  { key: 'tahsil_edildi', label: 'Tahsil Edildi', color: 'green' },
  { key: 'soz_verildi', label: 'Söz Verildi', color: 'amber' },
  { key: 'odenmedi', label: 'Ödenmedi', color: 'red' },
];

const DEFAULT_OUTCOMES: OutcomeOption[] = [
  { key: 'met', label: 'Görüşüldü', color: 'green' },
  { key: 'callback', label: 'Tekrar Aranacak', color: 'amber' },
  { key: 'no_meeting', label: 'Görüşülemedi', color: 'red' },
  { key: 'order_taken', label: 'Sipariş Alındı', color: 'blue' },
  { key: 'sample_given', label: 'Numune Verildi', color: 'purple' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function outcomeColorClasses(color: string | undefined, selected: boolean): string {
  const base = 'border';
  if (!selected) {
    return `${base} bg-background border-border text-foreground hover:bg-muted`;
  }
  switch ((color ?? '').toLowerCase()) {
    case 'green':
      return `${base} bg-green-600 border-green-700 text-white`;
    case 'amber':
    case 'yellow':
      return `${base} bg-amber-500 border-amber-600 text-white`;
    case 'red':
      return `${base} bg-red-600 border-red-700 text-white`;
    case 'blue':
      return `${base} bg-blue-600 border-blue-700 text-white`;
    case 'purple':
      return `${base} bg-purple-600 border-purple-700 text-white`;
    case 'gray':
    case 'grey':
    default:
      return `${base} bg-gray-600 border-gray-700 text-white`;
  }
}

function outcomeLabel(outcomes: OutcomeOption[], key: string): string {
  return outcomes.find((o) => o.key === key)?.label ?? key;
}

function formatAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Telefon numarasını WhatsApp için hazırlar:
 * rakamları al, baştaki 0'ı 90 ile değiştir.
 */
function toWaNumber(phone: string): string {
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.startsWith('0')) return '90' + digits.slice(1);
  return digits;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReminderDetailSheet(props: {
  item: ReminderDetailItem;
  clinic: { name: string; phone: string | null } | null;
  attachments?: ReminderAttachment[];
  assignerName?: string | null;
  onClose: () => void;
  onSnooze: (id: string, ms: number, label: string) => void;
  onAddToRoute?: (accountId: string) => void;
  onComplete: (id: string, outcome: string, note: string) => void;
  onReopen?: (id: string) => void;
  onCreateFollowUp?: (item: ReminderDetailItem) => void;
  onLinkClinic?: () => void;
}): JSX.Element {
  const {
    item,
    clinic,
    attachments,
    assignerName,
    onClose,
    onSnooze,
    onAddToRoute,
    onComplete,
    onReopen,
    onCreateFollowUp,
    onLinkClinic,
  } = props;

  const [completionOpen, setCompletionOpen] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null);
  const [completionNoteText, setCompletionNoteText] = useState('');

  const isDone = item.status === 'done';
  const outcomes = item.type === 'tahsilat' ? TAHSILAT_OUTCOMES : DEFAULT_OUTCOMES;

  const phone = clinic?.phone ? clinic.phone.replace(/[^\d+]/g, '') : null;
  const waNumber = phone ? toWaNumber(phone) : null;

  function handleComplete(): void {
    if (!selectedOutcome) return;
    onComplete(item.id, selectedOutcome, completionNoteText.trim());
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Randevu detayı"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Sheet */}
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-background p-4 shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Detay</h2>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted" aria-label="Kapat">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tür etiketi + başlık + zaman */}
        <div className="mb-3 space-y-1">
          <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {TYPE_LABELS[item.type]}
          </span>
          <p className="text-sm font-semibold leading-snug">{item.title}</p>
          <p className="text-xs text-muted-foreground">{formatAt(item.at)}</p>
          {item.sourceRef?.startsWith('followup:') && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-indigo-600">
              <CornerDownRight className="h-3 w-3" />
              Önceki görüşmenin devamı
            </p>
          )}
        </div>

        {/* Klinik */}
        {clinic && (
          <div className="mb-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="font-medium">{clinic.name}</span>
          </div>
        )}

        {/* Not */}
        {item.note && (
          <p className="mb-3 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
            {item.note}
          </p>
        )}

        {/* Atayan */}
        {assignerName && (
          <p className="mb-3 text-xs text-muted-foreground">
            Atayan: <span className="font-medium text-foreground">{assignerName}</span>
          </p>
        )}

        {/* Ekler */}
        {attachments && attachments.length > 0 && (
          <div className="mb-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Ekler</p>
            <div className="flex flex-wrap gap-2">
              {attachments.map((att) =>
                att.kind === 'photo' ? (
                  <button
                    key={att.id}
                    onClick={() => window.open(att.url)}
                    className="overflow-hidden rounded border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                    aria-label="Fotoğrafı aç"
                  >
                    <img
                      src={att.url}
                      alt="ek fotoğraf"
                      className="h-16 w-16 rounded object-cover"
                    />
                  </button>
                ) : (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <audio key={att.id} src={att.url} controls className="h-10 max-w-[240px]" />
                ),
              )}
            </div>
          </div>
        )}

        {/* Hızlı aksiyon: Ara / WhatsApp */}
        {phone && (
          <div className="mb-3 flex gap-2">
            <a
              href={`tel:${phone}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background py-2 text-sm font-medium hover:bg-muted"
            >
              <Phone className="h-4 w-4" />
              Ara
            </a>
            {waNumber && (
              <a
                href={`https://wa.me/${waNumber}`}
                target="_blank"
                rel="noreferrer"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-background py-2 text-sm font-medium hover:bg-muted"
              >
                <MessageCircle className="h-4 w-4 text-green-600" />
                WhatsApp
              </a>
            )}
          </div>
        )}

        {/* Ertele + Rotaya Ekle */}
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => onSnooze(item.id, 3_600_000, '1 saat')}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Clock className="h-4 w-4" />1 saat ertele
          </button>
          <button
            onClick={() => onSnooze(item.id, 86_400_000, 'Yarın')}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
          >
            <Clock className="h-4 w-4" />
            Yarın
          </button>
          {item.accountId && onAddToRoute && (
            <button
              onClick={() => onAddToRoute(item.accountId!)}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              <MapPin className="h-4 w-4" />
              Rotaya Ekle
            </button>
          )}
          {onCreateFollowUp && (
            <button
              onClick={() => onCreateFollowUp(item)}
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
            >
              <CalendarPlus className="h-4 w-4" />
              Tekrar Randevu
            </button>
          )}
          {!item.accountId && onLinkClinic && (
            <button
              onClick={onLinkClinic}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted"
            >
              <Link2 className="h-4 w-4" />
              Klinik Bağla
            </button>
          )}
        </div>

        <hr className="mb-4 border-border" />

        {/* ---- Tamamlama bölümü ---- */}
        {isDone ? (
          /* Tamamlanmış: sonuç + not + geri al */
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              Tamamlandı
            </div>
            {item.outcome && (
              <p className="text-sm">
                Sonuç: <span className="font-medium">{outcomeLabel(outcomes, item.outcome)}</span>
              </p>
            )}
            {item.completionNote && (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {item.completionNote}
              </p>
            )}
            {onReopen && (
              <button
                onClick={() => onReopen(item.id)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-4 w-4" />
                Geri al
              </button>
            )}
          </div>
        ) : completionOpen ? (
          /* Tamamlama formu */
          <div className="space-y-3">
            <p className="text-sm font-medium">Sonuç seçin</p>
            <div className="flex flex-wrap gap-2">
              {outcomes.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setSelectedOutcome(o.key)}
                  className={[
                    'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                    outcomeColorClasses(o.color, selectedOutcome === o.key),
                  ].join(' ')}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <textarea
              value={completionNoteText}
              onChange={(e) => setCompletionNoteText(e.target.value)}
              placeholder="Not ekle (isteğe bağlı)"
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setCompletionOpen(false);
                  setSelectedOutcome(null);
                  setCompletionNoteText('');
                }}
                className="flex-1 rounded-lg border border-border bg-background py-2 text-sm hover:bg-muted"
              >
                Vazgeç
              </button>
              <button
                onClick={handleComplete}
                disabled={!selectedOutcome}
                className="flex-1 rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                Kaydet
              </button>
            </div>
          </div>
        ) : (
          /* Tamamla butonu */
          <button
            onClick={() => setCompletionOpen(true)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <CheckCircle2 className="h-4 w-4" />
            Tamamla
          </button>
        )}
      </div>
    </div>
  );
}
