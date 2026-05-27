#!/usr/bin/env tsx
/**
 * Saha Bootstrap Admin CLI
 *
 * Yeni bir Supabase projesinde ilk admin kullanıcısını oluşturur.
 *   npm run saha:create-admin
 *
 * Akış:
 *  1. .env dosyasını okur (Node 20.6+ loadEnvFile, fallback manuel parse)
 *  2. Email, ad soyad, parola sorar (readline/promises)
 *  3. supabase.auth.admin.createUser ile auth user yaratır
 *  4. profiles tablosuna upsert (role = ADMIN)
 *  5. Login URL + bilgi yazdırır
 *
 * EXIT CODES:
 *   0  → başarı
 *   1  → hata
 */
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
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
// ─── .env loader ──────────────────────────────────────────────
function loadEnv() {
    const envPath = resolve(ROOT, '.env');
    if (!existsSync(envPath)) {
        log.warn('.env bulunamadı — sistem env değişkenleri kullanılacak');
        return;
    }
    // Node 20.6+ has process.loadEnvFile; try it first
    const procWithLoad = process;
    if (typeof procWithLoad.loadEnvFile === 'function') {
        try {
            procWithLoad.loadEnvFile(envPath);
            return;
        }
        catch {
            // Fall through to manual parser
        }
    }
    // Fallback: tiny manual parser
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
// ─── Validation ───────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(value) {
    return EMAIL_RE.test(value);
}
function isValidPassword(value) {
    return value.length >= 8;
}
// ─── Profile upsert ───────────────────────────────────────────
async function ensureAdminProfile(supabase, userId, email, fullName) {
    // Check if profile row already exists (handle_new_user trigger may have created one).
    const { data: existing, error: selectErr } = await supabase
        .from('profiles')
        .select('id, role')
        .eq('id', userId)
        .maybeSingle();
    if (selectErr) {
        throw new Error(`profiles select hatası: ${selectErr.message}`);
    }
    if (existing) {
        const { error: updateErr } = await supabase
            .from('profiles')
            .update({
            role: 'ADMIN',
            ad_soyad: fullName,
            email,
        })
            .eq('id', userId);
        if (updateErr) {
            throw new Error(`profiles update hatası: ${updateErr.message}`);
        }
        log.ok('Profil zaten mevcut — role ADMIN olarak güncellendi');
        return;
    }
    const { error: insertErr } = await supabase.from('profiles').insert({
        id: userId,
        email,
        ad_soyad: fullName,
        role: 'ADMIN',
    });
    if (insertErr) {
        throw new Error(`profiles insert hatası: ${insertErr.message}`);
    }
    log.ok('Profil oluşturuldu (role: ADMIN)');
}
// ─── Main ─────────────────────────────────────────────────────
async function main() {
    console.log(`${c.bold}🔐 Saha — İlk Admin Kurulumu${c.reset}\n`);
    loadEnv();
    log.section('1. Environment kontrolü');
    const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl) {
        log.err('VITE_SUPABASE_URL veya SUPABASE_URL .env içinde tanımlı değil');
        process.exit(1);
    }
    if (!serviceRoleKey) {
        log.err('SUPABASE_SERVICE_ROLE_KEY .env içinde tanımlı değil');
        log.info('Service role key Supabase dashboard → Project Settings → API içinde bulunur');
        process.exit(1);
    }
    log.ok(`Supabase: ${supabaseUrl}`);
    log.section('2. Admin bilgileri');
    const rl = createInterface({ input, output });
    let email = '';
    let fullName = '';
    let password = '';
    try {
        while (true) {
            email = (await rl.question('E-posta: ')).trim();
            if (isValidEmail(email))
                break;
            log.warn('Geçerli bir e-posta giriniz.');
        }
        while (true) {
            fullName = (await rl.question('Ad Soyad: ')).trim();
            if (fullName.length >= 2)
                break;
            log.warn('En az 2 karakter giriniz.');
        }
        while (true) {
            password = await rl.question('Parola (min 8 karakter): ');
            if (isValidPassword(password))
                break;
            log.warn('Parola en az 8 karakter olmalı.');
        }
    }
    finally {
        rl.close();
    }
    log.section('3. Kullanıcı oluşturuluyor');
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, ad_soyad: fullName },
    });
    if (createErr || !created?.user) {
        log.err(`auth.admin.createUser hatası: ${createErr?.message ?? 'kullanıcı oluşturulamadı'}`);
        process.exit(1);
    }
    log.ok(`Auth user oluşturuldu (id: ${created.user.id})`);
    log.section('4. Profil ADMIN olarak ayarlanıyor');
    try {
        await ensureAdminProfile(supabase, created.user.id, email, fullName);
    }
    catch (err) {
        log.err(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
    // ─── Rapor ──────────────────────────────────────────────────
    console.log(`\n${c.green}${c.bold}🎉 Admin kurulumu tamamlandı.${c.reset}`);
    console.log(`${c.gray}Giriş URL : ${c.reset}http://localhost:5173/login`);
    console.log(`${c.gray}E-posta   : ${c.reset}${email}`);
    console.log(`${c.gray}Parola    : ${c.reset}(girdiğiniz parola)`);
    console.log(`${c.gray}Rol       : ${c.reset}ADMIN\n`);
}
main().catch((err) => {
    log.err(`Beklenmeyen hata: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
