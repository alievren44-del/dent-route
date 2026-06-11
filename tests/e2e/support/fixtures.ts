import { test as base, expect, type Page } from '@playwright/test';
import { installSupabaseMock, seedAuth, makeUser, type MockConfig, type MockUser } from './mock';

/**
 * NAV E2E fixtures.
 * - `mock(cfg)` : sayfa açılmadan ÖNCE Supabase/functions intercept'lerini kur (+ user varsa seed).
 * - `loginAs`   : belirli rolde oturum (ProtectedRoute arkasındaki route'lar için ZORUNLU).
 */
type MockFn = (cfg?: MockConfig) => Promise<void>;

export const test = base.extend<{ mock: MockFn }>({
  mock: async ({ page }, use) => {
    const fn: MockFn = async (cfg = {}) => {
      await installSupabaseMock(page, cfg);
      if (cfg.user) await seedAuth(page, cfg.user);
    };
    await use(fn);
  },
});

/**
 * Belirli rolde oturum aç. page.goto'dan ÖNCE çağır.
 * role: 'ADMIN' | 'SALES_REP' | 'REP' (profiles.role → mapParlaToSahaRole).
 *
 * NAV auth: session → validateSession(getUser) → fetchProfile('profiles' .single).
 * ProtectedRoute isAuthenticated = session && profile; kvkkAccepted = profile.kvkk_accepted_at.
 * Bu helper `profiles` satırını OTOMATIK enjekte eder (KVKK kabul + is_approved).
 * cfg.tables ile override edilebilir (örn. başka klinik/sipariş verisi).
 */
export async function loginAs(page: Page, role = 'ADMIN', cfg: MockConfig = {}): Promise<MockUser> {
  const user = makeUser({ role });
  const profileRow = {
    id: user.id,
    email: user.email,
    ad_soyad: 'Test Kullanıcı',
    role, // ADMIN / SALES_REP / REP
    region: 'Ankara',
    avg_fuel_consumption: 7.5,
    kvkk_accepted_at: new Date(0).toISOString(),
    kvkk_version: '1.0',
    is_approved: true,
  };
  // profileRow HER ZAMAN kazanır (auth kullanıcısı). cfg.tables.profiles auth profilini EZEMEZ.
  const tables = { ...(cfg.tables ?? {}), profiles: [profileRow, ...(cfg.tables?.profiles ?? [])] };
  await installSupabaseMock(page, { ...cfg, tables, user });
  await seedAuth(page, user);
  return user;
}

export { expect, makeUser };
