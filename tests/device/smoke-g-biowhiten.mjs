// G smoke: biowhiten variant picker in invoice form. node tests/device/smoke-g-biowhiten.mjs
import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5174';
const EMAIL = 'saha_push_test@parla.local';
const PASS = 'Test1234!';
const SHOTS = 'tests/device/shots/g';
const log = (...a) => console.log('[g]', ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 900 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [err]', m.text().slice(0, 160)); });
try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);

  await page.goto(`${BASE}/invoicing/fatura/yeni`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/01-form.png` });

  const prod = page.locator('input[placeholder="Ürün adı"]').first();
  if (!(await prod.count())) { log('product input not found'); }
  else {
    await prod.fill('biowhiten');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOTS}/02-product-list.png` });
    // click the biowhiten result (should have "paket" hint)
    const opt = page.locator('button:has-text("Biowhiten")').first();
    if (await opt.count()) {
      await opt.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/03-variant-picker.png` });
      const body = await page.textContent('body');
      log('shows "paket seç":', /paket se/i.test(body || ''));
      log('shows 1\'li:', /1'?li/i.test(body || ''));
      log('shows 4\'lü:', /4'?l/i.test(body || ''));
      log('shows 10\'lu:', /10'?lu/i.test(body || ''));
    } else { log('biowhiten option not found in list'); }
  }
} catch (e) { console.error('[g] FAILED', e.message); await page.screenshot({ path: `${SHOTS}/zz-err.png` }).catch(()=>{}); }
finally { await browser.close(); }
