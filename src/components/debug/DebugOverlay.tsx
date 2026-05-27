/**
 * DebugOverlay — Sağ üst köşede sarı uyarı/hata paneli.
 *
 * `debugLog` store'unu subscribe eder. Toplu yakalanan console.error,
 * console.warn, window error, unhandledrejection, edge function non-2xx
 * cevaplarını listeler. Kullanıcı kopyalayıp paylaşabilir.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import {
  clearDebug,
  getDebugEntries,
  subscribeDebug,
  type DebugEntry,
} from '@/lib/debugLog';

function levelColor(level: DebugEntry['level']) {
  switch (level) {
    case 'error':
      return 'bg-red-100 text-red-800 border-red-300';
    case 'warn':
      return 'bg-amber-100 text-amber-800 border-amber-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-300';
  }
}

function formatTs(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function entriesToText(entries: DebugEntry[]): string {
  return entries
    .map((e) => {
      const head = `[${formatTs(e.ts)}] [${e.level.toUpperCase()}] [${e.source}] ${e.message}`;
      return e.detail ? `${head}\n${e.detail}` : head;
    })
    .join('\n\n');
}

export function DebugOverlay() {
  const [entries, setEntries] = useState<DebugEntry[]>(() => getDebugEntries());
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => subscribeDebug(setEntries), []);

  const errorCount = entries.filter((e) => e.level === 'error').length;
  const warnCount = entries.filter((e) => e.level === 'warn').length;
  const hasAny = entries.length > 0;

  async function handleCopyAll() {
    const text = entriesToText(entries);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  async function handleCopyOne(e: DebugEntry) {
    const text = entriesToText([e]);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* yutulur */
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed right-3 top-3 z-[9999] flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-lg transition ${
          hasAny
            ? 'border-amber-400 bg-amber-300 text-amber-900 hover:bg-amber-400'
            : 'border-amber-200 bg-amber-100 text-amber-700 hover:bg-amber-200'
        }`}
        title="Debug paneli aç"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>Debug</span>
        {errorCount > 0 && (
          <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {errorCount}
          </span>
        )}
        {warnCount > 0 && (
          <span className="rounded-full bg-amber-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            {warnCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed right-3 top-3 z-[9999] flex max-h-[80vh] w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-amber-400 bg-amber-50 shadow-2xl">
      <div className="flex items-center justify-between border-b border-amber-300 bg-amber-200 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <span>Debug Paneli</span>
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs">
            {entries.length}
          </span>
          {errorCount > 0 && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs text-white">
              {errorCount} hata
            </span>
          )}
          {warnCount > 0 && (
            <span className="rounded-full bg-amber-600 px-2 py-0.5 text-xs text-white">
              {warnCount} uyarı
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyAll}
            disabled={!hasAny}
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-amber-900 hover:bg-amber-300 disabled:opacity-40"
            title="Tümünü kopyala"
          >
            <Copy className="h-3.5 w-3.5" />
            Kopyala
          </button>
          <button
            type="button"
            onClick={clearDebug}
            disabled={!hasAny}
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium text-amber-900 hover:bg-amber-300 disabled:opacity-40"
            title="Temizle"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Temizle
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex h-7 w-7 items-center justify-center rounded text-amber-900 hover:bg-amber-300"
            title="Kapat"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-amber-50">
        {!hasAny && (
          <div className="px-3 py-8 text-center text-xs text-amber-700">
            Henüz yakalanmış hata/uyarı yok. Tarama yap, hata çıkarsa burada görünür.
          </div>
        )}
        {entries.map((e) => {
          const expanded = expandedId === e.id;
          return (
            <div
              key={e.id}
              className={`border-b border-amber-200 px-3 py-2 text-xs ${levelColor(
                e.level,
              )}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] font-mono opacity-75">
                    <span>{formatTs(e.ts)}</span>
                    <span className="rounded bg-white/60 px-1.5 py-0.5 font-semibold">
                      {e.level.toUpperCase()}
                    </span>
                    <span className="truncate">{e.source}</span>
                  </div>
                  <div className="mt-1 break-words font-medium">{e.message}</div>
                  {e.detail && expanded && (
                    <pre className="mt-1.5 whitespace-pre-wrap break-words rounded bg-white/60 p-2 font-mono text-[10px] leading-snug">
                      {e.detail}
                    </pre>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {e.detail && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : e.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-white/60"
                      title={expanded ? 'Daralt' : 'Genişlet'}
                    >
                      {expanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleCopyOne(e)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-white/60"
                    title="Bu satırı kopyala"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DebugOverlay;
