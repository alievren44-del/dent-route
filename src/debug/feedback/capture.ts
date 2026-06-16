/**
 * capture.ts — Rapor objesi + ekran fotosu üretir.
 * html2canvas DOM→JPEG (ölçek 0.5, kalite 0.6). FAB/modal capture sırasında gizlenir.
 */
import { getBreadcrumbs } from './breadcrumbs';

export interface FeedbackUser { id?: string; role?: string; name?: string }

export interface FeedbackReport {
  id: string;
  ts: number;
  app: string;
  appVersion: string;
  route: string;
  userId?: string;
  userRole?: string;
  device: string;
  online: boolean;
  description: string;
  breadcrumbs: ReturnType<typeof getBreadcrumbs>;
}

export async function captureReport(opts: {
  app: string;
  appVersion: string;
  description: string;
  user: FeedbackUser;
  hideEls?: () => void;
  showEls?: () => void;
}): Promise<{ report: FeedbackReport; screenshotBase64: string | null }> {
  const id = `${opts.app}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let screenshotBase64: string | null = null;
  try {
    opts.hideEls?.();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    // modern-screenshot: oklch + modern CSS destekler (html2canvas 1.4.1 oklch'te patlıyordu).
    const { domToJpeg } = await import('modern-screenshot');
    const dataUrl = await domToJpeg(document.body, { quality: 0.6, scale: 0.5, backgroundColor: '#ffffff' });
    screenshotBase64 = dataUrl.split(',')[1] || null;
  } catch {
    // ekran fotosu best-effort — başarısızsa rapor yine kaydedilir
  } finally {
    opts.showEls?.();
  }

  const report: FeedbackReport = {
    id,
    ts: Date.now(),
    app: opts.app,
    appVersion: opts.appVersion,
    route: location.pathname,
    userId: opts.user.id,
    userRole: opts.user.role,
    device: navigator.userAgent.slice(0, 200),
    online: navigator.onLine,
    description: opts.description,
    breadcrumbs: getBreadcrumbs(),
  };

  return { report, screenshotBase64 };
}
