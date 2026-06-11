import { test, expect } from './support/fixtures';
import { loginAs } from './support/fixtures';

/**
 * Harness sağlık testi — NAV dev server + Supabase mock + auth-seed çalışıyor mu?
 * NOT: NAV PWA — page.goto'da waitUntil:'domcontentloaded' kullan ('load' asılı dış
 * istekler yüzünden fire olmayabilir). Worker spec'leri bu pattern'i izler.
 */
test.describe('harness smoke', () => {
  test('login sayfası mock ile render olur', async ({ page, mock }) => {
    await mock({ tables: {} });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
  });

  test('ADMIN seed ile korumalı route açılır', async ({ page }) => {
    // NOT: profiles'ı override ETME — loginAs auth profilini otomatik enjekte eder.
    await loginAs(page, 'ADMIN', {
      tables: { saha_clinics: [], orders: [], saha_notifications: [] },
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#root')).not.toBeEmpty({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    expect(page.url()).not.toContain('/login');
  });
});
