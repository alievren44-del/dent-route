/**
 * ClinicXlsxImport — Admin sayfası tab içeriği.
 *
 * Sivas legacy Excel (XLSX) import akışı:
 *   1. Dosya seç → sheet listesi
 *   2. Sheet multi-select + heuristic column mapping (override edilebilir)
 *   3. İlk 5 satır preview
 *   4. Batch upsert (50'lik) saha_clinics tablosuna
 *   5. Created / updated / skipped özet
 *
 * saha_clinics schema notu:
 *   - "source" kolonu YOK → raw_payload JSON içine
 *     `{ source: 'legacy_import_sivas', sheet: '...', confidence: 65 }` konur
 *   - google_place_id zorunlu (UNIQUE) → sentetik `legacy_sivas_<hash>`
 */

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  Loader2,
  Upload,
  XCircle,
} from 'lucide-react';

import { getSupabaseClient } from '@/lib/supabase';
import {
  inferColumnMapping,
  mapRows,
  parseSheetNames,
  parseSheetRows,
  syntheticPlaceId,
  validateRows,
  type ClinicRow,
  type TargetField,
} from '@/features/admin/lib/clinicXlsxParser';

const TARGET_FIELDS: Array<{ key: TargetField; label: string; required?: boolean }> = [
  { key: 'name', label: 'Klinik Adı (name)', required: true },
  { key: 'address', label: 'Adres' },
  { key: 'phone', label: 'Telefon' },
  { key: 'lat', label: 'Lat (enlem)', required: true },
  { key: 'lng', label: 'Lng (boylam)', required: true },
  { key: 'neighborhood', label: 'Mahalle' },
];

interface SheetState {
  name: string;
  headers: string[];
  rowCount: number;
}

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  skippedReasons: Array<{ name: string; reason: string }>;
  bySheet: Record<string, { processed: number; valid: number; skipped: number }>;
}

interface UpsertPayload {
  google_place_id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  phone: string | null;
  vertical_key: string;
  province_slug: string;
  types: string[];
  last_seen_at: string;
  last_verified_at: string;
  raw_payload: Record<string, unknown>;
}

function buildPayload(row: ClinicRow, sheetName: string): UpsertPayload {
  const types: string[] = [];
  if (row.type === 'public_hospital') types.push('hospital');
  if (row.type === 'polyclinic') types.push('polyclinic');
  if (row.type === 'private_clinic') types.push('dentist');

  return {
    google_place_id: syntheticPlaceId(row),
    name: row.name,
    lat: row.lat as number,
    lng: row.lng as number,
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

export default function ClinicXlsxImport() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null);
  const [sheets, setSheets] = useState<SheetState[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [mapping, setMapping] = useState<Record<TargetField, string>>(
    {} as Record<TargetField, string>,
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [result, setResult] = useState<ImportResult | null>(null);

  // Ana sheet (mapping kolonları için referans)
  const primarySheet = useMemo<SheetState | null>(() => {
    const first = Array.from(selectedSheets)[0];
    if (!first) return null;
    return sheets.find((s) => s.name === first) ?? null;
  }, [sheets, selectedSheets]);

  // Preview rows (mapping uygulanmış, ilk 5)
  const previewRows = useMemo<ClinicRow[]>(() => {
    if (!arrayBuffer || !primarySheet) return [];
    try {
      const parsed = parseSheetRows(arrayBuffer, primarySheet.name);
      const mapped = mapRows(parsed.rows, mapping, primarySheet.name);
      return mapped.slice(0, 5);
    } catch {
      return [];
    }
  }, [arrayBuffer, primarySheet, mapping]);

  function resetState(): void {
    setFileName(null);
    setArrayBuffer(null);
    setSheets([]);
    setSelectedSheets(new Set());
    setMapping({} as Record<TargetField, string>);
    setParseError(null);
    setImporting(false);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFile(file: File): Promise<void> {
    setFileName(file.name);
    setParseError(null);
    setResult(null);

    try {
      const buf = await file.arrayBuffer();
      const sheetNames = parseSheetNames(buf);
      if (sheetNames.length === 0) {
        setParseError('Excel dosyasında sheet bulunamadı.');
        return;
      }

      const sheetStates: SheetState[] = sheetNames.map((name) => {
        const parsed = parseSheetRows(buf, name);
        return { name, headers: parsed.headers, rowCount: parsed.rows.length };
      });

      setArrayBuffer(buf);
      setSheets(sheetStates);

      // Default: ilk sheet seçili
      const firstName = sheetStates[0]?.name;
      const defaultSelected = new Set<string>();
      if (firstName) defaultSelected.add(firstName);
      setSelectedSheets(defaultSelected);

      // İlk sheet'in header'larından mapping infer et
      const firstHeaders = sheetStates[0]?.headers ?? [];
      const inferred = inferColumnMapping(firstHeaders);
      setMapping(inferred as Record<TargetField, string>);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Excel okunamadı.');
    }
  }

  function toggleSheet(name: string): void {
    setSelectedSheets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function updateMapping(target: TargetField, header: string): void {
    setMapping((prev) => {
      const next = { ...prev };
      if (header === '') {
        delete next[target];
      } else {
        next[target] = header;
      }
      return next;
    });
  }

  async function handleImport(): Promise<void> {
    if (!arrayBuffer || importing) return;
    if (selectedSheets.size === 0) {
      setParseError('En az bir sheet seç.');
      return;
    }
    if (!mapping.name || !mapping.lat || !mapping.lng) {
      setParseError('name, lat ve lng kolonları zorunlu.');
      return;
    }

    setParseError(null);
    setImporting(true);
    setProgress({ done: 0, total: 0 });

    const supabase = getSupabaseClient();
    const bySheet: ImportResult['bySheet'] = {};
    const skippedReasons: ImportResult['skippedReasons'] = [];

    // Tüm sheet'lerden valid rows topla
    const allValid: Array<{ row: ClinicRow; sheetName: string }> = [];
    for (const sheetName of selectedSheets) {
      const parsed = parseSheetRows(arrayBuffer, sheetName);
      const mapped = mapRows(parsed.rows, mapping, sheetName);
      const { valid, skipped } = validateRows(mapped);
      bySheet[sheetName] = {
        processed: mapped.length,
        valid: valid.length,
        skipped: skipped.length,
      };
      for (const s of skipped) {
        skippedReasons.push({
          name: s.row.name || '(isimsiz)',
          reason: s.reason,
        });
      }
      for (const v of valid) allValid.push({ row: v, sheetName });
    }

    const total = allValid.length;
    setProgress({ done: 0, total });

    let created = 0;
    let updated = 0;
    const BATCH = 50;

    for (let i = 0; i < allValid.length; i += BATCH) {
      const batch = allValid.slice(i, i + BATCH);
      const payload = batch.map((b) => buildPayload(b.row, b.sheetName));
      const placeIds = payload.map((p) => p.google_place_id);

      // Önce mevcut place_id'leri çek (created vs updated için)
      const { data: existing } = await supabase
        .from('saha_clinics')
        .select('google_place_id')
        .in('google_place_id', placeIds);
      const existingSet = new Set(
        (existing ?? []).map((e: { google_place_id: string }) => e.google_place_id),
      );

      const { error } = await supabase
        .from('saha_clinics')
        .upsert(payload, { onConflict: 'google_place_id' });

      if (error) {
        // Hata batch'i skipped say
        for (const p of payload) {
          skippedReasons.push({ name: p.name, reason: `upsert hata: ${error.message}` });
        }
      } else {
        for (const p of payload) {
          if (existingSet.has(p.google_place_id)) updated++;
          else created++;
        }
      }

      setProgress({ done: Math.min(i + BATCH, total), total });
    }

    setResult({
      created,
      updated,
      skipped: skippedReasons.length,
      skippedReasons,
      bySheet,
    });
    setImporting(false);
  }

  const canImport =
    !!arrayBuffer &&
    selectedSheets.size > 0 &&
    !!mapping.name &&
    !!mapping.lat &&
    !!mapping.lng &&
    !importing;

  return (
    <div className="flex flex-col gap-4">
      {/* Üst aksiyon barı */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Klinik Excel (Sivas Legacy)</h2>
          <p className="text-xs text-slate-500">
            XLSX → saha_clinics (low-confidence; source=legacy_import_sivas).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resetState}
            disabled={importing}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Sıfırla
          </button>
          <button
            type="button"
            disabled={!canImport}
            onClick={() => void handleImport()}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {importing ? `İçeri aktarılıyor... ${progress.done}/${progress.total}` : 'İçeri Aktar'}
          </button>
        </div>
      </div>

      {/* 1. Upload */}
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-6 shadow-sm">
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 text-center">
          <FileSpreadsheet className="h-10 w-10 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">XLSX dosyası seç</span>
          <span className="text-xs text-slate-500">
            Sivas_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx (.xlsx / .xls)
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          {fileName && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              {fileName}
            </span>
          )}
        </label>
      </section>

      {parseError && (
        <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {/* 2. Sheet seçimi */}
      {sheets.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Sheet seç ({sheets.length} bulundu)
            </h3>
            <p className="text-xs text-slate-500">
              Birden fazla sheet seçebilirsin (örn. &quot;Ana liste&quot; +
              &quot;KAMU+Hastane&quot;). &quot;Özet&quot; gibi yardımcı sheet&apos;leri seçme.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {sheets.map((s) => (
              <li key={s.name} className="flex items-center gap-3 px-4 py-2">
                <input
                  type="checkbox"
                  id={`sheet-${s.name}`}
                  checked={selectedSheets.has(s.name)}
                  onChange={() => toggleSheet(s.name)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <label
                  htmlFor={`sheet-${s.name}`}
                  className="flex flex-1 cursor-pointer items-center justify-between text-sm"
                >
                  <span className="font-medium text-slate-700">{s.name}</span>
                  <span className="text-xs text-slate-500">
                    {s.rowCount} satır · {s.headers.length} kolon
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. Mapping */}
      {primarySheet && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Kolon Eşleme ({primarySheet.name})
            </h3>
            <p className="text-xs text-slate-500">
              Heuristic ile otomatik eşlendi; gerekirse override et.
            </p>
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Target Field
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Excel Kolonu
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {TARGET_FIELDS.map((tf) => {
                const isMissingRequired = tf.required && !mapping[tf.key];
                return (
                  <tr key={tf.key}>
                    <td className="px-3 py-2 text-slate-700">
                      {tf.label}
                      {tf.required && <span className="ml-1 text-xs text-rose-600">*</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={mapping[tf.key] ?? ''}
                        onChange={(e) => updateMapping(tf.key, e.target.value)}
                        className={`w-full rounded-md border px-2 py-1 text-sm ${
                          isMissingRequired
                            ? 'border-rose-300 bg-rose-50'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        <option value="">— eşleme yok —</option>
                        {primarySheet.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* 4. Preview */}
      {previewRows.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">
              Önizleme — ilk {previewRows.length} satır ({primarySheet?.name})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    #
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Name
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Address
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Phone
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Lat
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Lng
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Type
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewRows.map((r, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-3 py-2 text-slate-700">{r.name || '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.address ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.phone ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.lat ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.lng ?? '—'}</td>
                    <td className="px-3 py-2 text-slate-700">{r.type ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 5. Progress */}
      {importing && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-medium">
              İçeri aktarılıyor: {progress.done} / {progress.total}
            </span>
            <span className="text-xs">
              %{progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full bg-emerald-600 transition-all"
              style={{
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 6. Result */}
      {result && (
        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-700">Sonuç</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
              <CheckCircle className="h-3.5 w-3.5" />
              {result.created} eklendi
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-800">
              {result.updated} güncellendi
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" />
              {result.skipped} atlandı
            </span>
          </div>

          <div className="px-4 py-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Sheet bazında
            </h4>
            <ul className="space-y-1 text-xs text-slate-600">
              {Object.entries(result.bySheet).map(([name, s]) => (
                <li key={name}>
                  <span className="font-medium text-slate-700">{name}</span> — işlenen {s.processed}
                  , geçerli {s.valid}, atlanan {s.skipped}
                </li>
              ))}
            </ul>
          </div>

          {result.skippedReasons.length > 0 && (
            <div className="border-t border-slate-200 px-4 py-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Atlanan satırlar ({result.skippedReasons.length})
              </h4>
              <ul className="max-h-60 space-y-1 overflow-y-auto text-xs text-amber-800">
                {result.skippedReasons.slice(0, 100).map((s, idx) => (
                  <li key={idx} className="flex items-start gap-1">
                    <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                    <span>
                      {s.name}: {s.reason}
                    </span>
                  </li>
                ))}
                {result.skippedReasons.length > 100 && (
                  <li className="text-slate-500">… +{result.skippedReasons.length - 100} daha</li>
                )}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
