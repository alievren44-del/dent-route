import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5176';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, geolocation: { latitude: 39.925, longitude: 32.836 }, permissions: ['geolocation'] });
const p = await ctx.newPage();
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) { errs++; console.log('  [err]', m.text().slice(0, 140)); } });
try {
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.fill('input[type="email"]', 'saha_push_test@parla.local');
  await p.fill('input[type="password"]', 'Test1234!');
  await p.click('button[type="submit"]'); await p.waitForTimeout(3500);

  // /clinics — I-A sort option
  await p.goto(`${BASE}/clinics`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3000);
  await p.screenshot({ path: 'tests/device/shots/i-clinics.png' });
  const clinicsBody = await p.textContent('body');
  console.log('[i] /clinics no-crash:', !/something went wrong|ErrorBoundary/i.test(clinicsBody || ''));
  console.log('[i] /clinics "Potansiyele göre" sort:', /Potansiyele g/i.test(clinicsBody || ''));

  // discover — I-B add-clinic button
  await p.goto(`${BASE}/clinics/discover`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(4000);
  await p.screenshot({ path: 'tests/device/shots/i-discover.png' });
  const discBody = await p.textContent('body');
  console.log('[i] discover "yeni klinik" btn:', /yeni klinik|konuma yeni/i.test(discBody || ''));

  console.log('[i] console errors:', errs);
} catch (e) { console.error('[i] FAIL', e.message); }
finally { await b.close(); }
