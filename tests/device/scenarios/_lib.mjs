// Shared CDP device-scenario helpers for NAV (com.parla.saha).
//
// Login model = SESSION-INJECT (no UI typing): supabase signInWithPassword on the
// SAME Supabase project the app uses, then write the session into the app's
// storageKey `parla-shared-auth` and boot the app once via a hard goto. After boot
// all in-app navigation uses pushState + PopStateEvent so Capacitor does NOT reset
// the WebView (a hard navigation re-initialises the native app and drops state).
//
// CRITICAL harness rules baked in here (from prior NAV CDP debugging):
//   (1) every script that imports this MUST call `await b.close(); process.exit(0)`
//       at the end, otherwise the CDP websocket keeps node alive and output buffers.
//   (2) in-app nav = window.history.pushState + dispatchEvent(PopStateEvent) ONLY.
//   (3) supabase storageKey is `parla-shared-auth`.
//   (4) env (VITE_SUPABASE_URL + anon) read from web .env (same project) with
//       fallback to navigasyon/.env.production.
//
// READ-ONLY by default. No create/INSERT flows here — see RUN_WRITE gate note in
// plasiyer.mjs.

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const WEB_ENV = 'C:/Users/PC/Desktop/web sitesi/.env';
const NAV_ENV = 'C:/Users/PC/Desktop/navigasyon/.env.production';

/** Parse a dotenv file into a plain object (ignores comments/blank lines). */
function parseEnv(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#') && l.includes('='))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

/** Resolve VITE_SUPABASE_URL + anon key, preferring web .env, falling back to NAV. */
export function loadSupabaseEnv() {
  const web = parseEnv(WEB_ENV);
  const nav = parseEnv(NAV_ENV);
  const url = web.VITE_SUPABASE_URL || nav.VITE_SUPABASE_URL;
  const anon =
    web.VITE_SUPABASE_ANON_KEY ||
    nav.VITE_SUPABASE_ANON_KEY ||
    web.VITE_SUPABASE_PUBLISHABLE_KEY ||
    nav.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    throw new Error('Supabase URL/anon not found in web .env or navigasyon/.env.production');
  }
  return { url, anon };
}

/**
 * Sign in via supabase-js and return the session object (to be injected).
 * Also decodes app_metadata.role for a sanity log line.
 */
export async function signin(email, pw) {
  const { url, anon } = loadSupabaseEnv();
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error(`SIGNIN_ERR(${email})=${error.message}`);
  const session = data.session;
  let role = '?';
  try {
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64').toString());
    role = claims.app_metadata?.role || claims.role || '?';
  } catch {
    /* ignore decode errors */
  }
  return { session, role, sub: data.user?.id };
}

/** Connect to the device WebView over CDP and return { b, page }. */
export async function connect() {
  const b = await chromium.connectOverCDP('http://localhost:9222');
  const ctx = b.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.setDefaultTimeout(20000);
  return { b, page };
}

/**
 * Inject the session into localStorage and boot the app fresh (one hard goto).
 * Returns the booted role/sub/url read back from storage for verification.
 */
export async function injectAndBoot(page, session) {
  // Rol-değişiminde bayat profil/approval cache'i (persisted react-query, IndexedDB)
  // önceki kullanıcının verisini gösteriyordu → temizle, sonra taze session yaz.
  await page.evaluate((s) => {
    try { localStorage.clear(); } catch (_) {}
    try { (indexedDB.databases ? indexedDB.databases() : Promise.resolve([])).then((dbs) => (dbs || []).forEach((d) => d?.name && indexedDB.deleteDatabase(d.name))); } catch (_) {}
    localStorage.setItem('parla-shared-auth', JSON.stringify(s));
  }, session);
  await page.goto('https://localhost/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(4500);
  return page.evaluate(() => {
    try {
      const j = JSON.parse(localStorage.getItem('parla-shared-auth'));
      const p = JSON.parse(atob(j.access_token.split('.')[1]));
      return { booted_role: p.app_metadata?.role || p.role, sub: p.sub, url: location.pathname };
    } catch (e) {
      return { err: String(e).slice(0, 100) };
    }
  });
}

/**
 * In-app SPA navigation (NO hard goto — preserves Capacitor WebView state).
 * Waits `settle` ms for lazy chunk + data fetch.
 */
export async function navInApp(page, path, settle = 3200) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await page.waitForTimeout(settle);
}

/**
 * Assert the current route's render state. Attaches a console listener for the
 * duration of the nav so console-errors are attributed to the right route.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} path                route to navigate to
 * @param {object} opts
 * @param {boolean} [opts.expectDenied] true if AccessDenied is the PASS condition
 * @param {RegExp}  [opts.mustContain]  text that must appear (specific assertion)
 * @param {number}  [opts.settle]       ms to wait after nav
 * @returns {Promise<{path,url,denied,loading,empty,emails,errs,contains,snip,pass,reason}>}
 */
export async function assertRoute(page, path, opts = {}) {
  const { expectDenied = false, mustContain = null, settle = 3200 } = opts;
  const errs = [];
  const onErr = (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      // Filter known-benign device noise (favicon, ServiceWorker, ResizeObserver).
      if (!/favicon|ResizeObserver|ServiceWorker|net::ERR_FAILED.*favicon/i.test(t)) {
        errs.push(t.slice(0, 140));
      }
    }
  };
  page.on('console', onErr);
  await navInApp(page, path, settle);

  const s = await page.evaluate((mc) => {
    const txt = document.body.innerText || '';
    return {
      url: location.pathname,
      denied: /Erişim engellendi|yetkiniz yok|yetkisiz|403/i.test(txt),
      // "stuck loading" heuristic: a spinner word is essentially the whole body.
      loading: /(Yükleniyor|Yetki kontrol ediliyor|Loading)/i.test(txt) && txt.trim().length < 120,
      empty: txt.trim().length < 30,
      emails: (txt.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []).length,
      contains: mc ? new RegExp(mc, 'i').test(txt) : null,
      snip: txt.replace(/\s+/g, ' ').slice(0, 110),
    };
  }, mustContain ? mustContain.source : null);

  page.off('console', onErr);

  // PASS logic
  let pass = true;
  let reason = '';
  if (expectDenied) {
    if (!s.denied) {
      pass = false;
      reason = 'expected DENIED but rendered content';
    }
  } else {
    if (s.denied) {
      pass = false;
      reason = 'unexpected ACCESS DENIED';
    } else if (s.empty) {
      pass = false;
      reason = 'empty render';
    } else if (s.loading) {
      pass = false;
      reason = 'stuck on loading/permission spinner';
    } else if (errs.length > 0) {
      pass = false;
      reason = `console-error x${errs.length}: ${errs[0]}`;
    } else if (mustContain && s.contains === false) {
      pass = false;
      reason = `missing expected text /${mustContain.source}/`;
    }
  }
  return { path, ...s, errs, pass, reason };
}

/** Pretty one-line printer for an assertRoute result. */
export function printRoute(r) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  const flags = [
    r.denied ? 'DENIED' : '',
    r.loading ? 'LOADING' : '',
    r.empty ? 'EMPTY' : '',
    `err=${r.errs.length}`,
    r.contains === true ? 'match✓' : r.contains === false ? 'match✗' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const why = r.pass ? '' : `  << ${r.reason}`;
  console.log(`[${tag}] ${r.path.padEnd(30)} ${flags.padEnd(34)} | ${r.snip}${why}`);
}

/** Summary line + return non-zero-ish marker for the orchestrator to grep. */
export function summarize(results, label) {
  const pass = results.filter((r) => r.pass).length;
  const fail = results.length - pass;
  console.log(`SUMMARY ${label}: ${pass}/${results.length} pass, ${fail} fail`);
  return { pass, fail };
}
