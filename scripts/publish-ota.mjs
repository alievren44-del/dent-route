/**
 * publish-ota.mjs — OTA web-bundle yayınla (akşam fix sonrası).
 * Kullanım: SUPABASE_SERVICE_KEY=xxx node scripts/publish-ota.mjs <parla|nav> [--no-build]
 *
 * Yapar: build:native (VITE_ENABLE_FEEDBACK=1) → dist'i zip → Supabase Storage
 *   'ota/<app>/<version>.zip' + 'ota/<app>/latest.json' güncelle.
 * Friends'in app'i sonraki açılışta otomatik indirir (src/ota/checkUpdate.ts).
 */
import { createClient } from '@supabase/supabase-js';
import archiver from 'archiver';
import { createWriteStream, readFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';

const app = process.argv[2];
const noBuild = process.argv.includes('--no-build');
if (!['parla', 'nav'].includes(app)) {
  console.error('Kullanım: node scripts/publish-ota.mjs <parla|nav> [--no-build]');
  process.exit(1);
}
const SB_URL = 'https://rranpzicmhgfupgabgbi.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('HATA: SUPABASE_SERVICE_KEY ortam değişkeni gerekli.'); process.exit(1); }

const stamp = new Date();
const version = `${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(stamp.getDate()).padStart(2, '0')}${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`;

if (!noBuild) {
  console.log('▸ build:native (VITE_ENABLE_FEEDBACK=1)…');
  execSync('npm run build:native', { stdio: 'inherit', env: { ...process.env, VITE_ENABLE_FEEDBACK: '1' } });
}

const zipPath = `ota-${app}-${version}.zip`;
console.log('▸ dist zipleniyor…');
await new Promise((res, rej) => {
  const out = createWriteStream(zipPath);
  const ar = archiver('zip', { zlib: { level: 9 } });
  out.on('close', res); ar.on('error', rej);
  ar.pipe(out); ar.directory('dist/', false); ar.finalize();
});

const sb = createClient(SB_URL, KEY, { auth: { persistSession: false } });
const zipKey = `${app}/${version}.zip`;
console.log(`▸ yükleniyor → ota/${zipKey}`);
const { error: e1 } = await sb.storage.from('ota').upload(zipKey, readFileSync(zipPath), { contentType: 'application/zip', upsert: true });
if (e1) { console.error('zip upload hata:', e1.message); process.exit(1); }

const manifest = { version, url: `${SB_URL}/storage/v1/object/public/ota/${zipKey}`, published: stamp.toISOString() };
const { error: e2 } = await sb.storage.from('ota').upload(`${app}/latest.json`, Buffer.from(JSON.stringify(manifest)), { contentType: 'application/json', upsert: true });
if (e2) { console.error('manifest upload hata:', e2.message); process.exit(1); }

rmSync(zipPath, { force: true });
console.log(`\n✓ OTA yayınlandı: ${app} v${version}`);
console.log(`  manifest: ${SB_URL}/storage/v1/object/public/ota/${app}/latest.json`);
console.log('  Friends app'i sonraki açılışta otomatik güncellenecek.');
