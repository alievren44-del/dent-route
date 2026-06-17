/**
 * AuthClient — Supabase Auth wrapper.
 *
 * Parla'nın Supabase auth.users tablosu paylaşılır. Saha navigasyon kendi
 * session storage anahtarını ('saha-app-auth') kullanır — Parla web/mobil ile
 * cookie çakışması olmaz, ama aynı user ile aynı parola ile login olur.
 *
 * Login akışı:
 *   1. signInWithEmail(email, pwd)
 *   2. fetchProfile(uid) — profiles tablosundan role, kvkk_accepted_at çek
 *   3. Saha-yetkili rol mü? (REP/ADMIN). Değilse logout + hata.
 *   4. KVKK kabul edilmiş mi? Değilse /onboarding/kvkk yönlendir.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTypedClient } from '@lib/supabase';
import {
  type AuthSession,
  type ParlaUserRole,
  type SahaProfile,
  mapParlaToSahaRole,
} from './types';

/**
 * Parla profiles tablosu Türkçe canonical kolonlar kullanır:
 *   ad_soyad (full_name)
 *   telefon (phone)
 *   klinik_adi (clinic_name)
 * Migration: parla `20260501000002_profile_tr_canonical.sql`.
 */
interface ProfileRow {
  id: string;
  email: string | null;
  ad_soyad: string | null;
  role: string | null;
  region: string | null;
  avg_fuel_consumption: number | string | null;
  kvkk_accepted_at: string | null;
  kvkk_version: string | null;
  is_approved?: boolean | null | undefined;
}

/**
 * Ağ/offline hatası mı? Supabase getUser() offline'da AuthRetryableFetchError
 * (status 0) atar veya "Failed to fetch" mesajlı TypeError fırlatır. Bunları
 * gerçek 401 "geçersiz oturum"dan ayırmak gerek — offline'da kullanıcıyı
 * logout etmemek için (offline-first okuma).
 */
function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: number }).status;
  const name = (err as { name?: string }).name ?? '';
  const message = (err as { message?: string }).message ?? '';
  return (
    status === 0 ||
    name === 'AuthRetryableFetchError' ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(message)
  );
}

export class AuthError extends Error {
  constructor(
    public code: 'INVALID_CREDENTIALS' | 'NOT_AUTHORIZED' | 'INACTIVE' | 'UNKNOWN',
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthClient {
  private readonly supabase: SupabaseClient;

  constructor(supabase: SupabaseClient = getTypedClient()) {
    this.supabase = supabase;
  }

  async signInWithEmail(email: string, password: string): Promise<AuthSession> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.toLowerCase().includes('invalid')) {
        throw new AuthError('INVALID_CREDENTIALS', 'E-posta veya parola hatalı.');
      }
      throw new AuthError('UNKNOWN', error.message);
    }
    if (!data.session || !data.user) {
      throw new AuthError('UNKNOWN', 'Oturum oluşturulamadı.');
    }
    return this.toAuthSession(
      data.session.access_token,
      data.user.id,
      data.user.email,
      data.session.expires_at,
    );
  }

  async signOut(): Promise<void> {
    await this.supabase.auth.signOut();
  }

  async getCurrentSession(): Promise<AuthSession | null> {
    const { data } = await this.supabase.auth.getSession();
    const s = data.session;
    if (!s) return null;
    return this.toAuthSession(s.access_token, s.user.id, s.user.email, s.expires_at);
  }

  /**
   * Tek-giriş hand-off: Parla e-ticaret (parladisdeposu.com) rep login sonrası
   * saha portalına yönlendirirken oturumu URL hash'inde taşır
   * (#sso=base64(JSON{a:access,r:refresh})). Aynı Supabase project olduğu için
   * token geçerli — setSession ile oturumu kur, hash'i HEMEN temizle (token
   * URL'de/history'de kalmasın). Çift-login'i kaldırır.
   * Supabase OAuth implicit-flow ile aynı güvenli patern (hash sunucuya gitmez).
   */
  async consumeSsoHandoff(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    const m = window.location.hash.match(/[#&]sso=([^&]+)/);
    if (!m) return false;
    const clearHash = () => {
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch {
        /* yutulur */
      }
    };
    try {
      const payload = JSON.parse(decodeURIComponent(atob(m[1] ?? ''))) as { a?: string; r?: string };
      if (!payload.a || !payload.r) {
        clearHash();
        return false;
      }
      const { error } = await this.supabase.auth.setSession({
        access_token: payload.a,
        refresh_token: payload.r,
      });
      clearHash();
      return !error;
    } catch {
      clearHash();
      return false;
    }
  }

  /**
   * Server-side validate: localStorage session geçerli mi backend'de?
   * Supabase yeni ES256 JWT'lerinde session_id claim DB lookup ister.
   * Session DB'den silinmişse getUser() error döner → çağıran signOut etmeli.
   */
  async validateSession(): Promise<{ valid: boolean; error: string | null; offline: boolean }> {
    try {
      const { data, error } = await this.supabase.auth.getUser();
      if (error) return { valid: false, error: error.message, offline: isNetworkError(error) };
      if (!data.user) return { valid: false, error: 'no user', offline: false };
      return { valid: true, error: null, offline: false };
    } catch (e) {
      // getUser() ağ hatasında throw edebilir (Failed to fetch).
      const msg = e instanceof Error ? e.message : String(e);
      return { valid: false, error: msg, offline: isNetworkError(e) };
    }
  }

  async fetchProfile(userId: string): Promise<SahaProfile> {
    const { data, error } = await this.supabase
      .from('profiles')
      .select(
        'id, email, ad_soyad, role, region, avg_fuel_consumption, kvkk_accepted_at, kvkk_version, is_approved',
      )
      .eq('id', userId)
      .single();

    if (error) throw new AuthError('UNKNOWN', `Profil yüklenemedi: ${error.message}`);
    if (!data) throw new AuthError('NOT_AUTHORIZED', 'Profil bulunamadı.');

    const row = data as ProfileRow;

    // Parla'da is_approved: yeni kullanıcı false default. Saha rep için onaylı olmalı.
    if (row.is_approved === false) {
      throw new AuthError(
        'INACTIVE',
        'Hesabınız henüz onaylanmadı. Yöneticinizle iletişime geçin.',
      );
    }

    const role = (row.role ?? 'GUEST') as ParlaUserRole;
    const sahaRole = mapParlaToSahaRole(role);
    if (!sahaRole) {
      throw new AuthError(
        'NOT_AUTHORIZED',
        `Bu hesap saha satış için yetkili değil (rol: ${role}). REP veya ADMIN rolü gerekli.`,
      );
    }

    return {
      id: row.id,
      email: row.email ?? null,
      fullName: row.ad_soyad ?? null,
      role,
      region: row.region ?? null,
      avgFuelConsumption: Number(row.avg_fuel_consumption ?? 7.0),
      kvkkAcceptedAt: row.kvkk_accepted_at ?? null,
      kvkkVersion: row.kvkk_version ?? null,
      isActive: true,
    };
  }

  async acceptKvkk(userId: string, version: string): Promise<void> {
    const { data, error } = await this.supabase
      .from('profiles')
      .update({
        kvkk_accepted_at: new Date().toISOString(),
        kvkk_version: version,
      })
      .eq('id', userId)
      .select('id');
    if (error) throw new AuthError('UNKNOWN', `KVKK kaydedilemedi: ${error.message}`);
    if (!data || data.length === 0) {
      throw new AuthError(
        'NOT_AUTHORIZED',
        'Profil bulunamadı. Lütfen çıkış yapıp tekrar giriş yapın veya yöneticinizle iletişime geçin.',
      );
    }
  }

  /**
   * Auth state değişimlerini dinler (login/logout/token refresh).
   * App startup'ta authStore tarafından bir kez çağrılır.
   */
  onAuthStateChange(callback: (session: AuthSession | null) => void): { unsubscribe: () => void } {
    const { data } = this.supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        callback(null);
        return;
      }
      callback(
        this.toAuthSession(
          session.access_token,
          session.user.id,
          session.user.email,
          session.expires_at,
        ),
      );
    });
    return { unsubscribe: () => data.subscription.unsubscribe() };
  }

  private toAuthSession(
    accessToken: string,
    userId: string,
    email: string | undefined | null,
    expiresAt: number | null | undefined,
  ): AuthSession {
    return {
      userId,
      email: email ?? null,
      accessToken,
      expiresAt: expiresAt ?? null,
    };
  }
}
