// NAV rep-login client-guard testi: sales_rep oturumu inject → /admin/* erişim kontrolü.
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// web .env'den URL+anon (aynı Supabase projesi)
const env = Object.fromEntries(
  readFileSync('C:/Users/PC/Desktop/web sitesi/.env', 'utf8').split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { data: login, error } = await sb.auth.signInWithPassword({ email: 'saha_push_test@parla.local', password: 'Test1234!' });
if (error) { console.log('REP_SIGNIN_ERR=' + error.message); process.exit(1); }
const sess = login.session;
// rolü doğrula
const jp = JSON.parse(Buffer.from(sess.access_token.split('.')[1], 'base64').toString());
console.log('REP_SESSION sub=' + jp.sub + ' app_role=' + (jp.app_metadata?.role || '?'));

const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);

// rep session inject + reload (app fresh boot, rep olarak)
await page.evaluate((s) => { localStorage.setItem('parla-shared-auth', JSON.stringify(s)); }, sess);
await page.goto('https://localhost/', { waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(4000);
const boot = await page.evaluate(() => {
  try { const j = JSON.parse(localStorage.getItem('parla-shared-auth'));
    const p = JSON.parse(atob(j.access_token.split('.')[1]));
    return { booted_role: p.app_metadata?.role, sub: p.sub, url: location.pathname }; } catch (e) { return { err: String(e).slice(0,80) }; }
});
console.log('BOOT=' + JSON.stringify(boot));

// /admin/* erişim
for (const r of ['/admin/dashboard', '/admin/users', '/admin/audit-logs', '/admin/broadcast']) {
  await page.evaluate((path) => { window.history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); }, r);
  await page.waitForTimeout(3500);
  const s = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      url: location.pathname,
      denied: /Erişim engellendi|yetkiniz yok|yetkisiz|403|Bu sayfa|bulunamadı/i.test(txt),
      loading: /Yükleniyor|Loading/i.test(txt),
      emails: (txt.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []).length,
      snip: txt.replace(/\s+/g, ' ').slice(0, 90),
    };
  });
  console.log(`ADMIN ${r} -> url=${s.url} denied=${s.denied} loading=${s.loading} emails=${s.emails} | ${s.snip}`);
}
console.log('REP_GUARD_DONE');
await b.close().catch(() => {});
process.exit(0);
