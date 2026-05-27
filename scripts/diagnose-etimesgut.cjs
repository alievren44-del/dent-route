/* eslint-disable */
// Etimesgut tarama derin analiz:
//   1. clinic-scan-v3 dryRun çağır → 287 klinik al
//   2. DB orphan Etimesgut listesini al → 78 klinik
//   3. Karşılaştır:
//      - Google bulduğu klinikler içinde orphan adına benzer var mı?
//      - "Bulundu ama match'lenemedi" mi yoksa "Google bulamadı" mı?

'use strict';

const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const p = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
  }
})();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
function normNameTr(s) {
  if (!s) return '';
  let n = String(s).toLocaleLowerCase('tr-TR').trim();
  for (const [a, b] of Object.entries(TR_MAP)) n = n.replaceAll(a, b);
  return n.replace(/[^a-z0-9]/g, '');
}

async function callScan() {
  // Etimesgut centroid + 10km
  const body = {
    lat: 39.9471, lng: 32.66, radiusM: 10000,
    provinceSlug: 'ankara', districtSlug: 'etimesgut',
    source: 'google', intensity: 'deep',
    dryRun: true, includeKamu: true,
  };
  const url = `${SUPABASE_URL}/functions/v1/clinic-scan-v3`;
  console.log('Scan başlıyor (90-120s)…');
  const t0 = Date.now();
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  console.log(`Scan döndü: ${Math.round((Date.now() - t0) / 1000)}s, status: ${r.status}`);
  if (!r.ok) {
    const t = await r.text();
    console.error('FAIL body:', t.slice(0, 500));
    process.exit(1);
  }
  return await r.json();
}

async function fetchOrphans() {
  const { data, error } = await supabase
    .from('saha_clinics')
    .select('id, name, lat, lng')
    .eq('province_slug', 'ankara')
    .eq('district_slug', 'etimesgut')
    .is('google_place_id', null);
  if (error) throw error;
  return data;
}

function jaccard(a, b) {
  const A = new Set(a.split(/[\s_-]+/).filter(Boolean));
  const B = new Set(b.split(/[\s_-]+/).filter(Boolean));
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni === 0 ? 0 : inter / uni;
}

async function main() {
  const [scanResp, orphans] = await Promise.all([callScan(), fetchOrphans()]);
  const scanned = Array.isArray(scanResp?.clinics) ? scanResp.clinics : [];
  console.log(`\n=== ÖZET ===`);
  console.log(`Scan toplam:      ${scanned.length}`);
  console.log(`Scan yeni:        ${scanResp?.new ?? '?'}`);
  console.log(`Scan var olan:    ${scanResp?.updated ?? '?'}`);
  console.log(`DB orphan:        ${orphans.length}`);

  // Her orphan için scan sonucunda en iyi match'i bul
  const PFX = 6;
  let scanFound_butMatchFail = 0;
  let scanNotFound = 0;
  const examples = { found_match_fail: [], notfound: [] };

  for (const o of orphans) {
    const oNorm = normNameTr(o.name);
    if (!oNorm) continue;
    let bestScore = 0;
    let bestScan = null;
    for (const s of scanned) {
      const sNorm = normNameTr(s.name);
      if (!sNorm) continue;
      // prefix-6 match?
      const pfxMatch = oNorm.length >= PFX && sNorm.length >= PFX && oNorm.slice(0, PFX) === sNorm.slice(0, PFX);
      // jaccard token similarity
      const score = jaccard(o.name.toLowerCase(), s.name.toLowerCase());
      const combined = pfxMatch ? Math.max(score, 0.5) : score;
      if (combined > bestScore) {
        bestScore = combined;
        bestScan = s;
      }
    }
    if (bestScore >= 0.5 || (bestScan && normNameTr(bestScan.name).slice(0, PFX) === oNorm.slice(0, PFX) && oNorm.length >= PFX)) {
      scanFound_butMatchFail++;
      if (examples.found_match_fail.length < 10) {
        examples.found_match_fail.push({
          orphan: o.name,
          scan: bestScan.name,
          score: bestScore.toFixed(2),
        });
      }
    } else {
      scanNotFound++;
      if (examples.notfound.length < 10) {
        examples.notfound.push(o.name);
      }
    }
  }

  console.log(`\n=== TEŞHİS ===`);
  console.log(`Orphan, scan'da BENZERİ VAR (match algorithm fail): ${scanFound_butMatchFail}`);
  console.log(`Orphan, scan'da YOK (Google bulamadı):              ${scanNotFound}`);

  console.log('\n--- Scan buldu ama match fail (örnek) ---');
  for (const ex of examples.found_match_fail) {
    console.log(`  Excel: "${ex.orphan}"`);
    console.log(`  Scan : "${ex.scan}"   [jaccard=${ex.score}]`);
    console.log('');
  }

  console.log('--- Scan hiç bulamadı (örnek) ---');
  for (const n of examples.notfound) {
    console.log(`  - ${n}`);
  }

  // Tüm scan klinik isimlerini Etimesgut civarındaymış gibi listele (filter)
  // Bunlar Google'ın bulduğu, DB'de yoksa "yeni" diyeceği klinikler
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
