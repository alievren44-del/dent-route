// 16-phase audit — NAV multi-route smoke on live device
import { chromium } from '@playwright/test';
const log = (...a) => console.log('[walk]', ...a);
const b = await chromium.connectOverCDP('http://localhost:9222');
const ctx = b.contexts()[0];
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(20000);
const routes = ['/admin/dashboard', '/admin/users', '/admin/stock', '/admin/broadcast', '/admin/clinic-scan', '/admin/rep-kpi', '/admin/regions', '/admin/audit-logs'];
try {
  for (const r of routes) {
    const errs = [];
    const onErr = (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); };
    page.on('console', onErr);
    // SPA in-app nav to avoid Capacitor reset (pushState + popstate)
    await page.evaluate((path) => {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, r);
    await page.waitForTimeout(2800);
    const s = await page.evaluate(() => ({
      url: location.pathname,
      denied: /Erişim engellendi|yetkiniz yok|403/i.test(document.body.innerText),
      empty: document.body.innerText.trim().length < 40,
      snip: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80),
    }));
    log(`${r} -> url=${s.url} ${s.denied ? 'DENIED' : s.empty ? 'EMPTY' : 'OK'} err=${errs.length} | ${s.snip}`);
    page.off('console', onErr);
  }
  await page.screenshot({ path: 'tests/device/shots/audit-nav-walk.png' }).catch(() => {});
  log('DONE');
} catch (e) {
  log('FAIL:', e.message);
} finally {
  await b.close();
}
