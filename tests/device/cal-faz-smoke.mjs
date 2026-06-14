import { chromium } from '@playwright/test';

const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

await page.goto('https://localhost/takvim', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

const out = {};

// 1) Overdue filtre butonu (Faz C1)
out.gecikti_filter = await page.getByRole('button', { name: 'Gecikti' }).count();

// 2) Ekle modal — recurrence + foto + ses (Faz C3 + D)
await page.getByRole('button', { name: 'Ekle' }).first().click().catch(() => {});
await page.waitForTimeout(1200);
const body = await page.evaluate(() => document.body.innerText);
out.modal_tekrar = /Tekrar|Haftalık|Aylık/.test(body);
out.modal_foto = /Foto ekle|Foto/.test(body);
out.modal_ses = /Ses kaydet|Ses/.test(body);
out.modal_acildi = /Takvime Ekle/.test(body);

await page.keyboard.press('Escape').catch(() => {});

out.console_errors = errs.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
await b.close();
