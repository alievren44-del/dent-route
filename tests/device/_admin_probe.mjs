// NAV admin-access probe: mevcut oturum rolü + admin-data gerçekten yükleniyor mu (RLS-leak mi shell mi)
import { chromium } from '@playwright/test';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(15000);

// 1) mevcut kullanıcı + rol (Capacitor Preferences / supabase session)
const who = await page.evaluate(async () => {
  const out = { keys: [] };
  try {
    // localStorage taraması
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (/auth|supabase|user|role|token|sb-/i.test(k)) out.keys.push(k);
    }
    // supabase token'dan JWT payload çöz (rol için)
    const sbKey = out.keys.find((k) => /auth-token|sb-.*-auth/i.test(k));
    if (sbKey) {
      const raw = JSON.parse(localStorage.getItem(sbKey));
      const at = raw?.access_token || raw?.currentSession?.access_token;
      if (at) {
        const p = JSON.parse(atob(at.split('.')[1]));
        out.jwt_sub = p.sub; out.jwt_role = p.role; out.jwt_email = p.email;
        out.app_meta = p.app_metadata; out.user_meta = p.user_metadata;
      }
    }
  } catch (e) { out.err = String(e).slice(0, 100); }
  return out;
});
console.log('WHO=', JSON.stringify(who));

// 2) /admin/users — gerçek kullanıcı satırı render oluyor mu yoksa Yükleniyor/boş mu
await page.evaluate(() => { window.history.pushState({}, '', '/admin/users'); window.dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(4000);
const usersPage = await page.evaluate(() => {
  const txt = document.body.innerText;
  // satır/tablo benzeri kullanıcı verisi var mı (email pattern veya rol-rozeti çoklu)
  const emails = (txt.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []).length;
  return {
    loading: /Yükleniyor|Loading/i.test(txt),
    denied: /Erişim engellendi|yetkiniz yok|403|yetkisiz/i.test(txt),
    emailCount: emails,
    rowsHint: (txt.match(/SALES_REP|REP|ADMIN|admin|sales_rep/g) || []).length,
    snip: txt.replace(/\s+/g, ' ').slice(0, 200),
  };
});
console.log('ADMIN_USERS=', JSON.stringify(usersPage));

// 3) /admin/audit-logs — denetim verisi gerçekten geliyor mu
await page.evaluate(() => { window.history.pushState({}, '', '/admin/audit-logs'); window.dispatchEvent(new PopStateEvent('popstate')); });
await page.waitForTimeout(4000);
const audit = await page.evaluate(() => {
  const txt = document.body.innerText;
  return { loading: /Yükleniyor|Loading/i.test(txt), denied: /Erişim|403|yetki/i.test(txt), len: txt.length, snip: txt.replace(/\s+/g, ' ').slice(0, 160) };
});
console.log('AUDIT_LOGS=', JSON.stringify(audit));
console.log('PROBE_DONE');
await b.close().catch(() => {});
process.exit(0);
