/**
 * Native push-notification kaydı (Capacitor / FCM) — Saha Navigasyon.
 *
 * PARLA mobil uygulamasındaki `src/lib/push.ts` davranış pattern'i NAV mimarisine
 * UYARLANDI (kör kopya değil). Saptığımız noktalar ve gerekçeleri:
 *   - PARLA `import { supabase } from './supabase'` (singleton) kullanır; NAV'da
 *     client lazy factory `getSupabaseClient()` ile gelir → her çağrıda factory.
 *   - PARLA tip-cast'siz `supabase.from(...)` çağırır; NAV `getTypedClient()` ile
 *     `device_tokens` tablosunu tam-tipli (Database) yazar.
 *   - PARLA'da `getCurrentUser()` helper'ı var; NAV'da yok →
 *     `supabase.auth.getUser()` doğrudan kullanılır (offline'da hata fırlatabilir,
 *     try/catch ile yutulur ve token login sonrası retry'a bırakılır).
 *   - PARLA dev-log'u `import.meta.env.DEV`; NAV'da debug paneli var → `pushDebug`
 *     köprüsü ile aynı panele de düşürülür (NAV gözlemlenebilirlik standardı).
 *   - PARLA `setPushNavigate` Router içi bir bileşeni gerektirir; NAV router
 *     deklaratif `<Routes>` olduğundan aynı köprü `PushNavigateBridge` (App.tsx'e
 *     mount) ile sağlanır — pattern korunur, mount noktası NAV'a uyarlanır.
 *
 * device_tokens tablosu Parla ile ORTAK Supabase projesinde (RLS: auth.uid() =
 * user_id). `send-push` Edge Function + `trg_notify_send_push` trigger zaten
 * canlı; bu dosya yalnızca eksik olan CLIENT KAYIT kodunu tamamlar. Stale token
 * temizliği EF tarafında yapılır (client'ta gerekmez).
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type {
  Token,
  RegistrationError,
  PushNotificationSchema,
  ActionPerformed,
} from '@capacitor/push-notifications';
import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { pushDebug } from '@/lib/debugLog';

// Son alınan FCM token (login sonrası tekrar kayıt için modül-seviyesi cache).
let lastToken: string | null = null;

// Listener'lar bir kez kaydedilsin (StrictMode double-mount / HMR guard).
let initialized = false;

// ── Push tap yönlendirme köprüsü ───────────────────────────────────────────
// PARLA pattern: Router içindeki bir bileşen gerçek navigate fn'i kaydeder; push
// init Router mount'undan önce çalışabileceğinden navigate yoksa custom event'e,
// o da yoksa son çare tam reload'a düşülür. NAV'da köprüyü `PushNavigateBridge`
// (App.tsx'e mount edilen küçük bileşen) sağlar.
type PushNavigateFn = (path: string) => void;
let navigateRef: PushNavigateFn | null = null;

/** Router içindeki bir bileşen (useNavigate sahibi) mount olunca burayı set eder. */
export function setPushNavigate(fn: PushNavigateFn | null): void {
  navigateRef = fn;
}

/**
 * FCM token'ı Supabase `device_tokens` tablosuna yazar (user_id ↔ cihaz eşlemesi).
 * Kullanıcı henüz giriş yapmadıysa kayıt atlanır; onAuthStateChange ile login
 * olunca tekrar denenir (lastToken cache).
 */
async function saveToken(token: string): Promise<void> {
  lastToken = token;
  try {
    const auth = getSupabaseClient().auth;
    const { data, error: userErr } = await auth.getUser();
    const user = data?.user ?? null;
    if (userErr || !user) {
      if (import.meta.env.DEV) {
        pushDebug('info', 'push', 'token alındı ama kullanıcı anonim → login sonrası kaydedilecek');
      }
      return;
    }

    const platform = Capacitor.getPlatform(); // 'android' | 'ios' | 'web'
    const { error } = await getTypedClient()
      .from('device_tokens')
      .upsert(
        {
          user_id: user.id,
          token,
          platform,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'token' },
      );

    if (error) {
      pushDebug('error', 'push', `token kayıt hatası: ${error.message}`);
    } else if (import.meta.env.DEV) {
      pushDebug('info', 'push', `token kaydedildi: ${user.id}`);
    }
  } catch (e) {
    // getUser() offline'da fırlatabilir → login sonrası retry'a bırak.
    pushDebug('error', 'push', `token kayıt exception: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Bildirime dokununca ilgili sayfaya yönlendir.
 * payload.data.route / data.url / data.path alanını kullanır.
 * Önce React Router navigate (reload YOK, SPA state korunur); kaydedilmemişse
 * custom event köprüsü; o da tüketilmezse son çare tam reload.
 */
function handleTapNavigation(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const route = (data.route ?? data.url ?? data.path) as string | undefined;
  if (!route) return;
  try {
    // Mutlak http(s) URL: SPA-içi navigate edilemez → reload zorunlu.
    if (route.startsWith('http')) {
      window.location.assign(route);
      return;
    }
    const target = route.startsWith('/') ? route : `/${route}`;

    if (navigateRef) {
      navigateRef(target);
      return;
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('saha:push-navigate', { detail: { path: target } }));
      return;
    }
    window.location.assign(target);
  } catch (e) {
    pushDebug('error', 'push', `yönlendirme hatası: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Native push init. Web'de no-op döner.
 * Çağrı noktası: AuthBootstrap.initialize() tamamlandıktan sonra (session hazır →
 * saveToken user_id'yi anında bulur, ilk-açılış için en güvenli nokta). Login
 * SIGNED_IN retry'ı ek güvence sağlar.
 */
export async function initPush(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (initialized) return;
  initialized = true;

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt') {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== 'granted') return;

  // Listener'ları register()'dan ÖNCE ekle: cihazda FCM token cache'liyse (örn. ayni
  // cihazda PARLA kayit olmussa) 'registration' event'i register() cagrisinda ANINDA
  // fire olur; listener sonra eklenirse "No listeners found" ile token DUSER (cihaz-testte
  // logcat ile yakalandi). Capacitor önerisi de listener-once.
  await PushNotifications.addListener('registration', (token: Token) => {
    void saveToken(token.value);
  });
  await PushNotifications.addListener('registrationError', (err: RegistrationError) => {
    pushDebug('error', 'push', `registration error: ${JSON.stringify(err)}`);
  });
  await PushNotifications.addListener('pushNotificationReceived', (notif: PushNotificationSchema) => {
    if (import.meta.env.DEV) pushDebug('info', 'push', `received (foreground): ${notif.title ?? ''}`);
  });
  await PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    handleTapNavigation(action.notification.data as Record<string, unknown> | undefined);
  });

  // Listener'lar hazır → ŞİMDİ register (token event'i kesin yakalanır, race kapandı).
  await PushNotifications.register();

  // Token'ı session HAZIR olunca kaydet. SADECE SIGNED_IN dinlemek YETMEZ:
  // app-restore'da (zaten girişli kullanıcı tekrar açar) event INITIAL_SESSION'dır,
  // SIGNED_IN DEĞİL → token asla kaydedilmezdi. Ayrıca registration event'i session
  // client'a bağlanmadan önce fire ederse ilk saveToken anon gider (RLS 403); bu listener
  // session-bağlı anda (event session taşır) güvenle retry eder. (Cihaz-testte yakalandı.)
  getSupabaseClient().auth.onAuthStateChange((event, session) => {
    if (
      (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') &&
      session?.user &&
      lastToken
    ) {
      void saveToken(lastToken);
    }
  });
}
