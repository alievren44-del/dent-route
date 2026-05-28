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
          .then((newProfile) => set({ session: newSession, profile: newProfile }))
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
