/**
 * Schema-drift guard (nav) — hayalet-kolon sınıfını yakalar.
 *
 * NEDEN: kodda `.from('X').select('...col...')` / `.insert/.update` edilen ama DB'de
 * OLMAYAN kolon PostgREST 400 → nav'da sessiz boş-liste/hata olarak maskelenir
 * (nav'ın shipped_at/total_price gibi hayalet-kolon geçmişi var). tsc bunu yakalamaz
 * (select string tip-dışı). Bu test statik olarak kod-select/write/filter'ını kanonik
 * DB şemasına (src/types/database.types.ts, `supabase gen types` çıktısı) karşı doğrular.
 *
 * ORACLE TAZELİĞİ: database.types.ts migration sonrası REGENERATE edilmeli. Bayat
 * oracle → yeni-kolon false-positive. Kırmızıysa ilk kontrol: "types güncel mi?".
 *
 * KONSERVATİF: yalnız YÜKSEK-GÜVEN ghost fail eder. Belirsiz her şey (embed ilişki
 * `col(...)`, alias, json-path, cast, non-literal, aggregate-keyword, `.or` embed-ref,
 * bilinmeyen tablo/view) SESSİZCE ATLANIR — false-positive CI-gate'i kırmasın diye.
 * (Web'deki src/tests/contract/schema-columns.test.ts ile aynı mantık, nav'a uyarlandı.)
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const TYPES_FILE = path.join(ROOT, 'src/types/database.types.ts');

function parseSchema(src: string): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const tableRe = /^ {6}([a-z_][a-z0-9_]*): \{$/gm;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(src))) {
    const name = m[1]!;
    const rowStart = src.indexOf('Row: {', m.index);
    if (rowStart === -1) continue;
    const rowEnd = src.indexOf('Insert: {', rowStart);
    const body = src.slice(rowStart, rowEnd === -1 ? rowStart + 8000 : rowEnd);
    const cols = new Set<string>();
    // nav types kolonları `;`-sonlu; kolon-adı `:` öncesinde → regex uyumlu.
    const colRe = /^ {10}([a-z_][a-z0-9_]*)(\?)?:/gm;
    let cm: RegExpExecArray | null;
    while ((cm = colRe.exec(body))) cols.add(cm[1]!);
    if (cols.size) map.set(name, cols);
  }
  return map;
}

function collectFiles(): string[] {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.claude', 'coverage', '.git', 'tests']);
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (
        (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) &&
        !e.name.endsWith('.d.ts') &&
        !e.name.endsWith('.test.ts') &&
        !e.name.endsWith('.test.tsx')
      )
        out.push(p);
    }
  }
  walk(path.join(ROOT, 'src'));
  return out;
}

function extractSelects(code: string): Array<{ table: string; select: string }> {
  const out: Array<{ table: string; select: string }> = [];
  const anyFrom = [...code.matchAll(/\bfrom\(/g)];
  for (let i = 0; i < anyFrom.length; i++) {
    const fromM = anyFrom[i]!;
    const at = fromM.index!;
    const spanStart = at + fromM[0].length;
    const spanEnd =
      i + 1 < anyFrom.length ? anyFrom[i + 1]!.index! : Math.min(code.length, spanStart + 600);
    const lit = /^from\(\s*['"]([a-z_][a-z0-9_]*)['"](?:\s+as\s+[a-z]+)?\s*\)/.exec(
      code.slice(at, at + 80),
    );
    if (!lit) continue;
    const span = code.slice(spanStart, spanEnd);
    const sm = /\.select\(\s*(['"`])([\s\S]*?)\1/.exec(span);
    if (sm) out.push({ table: lit[1]!, select: sm[2]! });
  }
  return out;
}

const SELECT_KEYWORDS = new Set(['count', 'sum', 'avg', 'min', 'max']);

function topLevelColumns(sel: string): string[] {
  const cols: string[] = [];
  let depth = 0;
  let cur = '';
  const parts: string[] = [];
  for (const ch of sel) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  for (let raw of parts) {
    raw = raw.trim();
    if (!raw || raw === '*') continue;
    if (raw.includes('(')) continue;
    if (raw.includes('!')) continue;
    if (raw.includes(':')) raw = raw.slice(raw.indexOf(':') + 1).trim();
    if (raw.includes('->')) raw = raw.slice(0, raw.indexOf('->')).trim();
    if (raw.includes('::')) raw = raw.slice(0, raw.indexOf('::')).trim();
    if (SELECT_KEYWORDS.has(raw)) continue;
    if (/^[a-z_][a-z0-9_]*$/.test(raw)) cols.push(raw);
  }
  return cols;
}

function matchBrace(code: string, open: number): string {
  let d = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') d++;
    else if (code[i] === '}') {
      d--;
      if (d === 0) return code.slice(open, i + 1);
    }
  }
  return '';
}

function forEachFromSpan(
  code: string,
  cb: (table: string, spanStart: number, span: string) => void,
): void {
  const anyFrom = [...code.matchAll(/\bfrom\(/g)];
  for (let i = 0; i < anyFrom.length; i++) {
    const fromM = anyFrom[i]!;
    const at = fromM.index!;
    const spanStart = at + fromM[0].length;
    const spanEnd =
      i + 1 < anyFrom.length ? anyFrom[i + 1]!.index! : Math.min(code.length, spanStart + 1200);
    const lit = /^from\(\s*['"]([a-z_][a-z0-9_]*)['"](?:\s+as\s+[a-z]+)?\s*\)/.exec(
      code.slice(at, at + 80),
    );
    if (!lit) continue;
    cb(lit[1]!, spanStart, code.slice(spanStart, spanEnd));
  }
}

const FILTER_METHODS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'order',
];

function extractWriteAndFilterCols(
  code: string,
): Array<{ table: string; meth: string; col: string }> {
  const out: Array<{ table: string; meth: string; col: string }> = [];
  forEachFromSpan(code, (table, spanStart, span) => {
    for (const meth of ['insert', 'update', 'upsert']) {
      const re = new RegExp('\\.' + meth + '\\(\\s*\\{', 'g');
      let wm: RegExpExecArray | null;
      while ((wm = re.exec(span))) {
        const objStart = spanStart + wm.index + wm[0].length - 1;
        const obj = matchBrace(code, objStart);
        if (!obj) continue;
        let d = 0;
        for (let k = 1; k < obj.length; k++) {
          const ch = obj[k];
          if (ch === '{' || ch === '[' || ch === '(') { d++; continue; }
          if (ch === '}' || ch === ']' || ch === ')') { d--; continue; }
          if (d === 0 && /[,\n{]/.test(obj[k - 1] ?? '')) {
            const mk = /^\s*([a-z_][a-z0-9_]*)\s*:/.exec(obj.slice(k, k + 60));
            if (mk) out.push({ table, meth, col: mk[1]! });
          }
        }
      }
    }
    for (const meth of FILTER_METHODS) {
      const re = new RegExp('\\.' + meth + "\\(\\s*['\"]([a-z_][a-z0-9_]*)['\"]", 'g');
      let fm: RegExpExecArray | null;
      while ((fm = re.exec(span))) {
        if (SELECT_KEYWORDS.has(fm[1]!)) continue;
        out.push({ table, meth, col: fm[1]! });
      }
    }
  });
  return out;
}

describe('schema-drift (nav): kod kolonları DB şemasında var mı', () => {
  const schema = parseSchema(fs.readFileSync(TYPES_FILE, 'utf8'));

  it('types oracle parse edildi (tablo+view > 20)', () => {
    expect(schema.size).toBeGreaterThan(20);
    expect(schema.get('saha_clinics')).toBeTruthy();
    expect(schema.get('profiles')).toBeTruthy();
  });

  it('hayalet-kolon yok (kod-select ⊆ şema)', () => {
    const ghosts: string[] = [];
    for (const file of collectFiles()) {
      const code = fs.readFileSync(file, 'utf8');
      for (const { table, select } of extractSelects(code)) {
        const cols = schema.get(table);
        if (!cols) continue;
        for (const col of topLevelColumns(select)) {
          if (!cols.has(col)) {
            ghosts.push(
              `${path.relative(ROOT, file)}: from('${table}').select(... '${col}' ...) — kolon şemada YOK`,
            );
          }
        }
      }
    }
    expect(ghosts, `Hayalet kolon(lar):\n${ghosts.join('\n')}`).toEqual([]);
  });

  it('hayalet-kolon yok (write-path + filtre ⊆ şema)', () => {
    const ghosts: string[] = [];
    for (const file of collectFiles()) {
      const code = fs.readFileSync(file, 'utf8');
      for (const { table, meth, col } of extractWriteAndFilterCols(code)) {
        const cols = schema.get(table);
        if (!cols) continue;
        if (!cols.has(col)) {
          ghosts.push(
            `${path.relative(ROOT, file)}: .${meth}(... '${col}' ...) → '${table}' — kolon şemada YOK`,
          );
        }
      }
    }
    expect(ghosts, `Write/filtre hayalet:\n${ghosts.join('\n')}`).toEqual([]);
  });
});
