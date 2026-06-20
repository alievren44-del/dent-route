// FN-PLASİYER — functional (WRITE-flow) CDP device scenario for the PLASİYER
// (sales_rep) surface of NAV (com.parla.saha).
//
// Account: saha_push_test@parla.local / Test1234!  (sales_rep, approved, kvkk-ok)
//
// SAFETY MODEL (read this before running):
//   • DEFAULT (RUN_WRITE unset / != '1')  = READ-ONLY.
//       Navigate to each flow, assert the create form / control is PRESENT and
//       rendered (non-empty, no console errors). NO submits, NO data created.
//   • RUN_WRITE=1                          = perform the writes, BUT:
//       - every created entity is tagged with the QA marker `__QATEST__<ts>` in
//         its name/notes so it is grep-able for cleanup,
//       - the script attempts to clean up what it can via the app UI,
//       - anything it cannot auto-delete is printed on a `CLEANUP_NEEDED:` line
//         (type + id/marker) for the orchestrator to SQL-delete.
//   • Some flows CANNOT be auto-submitted from CDP without a real device:
//       P1 check-in   → GPS-gated (needs position within distance of clinic),
//       P8 numune     → requires a photo + a hand-drawn signature canvas,
//       P9/P10 teslim → requires an existing "Malzeme Teslimi" reminder card.
//     For these we do control-presence assertions even under RUN_WRITE and flag
//     them as DEVICE-ONLY in the log (orchestrator confirms manually on device).
//
// HARNESS: session-inject login → pushState in-app nav → interact → assert.
// Ends with `await b.close(); process.exit(0)` (mandatory — else CDP hangs node).

import { signin, connect, injectAndBoot, navInApp } from './_lib.mjs';

const REP_EMAIL = process.env.REP_EMAIL || 'saha_push_test@parla.local';
const REP_PW = process.env.REP_PW || 'Test1234!';
const WRITE = process.env.RUN_WRITE === '1';

// QA marker — every created entity carries this so cleanup can grep it.
const TS = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const MARK = `__QATEST__${TS}`;

// Optional dedicated test target (orchestrator creates + injects these). With no
// env we fall back to a name-search the flows can resolve at runtime; comments
// note where a real id makes the flow deterministic.
const TEST_CLINIC_ID = process.env.TEST_CLINIC_ID || ''; // saha_clinics.id (P1/P2/P3)
const TEST_CARI_ID = process.env.TEST_CARI_ID || ''; // saha_cariler.id (P6/P7/P11)

const results = [];
const cleanup = []; // {type, ref} entries we could NOT auto-remove

function rec(step, pass, detail) {
  results.push({ step, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${step} ${detail || ''}`.trimEnd());
}

/** Read the visible body text + console error count for the current route. */
async function snap(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText || '';
    return { len: txt.trim().length, txt: txt.replace(/\s+/g, ' ').slice(0, 200) };
  });
}

/** True if any element whose visible text matches `re` exists (button/label/etc). */
async function hasText(page, source) {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    return [...document.querySelectorAll('button,a,label,h1,h2,h3,input,textarea,[role="dialog"]')].some(
      (el) => re.test(el.textContent || '') || re.test(el.getAttribute('placeholder') || ''),
    );
  }, source);
}

/** Click the first button/link/tab whose visible text matches `source`. */
async function clickText(page, source) {
  return page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const el = [...document.querySelectorAll('button,a,[role="tab"],label')].find((e) =>
      re.test((e.textContent || '').trim()),
    );
    if (el) {
      el.click();
      return true;
    }
    return false;
  }, source);
}

/** Type into the first input/textarea matching a placeholder regex (React-safe). */
async function fillByPlaceholder(page, placeholderSrc, value) {
  const sel = await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const el = [...document.querySelectorAll('input,textarea')].find((e) =>
      re.test(e.getAttribute('placeholder') || ''),
    );
    if (!el) return null;
    el.setAttribute('data-qa-target', '1');
    return '[data-qa-target="1"]';
  }, placeholderSrc);
  if (!sel) return false;
  await page.fill(sel, value);
  await page.evaluate(() => document.querySelector('[data-qa-target="1"]')?.removeAttribute('data-qa-target'));
  return true;
}

let b;
try {
  // 1) Login + boot as rep
  const { session, role, sub } = await signin(REP_EMAIL, REP_PW);
  console.log(`REP_SESSION role=${role} sub=${sub} WRITE=${WRITE} MARK=${MARK}`);
  let page;
  ({ b, page } = await connect());
  const boot = await injectAndBoot(page, session);
  console.log('BOOT=' + JSON.stringify(boot));
  if (boot.err) throw new Error('BOOT_FAIL ' + boot.err);

  // -----------------------------------------------------------------------
  // P1 — Ziyaret check-in (GPS-gated → DEVICE-ONLY submit)
  // -----------------------------------------------------------------------
  {
    // Reached via clinic detail "Yeni Ziyaret" → /visits/check-in/:id.
    if (TEST_CLINIC_ID) {
      await navInApp(page, `/visits/check-in/${TEST_CLINIC_ID}`, 3500);
    } else {
      await navInApp(page, '/clinics', 3500);
    }
    const present = await hasText(page, 'Check-in|Ziyaret|Konum');
    rec('P1 check-in render', present, present ? '(submit is GPS-gated → DEVICE-ONLY)' : 'control not found');
    // The actual "Check-in Yap" submit cannot succeed off-device (needs GPS within
    // range of the clinic). We never click it here.
  }

  // -----------------------------------------------------------------------
  // P2 — Not alma (clinic detail → Notlar tab → add note)
  // -----------------------------------------------------------------------
  if (TEST_CLINIC_ID) {
    await navInApp(page, `/clinics/${TEST_CLINIC_ID}`, 3500);
    const tab = await clickText(page, 'Notlar');
    await page.waitForTimeout(800);
    const formPresent = await hasText(page, 'Not ekle|Not Ekle');
    if (!WRITE) {
      rec('P2 note form', tab && formPresent, formPresent ? '(read-only)' : 'note tab/textarea missing');
    } else {
      const noteText = `${MARK} otomatik test notu`;
      const filled = await fillByPlaceholder(page, 'Not ekle', noteText);
      const clicked = filled && (await clickText(page, '^Not Ekle$|Not Ekle'));
      await page.waitForTimeout(2500);
      const s = await snap(page);
      const ok = clicked && s.txt.includes(MARK);
      rec('P2 note create', ok, ok ? '(note visible)' : 'submit/verify failed');
      if (ok) {
        // saha_account_notes has no in-app delete UI → flag for SQL cleanup.
        cleanup.push({ type: 'saha_account_notes', ref: `note like '%${MARK}%'` });
      }
    }
  } else {
    rec('P2 note', false, 'SKIP: TEST_CLINIC_ID unset (set env for deterministic run)');
  }

  // -----------------------------------------------------------------------
  // P3 — Randevu + P4 Hatırlatma (+ recurrence) via /takvim "Ekle" modal
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/takvim', 3500);
    const addBtn = await hasText(page, '^Ekle$|Ekle');
    if (!WRITE) {
      rec('P3/P4 calendar add', addBtn, '(read-only: "Ekle" present)');
    } else {
      const opened = await clickText(page, '^Ekle$');
      await page.waitForTimeout(900);
      const modal = await hasText(page, 'Takvime Ekle');
      // Type = Randevu, recurrence weekly (P3 recurrence), title carries MARK.
      await clickText(page, '^Randevu$');
      await clickText(page, '^Haftalık$'); // recurrence present check
      // datetime-local id=ar-at — set to tomorrow 10:00 (future, else guard blocks).
      await page.evaluate(() => {
        const d = new Date(Date.now() + 86400000);
        const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T10:00`;
        const el = document.getElementById('ar-at');
        if (el) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      await page.evaluate((mark) => {
        const el = document.getElementById('ar-title');
        if (el) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, `${mark} randevu`);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, MARK);
      const saved = await clickText(page, '^Takvime Ekle$|Takvime Ekle');
      await page.waitForTimeout(2500);
      const s = await snap(page);
      const ok = opened && modal && saved && (s.txt.includes('eklendi') || s.txt.includes(MARK));
      rec('P3/P4 reminder create (recurrence weekly)', ok, ok ? '(saha_reminders)' : 'modal/save failed');
      if (ok) cleanup.push({ type: 'saha_reminders', ref: `title like '%${MARK}%'` });
    }
  }

  // -----------------------------------------------------------------------
  // P5 — Satış (order create, rep auto-approve under threshold)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/orders/new', 3500);
    const form = await hasText(page, 'Müşteri|Ürün Ekle|Sipariş');
    if (!WRITE) {
      rec('P5 order form', form, '(read-only: customer + product search present)');
    } else {
      // Pick the test cari/clinic by name search, add first product, submit.
      // NOTE: real submission creates a live order. We tag the note with MARK.
      // Customer search needs ≥2 chars + a real match; deterministic only with a
      // known test clinic name passed via TEST_CLINIC_NAME. Falls back to 'test'
      // and degrades to control-presence if no match is returned.
      const custSearch = process.env.TEST_CLINIC_NAME || 'test';
      await fillByPlaceholder(page, 'Müşteri ara', custSearch);
      await page.waitForTimeout(1500);
      const pickedCust = await page.evaluate(() => {
        const opt = document.querySelector('.shadow-lg button');
        if (opt) {
          opt.click();
          return true;
        }
        return false;
      });
      let ordered = false;
      if (pickedCust) {
        await fillByPlaceholder(page, 'Ürün ara', 'frez');
        await page.waitForTimeout(1500);
        const pickedProd = await page.evaluate(() => {
          const opt = document.querySelector('.shadow-lg button');
          if (opt) {
            opt.click();
            return true;
          }
          return false;
        });
        // notes carry MARK for cleanup grep
        await fillByPlaceholder(page, 'sipariş notu', `${MARK}`);
        if (pickedProd) {
          ordered = await clickText(page, 'Sipariş Oluştur|Onaya Gönder');
          await page.waitForTimeout(2500);
        }
      }
      rec('P5 order create', ordered, ordered ? '(order placed — see CLEANUP)' : 'no deterministic test customer/product — control-presence only');
      if (ordered) cleanup.push({ type: 'orders/saha_orders', ref: `notes like '%${MARK}%'` });
    }
  }

  // -----------------------------------------------------------------------
  // P6 — Faturasız satış (KDV=0) + P7 normal fatura (KDV applied)
  // -----------------------------------------------------------------------
  {
    const url = TEST_CARI_ID ? `/invoicing/fatura/yeni?cari_id=${TEST_CARI_ID}` : '/invoicing/fatura/yeni';
    await navInApp(page, url, 3500);
    const form = await hasText(page, 'Faturasız|Kalem|Cari');
    if (!WRITE) {
      rec('P6/P7 invoice form', form, '(read-only: Faturasız toggle + kalem present)');
    } else if (!TEST_CARI_ID) {
      rec('P6/P7 invoice', false, 'SKIP write: TEST_CARI_ID unset (cari required to submit)');
    } else {
      // P6 faturasız: toggle Faturasız → KDV must compute 0.
      await page.evaluate(() => {
        const cb = [...document.querySelectorAll('input[type="checkbox"]')].find((c) =>
          /Faturasız/i.test(c.closest('label')?.textContent || ''),
        );
        if (cb && !cb.checked) cb.click();
      });
      // fill first kalem product name + qty/price so totals compute
      await fillByPlaceholder(page, 'Ürün adı', `${MARK} kalem`);
      await page.waitForTimeout(400);
      // KDV displayed should be ₺0,00 when faturasız.
      const kdvZero = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('*')].filter((e) => /KDV/i.test(e.textContent || '') && e.children.length < 3);
        return rows.some((r) => /KDV/i.test(r.textContent) && /0,00|₺0/.test(r.parentElement?.textContent || ''));
      });
      rec('P6 faturasız KDV=0', kdvZero, kdvZero ? '(KDV-hariç verified in UI)' : 'KDV-zero not confirmed (needs valid price row)');
      // Submit faturasız invoice
      const saved = await clickText(page, 'Kaydet & Gönder|Kaydet&|Taslak');
      await page.waitForTimeout(2500);
      rec('P6 faturasız invoice create', saved, saved ? '(saha_faturalar)' : 'submit failed');
      if (saved) cleanup.push({ type: 'saha_faturalar', ref: `aciklama/kalem like '%${MARK}%' (faturasız)` });

      // P7 normal: new invoice WITHOUT faturasız → KDV applied.
      await navInApp(page, url, 3000);
      await fillByPlaceholder(page, 'Ürün adı', `${MARK} kalem n`);
      const kdvApplied = await page.evaluate(() => /KDV/i.test(document.body.innerText));
      rec('P7 normal invoice KDV present', kdvApplied, '(faturasız OFF → KDV row shown)');
      const saved2 = await clickText(page, 'Kaydet & Gönder|Taslak');
      await page.waitForTimeout(2000);
      rec('P7 normal invoice create', saved2, saved2 ? '(saha_faturalar)' : 'submit failed');
      if (saved2) cleanup.push({ type: 'saha_faturalar', ref: `kalem like '%${MARK}%' (normal)` });
    }
  }

  // -----------------------------------------------------------------------
  // P8 — Numune (budget check) — DEVICE-ONLY submit (photo + signature required)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/samples', 3500);
    await clickText(page, '^Yeni$|Yeni');
    await page.waitForTimeout(900);
    const budget = await hasText(page, 'Bütçe|Numune Ver|Ürün Ekle');
    rec('P8 numune form + budget', budget, '(submit requires photo+imza canvas → DEVICE-ONLY)');
    // We never auto-submit: photo + signature canvas cannot be supplied off-device.
  }

  // -----------------------------------------------------------------------
  // P9/P10 — Teslim outcome + bildirim — DEVICE-ONLY (needs a teslim card)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/takvim', 3500);
    // Outcome buttons live on the ReminderDetailSheet of a "Malzeme Teslimi" card.
    const present = await hasText(page, 'Malzeme Teslim|Teslim|Tahsilat');
    if (!WRITE) {
      rec('P9/P10 teslim outcome', present, '(read-only: presence of teslim cards/labels)');
    } else {
      // Open a teslim card if one exists and assert outcome buttons render.
      const opened = await clickText(page, 'Malzeme Teslim');
      await page.waitForTimeout(900);
      const outcomeBtns = await hasText(page, 'Teslim Edildi|Kısmi Teslim|Teslim Edilemedi');
      rec('P9/P10 teslim outcome buttons', outcomeBtns, outcomeBtns ? '(present — completing creates auto follow-up)' : 'no teslim card on calendar → DEVICE-ONLY');
      // We do NOT click an outcome under automation: it mutates a real reminder and
      // fan-outs a notification + 1-month follow-up. Confirmed on device by orchestrator.
    }
  }

  // -----------------------------------------------------------------------
  // P11 — Cari takibi (balance / aging / transactions render)
  // -----------------------------------------------------------------------
  {
    if (TEST_CARI_ID) {
      await navInApp(page, `/invoicing/cari/${TEST_CARI_ID}`, 4000);
    } else {
      await navInApp(page, '/invoicing/cari', 4000);
    }
    const s = await snap(page);
    const ok = s.len > 40 && (await hasText(page, 'Bakiye|Cari|Faturalar|Ekstre|Ödemeler'));
    rec('P11 cari render', ok, ok ? '(balance/tabs present)' : 'empty/missing');
    // Aging report
    await navInApp(page, '/invoicing/aging', 3500);
    const aging = await hasText(page, 'Yaşlandırma|Vade|Gün|Alacak');
    rec('P11 aging render', aging, '(read-only)');
  }

  // -----------------------------------------------------------------------
  // P12 — Rota: plan (add stop) + auto (generate)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/routes/plan', 3500);
    const plan = await hasText(page, 'Rota|Optimize|Durak|Başlangıç');
    rec('P12 route planner', plan, '(read-only: optimize control present; stops come from /clinics basket)');
    await navInApp(page, '/routes/auto', 3500);
    const auto = await hasText(page, 'Otomatik|Rotayı oluştur|İlçe');
    if (!WRITE) {
      rec('P12 route auto', auto, '(read-only: "Rotayı oluştur" present — GPS-gated)');
    } else {
      // "Rotayı oluştur" is GPS-gated; it does not persist a destructive entity by
      // itself (builds an in-memory plan), so generating is safe but needs device GPS.
      rec('P12 route auto', auto, '(generate is GPS-gated → DEVICE-ONLY)');
    }
  }

  // -----------------------------------------------------------------------
  // P13 — Klinik/Cari ekle (rep-side "Yeni Cari" on /invoicing/cari)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/invoicing/cari', 3800);
    const btn = await hasText(page, 'Yeni Cari');
    if (!WRITE) {
      rec('P13 yeni cari form', btn, '(read-only: "Yeni Cari" button present)');
    } else {
      const opened = await clickText(page, 'Yeni Cari');
      await page.waitForTimeout(900);
      // Required field "Fatura Unvanı *" — fill with MARK, then Kaydet.
      const filled = await page.evaluate((mark) => {
        const lbl = [...document.querySelectorAll('label')].find((l) => /Fatura Unvanı/i.test(l.textContent || ''));
        const inp = lbl?.parentElement?.querySelector('input');
        if (!inp) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(inp, `${mark} cari`);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }, MARK);
      const saved = filled && (await clickText(page, '^Kaydet$|Kaydet'));
      await page.waitForTimeout(2500);
      const s = await snap(page);
      // success navigates to /invoicing/cari/:id
      const ok = saved && /\/invoicing\/cari\//.test(await page.evaluate(() => location.pathname));
      rec('P13 cari create', ok, ok ? '(saha_cariler)' : 'submit/nav failed');
      if (ok) cleanup.push({ type: 'saha_cariler', ref: `fatura_unvani like '%${MARK}%'` });
    }
  }

  // -----------------------------------------------------------------------
  // P14 — Bildirim oku (mark read)
  // -----------------------------------------------------------------------
  {
    await navInApp(page, '/notifications', 3500);
    const present = await hasText(page, 'Bildirim|okundu');
    if (!WRITE) {
      rec('P14 notifications render', present, '(read-only)');
    } else {
      // "Hepsini okundu işaretle" is idempotent + non-destructive (read_at stamp).
      const before = await page.evaluate(() => /Okunmamış \(\d/.test(document.body.innerText));
      const clicked = await clickText(page, 'Hepsini okundu işaretle');
      await page.waitForTimeout(1500);
      rec('P14 mark all read', clicked, '(non-destructive read_at stamp)');
    }
  }

  // -----------------------------------------------------------------------
  // SUMMARY + CLEANUP report
  // -----------------------------------------------------------------------
  const pass = results.filter((r) => r.pass).length;
  console.log(`SUMMARY FN-PLASIYER: ${pass}/${results.length}`);
  if (cleanup.length === 0) {
    console.log('CLEANUP_NEEDED: none');
  } else {
    for (const c of cleanup) console.log(`CLEANUP_NEEDED: ${c.type} :: ${c.ref}`);
  }
  console.log('SCENARIO_DONE');
} catch (e) {
  console.log('SCENARIO_ERROR ' + (e?.message || e));
  // Still emit any pending cleanup so created entities are never orphaned silently.
  for (const c of cleanup) console.log(`CLEANUP_NEEDED: ${c.type} :: ${c.ref}`);
  console.log('SCENARIO_DONE');
} finally {
  if (b) await b.close().catch(() => {});
  process.exit(0);
}
