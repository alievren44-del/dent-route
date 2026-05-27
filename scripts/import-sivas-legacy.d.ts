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
export {};
