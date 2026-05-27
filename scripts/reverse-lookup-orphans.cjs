/* eslint-disable */
// Reverse-lookup: orphan (google_place_id NULL) Excel-import satırlarını
// Google Places TextSearch ile çözer, place_id + doğru lat/lng UPDATE eder.
//
// Kullanım:
//   node scripts/reverse-lookup-orphans.cjs              → tüm orphan'lar
//   node scripts/reverse-lookup-orphans.cjs etimesgut    → sadece bir ilçe (test)
//   node scripts/reverse-lookup-orphans.cjs --province=ankara
//
// Maliyet: ~$0.032 / orphan (Google TextSearch). 30 orphan ≈ $1.

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
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!SUPABASE_URL || !SERVICE_KEY || !GOOGLE_KEY) {
  console.error('Env eksik: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / GOOGLE_PLACES_API_KEY');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const districts = require('../src/data/tr-locations/districts.json');
const provincePlaka = new Map([
  ['ankara', 6], ['sivas', 58], ['malatya', 44], ['mardin', 47],
  ['kastamonu', 37], ['tokat', 60], ['kirikkale', 71],
  ['balikesir', 10], ['ordu', 52],
]);
const districtIndex = new Map();
for (const d of districts) {
  districtIndex.set(`${d.il_plaka}|${d.slug}`, d);
}

const TR_MAP = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };
function normName(s) {
  if (!s) return '';
  let n = String(s).toLocaleLowerCase('tr-TR').trim();
  for (const [a, b] of Object.entries(TR_MAP)) n = n.replaceAll(a, b);
  return n.replace(/[^a-z0-9]/g, '');
}

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Excel adından "⭐ YENİ" / "⭐ v3" gibi marker'ları temizle, suffix kelimeleri
// bırak (Google ile semantik eşleşme için).
function cleanName(s) {
  return String(s ?? '')
    .replace(/⭐\s*(YENİ|v\d)/giu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function textSearch(query) {
  const url =
    `https://maps.googleapis.com/maps/api/place/textsearch/json` +
    `?query=${encodeURIComponent(query)}&region=tr&key=${GOOGLE_KEY}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { results: [], err: `http_${r.status}` };
    const j = await r.json();
    if (j.status === 'OVER_QUERY_LIMIT' || j.status === 'REQUEST_DENIED') {
      return { results: [], err: j.status };
    }
    return { results: Array.isArray(j.results) ? j.results : [], err: j.status === 'OK' ? null : j.status };
  } catch (e) {
    return { results: [], err: e.message || 'fetch_err' };
  }
}

async function lookupOrphan(orphan, districtData, provinceReadable) {
  const cleaned = cleanName(orphan.name);
  // 3 sorgu denenir, ilk eşleşme alınır:
  //   1. "<name> <ilçe> <il>"
  //   2. "<name> diş hekimi <ilçe>"
  //   3. "<name> dental <il>"
  const queries = [
    `${cleaned} ${districtData.ad} ${provinceReadable}`,
    `${cleaned} diş hekimi ${districtData.ad}`,
    `${cleaned} dental ${provinceReadable}`,
  ];
  const orphanNorm = normName(cleaned);
  const orphanPrefix = orphanNorm.slice(0, 6);

  for (const q of queries) {
    const { results, err } = await textSearch(q);
    if (err && err !== 'ZERO_RESULTS') {
      return { matched: false, reason: `api_${err}` };
    }
    if (!results.length) continue;
    // İlk birkaç sonucu sıralı kontrol et:
    //   - distance < 5km from district centroid
    //   - prefix-6 match VEYA normalize-name içerik eşitliği
    for (const cand of results.slice(0, 5)) {
      const gLat = cand?.geometry?.location?.lat;
      const gLng = cand?.geometry?.location?.lng;
      if (typeof gLat !== 'number' || typeof gLng !== 'number') continue;
      const d = haversineM(districtData.lat, districtData.lng, gLat, gLng);
      if (d > 15000) continue; // ilçe centroid'inden 15km'den uzak → muhtemelen yanlış il
      const cNorm = normName(cand.name);
      if (!cNorm) continue;
      const pfxMatch = cNorm.length >= 6 && orphanNorm.length >= 6 && cNorm.slice(0, 6) === orphanPrefix;
      const equality = cNorm === orphanNorm;
      const includes = orphanNorm.length >= 8 && cNorm.length >= 8 &&
        (cNorm.includes(orphanNorm) || orphanNorm.includes(cNorm));
      if (pfxMatch || equality || includes) {
        return {
          matched: true,
          place_id: cand.place_id,
          name: cand.name,
          lat: gLat,
          lng: gLng,
          distance_m: Math.round(d),
          via_query: q,
        };
      }
    }
  }
  return { matched: false, reason: 'no_strong_match' };
}

async function main() {
  const argDistrict = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
  const provinceArg = process.argv.find((a) => a.startsWith('--province='));
  const provinceFilter = provinceArg ? provinceArg.split('=')[1] : null;

  let query = supabase
    .from('saha_clinics')
    .select('id, name, lat, lng, province_slug, district_slug')
    .is('google_place_id', null);
  if (provinceFilter) query = query.eq('province_slug', provinceFilter);
  if (argDistrict) query = query.eq('district_slug', argDistrict);

  const { data: orphans, error } = await query;
  if (error) {
    console.error(error);
    process.exit(1);
  }
  console.log(`Orphan sayısı: ${orphans.length}`);
  if (orphans.length === 0) return;

  console.log(`Maliyet tahmini: ~$${(orphans.length * 0.032).toFixed(2)} (Google TextSearch)`);
  console.log(`Devam ediliyor...\n`);

  const stats = { matched: 0, notFound: 0, apiError: 0 };
  const updates = [];
  const failures = [];

  const CONCURRENCY = 3; // Google rate-limit'e nazik
  for (let i = 0; i < orphans.length; i += CONCURRENCY) {
    const batch = orphans.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (o) => {
        const plaka = provincePlaka.get(o.province_slug);
        const district = plaka ? districtIndex.get(`${plaka}|${o.district_slug}`) : null;
        if (!district) return { orphan: o, result: { matched: false, reason: 'no_district' } };
        const provReadable = o.province_slug === 'ankara' ? 'Ankara' :
          o.province_slug === 'sivas' ? 'Sivas' :
          o.province_slug.charAt(0).toUpperCase() + o.province_slug.slice(1);
        const r = await lookupOrphan(o, district, provReadable);
        return { orphan: o, result: r };
      }),
    );
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const { orphan, result } = s.value;
      if (result.matched) {
        stats.matched++;
        updates.push({ id: orphan.id, place_id: result.place_id, lat: result.lat, lng: result.lng });
      } else if ((result.reason || '').startsWith('api_')) {
        stats.apiError++;
        failures.push({ name: orphan.name, reason: result.reason });
      } else {
        stats.notFound++;
        failures.push({ name: orphan.name, reason: result.reason });
      }
    }
    process.stdout.write(
      `\r${Math.min(i + CONCURRENCY, orphans.length)}/${orphans.length}  ` +
      `match:${stats.matched} notfound:${stats.notFound} apierr:${stats.apiError}`,
    );
  }
  console.log('\n');

  console.log('=== UPDATE batch ===');
  for (let i = 0; i < updates.length; i += 50) {
    const slice = updates.slice(i, i + 50);
    for (const u of slice) {
      // Tek tek update çünkü place_id UNIQUE constraint var; conflict olabilir
      try {
        const { error: upErr } = await supabase
          .from('saha_clinics')
          .update({
            google_place_id: u.place_id,
            lat: u.lat,
            lng: u.lng,
            updated_at: new Date().toISOString(),
          })
          .eq('id', u.id);
        if (upErr && upErr.code === '23505') {
          // Çift place_id (zaten bir başka satır aynı place_id ile var)
          // → eski orphan'ı 'duplicate' işaretle
          await supabase
            .from('saha_clinics')
            .update({ status: 'duplicate', updated_at: new Date().toISOString() })
            .eq('id', u.id);
          failures.push({ name: `(id=${u.id})`, reason: 'duplicate_place_id' });
          stats.matched--;
        }
      } catch (e) {
        failures.push({ name: `(id=${u.id})`, reason: e.message });
      }
    }
    process.stdout.write(`\r  ${Math.min(i + 50, updates.length)}/${updates.length}`);
  }
  console.log('\n');

  console.log('=== ÖZET ===');
  console.log(`Match'lendi:        ${stats.matched}`);
  console.log(`Google'da yok:      ${stats.notFound}`);
  console.log(`API hatası:         ${stats.apiError}`);
  console.log(`Toplam:             ${orphans.length}`);
  if (failures.length > 0 && failures.length <= 50) {
    console.log('\n--- Başarısızlar ---');
    for (const f of failures) console.log(`  ${f.reason.padEnd(20)} ${f.name}`);
  } else if (failures.length > 50) {
    console.log(`\n--- Başarısız ilk 30 ---`);
    for (const f of failures.slice(0, 30)) console.log(`  ${f.reason.padEnd(20)} ${f.name}`);
  }
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
