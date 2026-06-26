// A/B/D browser smoke vs live Supabase. Run: node tests/device/smoke-abd.mjs
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:5173';
const EMAIL = 'saha_push_test@parla.local';
const PASS = 'Test1234!';
const ANKARA = { latitude: 39.925, longitude: 32.836 };
const SHOTS = 'tests/device/shots/abd';

const log = (...a) => console.log('[smoke]', ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  geolocation: ANKARA,
  permissions: ['geolocation'],
  viewport: { width: 412, height: 900 },
});
const page = await ctx.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !t.includes('favicon')) console.log('  [console.error]', t.slice(0, 200));
});

try {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // Login
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);
  log('after login url:', page.url());
  await page.screenshot({ path: `${SHOTS}/01-after-login.png` });

  // ---- B: radius ----
  await page.goto(`${BASE}/clinics/discover`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000); // geolocation + nearby fetch
  await page.screenshot({ path: `${SHOTS}/02-discover-default.png` });

  async function readCount() {
    const body = await page.textContent('body');
    const m = body && body.match(/(\d+)\s*\/?\s*\d*\s*klinik/i);
    return m ? m[0] : '(no count found)';
  }

  const counts = {};
  for (const km of ['2', '5', '10']) {
    // radius buttons render like "2 km"
    const btn = page.locator(`button:has-text("${km}km")`).first();
    if (await btn.count()) {
      await btn.click();
      await page.waitForTimeout(3500);
    } else {
      log(`radius button ${km}km not found`);
    }
    counts[km] = await readCount();
    await page.screenshot({ path: `${SHOTS}/03-radius-${km}km.png` });
    log(`radius ${km}km ->`, counts[km]);
  }

  // ---- A: Turkish search ----
  const searchSel = 'input[placeholder*="ra"], input[type="search"], input[placeholder*="lin"]';
  const sIn = page.locator(searchSel).first();
  if (await sIn.count()) {
    await sIn.fill('irem');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${SHOTS}/04-search-irem.png` });
    const afterIrem = await page.textContent('body');
    log('search "irem" mentions İrem/Irem:', /irem/i.test(afterIrem || ''));
    await sIn.fill('avrupa agiz');
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${SHOTS}/05-search-avrupa.png` });
    const afterAv = await page.textContent('body');
    log('search "avrupa agiz" mentions avrupa:', /avrupa/i.test(afterAv || ''));
  } else {
    log('search input not found on discover');
  }

  log('SUMMARY counts:', JSON.stringify(counts));
} catch (e) {
  console.error('[smoke] FAILED:', e.message);
  await page.screenshot({ path: `${SHOTS}/zz-error.png` }).catch(() => {});
} finally {
  await browser.close();
}
