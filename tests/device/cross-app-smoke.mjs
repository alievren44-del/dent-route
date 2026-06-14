import { chromium } from '@playwright/test';

const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });

const out = {};
async function visit(path, key, expectRe) {
  await page.goto('https://localhost' + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const body = await page.evaluate(() => document.body.innerText);
  out[key] = { url: await page.evaluate(() => location.href), match: expectRe.test(body) };
}

// Admin sayfaları (admin login varsayılır)
await visit('/admin/broadcast', 'broadcast', /Toplu Bildirim|Gönder|Hedef|Mesaj/);
await visit('/admin/dashboard', 'dashboard', /Canlı Aktivite|Bugün henüz|ziyaret/);

out.console_errors = errs.slice(0, 6);
console.log(JSON.stringify(out, null, 1));
await b.close();
