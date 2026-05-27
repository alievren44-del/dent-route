/* eslint-disable */
// Province-level scan orchestrator:
//   Bir il'in tüm ilçelerini sırayla clinic-scan-v3 ile tarar (deep + strictDistrict).
//   Sonuçlar DB'ye otomatik yazılır. Sonra `export-province-route.cjs` ile Excel.
//
// Kullanım:
//   node scripts/scan-province.cjs malatya
//   node scripts/scan-province.cjs sivas --intensity=standard
//   node scripts/scan-province.cjs kastamonu --skip-existing
//
// Maliyet uyarısı: her ilçe ~$0.50-2 Google Places. Tüm il ~$10-50.

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

const provinces = require('../src/data/tr-locations/provinces.json');
const districts = require('../src/data/tr-locations/districts.json');

async function scanDistrict(prov, district, intensity) {
  const body = {
    lat: district.lat,
    lng: district.lng,
    radiusM: 15000, // strictDistrict aktifken radius önemsiz; geniş tut
    provinceSlug: prov.slug,
    districtSlug: district.slug,
    source: 'google',
    intensity,
    includeKamu: true,
    dryRun: false, // canonical liste için commit
    strictDistrict: true,
  };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/clinic-scan-v3`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return { status: r.status, err: text.slice(0, 200) };
  }
  return await r.json();
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Kullanım: node scripts/scan-province.cjs <province_slug> [--intensity=standard|deep|exhaustive] [--skip-existing]');
    process.exit(1);
  }
  const intensityArg = process.argv.find((a) => a.startsWith('--intensity='));
  const intensity = intensityArg ? intensityArg.split('=')[1] : 'deep';
  const skipExisting = process.argv.includes('--skip-existing');

  const prov = provinces.find((p) => p.slug === slug);
  if (!prov) { console.error('Province bulunamadı:', slug); process.exit(1); }
  const provDistricts = districts.filter((d) => d.il_plaka === prov.plaka);

  console.log(`Province: ${prov.ad} (${provDistricts.length} ilçe)`);
  console.log(`Intensity: ${intensity}`);
  console.log(`Skip existing: ${skipExisting}\n`);

  let toScan = provDistricts;
  if (skipExisting) {
    const { data: scanned } = await supabase
      .from('saha_clinic_scan_logs')
      .select('district_slug')
      .eq('province_slug', slug)
      .eq('scan_mode', 'v3');
    const seen = new Set((scanned ?? []).map((r) => r.district_slug));
    toScan = provDistricts.filter((d) => !seen.has(d.slug));
    console.log(`Skip uygulandı: ${provDistricts.length - toScan.length} atlandı, ${toScan.length} kaldı\n`);
  }

  const t0 = Date.now();
  let okCount = 0;
  let totalNew = 0;
  let totalScanned = 0;

  for (let i = 0; i < toScan.length; i++) {
    const d = toScan[i];
    const tStart = Date.now();
    process.stdout.write(`[${i + 1}/${toScan.length}] ${d.ad.padEnd(20)} `);
    try {
      const res = await scanDistrict(prov, d, intensity);
      if (res?.status === 'ok') {
        okCount++;
        totalNew += res.new ?? 0;
        totalScanned += res.scanned ?? 0;
        const elapsed = Math.round((Date.now() - tStart) / 1000);
        console.log(`scanned=${res.scanned} new=${res.new} updated=${res.updated} filtered_out=${res.filtered_out ?? 0} ${elapsed}s`);
      } else {
        console.log(`FAIL (status=${res?.status || '?'}): ${res?.err ? res.err.slice(0, 100) : JSON.stringify(res).slice(0, 100)}`);
      }
    } catch (e) {
      console.log(`THROW: ${(e?.message ?? e).toString().slice(0, 100)}`);
    }
    // Soft rate-limit: 2sn pause her ilçe sonrası
    await new Promise((r) => setTimeout(r, 2000));
  }

  const total = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== ÖZET ===`);
  console.log(`İlçe başarılı:  ${okCount}/${toScan.length}`);
  console.log(`Toplam yeni:    ${totalNew}`);
  console.log(`Toplam scanned: ${totalScanned}`);
  console.log(`Süre:           ${Math.floor(total / 60)}m ${total % 60}s`);
  console.log(`\nSonraki adım: node scripts/export-province-route.cjs ${slug}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
