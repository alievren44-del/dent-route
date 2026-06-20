// B2 — ADMIN NAV scenario walk.
// Account: qa-admin@parla-qa.test / TestQA1234!  (admin)
//
// Covers every /admin/* tab + admin-reachable invoicing/orders surfaces.
// Each admin route must RENDER admin content (NOT "Erişim engellendi").
//
// READ + NAV + RENDER assertions only. No writes (no broadcast send, no
// region reassign, no user create). Default = safe + repeatable.
//
// HARNESS: session-inject login -> pushState in-app nav -> per-route assert.
// Ends with `await b.close(); process.exit(0)` (mandatory).

import {
  signin,
  connect,
  injectAndBoot,
  assertRoute,
  printRoute,
  summarize,
} from './_lib.mjs';

const ADMIN_EMAIL = 'qa-admin@parla-qa.test';
const ADMIN_PW = 'TestQA1234!';

let b;
try {
  // 1) Login (session-inject)
  const { session, role, sub } = await signin(ADMIN_EMAIL, ADMIN_PW);
  console.log(`ADMIN_SESSION role=${role} sub=${sub}`);

  // 2) Connect + boot app as admin
  let page;
  ({ b, page } = await connect());
  const boot = await injectAndBoot(page, session);
  console.log('BOOT=' + JSON.stringify(boot));
  if (boot.err) throw new Error('BOOT_FAIL ' + boot.err);

  const results = [];

  // 3) /admin/* tabs — must render admin content (NOT denied), with a specific
  //    text anchor where the page header is known.
  // N-A1 dashboard
  results.push(await assertRoute(page, '/admin/dashboard', { mustContain: /Yönetici Paneli|Performans|Plasiyer|Canlı/, settle: 4500 }));
  // N-A2 users + clinics
  results.push(await assertRoute(page, '/admin/users', { mustContain: /Kullanıcı|Rol|Yeni Kullanıcı|ADMIN|REP/, settle: 4000 }));
  results.push(await assertRoute(page, '/admin/clinics', { mustContain: /Klinik|İçe Aktar|CSV|Yükle/ }));
  // N-A3 stock + broadcast
  results.push(await assertRoute(page, '/admin/stock', { mustContain: /Stok|Hareket|Defter|Ürün/ }));
  results.push(await assertRoute(page, '/admin/broadcast', { mustContain: /Bildirim|Toplu|Gönder|Mesaj/ }));
  // N-A4 clinic-scan + heatmap + bi
  results.push(await assertRoute(page, '/admin/clinic-scan', { mustContain: /Tarama|İl|İlçe|Klinik|Job|Görev/, settle: 4000 }));
  results.push(await assertRoute(page, '/admin/heatmap', { mustContain: /Isı|Harita|Yoğunluk|Klinik/, settle: 4500 }));
  results.push(await assertRoute(page, '/admin/bi', { mustContain: /BI|Rapor|Analiz|Ciro|Grafik/, settle: 4000 }));
  // N-A5 rep-kpi + regions + route-planner
  results.push(await assertRoute(page, '/admin/rep-kpi', { mustContain: /KPI|Hedef|Plasiyer|Skor/ }));
  results.push(await assertRoute(page, '/admin/regions', { mustContain: /Bölge|Atama|Plasiyer|İl/ }));
  results.push(await assertRoute(page, '/admin/route-planner', { mustContain: /Rota|Plan|Tarama|Durak/ }));
  // N-A6 audit-logs + tr-seed
  results.push(await assertRoute(page, '/admin/audit-logs', { mustContain: /Denetim|İz|Log|Kayıt|Filtre/, settle: 4000 }));
  results.push(await assertRoute(page, '/admin/tr-seed', { mustContain: /Seed|İl|İlçe|Türkiye|Yükle/ }));

  // 4) Admin-reachable shared surfaces (admin bypasses sales_rep role + invoicing perm).
  results.push(await assertRoute(page, '/orders/approval', { mustContain: /Onay|Bekleyen|Sipariş/ }));
  results.push(await assertRoute(page, '/orders/new', { mustContain: /Sipariş|Ürün|Müşteri/ }));
  results.push(await assertRoute(page, '/invoicing/cari', { mustContain: /Cari|Bakiye|Yeni/, settle: 4000 }));

  for (const r of results) printRoute(r);
  summarize(results, 'NAV-ADMIN');
  console.log('SCENARIO_DONE');
} catch (e) {
  console.log('SCENARIO_ERROR ' + (e?.message || e));
  console.log('SCENARIO_DONE');
} finally {
  if (b) await b.close().catch(() => {});
  process.exit(0);
}
