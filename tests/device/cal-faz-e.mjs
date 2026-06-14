import { chromium } from '@playwright/test';

const EDA = '6696d578-ab78-456c-887b-f8730a931102';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

await page.goto('https://localhost/takvim', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const out = {};

// Ekle modal aç
await page.getByRole('button', { name: 'Ekle' }).first().click().catch(() => {});
await page.waitForTimeout(1000);

// "Kime" plasiyer seçici (admin + assignableReps fallback) → Eda
const kimeSel = page.locator('#ar-rep');
out.kime_present = await kimeSel.count();
if (out.kime_present) await kimeSel.selectOption(EDA).catch((e) => (out.kime_err = String(e)));

// tip Randevu (default appointment) + tarih-saat yarın 14:00
await page.getByRole('button', { name: 'Randevu', exact: true }).click().catch(() => {});
await page.locator('#ar-at').fill('2026-06-16T14:00').catch((e) => (out.at_err = String(e)));
await page.locator('#ar-title').fill('FAZ-E test atama').catch(() => {});

// Kaydet
await page.getByRole('button', { name: 'Takvime Ekle' }).click().catch(() => {});
await page.waitForTimeout(3500);

// Auto-switch: repFilter Eda'ya geçti mi (#rep-sel value)
out.repsel_value = await page.locator('#rep-sel').inputValue().catch(() => 'n/a');
out.switched_to_eda = out.repsel_value === EDA;
const body = await page.evaluate(() => document.body.innerText);
out.test_visible = /FAZ-E test atama/.test(body);
out.console_errors = errs.slice(0, 5);

console.log(JSON.stringify(out, null, 1));
await b.close();
