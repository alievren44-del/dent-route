// B1 — PLASİYER (sales_rep) NAV scenario walk.
// Account: saha_push_test@parla.local / Test1234!  (sales_rep)
//
// Covers the rep-visible surface of NAV: takvim, clinics, gorevler, harita,
// routes/*, orders (new + history), samples, invoicing (cari + aging),
// tahsilatlar, sales, history, notifications — PLUS the /admin/* guard
// regression (rep must see "Erişim engellendi").
//
// READ + NAV + RENDER + GUARD only. No data is created. A guarded write-flow
// (create order) is sketched behind RUN_WRITE=1 and is OFF by default; it is a
// no-op placeholder (only logs intent) so this file NEVER mutates prod.
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

const REP_EMAIL = 'saha_push_test@parla.local';
const REP_PW = 'Test1234!';

let b;
try {
  // 1) Login (session-inject)
  const { session, role, sub } = await signin(REP_EMAIL, REP_PW);
  console.log(`REP_SESSION role=${role} sub=${sub}`);

  // 2) Connect + boot app as rep
  let page;
  ({ b, page } = await connect());
  const boot = await injectAndBoot(page, session);
  console.log('BOOT=' + JSON.stringify(boot));
  if (boot.err) throw new Error('BOOT_FAIL ' + boot.err);

  const results = [];

  // 3) Allowed rep routes — each with a specific content assertion.
  // N-P1 takvim
  results.push(await assertRoute(page, '/takvim', { mustContain: /Randevu|Ajanda|Bugün|Ekle/ }));
  // N-P2 clinics list + discover
  results.push(await assertRoute(page, '/clinics', { mustContain: /Klinik|Müşteri|Ara|Ekle/ }));
  results.push(await assertRoute(page, '/clinics/discover', { mustContain: /Keşfet|Yakın|Tara|Klinik/ }));
  results.push(await assertRoute(page, '/nearby-provinces', { mustContain: /İl|Çevre|Mesafe|Yakın/ }));
  // N-P3 gorevler + harita
  results.push(await assertRoute(page, '/gorevler', { mustContain: /Görev|Tamamla|Ekle/ }));
  results.push(await assertRoute(page, '/harita', { mustContain: /Harita|Konum|Klinik/, settle: 4000 }));
  // N-P4 routes/*
  results.push(await assertRoute(page, '/routes/plan', { mustContain: /Rota|Durak|Plan/ }));
  results.push(await assertRoute(page, '/routes/auto', { mustContain: /Rota|Otomatik|İlçe|Plan/ }));
  results.push(await assertRoute(page, '/routes/corridor', { mustContain: /Koridor|Yol|Rota/ }));
  results.push(await assertRoute(page, '/routes/assigned', { mustContain: /Atan|Rota|Kabul/ }));
  // N-P5 orders (rep-only route → must render, not denied)
  results.push(await assertRoute(page, '/orders/new', { mustContain: /Sipariş|Ürün|Müşteri|Sepet/ }));
  results.push(await assertRoute(page, '/orders/history', { mustContain: /Sipariş|Geçmiş|Durum/ }));
  // N-P6 samples + invoicing (cari/aging gated by saha:invoicing:access — rep should have it)
  results.push(await assertRoute(page, '/samples', { mustContain: /Numune|Talep|Bütçe/ }));
  results.push(await assertRoute(page, '/invoicing/cari', { mustContain: /Cari|Bakiye|Yeni/, settle: 4000 }));
  results.push(await assertRoute(page, '/invoicing/aging', { mustContain: /Yaşlandırma|Vade|Alacak|Gün/ }));
  // N-P8 tahsilatlar + sales + history
  results.push(await assertRoute(page, '/tahsilatlar', { mustContain: /Tahsilat|Ödeme|₺/ }));
  results.push(await assertRoute(page, '/sales', { mustContain: /Satış|₺|Hedef|Sipariş/ }));
  results.push(await assertRoute(page, '/history', { mustContain: /Ziyaret|Geçmiş|Tarih/ }));
  // N-P9 notifications
  results.push(await assertRoute(page, '/notifications', { mustContain: /Bildirim|Okundu|Yeni/ }));

  // 4) N-P10 GUARD regression — admin routes must be DENIED for rep.
  for (const r of ['/admin/dashboard', '/admin/users', '/admin/audit-logs', '/admin/broadcast', '/admin/stock']) {
    results.push(await assertRoute(page, r, { expectDenied: true }));
  }
  // /orders/approval is requireRole=admin → rep denied too.
  results.push(await assertRoute(page, '/orders/approval', { expectDenied: true }));

  // 5) OPTIONAL guarded write-flow (OFF by default). Never mutates prod here.
  if (process.env.RUN_WRITE === '1') {
    // Placeholder: a real create-order flow would (a) pick a TEST cari only,
    // (b) add a sample item, (c) submit, (d) capture order id, (e) the
    // orchestrator/cleanup script deletes that order via service-role.
    // Intentionally NOT implemented to keep this suite non-destructive.
    console.log('RUN_WRITE=1 set, but create-order flow is a non-destructive placeholder (no INSERT performed).');
  }

  for (const r of results) printRoute(r);
  summarize(results, 'NAV-PLASIYER');
  console.log('SCENARIO_DONE');
} catch (e) {
  console.log('SCENARIO_ERROR ' + (e?.message || e));
  console.log('SCENARIO_DONE');
} finally {
  if (b) await b.close().catch(() => {});
  process.exit(0);
}
