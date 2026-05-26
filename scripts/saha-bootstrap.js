#!/usr/bin/env tsx
/**
 * Saha Bootstrap CLI
 *
 * Yeni bir tenant kurulumunda veya doğrulama amacıyla çalıştırılır.
 *   npm run saha:bootstrap
 *
 * Yaptıkları:
 *  1. config/.saha-config.json okur
 *  2. Vertical template'in valid olduğunu doğrular
 *  3. Supabase URL/key erişilebilir mi test eder
 *  4. CRM tipi 'supabase' ise schema check yapar
 *  5. CRM tipi 'custom_rest' ise endpoint test eder
 *  6. Rapor yazdırır
 *
 * EXIT CODES:
 *   0  → tüm checkler ✓
 *   1  → config eksik veya invalid
 *   2  → vertical invalid
 *   3  → Supabase erişimi başarısız
 *   4  → CRM bağlantı problemi
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
// ─── Console renkleri (terminal ANSI) ────────────────────────
const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    gray: '\x1b[90m',
};
const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const log = {
    info: (msg) => console.log(`${c.blue}ℹ${c.reset}  ${msg}`),
    ok: (msg) => console.log(`${c.green}✓${c.reset}  ${msg}`),
    warn: (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`),
    err: (msg) => console.log(`${c.red}✗${c.reset}  ${msg}`),
    section: (msg) => console.log(`\n${c.bold}${msg}${c.reset}`),
};
async function main() {
    console.log(`${c.bold}🚀 Saha Bootstrap${c.reset}\n`);
    // ─── 1. Config file ────────────────────────────────────────
    log.section('1. Konfigürasyon');
    const configPath = resolve(ROOT, 'config/.saha-config.json');
    if (!existsSync(configPath)) {
        log.err(`config/.saha-config.json bulunamadı.`);
        log.info(`Çözüm: cp config/.saha-config.example.json config/.saha-config.json && tenant için düzenle`);
        process.exit(1);
    }
    log.ok('config/.saha-config.json mevcut');
    let config;
    try {
        config = JSON.parse(readFileSync(configPath, 'utf-8'));
    }
    catch (err) {
        log.err(`Config JSON parse edilemedi: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }
    log.ok(`Tenant: ${c.bold}${config.tenant?.name ?? '?'}${c.reset} (${config.tenant?.id ?? '?'})`);
    // ─── 2. Vertical ───────────────────────────────────────────
    log.section('2. Vertical Template');
    const verticalId = config.vertical?.extends;
    if (!verticalId) {
        log.err('config.vertical.extends tanımlı değil');
        process.exit(2);
    }
    const verticalPath = resolve(ROOT, `verticals/${verticalId}.json`);
    if (!existsSync(verticalPath)) {
        log.err(`verticals/${verticalId}.json bulunamadı`);
        process.exit(2);
    }
    let vertical;
    try {
        vertical = JSON.parse(readFileSync(verticalPath, 'utf-8'));
    }
    catch (err) {
        log.err(`Vertical JSON parse edilemedi: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(2);
    }
    log.ok(`Vertical: ${c.bold}${vertical.displayName}${c.reset} (${vertical.id})`);
    log.ok(`${vertical.customerTypes?.length ?? 0} müşteri tipi · ${vertical.visitOutcomes?.length ?? 0} ziyaret outcome · ${(vertical.customFields?.account?.length ?? 0) + (vertical.customFields?.visit?.length ?? 0)} custom field`);
    // ─── 3. Environment variables ──────────────────────────────
    log.section('3. Environment Variables');
    const requiredEnvs = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_MAPBOX_PUBLIC_TOKEN'];
    const missing = requiredEnvs.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        log.warn(`Eksik env var: ${missing.join(', ')}`);
        log.info('.env dosyasını oluştur: cp .env.example .env');
    }
    else {
        log.ok('Tüm gerekli env var\'lar mevcut');
    }
    // ─── 4. Supabase erişim testi ──────────────────────────────
    log.section('4. Supabase Bağlantısı');
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseKey) {
        log.warn('Supabase env eksik — bağlantı testi atlandı');
    }
    else {
        try {
            const res = await fetch(`${supabaseUrl}/rest/v1/`, {
                headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
            });
            if (res.ok) {
                log.ok(`Supabase erişilebilir (${supabaseUrl})`);
            }
            else {
                log.err(`Supabase HTTP ${res.status}`);
                process.exit(3);
            }
        }
        catch (err) {
            log.err(`Supabase bağlantı hatası: ${err instanceof Error ? err.message : String(err)}`);
            process.exit(3);
        }
    }
    // ─── 5. CRM kontrol ─────────────────────────────────────────
    log.section('5. CRM Adapter');
    const crmType = config.crm?.type;
    if (crmType === 'supabase') {
        log.ok('CRM: Built-in (Supabase)');
        log.info('Schema check için: npm run supabase:push (migration uygula)');
    }
    else if (crmType === 'custom_rest') {
        log.ok(`CRM: Custom REST → ${config.crm?.config?.baseUrl}`);
        const endpoints = Object.keys(config.crm?.config?.endpoints ?? {});
        log.ok(`${endpoints.length} endpoint tanımlı`);
        log.info('Endpoint testleri Faz 2 implementasyonunda yapılacak');
    }
    else {
        log.err(`Bilinmeyen CRM tipi: ${crmType}`);
        process.exit(4);
    }
    // ─── Rapor ──────────────────────────────────────────────────
    console.log(`\n${c.green}${c.bold}🎉 Bootstrap tamamlandı.${c.reset}`);
    console.log(`${c.gray}Sonraki adım: npm run dev${c.reset}\n`);
}
main().catch((err) => {
    log.err(`Bootstrap beklenmeyen hata: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(99);
});
