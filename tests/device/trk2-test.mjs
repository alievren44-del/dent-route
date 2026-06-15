// R1/R2/R5/R6 yeni gereksinim — plasiyer cihaz testi.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
mkdirSync('tests/device/shots/trk2', { recursive: true });
const SILA = '31ecf2fc-949c-459d-a2f0-77317f02ac6f';
const b = await chromium.connectOverCDP('http://localhost:9222');
const page = b.contexts()[0].pages()[0];
page.setDefaultTimeout(12000);
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
page.on('pageerror', (e) => errs.push('PAGEERR ' + e.message.slice(0, 140)));
const R = {};
const nav = async (x) => { await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate')); }, x); await page.waitForTimeout(2300); };
const body = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const shot = async (n) => { try { await page.screenshot({ path: `tests/device/shots/trk2/${n}.png`, timeout: 6000 }); } catch {} };
const log = (k, ok, x = '') => { R[k] = ok ? 'PASS' : 'FAIL'; console.log(`${ok ? '✅' : '❌'} ${k} ${x}`); };

try {
  // ===== N1 (R1): kliniksiz randevuya "Klinik Bağla" =====
  await nav('/takvim');
  try { await page.getByRole('button', { name: 'Tümü' }).click(); await page.waitForTimeout(1500); } catch {}
  try { await page.getByText('TEST-LINK randevu', { exact: false }).first().click(); await page.waitForTimeout(1400); } catch (e) { console.log('testlink click', e.message.slice(0, 50)); }
  let bt = await body();
  await shot('n1-sheet');
  const hasLinkBtn = bt.includes('Klinik Bağla');
  log('N1a_link_button', hasLinkBtn);
  if (hasLinkBtn) {
    await page.getByRole('button', { name: 'Klinik Bağla' }).click(); await page.waitForTimeout(1300);
    await page.getByPlaceholder('Klinik adı ara…').fill('Sıla'); await page.waitForTimeout(3200);
    await shot('n1-search');
    try {
      await page.locator('[role=dialog] button', { hasText: 'Uzm.Dt. Sıla Sucuka' }).first().click();
      await page.waitForTimeout(2500);
    } catch (e) { console.log('pick', e.message.slice(0, 50)); }
    bt = await body();
    log('N1b_linked', bt.includes('Klinik bağlandı') || bt.includes('bağland'), 'toast');
  } else { log('N1b_linked', false, 'buton yok'); }
  // modal/sheet temizle
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);

  // ===== N2 (R6): klinik geçmişinde "Yaklaşan" randevu =====
  await nav('/clinics/' + SILA);
  try { await page.getByRole('button', { name: 'Zaman Çizelgesi' }).click(); await page.waitForTimeout(2500); } catch {}
  bt = await body();
  await shot('n2-clinic-timeline');
  const n2 = bt.includes('TEST-LINK randevu') && bt.includes('Yaklaşan');
  log('N2_upcoming_in_clinic', n2, `testlink=${bt.includes('TEST-LINK randevu')} yaklasan=${bt.includes('Yaklaşan')}`);

  // ===== N3 (R2): Özet'te "Son Görüşme" kartı =====
  await nav('/clinics/' + SILA);
  await page.waitForTimeout(1500); // overview default
  bt = await body();
  await shot('n3-overview');
  const n3 = bt.includes('Son Görüşme') && (bt.includes('gorusme gerceklesti hekim') || bt.includes('Görüşüldü'));
  log('N3_son_gorusme_card', n3, `kart=${bt.includes('Son Görüşme')}`);

  // ===== N5 (R5): Tekrar Randevu → kaydet → yeni kartta "Önceki görüşmenin devamı" =====
  await nav('/takvim');
  try { await page.getByRole('button', { name: 'Tümü' }).click(); await page.waitForTimeout(1500); } catch {}
  try { await page.getByText('Uzm.Dt. Sıla Sucuka', { exact: false }).first().click(); await page.waitForTimeout(1400); } catch (e) { console.log('sila done click', e.message.slice(0, 50)); }
  bt = await body();
  if (bt.includes('Tekrar Randevu')) {
    await page.getByRole('button', { name: 'Tekrar Randevu' }).click(); await page.waitForTimeout(1400);
    await page.fill('#ar-at', '2026-06-25T11:00'); await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Takvime Ekle' }).click(); await page.waitForTimeout(3000);
    await shot('n5-after-save');
    // yeni follow-up kartını aç (en üstteki Sıla tanıtım open) — Yaklaşan filtre
    await nav('/takvim');
    try { await page.getByRole('button', { name: 'Yaklaşan' }).click(); await page.waitForTimeout(1500); } catch {}
    try { await page.getByText('Uzm.Dt. Sıla Sucuka', { exact: false }).first().click(); await page.waitForTimeout(1400); } catch {}
    bt = await body();
    await shot('n5-followup-sheet');
    log('N5_followup_badge', bt.includes('Önceki görüşmenin devamı'), 'badge');
  } else { log('N5_followup_badge', false, 'tekrar randevu yok'); }

  // ===== regression: F2 Sıla notu hâlâ Zaman Çizelgesi'nde =====
  await nav('/clinics/' + SILA);
  try { await page.getByRole('button', { name: 'Zaman Çizelgesi' }).click(); await page.waitForTimeout(2500); } catch {}
  bt = await body();
  log('REG_F2_clinic_note', bt.includes('gorusme gerceklesti hekim'), '');

} catch (e) {
  console.log('FATAL', e.message);
}
console.log('\n=== SONUÇ ===');
console.log(JSON.stringify(R, null, 1));
if (errs.length) console.log('CONSOLE_ERR', JSON.stringify([...new Set(errs)].slice(0, 5)));
await b.close();
