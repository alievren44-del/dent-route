/**
 * breadcrumbs.ts — Debug/feedback bağlam toplayıcı (ring buffer'lar).
 * console + network + kullanıcı-aksiyon + hata + route geçmişi son N girdi.
 * install() bir kez çağrılır (App mount). Portable: parla + NAV aynı.
 */
type Level = 'log' | 'info' | 'warn' | 'error';
interface ConsoleEntry {
  ts: number;
  level: Level;
  msg: string;
}
interface NetEntry {
  ts: number;
  method: string;
  url: string;
  status?: number;
  ms?: number;
  err?: string;
}
interface ActionEntry {
  ts: number;
  type: string;
  label: string;
  route: string;
}
interface ErrEntry {
  ts: number;
  msg: string;
  stack?: string;
}
interface RouteEntry {
  ts: number;
  route: string;
}

const consoleBuf: ConsoleEntry[] = [];
const netBuf: NetEntry[] = [];
const actionBuf: ActionEntry[] = [];
const errBuf: ErrEntry[] = [];
const routeBuf: RouteEntry[] = [];

const cap = (arr: unknown[], max: number) => {
  while (arr.length > max) arr.shift();
};
function safeStr(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** App'in network interceptor'ı (axios/fetch) buraya besler. */
export function recordNetwork(e: Omit<NetEntry, 'ts'>) {
  netBuf.push({ ...e, ts: Date.now() });
  cap(netBuf, 30);
}

/** Router route geçişi. */
export function recordRoute(route: string) {
  const last = routeBuf[routeBuf.length - 1];
  if (last && last.route === route) return;
  routeBuf.push({ ts: Date.now(), route });
  cap(routeBuf, 10);
}

export function getBreadcrumbs() {
  return {
    console: [...consoleBuf],
    network: [...netBuf],
    actions: [...actionBuf],
    errors: [...errBuf],
    routeHistory: [...routeBuf],
  };
}

let installed = false;
export function installBreadcrumbs() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  (['log', 'info', 'warn', 'error'] as Level[]).forEach((level) => {
    const orig = (console as unknown as Record<Level, ((...a: unknown[]) => void) | undefined>)[
      level
    ]?.bind(console);
    (console as unknown as Record<Level, (...a: unknown[]) => void>)[level] = (
      ...args: unknown[]
    ) => {
      try {
        consoleBuf.push({ ts: Date.now(), level, msg: args.map(safeStr).join(' ').slice(0, 500) });
        cap(consoleBuf, 50);
      } catch {
        /* yut */
      }
      orig?.(...args);
    };
  });

  window.addEventListener('error', (ev) => {
    errBuf.push({
      ts: Date.now(),
      msg: String(ev.message || ev.error?.message || 'error').slice(0, 400),
      stack: ev.error?.stack?.slice(0, 800),
    });
    cap(errBuf, 20);
  });
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const r = ev.reason as { message?: string; stack?: string } | undefined;
    errBuf.push({
      ts: Date.now(),
      msg: ('unhandledrejection: ' + (r?.message || String(ev.reason || ''))).slice(0, 400),
      stack: r?.stack?.slice(0, 800),
    });
    cap(errBuf, 20);
  });

  // fetch wrap — supabase-js / fetch tabanlı çağrıları yakala (NAV + parla bonus)
  const origFetch = window.fetch?.bind(window);
  if (origFetch) {
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const t = Date.now();
      const url =
        typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url || String(args[0]);
      const method = String(args[1]?.method || 'GET').toUpperCase();
      try {
        const res = await origFetch(...args);
        recordNetwork({
          method,
          url: String(url).slice(0, 200),
          status: res.status,
          ms: Date.now() - t,
        });
        return res;
      } catch (e) {
        recordNetwork({
          method,
          url: String(url).slice(0, 200),
          ms: Date.now() - t,
          err: (e as Error).message,
        });
        throw e;
      }
    };
  }

  document.addEventListener(
    'click',
    (ev) => {
      try {
        const t = ev.target as HTMLElement | null;
        const el = t?.closest('button,a,[role="button"],[data-testid]') as HTMLElement | null;
        if (!el) return;
        const label = (
          el.getAttribute('data-testid') ||
          el.getAttribute('aria-label') ||
          el.textContent ||
          el.tagName ||
          ''
        )
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 60);
        actionBuf.push({
          ts: Date.now(),
          type: el.tagName.toLowerCase(),
          label,
          route: location.pathname,
        });
        cap(actionBuf, 20);
      } catch {
        /* yut */
      }
    },
    true,
  );
}
