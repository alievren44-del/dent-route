/* eslint-disable */
// Re-geocode tüm orphan kayıtları (google_place_id NULL) Mapbox proximity ile.
// Hatalı geocode → ilçe centroid'inden uzak düşen kayıtları düzeltir.

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
const MAPBOX_TOKEN = process.env.VITE_MAPBOX_PUBLIC_TOKEN;

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const districts = require('../src/data/tr-locations/districts.json');
const districtIndex = new Map();
for (const d of districts) {
  districtIndex.set(`${d.il_plaka}|${d.slug}`, d);
}
const provincePlaka = new Map([
  ['ankara', 6],
  ['sivas', 58],
]);

async function geocode(addr, dlat, dlng) {
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(addr)}.json` +
    `?country=tr&limit=1&proximity=${dlng},${dlat}&access_token=${MAPBOX_TOKEN}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const f = j?.features?.[0];
    if (!f || !Array.isArray(f.center)) return null;
    return { lat: Number(f.center[1]), lng: Number(f.center[0]) };
  } catch {
    return null;
  }
}

async function main() {
  console.log('1. Fetch orphans');
  const { data: orphans, error } = await supabase
    .from('saha_clinics')
    .select('id, name, address, lat, lng, province_slug, district_slug')
    .is('google_place_id', null)
    .in('province_slug', ['ankara', 'sivas']);
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`   → ${orphans.length} orphan\n`);

  console.log('2. Re-geocode (proximity bias)');
  let done = 0;
  let updated = 0;
  let skipped = 0;
  const updates = [];
  const CONCURRENCY = 8;

  for (let i = 0; i < orphans.length; i += CONCURRENCY) {
    const batch = orphans.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (o) => {
        const plaka = provincePlaka.get(o.province_slug);
        const district = plaka ? districtIndex.get(`${plaka}|${o.district_slug}`) : null;
        if (!district) return { id: o.id, skipped: 'no_district' };
        const provReadable = o.province_slug === 'ankara' ? 'Ankara' : 'Sivas';
        const addr = [o.address, district.ad, provReadable, 'Türkiye']
          .filter(Boolean)
          .join(', ');
        const geo = await geocode(addr, district.lat, district.lng);
        if (!geo) return { id: o.id, skipped: 'no_match' };
        // Sadece anlamlı değişimi yaz (>50m diff)
        const dLat = Math.abs(geo.lat - o.lat);
        const dLng = Math.abs(geo.lng - o.lng);
        if (dLat < 0.0005 && dLng < 0.0005) return { id: o.id, skipped: 'no_change' };
        return { id: o.id, lat: geo.lat, lng: geo.lng };
      }),
    );
    for (const s of settled) {
      done++;
      if (s.status !== 'fulfilled') continue;
      const v = s.value;
      if (v.skipped) {
        skipped++;
        continue;
      }
      updates.push(v);
    }
    process.stdout.write(`\r   ${done}/${orphans.length} (update bekleyen: ${updates.length}, skip: ${skipped})`);
  }
  process.stdout.write('\n\n');

  console.log('3. UPDATE batch');
  for (let i = 0; i < updates.length; i += 50) {
    const slice = updates.slice(i, i + 50);
    await Promise.all(
      slice.map((u) =>
        supabase
          .from('saha_clinics')
          .update({ lat: u.lat, lng: u.lng, updated_at: new Date().toISOString() })
          .eq('id', u.id),
      ),
    );
    updated += slice.length;
    process.stdout.write(`\r   ${updated}/${updates.length}`);
  }
  console.log('\n');
  console.log(`✓ Toplam orphan: ${orphans.length}, güncellenen: ${updated}, atlanan: ${skipped}`);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
