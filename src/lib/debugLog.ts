/**
 * debugLog — Global runtime hata/uyarı toplayıcı.
 *
 * - console.error / console.warn monkey-patch edilir (orijinal davranış korunur).
 * - window 'error' + 'unhandledrejection' dinlenir.
 * - fetch monkey-patch'i Supabase Edge Function (`/functions/v1/*`) non-2xx
 *   cevaplarını yakalayıp body'yi de loglar (response.clone()).
 *
 * DebugOverlay bu store'u subscribe eder. Tek seferlik install (HMR safe).
 */

export type DebugLevel = 'error' | 'warn' | 'info';

export interface DebugEntry {
  id: number;
  ts: number;
  level: DebugLevel;
  source: string;
  message: string;
  detail?: string;
}

type Listener = (entries: DebugEntry[]) => void;

const MAX_ENTRIES = 200;
const STORE: { entries: DebugEntry[]; listeners: Set<Listener>; nextId: number } = {
  entries: [],
  listeners: new Set(),
  nextId: 1,
};

function emit() {
  for (const l of STORE.listeners) l(STORE.entries);
}

function safeStringify(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Error) {
    return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ''}`;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    try {
      return String(v);
    } catch {
      return '[unserializable]';
    }
  }
}

function formatArgs(args: unknown[]): { message: string; detail?: string } {
  if (args.length === 0) return { message: '(empty)' };
  const first = safeStringify(args[0]);
  if (args.length === 1) return { message: first };
  const rest = args.slice(1).map(safeStringify).join('\n');
  return { message: first, detail: rest };
}

export function pushDebug(level: DebugLevel, source: string, message: string, detail?: string) {
  const entry: DebugEntry = {
    id: STORE.nextId++,
    ts: Date.now(),
    level,
    source,
    message,
    detail,
  };
  STORE.entries = [entry, ...STORE.entries].slice(0, MAX_ENTRIES);
  emit();
}

export function getDebugEntries(): DebugEntry[] {
  return STORE.entries;
}

export function clearDebug() {
  STORE.entries = [];
  emit();
}

export function subscribeDebug(listener: Listener): () => void {
  STORE.listeners.add(listener);
  return () => {
    STORE.listeners.delete(listener);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Global capture install
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __debugLogInstalled?: boolean;
  }
}

function installCapture() {
  if (typeof window === 'undefined') return;
  if (window.__debugLogInstalled) return;
  window.__debugLogInstalled = true;

  // console.error
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const { message, detail } = formatArgs(args);
      pushDebug('error', 'console.error', message, detail);
    } catch {
      /* yutulur */
    }
    origError(...args);
  };

  // console.warn
  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    try {
      const { message, detail } = formatArgs(args);
      pushDebug('warn', 'console.warn', message, detail);
    } catch {
      /* yutulur */
    }
    origWarn(...args);
  };

  // window error
  window.addEventListener('error', (ev) => {
    const msg = ev.message || 'window.error';
    const detail =
      ev.error instanceof Error
        ? `${ev.error.stack ?? ev.error.message}`
        : `${ev.filename}:${ev.lineno}:${ev.colno}`;
    pushDebug('error', 'window.error', msg, detail);
  });

  // unhandled promise rejection
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const { message, detail } = formatArgs([reason]);
    pushDebug('error', 'unhandledrejection', message, detail);
  });

  // fetch wrapper — Edge Function non-2xx + network errors
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const input = args[0];
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input instanceof Request
            ? input.url
            : '';
    const isEdgeFn = url.includes('/functions/v1/');
    try {
      const res = await origFetch(...args);
      if (isEdgeFn && !res.ok) {
        let bodyText = '';
        try {
          bodyText = await res.clone().text();
        } catch {
          bodyText = '(body okunamadı)';
        }
        const fnName = url.split('/functions/v1/')[1]?.split(/[/?]/)[0] ?? '?';
        pushDebug(
          'error',
          'edge-function',
          `${fnName} → HTTP ${res.status} ${res.statusText}`,
          `URL: ${url}\nBody: ${bodyText.slice(0, 2000)}`,
        );
      }
      return res;
    } catch (err) {
      if (isEdgeFn) {
        const fnName = url.split('/functions/v1/')[1]?.split(/[/?]/)[0] ?? '?';
        pushDebug('error', 'edge-function', `${fnName} → network error`, safeStringify(err));
      }
      throw err;
    }
  };
}

installCapture();

// Sentinel — kullanıcı panelin aktif olduğunu görsün
pushDebug(
  'info',
  'debugLog',
  'Debug paneli aktif',
  `installed @ ${new Date().toISOString()}\nuser-agent: ${
    typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'
  }`,
);
