/**
 * Cloudflare Turnstile CAPTCHA — Supabase Auth entegrasyonu.
 *
 * Supabase Dashboard → Auth → Attack Protection → CAPTCHA (Turnstile) AÇIKKEN
 * signUp / signInWithPassword / resetPasswordForEmail çağrıları captchaToken
 * ister. Bu helper görünmez Turnstile widget'ı çalıştırıp token üretir.
 *
 * FAIL-OPEN: script yüklenemez / hata / timeout olursa `undefined` döner —
 * dashboard'da CAPTCHA kapalıyken davranış hiç değişmez; açıkken token'sız
 * istek Supabase'ten net "captcha verification failed" hatası alır.
 *
 * appearance: 'interaction-only' → Cloudflare ek doğrulama isterse widget
 * sağ-alt köşede belirir, gerekmiyorsa hiç görünmez.
 *
 * Token TEK KULLANIMLIK — her auth çağrısından hemen önce yeni token al.
 */

const SITE_KEY: string =
  (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ??
  '0x4AAAAAADx4dGEBh3KOn3LA';

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TIMEOUT_MS = 15_000;

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null; // sonraki denemede yeniden yüklensin
        reject(new Error('Turnstile script yüklenemedi'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** Turnstile token üret; başarısızlıkta `undefined` (fail-open). */
export async function getCaptchaToken(): Promise<string | undefined> {
  try {
    await loadScript();
    const turnstile = window.turnstile;
    if (!turnstile) return undefined;

    return await new Promise<string | undefined>((resolve) => {
      const container = document.createElement('div');
      // Challenge gerekirse kullanıcı görebilsin diye sabit sağ-alt köşe.
      container.style.cssText =
        'position:fixed;bottom:16px;right:16px;z-index:99999;';
      document.body.appendChild(container);

      let widgetId: string | null = null;
      let done = false;
      const finish = (token: string | undefined) => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        try {
          if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
        } catch {
          /* widget zaten kalkmış olabilir */
        }
        container.remove();
        resolve(token);
      };
      const timer = window.setTimeout(() => finish(undefined), TIMEOUT_MS);

      try {
        widgetId = turnstile.render(container, {
          sitekey: SITE_KEY,
          appearance: 'interaction-only',
          callback: (token: string) => finish(token),
          'error-callback': () => finish(undefined),
          'unsupported-callback': () => finish(undefined),
        });
      } catch {
        finish(undefined);
      }
    });
  } catch {
    return undefined;
  }
}
