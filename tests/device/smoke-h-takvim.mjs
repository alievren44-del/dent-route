import { chromium } from '@playwright/test';
const BASE = 'http://localhost:5175';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 } });
const p = await ctx.newPage();
let errs = 0;
p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) { errs++; console.log('  [err]', m.text().slice(0, 140)); } });
try {
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.fill('input[type="email"]', 'saha_push_test@parla.local');
  await p.fill('input[type="password"]', 'Test1234!');
  await p.click('button[type="submit"]'); await p.waitForTimeout(3500);
  await p.goto(`${BASE}/takvim`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  await p.screenshot({ path: 'tests/device/shots/h-takvim.png' });
  const body = await p.textContent('body');
  console.log('[h] error boundary?', /bir (hata|şey ters)|something went wrong|ErrorBoundary/i.test(body || ''));
  console.log('[h] chip Yaklaşan:', /Yakla/i.test(body || ''));
  console.log('[h] console errors:', errs);
  console.log('[h] url:', p.url());
} catch (e) { console.error('[h] FAIL', e.message); }
finally { await b.close(); }
