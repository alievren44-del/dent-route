/* eslint-disable */
// Province-level NN-TSP route Excel exporter.
//
// Kullanım:
//   node scripts/export-province-route.cjs ankara
//   node scripts/export-province-route.cjs ankara --start=39.9783,32.6654
//
// Default başlangıç: il merkezi (provinces.json'dan).
// --start: kullanıcı konumu (Eryaman 5 örn. 39.9783,32.6654)
//
// Output: exports/<province>_<YYYY-MM-DD>_dis_hekimi_rotasi.xlsx

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

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const provinces = require('../src/data/tr-locations/provinces.json');

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// NN-TSP greedy: start'tan başla, her adımda kalan en yakına git.
function nearestNeighborRoute(start, clinics) {
  const route = [];
  const remaining = clinics.slice();
  let cur = start;
  let totalKm = 0;
  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(cur.lat, cur.lng, remaining[i].lat, remaining[i].lng);
      if (d < bestD) {
        bestD = d;
        bestIdx = i;
      }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    next._segmentKm = bestD;
    next._cumulativeKm = (route.length > 0 ? route[route.length - 1]._cumulativeKm : 0) + bestD;
    next._homeKm = haversineKm(start.lat, start.lng, next.lat, next.lng);
    route.push(next);
    cur = next;
  }
  if (route.length > 0) {
    totalKm = route[route.length - 1]._cumulativeKm;
    const homeReturnKm = haversineKm(cur.lat, cur.lng, start.lat, start.lng);
    return { route, totalKm, homeReturnKm, loopKm: totalKm + homeReturnKm };
  }
  return { route: [], totalKm: 0, homeReturnKm: 0, loopKm: 0 };
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Kullanım: node scripts/export-province-route.cjs <province_slug> [--start=lat,lng]');
    process.exit(1);
  }
  const startArg = process.argv.find((a) => a.startsWith('--start='));
  let startLat, startLng, startName;
  if (startArg) {
    const [la, lo] = startArg.split('=')[1].split(',').map(Number);
    startLat = la;
    startLng = lo;
    startName = `Kullanıcı konumu (${la}, ${lo})`;
  } else {
    const prov = provinces.find((p) => p.slug === slug);
    if (!prov) {
      console.error('Province bulunamadı:', slug);
      process.exit(1);
    }
    startLat = prov.lat;
    startLng = prov.lng;
    startName = `${prov.ad} merkez (${prov.lat}, ${prov.lng})`;
  }
  console.log(`Başlangıç: ${startName}\n`);

  console.log('1. DB klinikleri çek');
  // Pagination — Supabase default 1000 limit
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('saha_clinics')
      .select('id, google_place_id, name, lat, lng, address, phone, rating, user_ratings_total, types, district_slug, clinic_segment, status, raw_payload')
      .eq('province_slug', slug)
      .eq('status', 'active')
      .range(from, from + PAGE - 1);
    if (error) { console.error(error); process.exit(1); }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`   → ${all.length} aktif klinik\n`);

  const ozel = all.filter((c) => c.clinic_segment !== 'kamu');
  const kamu = all.filter((c) => c.clinic_segment === 'kamu');
  console.log(`   Özel: ${ozel.length} | KAMU: ${kamu.length}\n`);

  console.log('2. NN-TSP rota üret (özel)');
  const start = { lat: startLat, lng: startLng };
  const t0 = Date.now();
  const ozelRoute = nearestNeighborRoute(start, ozel);
  console.log(`   ${ozelRoute.route.length} klinik | ${ozelRoute.totalKm.toFixed(1)}km | tur ${ozelRoute.loopKm.toFixed(1)}km | ${Math.round((Date.now() - t0) / 1000)}s\n`);

  console.log('3. NN-TSP rota üret (KAMU)');
  const kamuRoute = nearestNeighborRoute(start, kamu);
  console.log(`   ${kamuRoute.route.length} kurum | ${kamuRoute.totalKm.toFixed(1)}km\n`);

  // İlçe dağılımı
  const byIlce = {};
  for (const r of ozelRoute.route) {
    const k = r.district_slug || '?';
    byIlce[k] = (byIlce[k] || 0) + 1;
  }

  console.log('4. Excel yaz');
  const wb = xlsx.utils.book_new();

  // Sheet 1: Özel klinikler
  const provReadable = provinces.find((p) => p.slug === slug)?.ad ?? slug;
  const sheet1Rows = ozelRoute.route.map((r, i) => {
    const raw = r.raw_payload || {};
    return {
      'Global Sıra': i + 1,
      'İlçe': r.district_slug || '',
      'Klinik Adı': r.name,
      'Mahalle': raw.original?.['Mahalle'] || raw.original?.Mahalle || '',
      'Adres': r.address || '',
      'Telefon': r.phone || '',
      'Yorum Sayısı': r.user_ratings_total ?? '',
      'Puan': r.rating ?? '',
      'Tip/Özellik': r.clinic_segment === 'kamu' ? 'KAMU' : 'Özel',
      'Eve Kuş Uçuşu (km)': r._homeKm.toFixed(1),
      'Segment Mesafesi (km)': r._segmentKm.toFixed(2),
      'Kümülatif (km)': r._cumulativeKm.toFixed(1),
      'place_id': r.google_place_id || '',
    };
  });
  const ws1 = xlsx.utils.json_to_sheet(sheet1Rows);
  xlsx.utils.book_append_sheet(wb, ws1, `${provReadable} Birleşik Rota`);

  // Sheet 2: KAMU
  const sheet2Rows = kamuRoute.route.map((r, i) => ({
    'Sıra': i + 1,
    'İlçe': r.district_slug || '',
    'Kurum Adı': r.name,
    'Adres': r.address || '',
    'Telefon': r.phone || '',
    'Yorum': r.user_ratings_total ?? '',
    'Puan': r.rating ?? '',
    'Eve (km)': r._homeKm.toFixed(1),
    'Kümülatif (km)': r._cumulativeKm.toFixed(1),
    'place_id': r.google_place_id || '',
  }));
  const ws2 = xlsx.utils.json_to_sheet(sheet2Rows);
  xlsx.utils.book_append_sheet(wb, ws2, 'KAMU Hastane & ADSM');

  // Sheet 3: Özet & Rota Bilgisi
  const sheet3Data = [
    [`${provReadable.toUpperCase()} DİŞ HEKİMİ ROTASI`, ''],
    ['Başlangıç / Bitiş noktası', startName],
    ['TOPLAM Özel Klinik', ozelRoute.route.length],
    ['TOPLAM KAMU/ADSM', kamuRoute.route.length],
    ['Tek yön toplam mesafe (NN-TSP)', `${ozelRoute.totalKm.toFixed(1)} km`],
    ['Tur mesafesi (eve dönüş dahil)', `${ozelRoute.loopKm.toFixed(1)} km`],
    ['', ''],
    ['SIRALAMA MANTIĞI', ''],
    ['Yöntem', 'Nearest-Neighbor Greedy TSP — başlangıç noktasından her adımda EN YAKIN ziyaret edilmemiş kliniğe gidilir. Toplam yolu (süre + yakıt) minimize eder.'],
    ['Öncelik', 'Rota verimliliği (zaman + yakıt tasarrufu) — coğrafi yakınlık. Klinikler ilçeye göre DEĞİL, fiziksel konuma göre sıralandı; ardışık duraklar birbirine en yakındır.'],
    ['Kullanım', 'Yukarıdan aşağı: ilk sıra başlangıca en yakın, son sıradan eve dönüş.'],
    ['', ''],
    ['İLÇE DAĞILIMI (birleşik listede)', ''],
    ...Object.entries(byIlce).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, `${v} klinik`]),
    ['', ''],
    ['NOT', 'KAMU/ADSM ayrı sayfa, kendi içinde başlangıca göre sıralı. "Eve Kuş Uçuşu" = düz çizgi mesafe (rota sırası ≠ bu mesafe, ardışık yakınlığa göre).'],
    ['Oluşturulma', new Date().toISOString()],
  ];
  const ws3 = xlsx.utils.aoa_to_sheet(sheet3Data);
  xlsx.utils.book_append_sheet(wb, ws3, 'Özet & Rota Bilgisi');

  const dir = path.resolve(__dirname, '..', 'exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const outFile = path.join(dir, `${slug}_${date}_dis_hekimi_rotasi.xlsx`);
  xlsx.writeFile(wb, outFile);
  console.log(`\n✓ Yazıldı: ${outFile}`);
}

main().catch((e) => { console.error('Fatal:', e); process.exit(1); });
