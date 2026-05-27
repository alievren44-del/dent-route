/**
 * clinicXlsxParser — Sivas legacy XLSX parsing utilities.
 *
 * Pure functions (no React, no Supabase). Shared between:
 *   - src/features/admin/components/ClinicXlsxImport.tsx (UI tab)
 *   - scripts/import-sivas-legacy.ts (CLI)
 *
 * Bağımlılık: SheetJS (`xlsx`) — community edition.
 */
import * as XLSX from 'xlsx';
// ----------------------------------------------------------------------------
// Sheet enumeration / okuma
// ----------------------------------------------------------------------------
/**
 * XLSX dosyasındaki tüm sheet adlarını döner.
 */
export function parseSheetNames(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    return wb.SheetNames.slice();
}
/**
 * Belirli bir sheet'i okur; header array + row dict array döner.
 * Boş hücreler null olur (defval: null).
 */
export function parseSheetRows(arrayBuffer, sheetName) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const ws = wb.Sheets[sheetName];
    if (!ws)
        return { headers: [], rows: [] };
    const rows = XLSX.utils.sheet_to_json(ws, {
        defval: null,
    });
    const headerSet = new Set();
    for (const r of rows) {
        for (const k of Object.keys(r))
            headerSet.add(k);
    }
    return { headers: Array.from(headerSet), rows };
}
// ----------------------------------------------------------------------------
// Heuristic mapping
// ----------------------------------------------------------------------------
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
export function inferColumnMapping(headers) {
    const mapping = {};
    const rules = [
        { target: 'name', patterns: ['klinik', 'kuruluş', 'kurulus', 'isim', 'name'] },
        { target: 'address', patterns: ['adres', 'address'] },
        { target: 'phone', patterns: ['telefon', 'phone', 'tel'] },
        { target: 'lat', patterns: ['lat', 'enlem'] },
        { target: 'lng', patterns: ['lng', 'lon', 'boylam'] },
        { target: 'neighborhood', patterns: ['mahalle', 'neighborhood'] },
    ];
    for (const rule of rules) {
        if (mapping[rule.target])
            continue;
        const found = headers.find((h) => {
            const lower = h.toLowerCase();
            return rule.patterns.some((p) => lower.includes(p));
        });
        if (found)
            mapping[rule.target] = found;
    }
    return mapping;
}
// ----------------------------------------------------------------------------
// Type inference (sheet adından)
// ----------------------------------------------------------------------------
export function inferClinicTypeFromSheet(sheetName) {
    const lower = sheetName.toLowerCase();
    // "KAMU+Hastane" gibi → public_hospital
    if (lower.includes('kamu') || lower.includes('hastane')) {
        return 'public_hospital';
    }
    // "Polikliniği" / "poliklinik" → polyclinic
    if (lower.includes('poliklinik') || lower.includes('polikliniği')) {
        return 'polyclinic';
    }
    return 'private_clinic';
}
// ----------------------------------------------------------------------------
// Row mapping
// ----------------------------------------------------------------------------
function toStr(v) {
    if (v === null || v === undefined)
        return undefined;
    const s = String(v).trim();
    return s.length > 0 ? s : undefined;
}
function toNum(v) {
    if (v === null || v === undefined)
        return undefined;
    if (typeof v === 'number') {
        return Number.isFinite(v) ? v : undefined;
    }
    const s = String(v).trim().replace(',', '.');
    if (s.length === 0)
        return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
}
/**
 * Raw row dict array'ini target field'lara map eder.
 * type sheet adından infer edilir (override yok).
 */
export function mapRows(rows, mapping, sheetName) {
    const out = [];
    const inferredType = sheetName ? inferClinicTypeFromSheet(sheetName) : undefined;
    for (const r of rows) {
        const nameCol = mapping.name;
        const addrCol = mapping.address;
        const phoneCol = mapping.phone;
        const latCol = mapping.lat;
        const lngCol = mapping.lng;
        const nbhCol = mapping.neighborhood;
        const row = {
            name: nameCol ? toStr(r[nameCol]) ?? '' : '',
        };
        if (addrCol) {
            const v = toStr(r[addrCol]);
            if (v)
                row.address = v;
        }
        if (phoneCol) {
            const v = toStr(r[phoneCol]);
            if (v)
                row.phone = v;
        }
        if (latCol) {
            const v = toNum(r[latCol]);
            if (v !== undefined)
                row.lat = v;
        }
        if (lngCol) {
            const v = toNum(r[lngCol]);
            if (v !== undefined)
                row.lng = v;
        }
        if (nbhCol) {
            const v = toStr(r[nbhCol]);
            if (v)
                row.neighborhood = v;
        }
        if (inferredType) {
            row.type = inferredType;
        }
        out.push(row);
    }
    return out;
}
// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------
/**
 * name yoksa veya lat/lng eksik/NaN ise satır skip edilir.
 */
export function validateRows(rows) {
    const valid = [];
    const skipped = [];
    for (const row of rows) {
        if (!row.name || row.name.trim().length === 0) {
            skipped.push({ row, reason: 'name yok' });
            continue;
        }
        if (row.lat === undefined ||
            row.lng === undefined ||
            !Number.isFinite(row.lat) ||
            !Number.isFinite(row.lng)) {
            skipped.push({ row, reason: 'koordinat yok' });
            continue;
        }
        valid.push(row);
    }
    return { valid, skipped };
}
// ----------------------------------------------------------------------------
// Synthetic place_id (idempotent re-import)
// ----------------------------------------------------------------------------
/**
 * FNV-1a 32-bit hash — küçük + deterministic; crypto'ya gerek yok.
 */
function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
/**
 * "legacy_sivas_<hash(name+address)>" formatında sentetik place_id üretir.
 * Aynı (name, address) tekrar import edilirse aynı id çıkar → upsert idempotent.
 */
export function syntheticPlaceId(row, prefix = 'legacy_sivas') {
    const key = `${row.name ?? ''}|${row.address ?? ''}`.toLowerCase().trim();
    return `${prefix}_${fnv1a32(key)}`;
}
