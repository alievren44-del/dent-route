/* eslint-disable */
// One-shot importer:
//   1. DELETE saha_clinics WHERE province_slug IN ('ankara','sivas')
//   2. Parse 2 Excels (Ankara v2 + Sivas v3), 4 sheets
//   3. Geocode each row via Mapbox (free 100k/ay)
//   4. INSERT to saha_clinics
//
// Çalıştırma: node scripts/import-hekim-listesi.cjs

'use strict';

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

// Manuel .env parser (dotenv dep yok)
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

if (!SUPABASE_URL || !SERVICE_KEY || !MAPBOX_TOKEN) {
  console.error('Eksik env: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_MAPBOX_PUBLIC_TOKEN');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const districtsData = require('../src/data/tr-locations/districts.json');

const SRC_DIR = 'C:/Users/PC/Desktop/diş hekimi listesi için';
const ANKARA_FILE = path.join(SRC_DIR, 'ANKARA_GENELI_Birlesik_Dis_Hekimi_Rotasi_v2.xlsx');
const SIVAS_FILE = path.join(SRC_DIR, 'Sivas_Merkez_Dis_Hekimi_Rotasi_v3.xlsx');

const TR_MAP = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i',
  ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
};
function slugify(s) {
  if (!s) return '';
  let out = '';
  for (const ch of s) out += TR_MAP[ch] ?? ch;
  return out.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// İlçe adı → slug haritası (province bazlı)
function buildDistrictMap(province) {
  const map = new Map();
  for (const d of districtsData) {
    if (slugify(d.il_ad) === province) {
      map.set(slugify(d.ad), d.slug);
      // Bazı eşleşmeler (örn. "Merkez")
    }
  }
  return map;
}

function detectSegment(tip, name) {
  const s = `${tip ?? ''} ${name ?? ''}`.toLowerCase();
  if (/kamu|adsm|devlet|hastane|şehir|ağız.*sağlığı.*merkezi/i.test(s)) return 'kamu';
  return 'private';
}

function parsePuan(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function parseYorum(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parsePhone(v) {
  if (v == null) return null;
  return String(v).trim() || null;
}

// ── Parse rows ───────────────────────────────────────────────────────────────

function parseAnkara() {
  const wb = xlsx.readFile(ANKARA_FILE);
  const districtMap = buildDistrictMap('ankara');
  const rows = [];

  // Sheet 1: Özel klinikler
  const s1 = xlsx.utils.sheet_to_json(wb.Sheets['Ankara Geneli - Birleşik Rota'], { defval: null });
  for (const r of s1) {
    const name = String(r['Klinik Adı'] ?? '').trim();
    if (!name) continue;
    const ilce = String(r['İlçe'] ?? '').trim();
    const districtSlug = districtMap.get(slugify(ilce)) ?? null;
    rows.push({
      name,
      address: r['Adres'] ? String(r['Adres']).trim() : null,
      phone: parsePhone(r['Telefon']),
      neighborhood: r['Mahalle'] ? String(r['Mahalle']).trim() : null,
      rating: parsePuan(r['Puan']),
      user_ratings_total: parseYorum(r['Yorum Sayısı']),
      segment: detectSegment(r['Tip/Özellik'], name),
      province_slug: 'ankara',
      district_slug: districtSlug,
      types: [],
      raw_payload: { source: 'manual_excel_v2', sheet: 'ozel', original: r },
    });
  }

  // Sheet 2: KAMU
  const s2 = xlsx.utils.sheet_to_json(wb.Sheets['KAMU Hastane & ADSM'], { defval: null });
  for (const r of s2) {
    const name = String(r['Kurum Adı'] ?? '').trim();
    if (!name) continue;
    const ilce = String(r['İlçe'] ?? '').trim();
    const districtSlug = districtMap.get(slugify(ilce)) ?? null;
    rows.push({
      name,
      address: r['Adres'] ? String(r['Adres']).trim() : null,
      phone: parsePhone(r['Telefon']),
      neighborhood: r['Mahalle'] ? String(r['Mahalle']).trim() : null,
      rating: parsePuan(r['Puan']),
      user_ratings_total: parseYorum(r['Yorum']),
      segment: 'kamu',
      province_slug: 'ankara',
      district_slug: districtSlug,
      types: [],
      raw_payload: { source: 'manual_excel_v2', sheet: 'kamu', original: r },
    });
  }

  return rows;
}

function parseSivas() {
  const wb = xlsx.readFile(SIVAS_FILE);
  const districtMap = buildDistrictMap('sivas');
  const rows = [];

  // Sheet 1: Sivas merkez özel
  const s1 = xlsx.utils.sheet_to_json(wb.Sheets['Sivas Merkez v3'], { defval: null });
  for (const r of s1) {
    const name = String(r['Klinik Adı'] ?? '').trim();
    if (!name) continue;
    rows.push({
      name,
      address: r['Adres'] ? String(r['Adres']).trim() : null,
      phone: parsePhone(r['Telefon']),
      neighborhood: r['Mahalle'] ? String(r['Mahalle']).trim() : null,
      rating: parsePuan(r['Puan']),
      user_ratings_total: parseYorum(r['Yorum']),
      segment: detectSegment(r['Tip/Özellik'], name),
      province_slug: 'sivas',
      district_slug: districtMap.get('merkez') ?? 'merkez',
      types: [],
      raw_payload: { source: 'manual_excel_v3', sheet: 'ozel', original: r },
    });
  }

  // Sheet 2: KAMU
  const s2 = xlsx.utils.sheet_to_json(wb.Sheets['KAMU + Hastane'], { defval: null });
  for (const r of s2) {
    const name = String(r['Kurum Adı'] ?? '').trim();
    if (!name) continue;
    rows.push({
      name,
      address: r['Adres'] ? String(r['Adres']).trim() : null,
      phone: null,
      neighborhood: r['Mahalle'] ? String(r['Mahalle']).trim() : null,
      rating: parsePuan(r['Puan']),
      user_ratings_total: parseYorum(r['Yorum']),
      segment: 'kamu',
      province_slug: 'sivas',
      district_slug: districtMap.get('merkez') ?? 'merkez',
      types: [],
      raw_payload: { source: 'manual_excel_v3', sheet: 'kamu', original: r },
    });
  }

  return rows;
}

// ── Geocode ──────────────────────────────────────────────────────────────────

async function geocodeOne(row) {
  // Adres + il + Türkiye. Adres yoksa mahalle + ilçe.
  const provinceReadable = row.province_slug === 'ankara' ? 'Ankara' : 'Sivas';
  const parts = [
    row.address,
    row.neighborhood,
    row.district_slug,
    provinceReadable,
    'Türkiye',
  ].filter(Boolean);
  const q = parts.join(', ');
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?country=tr&limit=1&access_token=${MAPBOX_TOKEN}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { lat: null, lng: null, err: `http_${r.status}` };
    const j = await r.json();
    const f = j?.features?.[0];
    if (!f || !Array.isArray(f.center)) return { lat: null, lng: null, err: 'no_match' };
    return { lat: Number(f.center[1]), lng: Number(f.center[0]), err: null };
  } catch (e) {
    return { lat: null, lng: null, err: e.message || 'fetch_err' };
  }
}

async function geocodeAll(rows) {
  const out = [];
  const CONCURRENCY = 10;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const batch = rows.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((r) => geocodeOne(r)));
    for (let j = 0; j < batch.length; j++) {
      const res = settled[j];
      const geo = res.status === 'fulfilled' ? res.value : { lat: null, lng: null, err: 'rejected' };
      out.push({ ...batch[j], lat: geo.lat, lng: geo.lng, _geoErr: geo.err });
      if (geo.err) failed++;
      done++;
    }
    process.stdout.write(`\rGeocode: ${done}/${rows.length} (fail: ${failed})`);
  }
  process.stdout.write('\n');
  return out;
}

// ── Insert ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('1. DELETE saha_clinics WHERE province_slug IN (ankara, sivas)');
  const { error: delErr, count: delCount } = await supabase
    .from('saha_clinics')
    .delete({ count: 'exact' })
    .in('province_slug', ['ankara', 'sivas']);
  if (delErr) {
    console.error('DELETE hata:', delErr);
    process.exit(1);
  }
  console.log(`   → silindi: ${delCount ?? 0}\n`);

  console.log('2. Parse Excel');
  const ankaraRows = parseAnkara();
  const sivasRows = parseSivas();
  console.log(`   → Ankara: ${ankaraRows.length}`);
  console.log(`   → Sivas:  ${sivasRows.length}\n`);

  console.log('3. Geocode (Mapbox)');
  const all = [...ankaraRows, ...sivasRows];
  const geocoded = await geocodeAll(all);
  const valid = geocoded.filter((r) => r.lat != null && r.lng != null);
  const invalid = geocoded.filter((r) => r.lat == null || r.lng == null);
  console.log(`   → geçerli: ${valid.length}`);
  console.log(`   → geocode fail: ${invalid.length}`);
  if (invalid.length > 0 && invalid.length <= 20) {
    console.log('   fail örnekleri:');
    for (const r of invalid.slice(0, 10)) {
      console.log(`     - ${r.name} (${r._geoErr})`);
    }
  }
  console.log('');

  console.log('4. INSERT batch (100)');
  const nowIso = new Date().toISOString();
  const payload = valid.map((r) => ({
    name: r.name,
    lat: r.lat,
    lng: r.lng,
    address: r.address,
    phone: r.phone,
    rating: r.rating,
    user_ratings_total: r.user_ratings_total,
    types: r.types,
    province_slug: r.province_slug,
    district_slug: r.district_slug,
    clinic_segment: r.segment,
    sources: ['manual_excel'],
    raw_payload: r.raw_payload,
    last_seen_at: nowIso,
    last_verified_at: nowIso,
  }));

  let inserted = 0;
  for (let i = 0; i < payload.length; i += 100) {
    const slice = payload.slice(i, i + 100);
    const { error: insErr } = await supabase.from('saha_clinics').insert(slice);
    if (insErr) {
      console.error(`\nINSERT batch ${i} hata:`, insErr);
      process.exit(1);
    }
    inserted += slice.length;
    process.stdout.write(`\rINSERT: ${inserted}/${payload.length}`);
  }
  console.log('\n');

  console.log('5. Final sayım');
  const { count: finalAnk } = await supabase
    .from('saha_clinics').select('*', { count: 'exact', head: true })
    .eq('province_slug', 'ankara');
  const { count: finalSiv } = await supabase
    .from('saha_clinics').select('*', { count: 'exact', head: true })
    .eq('province_slug', 'sivas');
  console.log(`   ankara: ${finalAnk}`);
  console.log(`   sivas:  ${finalSiv}`);

  console.log('\n✓ Tamam.');
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
