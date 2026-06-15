// İzole temiz doğrulama: R1 (link), R2 (Son Görüşme), R5 (badge deeplink).
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/device/shots/trk3', { recursive: true });
const SILA = '31ecf2fc-949c-459d-a2f0-77317f02ac6f';
const FOLLOWUP = '0709ade1-35ea-4b3b-b480-d970de1156a2'; // source_ref=followup:c97232ea
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
const R = {};
const nav = async (x) => { await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, x); await page.waitForTimeout(2600); };
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const shot = async (n) => { try { await page.screenshot({ path: `tests/device/shots/trk3/${n}.png`, timeout: 6000 }); } catch {} };
const log = (k, ok, x = '') => { R[k] = ok ? 'PASS' : 'FAIL'; console.log(`${ok ? '✅' : '❌'} ${k} ${x}`); };

try {
  // ---- R1: TEST-LINK (kliniksiz) → Klinik Bağla → Sıla ----
  await nav('/takvim');
  await page.getByRole('button', { name: 'Tümü' }).click().catch(() => {});
  await page.waitForTimeout(1500);
  await page.getByText('TEST-LINK randevu', { exact: false }).first().click();
  await page.waitForTimeout(1300);
  let bt = await body();
  const linkBtn = bt.includes('Klinik Bağla');
  log('R1a_link_button', linkBtn);
  if (linkBtn) {
    await page.getByRole('button', { name: 'Klinik Bağla' }).click();
    await page.waitForTimeout(1300);
    await page.getByPlaceholder('Klinik adı ara…').fill('Sıla');
    await page.waitForTimeout(3200);
    await shot('r1-search');
    await page.locator('[role=dialog] button', { hasText: 'Uzm.Dt. Sıla Sucuka' }).first().click();
    await page.waitForTimeout(2500);
    bt = await body();
    log('R1b_linked', bt.includes('bağland'), 'toast');
  } else log('R1b_linked', false, 'buton yok');

  // ---- R2: Sıla Özet → Son Görüşme kartı ----
  await nav('/clinics/' + SILA);
  await page.waitForTimeout(3200);
  bt = await body();
  await shot('r2-overview');
  log('R2_son_gorusme', bt.includes('Son Görüşme') && bt.includes('gorusme gerceklesti hekim'),
    `kart=${bt.includes('Son Görüşme')}`);

  // ---- R5: follow-up kartı → "Önceki görüşmenin devamı" badge (deeplink) ----
  await nav('/takvim?reminder=' + FOLLOWUP);
  await page.waitForTimeout(2500);
  try {
    await page.locator('#reminder-' + FOLLOWUP).click();
    await page.waitForTimeout(1400);
  } catch (e) { console.log('deeplink click', e.message.slice(0, 50)); }
  bt = await body();
  await shot('r5-badge');
  log('R5_followup_badge', bt.includes('Önceki görüşmenin devamı'));

} catch (e) {
  console.log('FATAL', e.message);
}
console.log('\n=== SONUÇ ===');
console.log(JSON.stringify(R, null, 1));
if (errs.length) console.log('CONSOLE_ERR', JSON.stringify([...new Set(errs)].slice(0, 5)));
await b.close();
