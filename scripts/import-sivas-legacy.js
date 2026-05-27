#!/usr/bin/env tsx
/**
 * import-sivas-legacy — Sivas legacy XLSX → saha_clinics CLI script.
 *
 * Kullanım:
 *   npm run saha:import-sivas
 *
 * Gereken env (.env):
 *   SUPABASE_URL veya VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Veri dosyası:
 *   ./data-legacy/Sivas_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx
 *
 * Davranış:
 *   - "Özet" sheet'i atlar; "Ana liste" + "KAMU+Hastane" işler (varsa).
 *   - 50'lik batchlerle saha_clinics tablosuna upsert (onConflict: google_place_id).
 *   - Sentetik google_place_id (legacy_sivas_<hash(name+address)>) → idempotent.
 *   - raw_payload.source = 'legacy_import_sivas'.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { inferColumnMapping, mapRows, parseSheetNames, parseSheetRows, syntheticPlaceId, validateRows, } from '../src/features/admin/lib/clinicXlsxParser';
// ----------------------------------------------------------------------------
// Env loading (node:process'in loadEnvFile API'si — Node 20.6+)
// ----------------------------------------------------------------------------
const ENV_PATH = resolve(process.cwd(), '.env');
try {
    // @ts-expect-error — loadEnvFile Node 20.6+'da var, types eski olabilir
    if (typeof process.loadEnvFile === 'function' && existsSync(ENV_PATH)) {
        // @ts-expect-error — yukarıdaki ile aynı
        process.loadEnvFile(ENV_PATH);
    }
}
catch {
    // .env yoksa env'lerin shell'den geldiğini varsay
}
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('SUPABASE_URL (veya VITE_SUPABASE_URL) ve SUPABASE_SERVICE_ROLE_KEY env eksik.');
    process.exit(1);
}
// ----------------------------------------------------------------------------
// Sabitler
// ----------------------------------------------------------------------------
const FILE_PATH = resolve(process.cwd(), 'data-legacy', 'Sivas_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx');
const PROCESS_SHEETS = ['Ana liste', 'KAMU+Hastane'];
const SKIP_SHEETS = new Set(['Özet']);
const BATCH_SIZE = 50;
function buildPayload(row, sheetName) {
    const types = [];
    if (row.type === 'public_hospital')
        types.push('hospital');
    if (row.type === 'polyclinic')
        types.push('polyclinic');
    if (row.type === 'private_clinic')
        types.push('dentist');
    return {
        google_place_id: syntheticPlaceId(row),
        name: row.name,
        lat: row.lat,
        lng: row.lng,
        address: row.address ?? null,
        phone: row.phone ?? null,
        vertical_key: 'dental',
        province_slug: 'sivas',
        types,
        last_seen_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        raw_payload: {
            source: 'legacy_import_sivas',
            sheet: sheetName,
            confidence: 65,
            neighborhood: row.neighborhood ?? null,
            clinic_type: row.type ?? null,
        },
    };
}
// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
    if (!existsSync(FILE_PATH)) {
        console.error(`Sivas Excel'i data-legacy/ klasörüne koy: ${FILE_PATH}`);
        process.exit(1);
    }
    // ArrayBuffer (Node Buffer → ArrayBuffer)
    const buf = readFileSync(FILE_PATH);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const allSheetNames = parseSheetNames(ab);
    console.log(`Sheet bulundu: ${allSheetNames.join(', ')}`);
    const sheetsToProcess = allSheetNames.filter((n) => {
        if (SKIP_SHEETS.has(n))
            return false;
        // PROCESS_SHEETS listesinde varsa al; yoksa "Ana liste" / "KAMU+Hastane" eşleşmesi içerse al
        if (PROCESS_SHEETS.includes(n))
            return true;
        const lower = n.toLowerCase();
        return lower.includes('ana liste') || (lower.includes('kamu') && lower.includes('hastane'));
    });
    if (sheetsToProcess.length === 0) {
        console.error(`İşlenecek sheet bulunamadı. Beklenenler: ${PROCESS_SHEETS.join(', ')}`);
        process.exit(1);
    }
    console.log(`İşlenecek sheet'ler: ${sheetsToProcess.join(', ')}\n`);
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    const bySheet = {};
    for (const sheetName of sheetsToProcess) {
        console.log(`\n=== Sheet: ${sheetName} ===`);
        const parsed = parseSheetRows(ab, sheetName);
        if (parsed.rows.length === 0) {
            console.log('  (boş)');
            bySheet[sheetName] = { processed: 0, created: 0, updated: 0, skipped: 0 };
            continue;
        }
        const mapping = inferColumnMapping(parsed.headers);
        console.log(`  Header (${parsed.headers.length}): ${parsed.headers.join(' | ')}`);
        console.log(`  Mapping: ${JSON.stringify(mapping)}`);
        if (!mapping.name || !mapping.lat || !mapping.lng) {
            console.error(`  ⚠️ name/lat/lng mapping eksik — sheet atlanıyor`);
            bySheet[sheetName] = {
                processed: parsed.rows.length,
                created: 0,
                updated: 0,
                skipped: parsed.rows.length,
            };
            totalSkipped += parsed.rows.length;
            continue;
        }
        const mapped = mapRows(parsed.rows, mapping, sheetName);
        const { valid, skipped } = validateRows(mapped);
        console.log(`  ${mapped.length} satır → ${valid.length} geçerli, ${skipped.length} atlanan`);
        let sheetCreated = 0;
        let sheetUpdated = 0;
        for (let i = 0; i < valid.length; i += BATCH_SIZE) {
            const batch = valid.slice(i, i + BATCH_SIZE);
            const payload = batch.map((r) => buildPayload(r, sheetName));
            const placeIds = payload.map((p) => p.google_place_id);
            const { data: existing } = await supabase
                .from('saha_clinics')
                .select('google_place_id')
                .in('google_place_id', placeIds);
            const existingSet = new Set((existing ?? []).map((e) => e.google_place_id));
            const { error } = await supabase
                .from('saha_clinics')
                .upsert(payload, { onConflict: 'google_place_id' });
            if (error) {
                console.error(`  ❌ batch hata (i=${i}): ${error.message}`);
                totalSkipped += payload.length;
                continue;
            }
            for (let j = 0; j < payload.length; j++) {
                const p = payload[j];
                const globalIdx = i + j + 1;
                if (existingSet.has(p.google_place_id)) {
                    sheetUpdated++;
                    console.log(`  [${globalIdx}/${valid.length}] "${p.name}" — güncellendi`);
                }
                else {
                    sheetCreated++;
                    console.log(`  [${globalIdx}/${valid.length}] "${p.name}" — yüklendi`);
                }
            }
        }
        for (const s of skipped) {
            const display = s.row.name || '(isimsiz)';
            console.log(`  SKIP: "${display}" — ${s.reason}`);
        }
        bySheet[sheetName] = {
            processed: mapped.length,
            created: sheetCreated,
            updated: sheetUpdated,
            skipped: skipped.length,
        };
        totalCreated += sheetCreated;
        totalUpdated += sheetUpdated;
        totalSkipped += skipped.length;
    }
    console.log('\n=== ÖZET ===');
    console.log(`Toplam eklendi   : ${totalCreated}`);
    console.log(`Toplam güncellendi: ${totalUpdated}`);
    console.log(`Toplam atlandı   : ${totalSkipped}`);
    console.log('\nSheet bazında:');
    for (const [name, s] of Object.entries(bySheet)) {
        console.log(`  ${name.padEnd(20)} processed=${s.processed} created=${s.created} updated=${s.updated} skipped=${s.skipped}`);
    }
}
main().catch((err) => {
    console.error('FATAL:', err instanceof Error ? err.message : err);
    process.exit(1);
});
