/* eslint-disable */
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

const KEY = process.env.GOOGLE_PLACES_API_KEY;

const names = [
  'Gülnur Kan',
  'Dr.Dt. Burcu Uluhan Seyhan',
  'Dt. Şerife Betül Çetinkaya',
  'Hüseyin AKKUŞ',
  'Uzman Diş Hekimi Zeynep Öncel Torun',
  'Dt. Orkun Ali Çelik',
  'Dt. Buğra Balkan, Diş Hekimi',
  'Dt. Bilal Dedeoğlu',
  'Dentorium Diş Tedavi Merkezi',
];

async function search(q) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q + ' Etimesgut Ankara')}&region=tr&key=${KEY}`;
  const r = await fetch(url);
  const j = await r.json();
  const f = j?.results?.[0];
  if (!f) return null;
  return {
    name: f.name,
    address: f.formatted_address ?? f.vicinity ?? '',
    lat: f.geometry?.location?.lat,
    lng: f.geometry?.location?.lng,
  };
}

async function main() {
  console.log('Etimesgut civarında klinik adresleri (Google TextSearch):\n');
  for (const n of names) {
    const r = await search(n);
    if (!r) {
      console.log(`[BULUNAMADI] ${n}`);
      continue;
    }
    const addrLower = r.address.toLocaleLowerCase('tr-TR');
    const hasEtimesgut = addrLower.includes('etimesgut');
    const flag = hasEtimesgut ? '✓' : '✗';
    console.log(`${flag} ${n}`);
    console.log(`    Google: ${r.name}`);
    console.log(`    Adres : ${r.address}`);
    console.log('');
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
