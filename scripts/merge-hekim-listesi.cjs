/* eslint-disable */
// MERGE importer (non-destructive):
//   Folder "diş hekimi listesi için" içindeki il bazlı diş hekimi listelerini
//   saha_clinics tablosuyla KARŞILAŞTIR ve eksikleri tamamla.
//     - Folder'da olup DB'de olmayan klinik  -> INSERT (yeni)
//     - DB'de olan ama bazı alanları boş kayıt -> UPDATE (telefon/puan/adres/
//       place_id/district boşsa folder'dan doldur)
//   Mevcut veriyi ASLA silmez.
//
// Eşleştirme: önce google_place_id, sonra slug(name)+province (+ilçe).
// Koordinatı olmayan yeni kayıtlar Mapbox ile geocode edilir.
//
// Çalıştırma:
//   node scripts/merge-hekim-listesi.cjs            (tüm iller)
//   node scripts/merge-hekim-listesi.cjs amasya corum   (sadece bu iller)
//   DRY=1 node scripts/merge-hekim-listesi.cjs      (yazma yok, sadece rapor)

'use strict';

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

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
const DRY = process.env.DRY === '1';

if (!SUPABASE_URL || !SERVICE_KEY || !MAPBOX_TOKEN) {
  console.error('Eksik env: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_MAPBOX_PUBLIC_TOKEN');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const districtsData = require('../src/data/tr-locations/districts.json');
const SRC_DIR = path.resolve(__dirname, '..', 'diş hekimi listesi için');

// ── Slug / readable ───────────────────────────────────────────────────────────
const TR_MAP = {
  ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i',
  ö: 'o', Ö: 'o', ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  â: 'a', Â: 'a', î: 'i', Î: 'i', û: 'u', Û: 'u',
};
function slugify(s) {
  if (s == null) return '';
  let out = '';
  for (const ch of String(s)) out += TR_MAP[ch] ?? ch;
  return out.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function nameKey(s) {
  // gevşek isim anahtarı: noktalama/boşluk/ünvan farklarını törpüle
  return slugify(s)
    .replace(/-/g, '')
    .replace(/^(dt|dr|prof|doc|op|uzm|dishekimi|dishekim|ozel|muayenehane|muayene)/g, '');
}
// Telefon anahtarı: son 10 hane. Aynı telefon = aynı klinik (isim formatı
// farklı olsa bile — "Özel X ADSP" vs Google adı mükerrerini yakalar).
function phoneKey(s) {
  if (s == null) return '';
  const d = String(s).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

// Province slug -> okunabilir TR ad (districtsData'dan)
const PROV_READABLE = {};
for (const d of districtsData) {
  const ps = slugify(d.il_ad);
  if (!PROV_READABLE[ps]) PROV_READABLE[ps] = d.il_ad;
}

function buildDistrictMap(province) {
  const map = new Map();
  let center = null;
  for (const d of districtsData) {
    if (slugify(d.il_ad) === province) {
      map.set(slugify(d.ad), d.slug);
      if (d.slug === 'merkez') center = 'merkez';
    }
  }
  return { map, center };
}

function resolveDistrict(province, ilceRaw) {
  if (!ilceRaw) return null;
  const { map, center } = buildDistrictMap(province);
  let c = slugify(ilceRaw);
  if (map.has(c)) return map.get(c);
  // "kirsehir-merkez" gibi il prefix'ini at
  if (c.startsWith(province + '-')) {
    const stripped = c.slice(province.length + 1);
    if (map.has(stripped)) return map.get(stripped);
    if (stripped === 'merkez' && center) return center;
  }
  if (c.includes('merkez') && center) return center;
  return null;
}

// ── Generic cell extractor ─────────────────────────────────────────────────────
function pick(row, aliases) {
  for (const a of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, a)) {
      const v = row[a];
      if (v != null && String(v).trim() !== '' && String(v).trim() !== '—' && String(v).trim() !== '-') {
        return v;
      }
    }
  }
  return null;
}
const A = {
  name: ['Klinik Adı', 'Klinik / Hekim', 'Kurum Adı', 'Kurum', 'klinik', 'name'],
  person: ['ad'],
  district: ['İlçe', 'ilce', 'district'],
  address: ['Adres', 'adres', 'address'],
  phone: ['Telefon', 'phone'],
  rating: ['Puan', 'Google Puanı', 'rating'],
  reviews: ['Yorum Sayısı', 'Yorum', 'reviews', 'yorum'],
  neighborhood: ['Mahalle', 'neighborhood'],
  lat: ['lat', 'Enlem', 'Lat', 'enlem'],
  lng: ['lng', 'Boylam', 'Lng', 'boylam'],
  placeId: ['place_id', 'placeId'],
  combo: ['place/konum', 'konum'],
  type: ['Tip/Özellik', 'Tip', 'Tür', 'type', 'uzmanlik'],
};

function num(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function parseRating(v) {
  const n = num(v);
  if (n == null) return null;
  return n >= 0 && n <= 5 ? n : null;
}
function parseReviews(v) {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function parsePhone(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s !== '—' && s !== '-' ? s : null;
}

const SKIP_SHEET = /özet|ozet|açıklama|aciklama|ilçe ozeti|ilce ozeti|log|metodoloji|özet & rota|rota bilgisi/i;

function isKamuSheet(sheetName) {
  return /kamu|hastane|adsm/i.test(sheetName);
}

function parseFile(file, province) {
  const full = path.join(SRC_DIR, file);
  const wb = xlsx.readFile(full);
  const rows = [];
  for (const sn of wb.SheetNames) {
    if (SKIP_SHEET.test(sn)) continue;
    const sheet = wb.Sheets[sn];
    // Bazı dosyalar başlıkla başlar (merged title satırları); gerçek kolon
    // header'ını bul (en az 2 bilinen başlık token'ı içeren ilk satır).
    const aoa = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const HDR_RE = /(İlçe|ilçe|Klinik|Kurum|Adres|Telefon)/i;
    let hdrRow = 0;
    for (let i = 0; i < Math.min(aoa.length, 8); i++) {
      const hits = (aoa[i] || []).filter((c) => c != null && HDR_RE.test(String(c))).length;
      if (hits >= 2) { hdrRow = i; break; }
    }
    const json0 = xlsx.utils.sheet_to_json(sheet, { defval: null, range: hdrRow });
    // CSV başlıklarında UTF-8 BOM (﻿) var → ilk sütun header'ı eşleşmez.
    // Tüm satır anahtarlarından baştaki BOM'u temizle.
    const json = json0.map((r0) => {
      const r = {};
      for (const k in r0) r[k.replace(/^﻿/, '')] = r0[k];
      return r;
    });
    const kamuSheet = isKamuSheet(sn);
    for (const r of json) {
      let name = pick(r, A.name);
      const person = pick(r, A.person);
      if (!name && person) name = person; // csv: ad sütunu (klinik yoksa)
      if (!name) continue;
      name = String(name).trim();
      if (!name || /^toplam|^özet|^kapsama/i.test(name)) continue;

      // koordinat
      let lat = num(pick(r, A.lat));
      let lng = num(pick(r, A.lng));
      const combo = pick(r, A.combo);
      if ((lat == null || lng == null) && combo && /,/.test(String(combo))) {
        const m = String(combo).split(',').map((x) => num(x));
        if (m.length === 2 && m[0] != null && m[1] != null) { lat = m[0]; lng = m[1]; }
      }
      // sanity: TR sınırları
      if (lat != null && (lat < 35 || lat > 43)) lat = null;
      if (lng != null && (lng < 25 || lng > 45)) lng = null;
      if (lat == null || lng == null) { lat = null; lng = null; }

      const typeStr = pick(r, A.type);
      const segment = kamuSheet || /kamu|adsm|devlet|hastane|şehir|üniversite|fakülte|poliklinik/i.test(`${typeStr ?? ''}`)
        ? (kamuSheet ? 'kamu' : (/kamu|adsm|devlet|hastane|üniversite|fakülte/i.test(`${typeStr ?? ''} ${name}`) ? 'kamu' : 'private'))
        : 'private';

      rows.push({
        name,
        address: pick(r, A.address) ? String(pick(r, A.address)).trim() : null,
        phone: parsePhone(pick(r, A.phone)),
        rating: parseRating(pick(r, A.rating)),
        user_ratings_total: parseReviews(pick(r, A.reviews)),
        neighborhood: pick(r, A.neighborhood) ? String(pick(r, A.neighborhood)).trim() : null,
        district_slug: resolveDistrict(province, pick(r, A.district)),
        google_place_id: pick(r, A.placeId) ? String(pick(r, A.placeId)).trim() : null,
        lat, lng,
        clinic_segment: segment,
        province_slug: province,
        _source: file,
        raw_payload: { source: 'manual_excel_merge', file, sheet: sn, original: r },
      });
    }
  }
  return rows;
}

// Aynı il içindeki folder satırlarını birleştir (dosyalar arası dedup)
function dedupFolder(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = r.google_place_id ? 'pid:' + r.google_place_id : 'nm:' + nameKey(r.name);
    if (!byKey.has(key)) { byKey.set(key, r); continue; }
    const e = byKey.get(key);
    // alan birleştir: boş olanı doldur
    for (const f of ['address', 'phone', 'rating', 'user_ratings_total', 'neighborhood', 'district_slug', 'google_place_id', 'lat', 'lng']) {
      if ((e[f] == null || e[f] === '') && r[f] != null && r[f] !== '') e[f] = r[f];
    }
  }
  return [...byKey.values()];
}

// ── Geocode (Mapbox) ───────────────────────────────────────────────────────────
async function geocodeOne(row) {
  const prov = PROV_READABLE[row.province_slug] || row.province_slug;
  const parts = [row.address, row.neighborhood, row.district_slug, prov, 'Türkiye'].filter(Boolean);
  const q = parts.join(', ');
  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json` +
    `?country=tr&limit=1&access_token=${MAPBOX_TOKEN}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return { lat: null, lng: null };
    const j = await r.json();
    const f = j?.features?.[0];
    if (!f || !Array.isArray(f.center)) return { lat: null, lng: null };
    return { lat: Number(f.center[1]), lng: Number(f.center[0]) };
  } catch {
    return { lat: null, lng: null };
  }
}
async function geocodeMany(rows) {
  const C = 10;
  let done = 0, fail = 0;
  for (let i = 0; i < rows.length; i += C) {
    const batch = rows.slice(i, i + C);
    const res = await Promise.allSettled(batch.map((r) => geocodeOne(r)));
    for (let j = 0; j < batch.length; j++) {
      const g = res[j].status === 'fulfilled' ? res[j].value : { lat: null, lng: null };
      batch[j].lat = g.lat; batch[j].lng = g.lng;
      done++; if (g.lat == null) fail++;
    }
    process.stdout.write(`\r    geocode ${done}/${rows.length} (fail ${fail})`);
  }
  if (rows.length) process.stdout.write('\n');
}

// ── DB load ────────────────────────────────────────────────────────────────────
async function loadProvince(province) {
  let from = 0, page = 1000, all = [];
  for (;;) {
    const { data, error } = await supabase
      .from('saha_clinics')
      .select('id,name,google_place_id,phone,rating,user_ratings_total,address,lat,lng,district_slug,clinic_segment')
      .eq('province_slug', province)
      .range(from, from + page - 1);
    if (error) throw error;
    all = all.concat(data);
    if (data.length < page) break;
    from += page;
  }
  return all;
}

// ── Merge bir il ───────────────────────────────────────────────────────────────
async function mergeProvince(province, files) {
  console.log(`\n=== ${province.toUpperCase()} ===`);
  let folder = [];
  for (const f of files) {
    try { folder = folder.concat(parseFile(f, province)); }
    catch (e) { console.log(`  ! parse hata ${f}: ${e.message}`); }
  }
  folder = dedupFolder(folder);
  console.log(`  folder: ${folder.length} kayıt (${files.length} dosya)`);

  const db = await loadProvince(province);
  console.log(`  db    : ${db.length} kayıt`);

  const dbByPid = new Map();
  const dbByName = new Map();
  const dbByPhone = new Map();
  for (const r of db) {
    if (r.google_place_id) dbByPid.set(r.google_place_id, r);
    const nk = nameKey(r.name);
    if (!dbByName.has(nk)) dbByName.set(nk, r);
    const pk = phoneKey(r.phone);
    if (pk && !dbByPhone.has(pk)) dbByPhone.set(pk, r);
  }

  const toInsert = [];
  const toUpdate = []; // {id, patch}
  for (const fr of folder) {
    let m = null;
    if (fr.google_place_id && dbByPid.has(fr.google_place_id)) m = dbByPid.get(fr.google_place_id);
    // telefon eşleşmesi (güçlü — isim formatı farkını aşar)
    if (!m) { const pk = phoneKey(fr.phone); if (pk && dbByPhone.has(pk)) m = dbByPhone.get(pk); }
    if (!m) m = dbByName.get(nameKey(fr.name)) || null;

    if (m) {
      const patch = {};
      if (!m.phone && fr.phone) patch.phone = fr.phone;
      if (m.rating == null && fr.rating != null) patch.rating = fr.rating;
      if (m.user_ratings_total == null && fr.user_ratings_total != null) patch.user_ratings_total = fr.user_ratings_total;
      if (!m.address && fr.address) patch.address = fr.address;
      if (!m.google_place_id && fr.google_place_id) patch.google_place_id = fr.google_place_id;
      if (!m.district_slug && fr.district_slug) patch.district_slug = fr.district_slug;
      if (Object.keys(patch).length) toUpdate.push({ id: m.id, patch });
    } else {
      toInsert.push(fr);
    }
  }

  // yeni kayıt: koordinatsızları geocode et
  const needGeo = toInsert.filter((r) => r.lat == null || r.lng == null);
  if (needGeo.length) {
    console.log(`  geocode gerek: ${needGeo.length}`);
    if (!DRY) await geocodeMany(needGeo);
  }
  const insertable = toInsert.filter((r) => r.lat != null && r.lng != null);
  const skipped = toInsert.length - insertable.length;

  console.log(`  -> yeni INSERT: ${insertable.length}  | UPDATE(gap fill): ${toUpdate.length}  | geocode fail skip: ${skipped}`);

  if (DRY) {
    insertable.slice(0, 5).forEach((r) => console.log(`     +NEW ${r.name} [${r.clinic_segment}] ${r.lat?.toFixed?.(4)},${r.lng?.toFixed?.(4)}`));
    return { ins: 0, upd: 0, skip: skipped };
  }

  // INSERT
  const nowIso = new Date().toISOString();
  let ins = 0;
  // place_id çakışmasını önle: insertable içinde aynı pid varsa ilki kalsın
  const seenPid = new Set();
  const payload = [];
  for (const r of insertable) {
    let pid = r.google_place_id;
    if (pid && seenPid.has(pid)) pid = null;
    if (pid) seenPid.add(pid);
    payload.push({
      google_place_id: pid,
      name: r.name,
      lat: r.lat, lng: r.lng,
      address: r.address,
      phone: r.phone,
      rating: r.rating,
      user_ratings_total: r.user_ratings_total,
      types: [],
      vertical_key: 'dental',
      province_slug: r.province_slug,
      district_slug: r.district_slug,
      clinic_segment: r.clinic_segment,
      sources: ['manual_excel'],
      raw_payload: r.raw_payload,
      last_seen_at: nowIso,
      last_verified_at: nowIso,
    });
  }
  for (let i = 0; i < payload.length; i += 100) {
    const slice = payload.slice(i, i + 100);
    const { error } = await supabase.from('saha_clinics').insert(slice);
    if (error) {
      // pid çakışması olursa pid'siz tekrar dene
      console.log(`    insert hata batch ${i}: ${error.message} → pid'siz retry`);
      const noPid = slice.map((s) => ({ ...s, google_place_id: null }));
      const { error: e2 } = await supabase.from('saha_clinics').insert(noPid);
      if (e2) { console.error('    retry de başarısız:', e2.message); throw e2; }
    }
    ins += slice.length;
    process.stdout.write(`\r    insert ${ins}/${payload.length}`);
  }
  if (payload.length) process.stdout.write('\n');

  // UPDATE (gap fill)
  let upd = 0;
  for (const u of toUpdate) {
    const { error } = await supabase.from('saha_clinics').update(u.patch).eq('id', u.id);
    if (error) { console.error('    update hata:', error.message); continue; }
    upd++;
    if (upd % 50 === 0) process.stdout.write(`\r    update ${upd}/${toUpdate.length}`);
  }
  if (toUpdate.length) process.stdout.write(`\r    update ${upd}/${toUpdate.length}\n`);

  return { ins, upd, skip: skipped };
}

// ── Province -> files ──────────────────────────────────────────────────────────
const PROVINCE_FILES = {
  amasya: ['Amasya_Dis_Hekimi_v5_MASTER.xlsx'],
  corum: ['Corum_Dis_Hekimi_v5_MASTER.xlsx'],
  diyarbakir: [
    'Diyarbakir_17ilce_MASTER.xlsx',
    'Diyarbakir_BIRLESIK_6ilce.xlsx',
    'Diyarbakir_Kucuk_Ilceler_BIRLESIK.xlsx',
    'diyarbakır Baglar_Dis_Hekimi_Tarama.xlsx',
    'diyarbakır Kayapinar_Dis_Hekimi_Tarama.xlsx',
  ],
  kirsehir: ['Kirsehir_Dis_Hekimi_Saha_Listesi.xlsx'],
  nevsehir: ['Nevsehir_Dis_Hekimi_Saha_Listesi.xlsx'],
  ordu: ['Ordu_Dis_Hekimi_v5_MASTER.xlsx'],
  samsun: ['SAMSUN_ILI_TUM_ILCELER_Dis_Hekimi_Tarama_BIRLESIK.xlsx'],
  yozgat: ['Yozgat_Dis_Hekimi_Saha_Listesi.xlsx'],
  // Büyük xlsx (1708 satır, place_id'li) ana kaynak + 909-satır CSV (Milimetrik
  // gibi büyük dosyada OLMAYAN klinikleri içerir, koordinatsız→geocode) + KAMU.
  ankara: [
    'ankara_2026-05-27_dis_hekimi_rotasi.xlsx',
    'ANKARA_GENELI_Birlesik_Dis_Hekimi_Rotasi.csv',
    'ANKARA_GENELI_KAMU_Hastane_ADSM.csv',
  ],
  malatya: ['malatya_2026-05-27_dis_hekimi_rotasi.xlsx'],
  tokat: ['tokat_2026-05-27_dis_hekimi_rotasi.xlsx'],
  kastamonu: ['kastamonu_2026-05-27_dis_hekimi_rotasi.xlsx'],
  kirikkale: ['kirikkale_2026-05-27_dis_hekimi_rotasi.xlsx', 'Kirikkale_ozel_klinikler.csv', 'Kirikkale_kamu_adsm.csv'],
  mardin: ['Mardin_Dis_Hekimi_v5_MASTER.xlsx', 'Mardin_ozel_klinikler.csv', 'Mardin_kamu_adsm.csv'],
  sivas: ['sivas_2026-05-27_dis_hekimi_rotasi.xlsx', 'sivas_klinikler_basit.csv', 'Sivas_Merkez_Dis_Hekimi_Rotasi_v3.xlsx'],
};

async function main() {
  const argv = process.argv.slice(2).map((s) => s.toLowerCase());
  const provinces = argv.length ? argv : Object.keys(PROVINCE_FILES);
  console.log(`MERGE${DRY ? ' (DRY RUN)' : ''} — iller: ${provinces.join(', ')}`);

  const totals = { ins: 0, upd: 0, skip: 0 };
  for (const p of provinces) {
    const files = PROVINCE_FILES[p];
    if (!files) { console.log(`\n! bilinmeyen il: ${p}`); continue; }
    const r = await mergeProvince(p, files);
    totals.ins += r.ins; totals.upd += r.upd; totals.skip += r.skip;
  }

  console.log(`\n===== TOPLAM =====`);
  console.log(`  yeni eklenen : ${totals.ins}`);
  console.log(`  güncellenen  : ${totals.upd}`);
  console.log(`  atlanan(geo) : ${totals.skip}`);
  console.log(DRY ? '\n(DRY RUN — DB değişmedi)' : '\n✓ Tamam.');
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
