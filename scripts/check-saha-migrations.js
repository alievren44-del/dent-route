#!/usr/bin/env tsx
/**
 * Saha Migration Guard
 *
 * Navigasyon repo'nun Parla paylaşımlı Supabase'i ile karışmamasını sağlar.
 *
 * Kurallar:
 *   1. supabase/migrations/ altındaki her dosyanın adı `<timestamp>_saha_*.sql`
 *      formatında olmalı (greenfield ref hariç — migrations-greenfield/ ayrı).
 *   2. SQL içeriği yalnızca:
 *      - CREATE TABLE saha_* (saha prefix tablolar)
 *      - ALTER TABLE allowlist (Sprint 1 izinli ALTER'lar)
 *      - CREATE INDEX saha_*
 *      - CREATE/DROP POLICY (RLS — saha_* veya allowlist tablolar)
 *      - CREATE OR REPLACE FUNCTION saha_*
 *      - INSERT INTO permissions/role_permissions (RBAC seed)
 *      - CREATE EXTENSION
 *      içerebilir.
 *   3. Allowlist dışı tablo CREATE/DROP yasak.
 *
 * Bu guard sayesinde navigasyon'un yanlışlıkla Parla'nın `orders`,
 * `customer_accounts`, `products` gibi tablolarını ALTER etmesi engellenir.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import process from 'node:process';
const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
// Sprint 1 boyunca açıkça izinli olan Parla tablo ALTER'ları.
// Yeni allowlist eklemek için: önce .ai_context/08-shared-db-policy.md güncellenmeli + PR review.
const PARLA_TABLE_ALTER_ALLOWLIST = new Set([
    'profiles', // avg_fuel_consumption, region, kvkk_accepted_at, kvkk_version
    'rep_visits', // route_id, photos, custom_fields, next_action, next_action_due, check_in_location
]);
const PARLA_TABLE_INSERT_ALLOWLIST = new Set([
    'permissions', // RBAC seed
    'role_permissions', // RBAC seed
]);
const FILENAME_PATTERN = /^\d{14}_saha_[a-z0-9_]+\.sql$/;
// Lokal-only dosyalar — guard'dan muaf (gitignore'da, prod'a push edilmez).
const LOCAL_ONLY_FILES = new Set([
    '00000000000000_parla_baseline_local.sql',
]);
const issues = [];
function walk() {
    try {
        const entries = readdirSync(MIGRATIONS_DIR);
        return entries.filter((e) => {
            const p = join(MIGRATIONS_DIR, e);
            return statSync(p).isFile() && e.endsWith('.sql');
        });
    }
    catch {
        return [];
    }
}
function checkFilename(file) {
    if (!FILENAME_PATTERN.test(file)) {
        issues.push({
            file,
            line: 0,
            message: `Dosya adı uyumsuz. Beklenen: <14-digit-timestamp>_saha_<topic>.sql (örn: 20260525000001_saha_extension.sql)`,
        });
    }
}
// Tek bir SQL ifadesinden tablo adlarını çıkarır.
// Statement boundary: noktalı virgül, satır başı veya BEGIN/EXECUTE sonrası beklenir.
// Bu sayede `BEFORE UPDATE ON`, `FOR UPDATE USING`, `ON UPDATE CASCADE` gibi
// in-clause keyword'ler yanlışlıkla yakalanmaz.
function extractTablesFromStatement(stmt) {
    const found = [];
    // Statement boundary öncesi: ; \n veya başlangıç. \b kelime sınırı statement start için yetersiz.
    const stmtBoundary = `(?:^|;|\\nBEGIN\\b|EXECUTE\\s+'|[\\n\\r]\\s*)`;
    const patterns = [
        { action: 'CREATE TABLE', re: new RegExp(`${stmtBoundary}\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?([a-z_][a-z0-9_]*)`, 'gi') },
        { action: 'ALTER TABLE', re: new RegExp(`${stmtBoundary}\\s*ALTER\\s+TABLE\\s+(?:ONLY\\s+)?(?:public\\.)?([a-z_][a-z0-9_]*)`, 'gi') },
        { action: 'DROP TABLE', re: new RegExp(`${stmtBoundary}\\s*DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?([a-z_][a-z0-9_]*)`, 'gi') },
        { action: 'INSERT INTO', re: new RegExp(`${stmtBoundary}\\s*INSERT\\s+INTO\\s+(?:public\\.)?([a-z_][a-z0-9_]*)`, 'gi') },
        { action: 'DELETE FROM', re: new RegExp(`${stmtBoundary}\\s*DELETE\\s+FROM\\s+(?:ONLY\\s+)?(?:public\\.)?([a-z_][a-z0-9_]*)`, 'gi') },
        { action: 'UPDATE', re: new RegExp(`${stmtBoundary}\\s*UPDATE\\s+(?:ONLY\\s+)?(?:public\\.)?([a-z_][a-z0-9_]*)`, 'gi') },
        { action: 'TRUNCATE', re: new RegExp(`${stmtBoundary}\\s*TRUNCATE\\s+(?:TABLE\\s+)?(?:public\\.)?([a-z_][a-z0-9_]*)`, 'gi') },
    ];
    for (const { action, re } of patterns) {
        let m;
        while ((m = re.exec(stmt)) !== null) {
            const table = m[1]?.toLowerCase() ?? '';
            if (table)
                found.push({ action, table, line: 0 });
        }
    }
    return found;
}
function checkSqlContent(file, sql) {
    // Yorum satırlarını temizle (-- ile başlayan ve /* */ blokları)
    const cleaned = sql
        .replace(/--[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    // Satır numarası için orijinal satırlara bak ama analiz cleaned üzerinden
    const lines = sql.split('\n');
    const refs = extractTablesFromStatement(cleaned);
    for (const ref of refs) {
        const table = ref.table;
        if (table.startsWith('saha_'))
            continue;
        const isAllowedAlter = (ref.action === 'ALTER TABLE' || ref.action === 'UPDATE') &&
            PARLA_TABLE_ALTER_ALLOWLIST.has(table);
        const isAllowedSeed = (ref.action === 'INSERT INTO' || ref.action === 'DELETE FROM' || ref.action === 'UPDATE') &&
            PARLA_TABLE_INSERT_ALLOWLIST.has(table);
        if (isAllowedAlter || isAllowedSeed)
            continue;
        // PostgreSQL system / extension table'ı ise atla
        if (table.startsWith('pg_') ||
            table.startsWith('information_schema') ||
            table === 'spatial_ref_sys' ||
            table === 'geometry_columns' ||
            table === 'geography_columns') {
            continue;
        }
        // Satır no bulmak için kaba arama
        const idx = lines.findIndex((l) => new RegExp(`${ref.action.replace(' ', '\\s+')}.*${table}`, 'i').test(l));
        issues.push({
            file,
            line: idx >= 0 ? idx + 1 : 0,
            message: `Yasak işlem: ${ref.action} ${table}. Tablo saha_* prefix değil ve allowlist'te yok.`,
        });
    }
    // CREATE FUNCTION saha_ veya allowlist (set_updated_at)
    const fnRe = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi;
    let fm;
    while ((fm = fnRe.exec(cleaned)) !== null) {
        const name = fm[1]?.toLowerCase() ?? '';
        if (!name)
            continue;
        if (name.startsWith('saha_') || name === 'set_updated_at')
            continue;
        const idx = lines.findIndex((l) => new RegExp(`FUNCTION.*${name}`, 'i').test(l));
        issues.push({
            file,
            line: idx >= 0 ? idx + 1 : 0,
            message: `Yasak işlem: CREATE FUNCTION ${name}. Fonksiyon saha_* prefix değil.`,
        });
    }
}
// ─── Main ──────────────────────────────────────────────────────
const files = walk();
if (files.length === 0) {
    console.info('ℹ Migration yok — guard pas geçildi.');
    process.exit(0);
}
for (const file of files) {
    if (LOCAL_ONLY_FILES.has(file)) {
        console.info(`↪ ${file} lokal-only (gitignored) — guard atlandı.`);
        continue;
    }
    checkFilename(file);
    try {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        checkSqlContent(file, sql);
    }
    catch (err) {
        issues.push({
            file,
            line: 0,
            message: `Okunamadı: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
}
if (issues.length > 0) {
    console.error('\n❌ Saha migration guard başarısız:\n');
    for (const i of issues) {
        const loc = i.line > 0 ? `:${i.line}` : '';
        console.error(`  ${i.file}${loc}: ${i.message}`);
    }
    console.error('\nDetay: .ai_context/08-shared-db-policy.md');
    process.exit(1);
}
console.info(`✅ ${files.length} migration kontrol edildi. Paylaşımlı DB politikasına uygun.`);
