#!/usr/bin/env tsx
/**
 * Lokal Supabase Reset
 *
 * `supabase start` migrations/ klasöründeki dosyaları timestamp sırasıyla
 * uygular. İlk dosya `00000000000000_parla_baseline_local.sql` (gitignored)
 * Parla schema'yı yükler, sonraki saha migrations onun üstüne ALTER eder.
 *
 * Bu script:
 *   1. baseline mevcut mu kontrol et
 *   2. yoksa Parla prod'tan dump et
 *   3. supabase start
 *   4. status göster
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const BASELINE = join(ROOT, 'supabase', 'migrations', '00000000000000_parla_baseline_local.sql');
function run(cmd, opts = {}) {
    if (!opts.silent)
        console.info(`▶ ${cmd}`);
    try {
        return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit' });
    }
    catch (err) {
        if (err instanceof Error)
            throw err;
        throw new Error(String(err));
    }
}
console.info('\n🔄 Lokal Supabase Reset\n');
console.info('1️⃣  Stack durduruluyor…');
try {
    run('npx supabase stop --no-backup', { silent: true });
}
catch { /* zaten kapalı */ }
if (!existsSync(BASELINE)) {
    console.info('\n2️⃣  Parla baseline yok — Parla prod\'tan dump ediliyor…');
    console.info('     (Parla projesi link\'li olmalı: npx supabase link --project-ref rranpzicmhgfupgabgbi)');
    try {
        run(`npx supabase db dump --linked --schema public -f "${BASELINE}"`);
    }
    catch (err) {
        console.error('\n❌ Baseline dump başarısız. Önce Parla projesine link et:');
        console.error('   npx supabase link --project-ref rranpzicmhgfupgabgbi\n');
        throw err;
    }
}
else {
    console.info('\n2️⃣  Baseline mevcut, atlandı.');
    console.info('     Yenilemek için: npm run db:local-dump-baseline');
}
console.info('\n3️⃣  Stack başlatılıyor (Parla baseline + saha migrations sırayla uygulanır)…');
run('npx supabase start');
console.info('\n4️⃣  Durum:');
run('npx supabase status');
console.info('\n✅ Lokal Supabase hazır.');
console.info('   Studio:  http://127.0.0.1:54323');
console.info('   API:     http://127.0.0.1:54321');
console.info('   DB:      postgresql://postgres:postgres@127.0.0.1:54322/postgres');
console.info('\n   Test kullanıcısı eklemek için: psql ile manuel INSERT veya supabase/local/seed.sql');
