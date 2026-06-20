import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
const who = await page.evaluate(() => {
  const out = {};
  try {
    const raw = localStorage.getItem('parla-shared-auth');
    out.rawType = typeof raw; out.rawLen = raw?.length;
    const j = JSON.parse(raw);
    const at = j?.access_token || j?.currentSession?.access_token || j?.session?.access_token;
    out.topKeys = Object.keys(j || {}).slice(0, 8);
    if (at) {
      const p = JSON.parse(atob(at.split('.')[1]));
      out.sub = p.sub; out.email = p.email; out.role_claim = p.role;
      out.app_role = p.app_metadata?.role; out.user_role = p.user_metadata?.role;
    }
  } catch (e) { out.err = String(e).slice(0, 120); }
  return out;
});
console.log('WHOAMI=' + JSON.stringify(who));
await b.close().catch(() => {});
process.exit(0);
