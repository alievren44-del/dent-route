/**
 * Auth storage adapter — kalıcı (durable) oturum saklama.
 *
 * SORUN: Supabase auth `persistSession: true` varsayılan olarak WebView
 * `localStorage`'ı kullanır. Android Capacitor WebView'de localStorage soğuk
 * başlatmalar (uygulamayı kapat-aç) arasında GARANTİ DEĞİLDİR — sistem WebView
 * verisini temizleyebilir/atabilir → token kaybolur → her açılışta tekrar giriş.
 *
 * ÇÖZÜM: Native'de auth token'ını `@capacitor/preferences` (native key-value,
 * uygulama verisiyle birlikte kalıcı) üzerinden sakla. supabase-js async storage
 * adapter'ı destekler (getItem/setItem/removeItem Promise dönebilir).
 *
 * WEB: dokunma — varsayılan localStorage kullanılır (Parla *.parladisdeposu.com
 * subdomain'leri arası SSO paylaşımı 'parla-shared-auth' key ile korunur).
 */

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

/** supabase-js `SupportedStorage` ile uyumlu async adapter. */
export interface AsyncAuthStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const preferencesStorage: AsyncAuthStorage = {
  async getItem(key) {
    const { value } = await Preferences.get({ key });
    return value ?? null;
  },
  async setItem(key, value) {
    await Preferences.set({ key, value });
  },
  async removeItem(key) {
    await Preferences.remove({ key });
  },
};

/**
 * Native'de Preferences-backed durable storage döner; web'de undefined
 * (supabase varsayılan localStorage'ı kullansın — SSO subdomain paylaşımı korunur).
 */
export function getAuthStorage(): AsyncAuthStorage | undefined {
  return Capacitor.isNativePlatform() ? preferencesStorage : undefined;
}

/**
 * "Beni hatırla" tercihi — durable (Preferences native / localStorage web).
 * Varsayılan: hatırla (kullanıcı çıkış yapana dek oturum korunur).
 * Yalnızca AÇIKÇA 'false' yazıldığında oturum bir sonraki soğuk başlatmada kapanır.
 */
const REMEMBER_KEY = 'saha-remember-me';

export async function setRememberMe(remember: boolean): Promise<void> {
  const value = remember ? 'true' : 'false';
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.set({ key: REMEMBER_KEY, value });
    } else if (typeof window !== 'undefined') {
      window.localStorage.setItem(REMEMBER_KEY, value);
    }
  } catch {
    /* yutulur — hatırlama tercihi kritik değil */
  }
}

export async function clearRememberMe(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await Preferences.remove({ key: REMEMBER_KEY });
    } else if (typeof window !== 'undefined') {
      window.localStorage.removeItem(REMEMBER_KEY);
    }
  } catch {
    /* yutulur */
  }
}

/**
 * Kullanıcı oturumun hatırlanmamasını AÇIKÇA istedi mi?
 * null/eksik → hatırla (güvenli varsayılan; mevcut girişli kullanıcıları atma).
 */
export async function isRememberMeDisabled(): Promise<boolean> {
  try {
    let value: string | null = null;
    if (Capacitor.isNativePlatform()) {
      value = (await Preferences.get({ key: REMEMBER_KEY })).value ?? null;
    } else if (typeof window !== 'undefined') {
      value = window.localStorage.getItem(REMEMBER_KEY);
    }
    return value === 'false';
  } catch {
    return false;
  }
}
