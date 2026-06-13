/**
 * CsvImportPage — Admin sayfası.
 *
 * CSV upload → parse → preview → profiles bulk insert.
 * Tek tek (per-row) insert, duplicate email check.
 * Auth user yaratımı YOK — sadece profile stub.
 */

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  Loader2,
  Upload,
  Users,
  XCircle,
} from 'lucide-react';

import { getTypedClient } from '@/lib/supabase';
import ClinicXlsxImport from '@/features/admin/components/ClinicXlsxImport';

const KNOWN_COLUMNS = ['ad_soyad', 'email', 'telefon', 'klinik_adi', 'city', 'role'] as const;

type KnownColumn = (typeof KNOWN_COLUMNS)[number];

interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

interface PreviewWarning {
  kind: 'missing-email' | 'duplicate-email' | 'unknown-header';
  message: string;
}

interface ImportResultEntry {
  rowIndex: number;
  email: string | null;
  status: 'created' | 'duplicate' | 'error';
  message?: string;
  id?: string;
}

interface ImportSummary {
  created: number;
  duplicate: number;
  error: number;
  entries: ImportResultEntry[];
}

function parseCsv(text: string): ParsedCsv {
  const lines = text
    .replace(new RegExp('^\\uFEFF'), '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const first = lines[0]!;
  const sep = first.includes(';') && !first.includes(',') ? ';' : ',';
  const headers = first.split(sep).map((s) => s.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => l.split(sep).map((s) => s.trim()));
  return { headers, rows };
}

function rowToRecord(headers: string[], row: string[]): Record<string, string> {
  const rec: Record<string, string> = {};
  headers.forEach((h, idx) => {
    rec[h] = (row[idx] ?? '').trim();
  });
  return rec;
}

function computeWarnings(parsed: ParsedCsv): PreviewWarning[] {
  const warnings: PreviewWarning[] = [];
  const unknown = parsed.headers.filter((h) => !KNOWN_COLUMNS.includes(h as KnownColumn));
  unknown.forEach((h) =>
    warnings.push({
      kind: 'unknown-header',
      message: `Bilinmeyen kolon: "${h}" (yok sayılacak)`,
    }),
  );
  const emailIdx = parsed.headers.indexOf('email');
  const seen = new Map<string, number>();
  parsed.rows.forEach((row, i) => {
    const email = emailIdx >= 0 ? (row[emailIdx] ?? '').trim() : '';
    if (!email) {
      warnings.push({
        kind: 'missing-email',
        message: `Satır ${i + 2}: email eksik`,
      });
      return;
    }
    const key = email.toLowerCase();
    const prev = seen.get(key);
    if (prev !== undefined) {
      warnings.push({
        kind: 'duplicate-email',
        message: `Satır ${i + 2}: "${email}" satır ${prev + 2} ile aynı`,
      });
    } else {
      seen.set(key, i);
    }
  });
  return warnings;
}

async function importRow(
  row: Record<string, string>,
): Promise<
  | { status: 'created'; id: string | undefined }
  | { status: 'duplicate'; id: string | undefined }
  | { status: 'error'; message: string }
> {
  const supabase = getTypedClient();
  const email = row.email ? row.email.trim() : '';

  if (email) {
    const { data: existing, error: existingError } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existingError) {
      return { status: 'error', message: existingError.message };
    }
    if (existing) {
      return { status: 'duplicate', id: existing.id as string | undefined };
    }
  }

  const payload: Record<string, unknown> = {
    id: crypto.randomUUID(),
    email: email || null,
    ad_soyad: row.ad_soyad || null,
    telefon: row.telefon || null,
    klinik_adi: row.klinik_adi || null,
    city: row.city || null,
    role: row.role || 'CLINIC',
    is_approved: false,
  };

  const { data, error } = await supabase.from('profiles').insert(payload as never).select('id').single();

  if (error) return { status: 'error', message: error.message };
  return { status: 'created', id: (data?.id as string | undefined) ?? undefined };
}

function UserCsvImport() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const warnings = useMemo(() => (parsed ? computeWarnings(parsed) : []), [parsed]);

  const previewRows = useMemo(() => (parsed ? parsed.rows.slice(0, 5) : []), [parsed]);

  function resetState() {
    setParsed(null);
    setParseError(null);
    setFileName(null);
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function handleFile(file: File) {
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    setFileName(file.name);
    try {
      const text = await file.text();
      const result = parseCsv(text);
      if (result.headers.length === 0) {
        setParseError('CSV boş veya geçersiz.');
        setParsed(null);
        return;
      }
      setParseError(null);
      setParsed(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'CSV okunamadı.');
      setParsed(null);
    }
  }

  async function handleImport() {
    if (!parsed || importing) return;
    setImporting(true);
    setSummary(null);
    const total = parsed.rows.length;
    setProgress({ done: 0, total });

    const entries: ImportResultEntry[] = [];
    let created = 0;
    let duplicate = 0;
    let error = 0;

    for (let i = 0; i < parsed.rows.length; i++) {
      const rawRow = parsed.rows[i]!;
      const rec = rowToRecord(parsed.headers, rawRow);
      const email = rec.email ? rec.email.trim() : '';
      try {
        const res = await importRow(rec);
        if (res.status === 'created') {
          created++;
          entries.push({
            rowIndex: i,
            email: email || null,
            status: 'created',
            id: res.id,
          });
        } else if (res.status === 'duplicate') {
          duplicate++;
          entries.push({
            rowIndex: i,
            email: email || null,
            status: 'duplicate',
            id: res.id,
          });
        } else {
          error++;
          entries.push({
            rowIndex: i,
            email: email || null,
            status: 'error',
            message: res.message,
          });
        }
      } catch (err) {
        error++;
        entries.push({
          rowIndex: i,
          email: email || null,
          status: 'error',
          message: err instanceof Error ? err.message : 'Bilinmeyen hata',
        });
      }
      setProgress({ done: i + 1, total });
    }

    setSummary({ created, duplicate, error, entries });
    setImporting(false);
  }

  const canImport = !!parsed && parsed.rows.length > 0 && !importing;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">CSV İçeri Aktarım</h1>
          <p className="text-xs text-slate-500">
            Profiles tablosuna toplu klinik / kullanıcı kaydı (düşük güven — onay bekler).
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
            onClick={() => {
              void handleImport();
            }}
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
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4">
        {/* Dosya seçici */}
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-6 shadow-sm">
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 text-center">
            <FileUp className="h-10 w-10 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">CSV dosyası seç</span>
            <span className="text-xs text-slate-500">
              Header: ad_soyad, email, telefon, klinik_adi, city, role
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
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

        {parsed && (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">Önizleme</h2>
                <p className="text-xs text-slate-500">
                  Toplam {parsed.rows.length} satır — ilk {Math.min(5, parsed.rows.length)}{' '}
                  gösteriliyor.
                </p>
              </div>
              {warnings.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {warnings.length} uyarı
                </span>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      #
                    </th>
                    {parsed.headers.map((h) => (
                      <th
                        key={h}
                        className={`px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide ${
                          KNOWN_COLUMNS.includes(h as KnownColumn)
                            ? 'text-slate-600'
                            : 'text-amber-700'
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {previewRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                      {parsed.headers.map((h, j) => (
                        <td key={h} className="px-3 py-2 text-slate-700 whitespace-nowrap">
                          {row[j] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {previewRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={parsed.headers.length + 1}
                        className="px-3 py-6 text-center text-sm text-slate-500"
                      >
                        Veri satırı yok.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {warnings.length > 0 && (
              <div className="border-t border-slate-200 px-4 py-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Uyarılar
                </h3>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-800">
                  {warnings.map((w, idx) => (
                    <li key={idx} className="flex items-start gap-1">
                      <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>{w.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

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

        {summary && (
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Sonuç</h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {summary.created} eklendi
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                {summary.duplicate} atlandı (duplicate)
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-800">
                <XCircle className="h-3.5 w-3.5" />
                {summary.error} hata
              </span>
            </div>
            {summary.error > 0 && (
              <div className="px-4 py-3">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Hatalar
                </h3>
                <ul className="max-h-60 space-y-1 overflow-y-auto text-xs text-rose-700">
                  {summary.entries
                    .filter((e) => e.status === 'error')
                    .map((e, idx) => (
                      <li key={idx} className="flex items-start gap-1">
                        <XCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
                        <span>
                          Satır {e.rowIndex + 2}
                          {e.email ? ` (${e.email})` : ''}: {e.message ?? 'bilinmeyen hata'}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tabbed wrapper — default export
// ----------------------------------------------------------------------------

type ImportTab = 'user-csv' | 'clinic-xlsx';

export default function CsvImportPage() {
  const [tab, setTab] = useState<ImportTab>('user-csv');

  return (
    <div className="flex h-full min-h-screen flex-col bg-slate-50">
      <nav className="sticky top-0 z-10 flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-4 py-2 shadow-sm">
        <button
          type="button"
          onClick={() => setTab('user-csv')}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
            tab === 'user-csv' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Users className="h-4 w-4" />
          Kullanıcı CSV
        </button>
        <button
          type="button"
          onClick={() => setTab('clinic-xlsx')}
          className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${
            tab === 'clinic-xlsx' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Klinik Excel
        </button>
      </nav>

      {tab === 'user-csv' ? (
        <UserCsvImport />
      ) : (
        <div className="flex-1 p-4">
          <ClinicXlsxImport />
        </div>
      )}
    </div>
  );
}
