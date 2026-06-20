// FN-ADMIN — functional (WRITE-flow) CDP device scenario for the ADMIN surface
// of NAV (com.parla.saha).
//
// Account: parametrized via env ADMIN_EMAIL / ADMIN_PW. The orchestrator injects
// a fresh qa-admin; for a dry `node --check` / no-device run we fall back to the
// rep account (which will simply hit ACCESS-DENIED on /admin/* and the script
// reports that cleanly rather than crashing).
//
// SAFETY MODEL (identical to fn-plasiyer):
//   • DEFAULT (RUN_WRITE unset)  = READ-ONLY: assert admin controls/forms PRESENT
//     + render-nonempty + console-error=0. NO submits, NO mutations.
//   • RUN_WRITE=1                = perform gated writes (region assign, KPI target,
//     order approve) with `__QATEST__` markers + cleanup reporting.
//   • A4 broadcast SEND is a REAL push fan-out RPC → gated AND default-off; even
//     under RUN_WRITE we only fill+validate the form, we do NOT click "Gönder"
//     unless RUN_BROADCAST=1 is ALSO set (double opt-in).
//   • A5 clinic-scan: NEVER triggered. We assert scan controls render but never
//     click "Tara"/start under ANY flag — a real scan costs money.
//
// HARNESS: session-inject login → pushState in-app nav → interact → assert.
// Ends with `await b.close(); process.exit(0)` (mandatory).

import { signin, connect, injectAndBoot, navInApp } from './_lib.mjs';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'saha_push_test@parla.local';
const ADMIN_PW = process.env.ADMIN_PW || 'Test1234!';
const WRITE = process.env.RUN_WRITE === '1';
const RUN_BROADCAST = process.env.RUN_BROADCAST === '1'; // extra opt-in for real send

const TS = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const MARK = `__QATEST__${TS}`;

const results = [];
const cleanup = [];

function rec(step, pass, detail) {
  results.push({ step, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${step} ${detail || ''}`.trimEnd());
}

async function snap(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText || '';
    return {
      len: txt.trim().length,
      denied: /Erişim engellendi|yetkiniz yok|yetkisiz/i.test(txt),
      txt: txt.replace(/\s+/g, ' ').slice(0, 200),
    };
  });
}

async function hasText(page, source) {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    return [...document.querySelectorAll('button,a,label,h1,h2,h3,input,textarea,select,[role="dialog"]')].some(
      (el) => re.test(el.textContent || '') || re.test(el.getAttribute('placeholder') || ''),
    );
  }, source);
}

async function clickText(page, source) {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const el = [...document.querySelectorAll('button,a,[role="tab"]')].find((e) => re.test((e.textContent || '').trim()));
    if (el) {
      el.click();
      return true;
    }
    return false;
  }, source);
}

let b;
try {
  const { session, role, sub } = await signin(ADMIN_EMAIL, ADMIN_PW);
  console.log(`ADMIN_SESSION email=${ADMIN_EMAIL} role=${role} sub=${sub} WRITE=${WRITE} BROADCAST=${RUN_BROADCAST} MARK=${MARK}`);
  let page;
  ({ b, page } = await connect());
  const boot = await injectAndBoot(page, session);
  console.log('BOOT=' + JSON.stringify(boot));
  if (boot.err) throw new Error('BOOT_FAIL ' + boot.err);

  // Guard: if this account is not actually admin, /admin/* will be denied. Detect
  // early so every admin step reports "denied (not admin)" instead of false-fail.
  await navInApp(page, '/admin/dashboard', 4000);
  const dash = await snap(page);
  const isAdmin = !dash.denied && dash.len > 40;
  if (!isAdmin) {
    rec('A0 admin access', false, dash.denied ? 'ACCESS DENIED (account is not admin — set ADMIN_EMAIL/ADMIN_PW)' : 'dashboard empty');
  } else {
    rec('A0 admin dashboard render', true, '(admin access confirmed)');
  }

  // -----------------------------------------------------------------------
  // A1 — Kullanıcı (role/approve controls) — READ-ONLY default
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/admin/users', 4000);
    const s = await snap(page);
    const ctrls = !s.denied && (await hasText(page, 'Kullanıcı|Rol|ara'));
    if (!WRITE) {
      rec('A1 users render + role controls', ctrls, s.denied ? 'denied' : '(read-only: role select / approve toggle present)');
    } else {
      // Role change is intentionally NOT performed automatically (escalation risk).
      // We only verify the per-row role <select> exists.
      const hasSelect = await page.evaluate(() => !!document.querySelector('select'));
      rec('A1 role control present', ctrls && hasSelect, '(role change NOT auto-performed — escalation safety)');
    }
  }

  // -----------------------------------------------------------------------
  // A2 — Bölge atama (assign il/ilçe to rep → Kaydet)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/admin/regions', 4000);
    const s = await snap(page);
    const form = !s.denied && (await hasText(page, 'Bölge|İl|Atama|Kaydet'));
    if (!WRITE) {
      rec('A2 region assign form', form, s.denied ? 'denied' : '(read-only: il search + Kaydet present)');
    } else {
      // Pick first rep + first il in the lists, then Kaydet. This re-assigns a
      // region; it is reversible but changes state → flag for review/cleanup.
      const acted = await page.evaluate(() => {
        // select first rep option if a rep <select> exists
        const sel = document.querySelector('select');
        if (sel && sel.options.length > 1) {
          sel.selectedIndex = 1;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        // tick first il checkbox if present
        const cb = document.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
        return true;
      });
      const saved = acted && (await clickText(page, '^Kaydet$|Kaydet'));
      await page.waitForTimeout(2000);
      rec('A2 region assign save', saved, saved ? '(saha region assignment changed — verify)' : 'no rep/il list to assign');
      if (saved) cleanup.push({ type: 'region-assignment', ref: 'manual review: first rep got first il/ilçe toggled (revert in /admin/regions)' });
    }
  }

  // -----------------------------------------------------------------------
  // A3 — KPI/hedef ("Hedef Belirle" → set target → Kaydet)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/admin/rep-kpi', 4000);
    const s = await snap(page);
    const form = !s.denied && (await hasText(page, 'Hedef|KPI|hedefi|Plasiyer'));
    if (!WRITE) {
      rec('A3 KPI target form', form, s.denied ? 'denied' : '(read-only: "Hedef Belirle" + inputs present)');
    } else {
      const acted = await page.evaluate(() => {
        const sel = document.querySelector('select'); // rep picker
        if (sel && sel.options.length > 1) {
          sel.selectedIndex = 1;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        let filled = 0;
        for (const inp of document.querySelectorAll('input[placeholder*="hedef"]')) {
          setter.call(inp, '1');
          inp.dispatchEvent(new Event('input', { bubbles: true }));
          filled++;
        }
        return filled > 0;
      });
      const saved = acted && (await clickText(page, '^Kaydet$|Kaydet'));
      await page.waitForTimeout(2000);
      rec('A3 KPI target save', saved, saved ? '(saha_rep_targets upsert — verify/cleanup)' : 'no rep/inputs');
      if (saved) cleanup.push({ type: 'saha_rep_targets', ref: 'first rep current-month target set to 1 (upsert — reset/delete row)' });
    }
  }

  // -----------------------------------------------------------------------
  // A4 — Toplu bildirim (fill form; SEND gated behind RUN_BROADCAST=1)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/admin/broadcast', 4000);
    const s = await snap(page);
    const form = !s.denied && (await hasText(page, 'Toplu|Bildirim|Gönder|başlık'));
    rec('A4 broadcast form', form, s.denied ? 'denied' : '(form present)');
    if (WRITE && form) {
      // Fill title + body with MARK; only SEND if RUN_BROADCAST=1 (real fan-out).
      await page.evaluate((mark) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const tsetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        const t = document.getElementById('bc-title');
        if (t) { setter.call(t, `${mark} test`); t.dispatchEvent(new Event('input', { bubbles: true })); }
        const bd = document.getElementById('bc-body');
        if (bd) { tsetter.call(bd, `${mark} otomatik test bildirimi — yok sayın`); bd.dispatchEvent(new Event('input', { bubbles: true })); }
      }, MARK);
      const filled = await hasText(page, MARK);
      rec('A4 broadcast fill', filled, '(title+body filled, NOT sent)');
      if (RUN_BROADCAST) {
        const sent = await clickText(page, '^Gönder$|Gönder');
        await page.waitForTimeout(2500);
        rec('A4 broadcast SEND (RUN_BROADCAST=1)', sent, '(REAL fan-out — recipients notified)');
        if (sent) cleanup.push({ type: 'saha_notifications', ref: `body like '%${MARK}%' (broadcast fan-out rows)` });
      } else {
        rec('A4 broadcast send', true, 'SKIPPED send (set RUN_BROADCAST=1 to actually send)');
      }
    }
  }

  // -----------------------------------------------------------------------
  // A5 — Klinik tarama: assert controls render; NEVER trigger a scan (paid)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/admin/clinic-scan', 4500);
    const s = await snap(page);
    const ctrls = !s.denied && (await hasText(page, 'Tarama|İl|İlçe|Klinik|Job|Görev'));
    rec('A5 clinic-scan render', ctrls, s.denied ? 'denied' : '(controls present — SCAN NEVER TRIGGERED: paid)');
    // HARD RULE: do not click "Tara"/start scan under any flag. No interaction here.
  }

  // -----------------------------------------------------------------------
  // A6 — Sipariş onayı ("Onayla" gated behind RUN_WRITE)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/orders/approval', 4000);
    const s = await snap(page);
    const present = !s.denied && (await hasText(page, 'Onay|Bekleyen|Sipariş'));
    if (!WRITE) {
      rec('A6 approval queue render', present, s.denied ? 'denied' : '(read-only: pending list / "Onayla" present)');
    } else {
      // Expand first pending row → click Onayla. This APPROVES a real order
      // (stock + cash side-effects). Only acts if a pending order exists.
      const expanded = await page.evaluate(() => {
        const row = document.querySelector('[data-order-id], li button, .rounded-xl button');
        if (row) { row.click(); return true; }
        return false;
      });
      await page.waitForTimeout(800);
      const approved = await clickText(page, '^Onayla$');
      await page.waitForTimeout(2000);
      const s2 = await snap(page);
      const ok = approved && /onaylandı/i.test(s2.txt);
      rec('A6 order approve', ok, ok ? '(order approved — irreversible side-effects; CLEANUP review)' : 'no pending order or no Onayla button');
      if (ok) cleanup.push({ type: 'orders', ref: 'an order was APPROVED (stock+cash posted) — manual review, not auto-revertible' });
    }
  }

  // -----------------------------------------------------------------------
  // A7 — Stok + audit-logs render (read-only)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/admin/stock', 4000);
    let s = await snap(page);
    rec('A7 stock render', !s.denied && s.len > 40, s.denied ? 'denied' : '(stock ledger renders)');
    await navInApp(page, '/admin/audit-logs', 4000);
    s = await snap(page);
    rec('A7 audit-logs render', !s.denied && s.len > 40, s.denied ? 'denied' : '(audit log renders)');
  }

  const pass = results.filter((r) => r.pass).length;
  console.log(`SUMMARY FN-ADMIN: ${pass}/${results.length}`);
  if (cleanup.length === 0) {
    console.log('CLEANUP_NEEDED: none');
  } else {
    for (const c of cleanup) console.log(`CLEANUP_NEEDED: ${c.type} :: ${c.ref}`);
  }
  console.log('SCENARIO_DONE');
} catch (e) {
  console.log('SCENARIO_ERROR ' + (e?.message || e));
  for (const c of cleanup) console.log(`CLEANUP_NEEDED: ${c.type} :: ${c.ref}`);
  console.log('SCENARIO_DONE');
} finally {
  if (b) await b.close().catch(() => {});
  process.exit(0);
}
