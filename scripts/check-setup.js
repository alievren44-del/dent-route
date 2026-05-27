#!/usr/bin/env tsx
/**
 * Saha Setup Doctor
 *
 *   npm run saha:check-setup
 *
 * Env değişkenlerini, Supabase bağlantısını ve gerekli tabloları doğrular.
 *
 * EXIT CODES:
 *   0  → tüm zorunlu checkler geçti
 *   1  → en az bir zorunlu check başarısız
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
// ─── ANSI renkler ─────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    gray: '\x1b[90m',
};
const log = {
    info: (msg) => console.log(`${c.blue}ℹ${c.reset}  ${msg}`),
    ok: (msg) => console.log(`${c.green}✓${c.reset}  ${msg}`),
    warn: (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`),
    err: (msg) => console.log(`${c.red}✗${c.reset}  ${msg}`),
    section: (msg) => console.log(`\n${c.bold}${msg}${c.reset}`),
};
const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
// ─── .env loader (Node 20.6+ loadEnvFile + fallback) ──────────
function loadEnv() {
    const envPath = resolve(ROOT, '.env');
    if (!existsSync(envPath)) {
        log.warn('.env bulunamadı — sadece sistem env değişkenleri okunacak');
        return;
    }
    const procWithLoad = process;
    if (typeof procWithLoad.loadEnvFile === 'function') {
        try {
            procWithLoad.loadEnvFile(envPath);
            return;
        }
        catch {
            // fallback below
        }
    }
    const content = readFileSync(envPath, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#'))
            continue;
        const eq = line.indexOf('=');
        if (eq < 0)
            continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) {
            process.env[key] = value;
        }
    }
}
// ─── Validators ───────────────────────────────────────────────
function isValidUrl(value) {
    try {
        // eslint-disable-next-line no-new
        new URL(value);
        return true;
    }
    catch {
        return false;
    }
}
function looksLikeJwt(value) {
    return value.split('.').length === 3 && value.length > 20;
}
// ─── Tracker ──────────────────────────────────────────────────
let requiredFailures = 0;
function fail(msg) {
    log.err(msg);
    requiredFailures += 1;
}
// ─── Main ─────────────────────────────────────────────────────
async function main() {
    console.log(`${c.bold}🩺 Saha Setup Doctor${c.reset}\n`);
    loadEnv();
    // ─── 1. Env variables ────────────────────────────────────────
    log.section('1. Environment Variables');
    const supabaseUrl = process.env.VITE_SUPABASE_URL ?? '';
    if (!supabaseUrl) {
        fail('VITE_SUPABASE_URL eksik');
    }
    else if (!isValidUrl(supabaseUrl)) {
        fail(`VITE_SUPABASE_URL geçerli URL değil: ${supabaseUrl}`);
    }
    else {
        log.ok(`VITE_SUPABASE_URL → ${supabaseUrl}`);
    }
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? '';
    if (!anonKey) {
        fail('VITE_SUPABASE_ANON_KEY eksik');
    }
    else if (!looksLikeJwt(anonKey)) {
        fail('VITE_SUPABASE_ANON_KEY JWT formatında değil (3 dot-separated bölüm bekleniyor)');
    }
    else {
        log.ok('VITE_SUPABASE_ANON_KEY mevcut');
    }
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!serviceRoleKey) {
        fail('SUPABASE_SERVICE_ROLE_KEY eksik (saha:create-admin için gerekli)');
    }
    else if (!looksLikeJwt(serviceRoleKey)) {
        fail('SUPABASE_SERVICE_ROLE_KEY JWT formatında değil');
    }
    else {
        log.ok('SUPABASE_SERVICE_ROLE_KEY mevcut');
    }
    const mapboxPublic = process.env.VITE_MAPBOX_PUBLIC_TOKEN ?? '';
    if (!mapboxPublic) {
        fail('VITE_MAPBOX_PUBLIC_TOKEN eksik');
    }
    else if (!mapboxPublic.startsWith('pk.')) {
        fail("VITE_MAPBOX_PUBLIC_TOKEN 'pk.' ile başlamıyor");
    }
    else {
        log.ok('VITE_MAPBOX_PUBLIC_TOKEN mevcut');
    }
    const mapboxSecret = process.env.MAPBOX_SECRET_TOKEN ?? '';
    if (!mapboxSecret) {
        log.warn('MAPBOX_SECRET_TOKEN eksik (server-side; opsiyonel)');
    }
    else {
        log.ok('MAPBOX_SECRET_TOKEN mevcut');
    }
    const googlePlaces = process.env.GOOGLE_PLACES_API_KEY ?? '';
    if (!googlePlaces) {
        log.warn('GOOGLE_PLACES_API_KEY eksik (opsiyonel — discovery için)');
    }
    else {
        log.ok('GOOGLE_PLACES_API_KEY mevcut');
    }
    // ─── 2. Supabase bağlantısı ──────────────────────────────────
    log.section('2. Supabase Bağlantısı');
    if (!supabaseUrl || !anonKey) {
        log.warn('Env eksik — bağlantı testi atlandı');
    }
    else {
        try {
            const supabase = createClient(supabaseUrl, anonKey, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const { error } = await supabase
                .from('profiles')
                .select('id', { count: 'exact', head: true });
            if (error) {
                fail(`Supabase profiles erişimi başarısız: ${error.message}`);
            }
            else {
                log.ok('Supabase erişilebilir (profiles tablosu okunabildi)');
            }
        }
        catch (err) {
            fail(`Supabase bağlantı hatası: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // ─── 3. Migration tabloları ──────────────────────────────────
    log.section('3. Migration Tabloları');
    const requiredTables = ['profiles', 'saha_clinics', 'saha_routes'];
    if (!supabaseUrl || !anonKey) {
        log.warn('Env eksik — tablo kontrolü atlandı');
    }
    else {
        try {
            const supabase = createClient(supabaseUrl, anonKey, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const missing = [];
            for (const tableName of requiredTables) {
                const { error } = await supabase
                    .from(tableName)
                    .select('*', { count: 'exact', head: true });
                if (error) {
                    // PGRST205 / 42P01 → tablo yok; başka hata RLS olabilir.
                    if (error.code === '42P01' ||
                        error.code === 'PGRST205' ||
                        /does not exist|not found/i.test(error.message)) {
                        missing.push(tableName);
                    }
                    else {
                        // Tablo var ama RLS / başka neden okunamadı — yine de mevcut sayalım.
                        log.ok(`${tableName} — erişilebilir (RLS aktif)`);
                    }
                }
                else {
                    log.ok(`${tableName} — mevcut`);
                }
            }
            if (missing.length > 0) {
                fail(`Eksik tablo(lar): ${missing.join(', ')}`);
                log.info('Çözüm: npm run supabase:push  (migrationları uygula)');
            }
        }
        catch (err) {
            fail(`Tablo kontrolü hatası: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // ─── 4. Admin sayısı ─────────────────────────────────────────
    log.section('4. Admin Kullanıcı Sayısı');
    if (!supabaseUrl || !(serviceRoleKey || anonKey)) {
        log.warn('Env eksik — admin sayısı kontrolü atlandı');
    }
    else {
        try {
            const supabase = createClient(supabaseUrl, serviceRoleKey || anonKey, {
                auth: { persistSession: false, autoRefreshToken: false },
            });
            const { count, error } = await supabase
                .from('profiles')
                .select('id', { count: 'exact', head: true })
                .eq('role', 'ADMIN');
            if (error) {
                log.warn(`Admin sayısı okunamadı: ${error.message}`);
            }
            else if ((count ?? 0) === 0) {
                log.warn('Hiç ADMIN kullanıcı yok.');
                log.info('Çözüm: npm run saha:create-admin');
            }
            else {
                log.ok(`${count} adet ADMIN kullanıcı mevcut`);
            }
        }
        catch (err) {
            log.warn(`Admin sayısı kontrolü hatası: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    // ─── Rapor ──────────────────────────────────────────────────
    console.log('');
    if (requiredFailures === 0) {
        console.log(`${c.green}${c.bold}✓ Tüm zorunlu checkler geçti.${c.reset}\n`);
        process.exit(0);
    }
    else {
        console.log(`${c.red}${c.bold}✗ ${requiredFailures} zorunlu check başarısız.${c.reset}\n`);
        process.exit(1);
    }
}
main().catch((err) => {
    log.err(`Beklenmeyen hata: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
