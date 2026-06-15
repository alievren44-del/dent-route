// Tekrar Randevu + Klinik Not görünürlüğü — plasiyer 10-senaryo cihaz testi.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/device/shots/trk', { recursive: true });
const SILA = '31ecf2fc-949c-459d-a2f0-77317f02ac6f';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message.slice(0, 140)));
const R = {};
const nav = async (x) => { await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, x); await page.waitForTimeout(2200); };
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const shot = async (n) => { try { await page.screenshot({ path: `tests/device/shots/trk/${n}.png`, timeout: 6000 }); } catch {} };
const log = (k, ok, extra = '') => { R[k] = ok ? 'PASS' : 'FAIL'; console.log(`${ok ? '✅' : '❌'} ${k} ${extra}`); };

try {
  // ---- S1: Sıla klinik Zaman Çizelgesi'nde görüşme notu ----
  await nav('/clinics/' + SILA);
  let bt = await body();
  const hasTab = bt.includes('Zaman Çizelgesi');
  if (hasTab) { try { await page.getByRole('button', { name: 'Zaman Çizelgesi' }).click(); await page.waitForTimeout(2500); } catch {} }
  bt = await body();
  await shot('s1-clinic-timeline');
  const s1note = bt.includes('gorusme gerceklesti hekim elindeki');
  const s1outcome = bt.includes('Görüşüldü');
  log('S1_clinic_note', s1note && s1outcome, `note=${s1note} gorusuldu=${s1outcome}`);

  // ---- S7: birleşik akış (randevu kartı render) / S8: notsuz "tanisma" gizli ----
  const s8hidden = !bt.includes('tanisma');
  log('S8_empty_reminder_hidden', s8hidden, `tanisma_yok=${s8hidden}`);
  const s7merged = bt.includes('Tanıtım') || bt.includes('Randevu') || bt.includes('Ziyaret');
  log('S7_merged_timeline', s7merged);

  // ---- S2/S6: /takvim Tümü → Sıla tanıtım done karta dokun → sheet ----
  await nav('/takvim');
  try { await page.getByRole('button', { name: 'Tümü' }).click(); await page.waitForTimeout(1800); } catch {}
  // Sıla tanıtım done kartını başlıkla bul ve aç
  let opened = false;
  try {
    await page.getByText('Uzm.Dt. Sıla Sucuka', { exact: false }).first().click();
    await page.waitForTimeout(1500); opened = true;
  } catch (e) { console.log('sila card click', e.message.slice(0, 60)); }
  bt = await body();
  await shot('s2-sheet-sila');
  const s2btn = bt.includes('Tekrar Randevu');
  log('S2_followup_button', s2btn);
  const s6note = bt.includes('gorusme gerceklesti hekim') || bt.includes('Görüşüldü');
  const s6reopen = bt.includes('Geri al');
  log('S6_done_detail', s6note && s6reopen, `not=${s6note} geri_al=${s6reopen}`);

  // ---- S3: Tekrar Randevu → modal ön-dolu (klinik + başlık) ----
  if (s2btn) {
    try { await page.getByRole('button', { name: 'Tekrar Randevu' }).click(); await page.waitForTimeout(1500); } catch (e) { console.log('trk click', e.message.slice(0, 60)); }
    bt = await body();
    await shot('s3-modal-prefill');
    let titleVal = '';
    try { titleVal = await page.inputValue('#ar-title'); } catch {}
    const s3title = titleVal.includes('Sıla') || titleVal.includes('Tanıtım');
    const s3clinic = bt.includes('Sıla Sucuka'); // klinik chip
    log('S3_prefill', s3title && s3clinic, `title="${titleVal.slice(0, 40)}" clinic=${s3clinic}`);
    // bu prefill testini kaydetmeden kapat (gerçek kayıt dekan senaryosunda)
    try { await page.getByRole('button', { name: 'Kapat' }).click(); await page.waitForTimeout(800); } catch {}
  } else { log('S3_prefill', false, 'buton yok'); }

  // ---- S5 + gerçek ihtiyaç: dekan done kart → Tekrar Randevu → klinik BOŞ → Pzt 20:00 KAYDET ----
  await nav('/takvim');
  try { await page.getByRole('button', { name: 'Tümü' }).click(); await page.waitForTimeout(1500); } catch {}
  try {
    await page.getByText('dekanla görüsme', { exact: false }).first().click();
    await page.waitForTimeout(1500);
  } catch (e) { console.log('dekan click', e.message.slice(0, 60)); }
  bt = await body();
  const dekanBtn = bt.includes('Tekrar Randevu');
  if (dekanBtn) {
    await page.getByRole('button', { name: 'Tekrar Randevu' }).click(); await page.waitForTimeout(1400);
    bt = await body();
    await shot('s5-dekan-modal');
    let titleVal = ''; try { titleVal = await page.inputValue('#ar-title'); } catch {}
    const s5noClinic = !bt.includes('Sıla Sucuka'); // dekan kliniksiz
    log('S5_null_clinic_flow', s5noClinic && titleVal.includes('dekan'), `title="${titleVal.slice(0,30)}" noClinic=${s5noClinic}`);
    // Pazartesi 22 Haz 2026 20:00 — gerçek ihtiyaç randevusu
    try { await page.fill('#ar-at', '2026-06-22T20:00'); await page.waitForTimeout(500); } catch (e) { console.log('fill at', e.message.slice(0,50)); }
    await page.getByRole('button', { name: 'Takvime Ekle' }).click();
    await page.waitForTimeout(3000);
    bt = await body();
    await shot('s3s5-after-save');
    log('S3_save_followup', bt.includes('Takvime eklendi') || bt.includes('22'), 'kaydedildi');
  } else { log('S5_null_clinic_flow', false, 'dekan buton yok'); log('S3_save_followup', false, ''); }

  // ---- S9: boş "+ Ekle" prefill yok ----
  await nav('/takvim');
  try { await page.getByRole('button', { name: 'Ekle' }).first().click(); await page.waitForTimeout(1400); } catch (e) { console.log('ekle', e.message.slice(0,50)); }
  let emptyTitle = 'x'; try { emptyTitle = await page.inputValue('#ar-title'); } catch {}
  await shot('s9-empty-add');
  log('S9_empty_add', emptyTitle === '', `title="${emptyTitle}"`);
  try { await page.getByRole('button', { name: 'Kapat' }).click(); await page.waitForTimeout(600); } catch {}

  // ---- S4 + S10: açık randevu detay → Tekrar Randevu + aksiyonlar ----
  await nav('/takvim');
  try { await page.getByRole('button', { name: 'Yaklaşan' }).click(); await page.waitForTimeout(1500); } catch {}
  try {
    // açık (done olmayan) ilk reminder kartını aç — başlık değişebilir, en üstteki randevu
    await page.locator('[role=button]').filter({ hasText: 'Randevu' }).first().click();
    await page.waitForTimeout(1400);
  } catch (e) { console.log('open card', e.message.slice(0,60)); }
  bt = await body();
  await shot('s4-open-detail');
  const s4 = bt.includes('Tekrar Randevu');
  const s10 = bt.includes('ertele') && bt.includes('Tamamla');
  log('S4_followup_on_open', s4);
  log('S10_actions_intact', s10, `ertele+tamamla=${s10}`);

} catch (e) {
  console.log('FATAL', e.message);
}

console.log('\n=== SONUÇ ===');
console.log(JSON.stringify(R, null, 1));
if (errs.length) console.log('CONSOLE_ERR', JSON.stringify([...new Set(errs)].slice(0, 5)));
await b.close();
