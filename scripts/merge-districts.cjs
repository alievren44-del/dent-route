// One-shot merge: BuNickTamYirmiHarfli/turkey-cities-districts-json (973 ilçe)
// + mevcut nufus_2023 alanlarını koru → src/data/tr-locations/districts.json
// + supabase/functions/{batch-scan,clinic-scan-v3,enum-neighborhoods}/districts.json
//
// Çalıştırma: node scripts/merge-districts.js [--fetch]
//   --fetch flag yoksa scripts/.cd.json kullanır (önceden indirilmiş).

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC_LOCAL_PROV = path.join(ROOT, 'src/data/tr-locations/provinces.json');
const SRC_LOCAL_DIST = path.join(ROOT, 'src/data/tr-locations/districts.json');
const SRC_FETCHED = path.join(ROOT, 'scripts/.cd.json');

const TARGETS = [
  path.join(ROOT, 'src/data/tr-locations/districts.json'),
  path.join(ROOT, 'supabase/functions/batch-scan/districts.json'),
  path.join(ROOT, 'supabase/functions/clinic-scan-v3/districts.json'),
  path.join(ROOT, 'supabase/functions/enum-neighborhoods/districts.json'),
];

const TR_MAP = {
  ç: 'c', Ç: 'c',
  ğ: 'g', Ğ: 'g',
  ı: 'i', İ: 'i',
  ö: 'o', Ö: 'o',
  ş: 's', Ş: 's',
  ü: 'u', Ü: 'u',
  â: 'a', Â: 'a',
  î: 'i', Î: 'i',
  û: 'u', Û: 'u',
};

function slugify(text) {
  if (!text) return '';
  let out = '';
  for (const ch of text) out += TR_MAP[ch] ?? ch;
  return out
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeProvinceName(name) {
  return slugify(name);
}

const localProvinces = JSON.parse(fs.readFileSync(SRC_LOCAL_PROV, 'utf8'));
const localDistricts = JSON.parse(fs.readFileSync(SRC_LOCAL_DIST, 'utf8'));
const source = JSON.parse(fs.readFileSync(SRC_FETCHED, 'utf8'));

const slugToPlaka = new Map();
for (const p of localProvinces) {
  slugToPlaka.set(slugify(p.ad), p.plaka);
  slugToPlaka.set(p.slug, p.plaka);
}

// Existing nufus_2023 lookup: (plaka, slug) -> nufus
const nufusMap = new Map();
for (const d of localDistricts) {
  nufusMap.set(`${d.il_plaka}|${d.slug}`, d.nufus_2023 ?? 0);
}

const result = [];
const unmatchedProvinces = [];

for (const city of source) {
  const plaka = slugToPlaka.get(slugify(city.name)) ?? slugToPlaka.get(city.slug);
  if (!plaka) {
    unmatchedProvinces.push(city.name);
    continue;
  }
  const provLocal = localProvinces.find((p) => p.plaka === plaka);
  for (const town of city.towns) {
    const slug = slugify(town.name);
    const nufus = nufusMap.get(`${plaka}|${slug}`) ?? 0;
    result.push({
      il_plaka: plaka,
      il_ad: provLocal.ad,
      ad: town.name,
      slug,
      lat: Number(town.latitude),
      lng: Number(town.longitude),
      nufus_2023: nufus,
    });
  }
}

// Sort: plaka asc, then district name (tr-TR collator)
const collator = new Intl.Collator('tr-TR');
result.sort((a, b) => {
  if (a.il_plaka !== b.il_plaka) return a.il_plaka - b.il_plaka;
  return collator.compare(a.ad, b.ad);
});

if (unmatchedProvinces.length > 0) {
  console.error('UYARI eşlenmeyen il:', unmatchedProvinces.join(', '));
  process.exit(1);
}

console.log(`Toplam ilçe: ${result.length}`);
console.log(`Önceki: ${localDistricts.length}`);
console.log(`Eklenen: ${result.length - localDistricts.length}`);

// Stats per province
const before = new Map();
for (const d of localDistricts) before.set(d.il_plaka, (before.get(d.il_plaka) ?? 0) + 1);
const after = new Map();
for (const d of result) after.set(d.il_plaka, (after.get(d.il_plaka) ?? 0) + 1);
const added = [];
for (const p of localProvinces) {
  const b = before.get(p.plaka) ?? 0;
  const a = after.get(p.plaka) ?? 0;
  if (a > b) added.push({ ad: p.ad, before: b, after: a, eklenen: a - b });
}
console.log('Eklenen ilçeli iller:');
for (const x of added) console.log(`  ${x.ad}: ${x.before} → ${x.after} (+${x.eklenen})`);

const json = JSON.stringify(result, null, 2) + '\n';
for (const target of TARGETS) {
  fs.writeFileSync(target, json);
  console.log(`wrote ${target}`);
}
