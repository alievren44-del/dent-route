/**
 * QueryErrorState — ortak sorgu-hata kartı.
 *
 * React Query `isError` durumunda kullanılır: kırmızı kart + "Tekrar Dene".
 * Amaç: finansal/veri sorguları sessizce "veri yok" / ₺0 gibi görünmesin —
 * hata açıkça görünür olsun (bkz. AgingReportPage'deki isError deseni).
 */

import { AlertTriangle } from 'lucide-react';

interface QueryErrorStateProps {
  /** Kullanıcıya gösterilecek hata mesajı. Verilmezse genel bir mesaj kullanılır. */
  message?: string;
  /** Verilirse "Tekrar Dene" butonu gösterilir (ör. `() => query.refetch()`). */
  onRetry?: () => void;
}

function QueryErrorState({ message, onRetry }: QueryErrorStateProps): JSX.Element {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
      <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-red-700">
          Veri yüklenemedi{message ? `: ${message}` : '.'}
        </p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 px-3 py-1.5 rounded-md border border-red-300 bg-white text-xs font-medium text-red-700 hover:bg-red-100 min-h-tap-min"
          >
            Tekrar Dene
          </button>
        )}
      </div>
    </div>
  );
}

export default QueryErrorState;
