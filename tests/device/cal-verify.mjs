import { chromium } from '@playwright/test';

const REPS = [
  ['self', 'Kendi (admin)'],
  ['6696d578-ab78-456c-887b-f8730a931102', 'Eda'],
  ['7b9ee005-3c33-4d3d-ae7e-fc2854aded81', 'ali'],
  ['2651109c-6b51-4656-902c-ff771d148430', 'Saha Push Test'],
];

const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);

await page.goto('https://localhost/takvim', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

async function snapshot(label) {
  // Ay yerine ajanda + Tümü filtresi: tüm kayıtlar görünür.
  await page.waitForTimeout(2500);
  const data = await page.evaluate(() => {
    const body = document.body.innerText;
    const e2e = (body.match(/E2E-TEST randevu g\d/g) || []).length;
    const cards = document.querySelectorAll('li.rounded-2xl').length;
    const empty = /takvim kaydı yok|kayıt yok/i.test(body);
    const loading = /Yükleniyor/i.test(body);
    return { e2e, cards, empty, loading };
  });
  return data;
}

const results = [];
for (const [val, name] of REPS) {
  const sel = page.locator('#rep-sel');
  if (await sel.count()) {
    await sel.selectOption(val).catch(() => {});
    await page.waitForTimeout(500);
  }
  // Ajanda + Tümü
  await page.getByRole('button', { name: 'Ajanda' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Tümü' }).click().catch(() => {});
  const snap = await snapshot(name);
  results.push({ rep: name, ...snap });
}

console.log('REPSEL_PRESENT', await page.locator('#rep-sel').count());
console.log(JSON.stringify(results, null, 1));
await b.close();
