/**
 * PullToRefresh — hafif, bağımlılıksız aşağı-çek yenileme sarmalayıcısı.
 *
 * Scroll AppShell'deki <main overflow-y-auto> üzerinde olduğundan, en yakın
 * kaydırılabilir ata bulunur; SADECE liste en üstteyken (scrollTop <= 0) aşağı
 * çekiş yenilemeyi tetikler. onRefresh mevcut react-query refetch/invalidate'i
 * çağırır — yeni bir veri yolu icat edilmez. "Yenile" butonu additive kalır.
 */
import { useRef, useState, type ReactNode, type TouchEvent } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void;
  children: ReactNode;
  className?: string;
}

const THRESHOLD = 70; // bu mesafeden fazla çekilirse yenile
const MAX_PULL = 100; // görsel tavan (direnç sonrası)

function getScrollParent(node: HTMLElement | null): HTMLElement | Window {
  let el: HTMLElement | null = node?.parentElement ?? null;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return window;
}

function scrollTopOf(s: HTMLElement | Window): number {
  return s instanceof Window ? s.scrollY : s.scrollTop;
}

export function PullToRefresh({ onRefresh, children, className }: PullToRefreshProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const scroller = useRef<HTMLElement | Window | null>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  function onTouchStart(e: TouchEvent<HTMLDivElement>): void {
    if (refreshing) return;
    const s = getScrollParent(wrapRef.current);
    scroller.current = s;
    startY.current = scrollTopOf(s) <= 0 ? e.touches[0]!.clientY : null;
  }

  function onTouchMove(e: TouchEvent<HTMLDivElement>): void {
    if (startY.current == null || refreshing) return;
    const s = scroller.current;
    if (!s || scrollTopOf(s) > 0) {
      startY.current = null;
      setPull(0);
      return;
    }
    const dy = e.touches[0]!.clientY - startY.current;
    if (dy > 0) setPull(Math.min(MAX_PULL, dy * 0.5)); // direnç
    else setPull(0);
  }

  async function onTouchEnd(): Promise<void> {
    if (startY.current == null) return;
    startY.current = null;
    if (pull >= THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
  }

  const active = pull > 0 || refreshing;

  return (
    <div
      ref={wrapRef}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => void onTouchEnd()}
      className={className}
    >
      <div
        aria-hidden={!active}
        className="flex items-end justify-center overflow-hidden text-muted-foreground"
        style={{
          height: refreshing ? THRESHOLD : pull,
          transition: startY.current == null ? 'height 200ms ease' : undefined,
        }}
      >
        <div className="flex items-center gap-1.5 pb-1 text-xs font-medium">
          {refreshing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Yenileniyor…
            </>
          ) : (
            <>
              <ArrowDown
                className="h-4 w-4 transition-transform"
                style={{ transform: pull >= THRESHOLD ? 'rotate(180deg)' : 'none' }}
                aria-hidden="true"
              />
              {pull >= THRESHOLD ? 'Bırak, yenilensin' : 'Yenilemek için çek'}
            </>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

export default PullToRefresh;
