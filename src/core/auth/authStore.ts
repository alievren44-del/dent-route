/**
 * Zustand auth store.
 *
 * Login durumunu, profili ve loading state'i tutar.
 * persistedSession Supabase tarafından localStorage'a yazılır (storageKey:
 * 'saha-app-auth'). Burada sadece runtime cache + profil bilgisi tutuyoruz.
 */

import { create } from 'zustand';
import { AuthClient } from './AuthClient';
import type { AuthSession, SahaProfile } from './types';

interface AuthStoreState {
  session: AuthSession | null;
  profile: SahaProfile | null;
  loading: boolean;
  error: string | null;

  // Actions
  initialize(client?: AuthClient): Promise<void>;
  signIn(email: string, password: string, client?: AuthClient): Promise<void>;
  signOut(client?: AuthClient): Promise<void>;
  acceptKvkk(version: string, client?: AuthClient): Promise<void>;
  refreshProfile(client?: AuthClient): Promise<void>;
}

let defaultClient: AuthClient | null = null;
function getClient(injected?: AuthClient): AuthClient {
  if (injected) return injected;
  if (!defaultClient) defaultClient = new AuthClient();
  return defaultClient;
}

let authStateSubscription: { unsubscribe: () => void } | null = null;

// Profil offline cache — offline açılışta (uygulamayı kapat-aç) session
// localStorage'dan gelir ama profiles query ağ ister. Son başarılı profili
// saklayıp offline'da buradan okuruz (offline-first okuma).
//
// MAX_CACHE_AGE: 24 saatten eski cache geçersiz sayılır. Böylece deaktive
// edilmiş/düşürülmüş bir temsilci uzun süre offline erişim yapamaz.
const PROFILE_CACHE_KEY = 'saha-profile-cache';
const MAX_CACHE_AGE = 24 * 60 * 60 * 1000; // 24 saat (ms)

interface ProfileCacheEntry {
  ts: number;       // Date.now() — yazıldığı an
  profile: SahaProfile;
}

function cacheProfile(profile: SahaProfile): void {
  try {
    const entry: ProfileCacheEntry = { ts: Date.now(), profile };
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* yutulur */
  }
}
function readCachedProfile(userId: string): SahaProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ProfileCacheEntry;
    // Eski format (ts alanı yok) veya süresi dolmuş → null döndür.
    if (!entry || typeof entry.ts !== 'number') return null;
    if (Date.now() - entry.ts > MAX_CACHE_AGE) return null;
    const p = entry.profile;
    return p && p.id === userId ? p : null;
  } catch {
    return null;
  }
}

export const useAuthStore = create<AuthStoreState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,
  error: null,

  async initialize(client) {
    const authClient = getClient(client);
    set({ loading: true, error: null });
    try {
      const session = await authClient.getCurrentSession();
      if (!session) {
        set({ session: null, profile: null, loading: false });
        return;
      }

      // Server-side validate — eski/silinmiş session row varsa otomatik signOut.
      // Supabase ES256 JWT'lerinde session_id DB lookup gerek; lookup fail =
      // 401 "Session from session_id claim does not exist".
      const validity = await authClient.validateSession();
      if (!validity.valid) {
        // Offline (Failed to fetch) → logout etme; persisted session + cached
        // profil ile devam et, veri katmanı cache'ten okusun.
        if (validity.offline) {
          const cachedProfile = readCachedProfile(session.userId);
          set({ session, profile: cachedProfile, loading: false, error: null });
          return;
        }
        // Gerçek geçersiz oturum (401) → signOut.
        await authClient.signOut().catch(() => {
          /* yutulur */
        });
        set({
          session: null,
          profile: null,
          loading: false,
          error: `Oturum sona erdi (${validity.error ?? 'unknown'}). Lütfen tekrar giriş yapın.`,
        });
        return;
      }

      const profile = await authClient.fetchProfile(session.userId);
      cacheProfile(profile);
      set({ session, profile, loading: false });

      // Subscribe to future auth changes — eski subscription varsa kapat
      // (StrictMode double-mount veya HMR sırasında üst üste binmesin).
      authStateSubscription?.unsubscribe();
      authStateSubscription = authClient.onAuthStateChange((newSession) => {
        if (!newSession) {
          set({ session: null, profile: null });
          return;
        }
        void authClient
          .fetchProfile(newSession.userId)
          .then((newProfile) => {
            cacheProfile(newProfile);
            set({ session: newSession, profile: newProfile });
          })
          .catch((err: unknown) =>
            set({ error: err instanceof Error ? err.message : String(err) }),
          );
      });
    } catch (err) {
      set({
        session: null,
        profile: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async signIn(email, password, client) {
    const authClient = getClient(client);
    set({ loading: true, error: null });
    try {
      const session = await authClient.signInWithEmail(email, password);
      const profile = await authClient.fetchProfile(session.userId);
      cacheProfile(profile);
      set({ session, profile, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : String(err),
        session: null,
        profile: null,
      });
      throw err;
    }
  },

  async signOut(client) {
    const authClient = getClient(client);
    await authClient.signOut();
    try {
      localStorage.removeItem(PROFILE_CACHE_KEY);
    } catch {
      /* yutulur */
    }
    set({ session: null, profile: null, error: null });
  },

  async acceptKvkk(version, client) {
    const authClient = getClient(client);
    const userId = get().session?.userId;
    if (!userId) throw new Error('Oturum yok.');
    await authClient.acceptKvkk(userId, version);
    await get().refreshProfile(client);
  },

  async refreshProfile(client) {
    const authClient = getClient(client);
    const userId = get().session?.userId;
    if (!userId) return;
    const profile = await authClient.fetchProfile(userId);
    set({ profile });
  },
}));
