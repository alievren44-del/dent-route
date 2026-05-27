/* eslint-disable */
// Tek ilçe scan + filtered_reasons listele.
// dryRun: true → DB'ye yazmaz, sadece preview döndürür.

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

async function main() {
  // Etimesgut centroid + 10km, strictDistrict on
  const body = {
    lat: 39.9471, lng: 32.66, radiusM: 10000,
    provinceSlug: 'ankara', districtSlug: 'etimesgut',
    source: 'google', intensity: 'standard',
    includeKamu: true, dryRun: true,
    strictDistrict: true,
  };
  console.log('Scan başlıyor (standard intensity, dryRun)…');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/clinic-scan-v3`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  console.log(`\nScan: ${j.scanned} | filtered_out: ${j.filtered_out}\n`);
  console.log('=== FILTERED REASONS (örnek) ===');
  const fr = Array.isArray(j.filtered_reasons) ? j.filtered_reasons : [];
  // Group by reason
  const grouped = {};
  for (const x of fr) {
    grouped[x.reason] = grouped[x.reason] || [];
    grouped[x.reason].push(x.name);
  }
  for (const [reason, names] of Object.entries(grouped)) {
    console.log(`\n[${reason}] ${names.length} adet:`);
    for (const n of names.slice(0, 10)) console.log(`  - ${n}`);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
