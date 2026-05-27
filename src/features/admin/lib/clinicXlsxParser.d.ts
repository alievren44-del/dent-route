/**
 * clinicXlsxParser — Sivas legacy XLSX parsing utilities.
 *
 * Pure functions (no React, no Supabase). Shared between:
 *   - src/features/admin/components/ClinicXlsxImport.tsx (UI tab)
 *   - scripts/import-sivas-legacy.ts (CLI)
 *
 * Bağımlılık: SheetJS (`xlsx`) — community edition.
 */
export type TargetField = 'name' | 'address' | 'phone' | 'lat' | 'lng' | 'neighborhood' | 'type';
export type ClinicType = 'private_clinic' | 'public_hospital' | 'polyclinic';
export interface ClinicRow {
    name: string;
    address?: string;
    phone?: string;
    lat?: number;
    lng?: number;
    neighborhood?: string;
    type?: ClinicType;
}
export interface ParsedSheet {
    headers: string[];
    rows: Record<string, unknown>[];
}
export interface ValidationResult {
    valid: ClinicRow[];
    skipped: Array<{
        row: ClinicRow;
        reason: string;
    }>;
}
/**
 * XLSX dosyasındaki tüm sheet adlarını döner.
 */
export declare function parseSheetNames(arrayBuffer: ArrayBuffer): string[];
/**
 * Belirli bir sheet'i okur; header array + row dict array döner.
 * Boş hücreler null olur (defval: null).
 */
export declare function parseSheetRows(arrayBuffer: ArrayBuffer, sheetName: string): ParsedSheet;
/**
 * Header adlarından target field'lara eşleme tahmini yapar.
 *
 * Heuristic kuralları:
 *   - "klinik" | "kuruluş" | "isim" | "name"        → name
 *   - "adres" | "address"                            → address
 *   - "telefon" | "phone" | "tel"                    → phone
 *   - "lat" | "enlem"                                → lat
 *   - "lng" | "lon" | "boylam"                       → lng
 *   - "mahalle" | "neighborhood"                     → neighborhood
 *
 * Match case-insensitive ve "contains" mantığı; ilk eşleşen header alınır.
 */
export declare function inferColumnMapping(headers: string[]): Partial<Record<TargetField, string>>;
export declare function inferClinicTypeFromSheet(sheetName: string): ClinicType;
/**
 * Raw row dict array'ini target field'lara map eder.
 * type sheet adından infer edilir (override yok).
 */
export declare function mapRows(rows: Record<string, unknown>[], mapping: Partial<Record<TargetField, string>>, sheetName?: string): ClinicRow[];
/**
 * name yoksa veya lat/lng eksik/NaN ise satır skip edilir.
 */
export declare function validateRows(rows: ClinicRow[]): ValidationResult;
/**
 * "legacy_sivas_<hash(name+address)>" formatında sentetik place_id üretir.
 * Aynı (name, address) tekrar import edilirse aynı id çıkar → upsert idempotent.
 */
export declare function syntheticPlaceId(row: ClinicRow, prefix?: string): string;
