import { chromium } from '@playwright/test';

const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const out = {};

await page.goto('https://localhost/takvim', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
await page.getByRole('button', { name: 'Tümü' }).click().catch(() => {});
await page.waitForTimeout(1500);

// 1) Kart-tap → sheet aç
const card = page.locator('li.rounded-2xl').filter({ hasText: 'FAZF-TEST' }).first();
out.card_found = await card.count();
if (out.card_found) {
  await card.locator('div[role="button"]').first().click().catch(() => {});
  await page.waitForTimeout(1200);
}
let body = await page.evaluate(() => document.body.innerText);
out.sheet_opened = /Tamamla|Ertele|Rotaya/.test(body);

// 2) Tamamla → outcome seçici
await page.getByRole('button', { name: 'Tamamla', exact: true }).click().catch(() => {});
await page.waitForTimeout(800);
body = await page.evaluate(() => document.body.innerText);
out.outcome_selector = /Görüşüldü|Tekrar Aranacak/.test(body);

// 3) "Görüşüldü" seç + not + Kaydet
await page.getByRole('button', { name: 'Görüşüldü' }).click().catch(() => {});
await page.locator('textarea').last().fill('cihaz testi — fiyat konuşuldu').catch(() => {});
await page.getByRole('button', { name: 'Kaydet' }).click().catch(() => {});
await page.waitForTimeout(2500);

// 4) Sonuç: kart done + outcome görünür mü (Tümü'de)
await page.getByRole('button', { name: 'Tümü' }).click().catch(() => {});
await page.waitForTimeout(1500);
body = await page.evaluate(() => document.body.innerText);
out.done_outcome_visible = /Görüşüldü — cihaz testi/.test(body);
out.console_clean = true;

console.log(JSON.stringify(out, null, 1));
await b.close();
