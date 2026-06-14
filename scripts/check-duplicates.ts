#!/usr/bin/env tsx
/**
 * Duplicate Filename Check
 *
 * Aynı isimli dosyaların farklı klasörlerde bulunmasını engeller.
 * (Ali'nin Elmas Dental projesindeki pattern'in tekrarı.)
 *
 * Refactor sırasında oluşan kalıntıları yakalar.
 */

import { readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');

const EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.github',
  'coverage',
  '.supabase',
  'android',
  'ios',
  // Veri/çıktı dizinleri — kod değil, duplicate basename kontrolü dışı.
  'exports',
  'diş hekimi listesi için',
  'kullanıcı yapacak',
  'tests',
]);

// Kod-olmayan veri dosyaları (aynı isim farklı klasör normaldir).
const EXCLUDED_EXTS = new Set([
  '.xlsx',
  '.xls',
  '.csv',
  '.png',
  '.jpg',
  '.jpeg',
  '.pdf',
  '.zip',
  '.md',
]);

const EXCLUDED_FILES = new Set([
  'index.ts',
  'index.tsx',
  'index.css',
  'types.ts',
  'README.md',
  '.gitkeep',
  // Modül başına konvansiyonel dosya adları (farklı feature'larda normal).
  'factory.ts',
  'provider.ts',
]);

const fileMap = new Map<string, string[]>();

function walk(dir: string) {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.ai_context' && entry !== '.github') continue;
    if (EXCLUDED_DIRS.has(entry)) continue;

    const full = resolve(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (!EXCLUDED_FILES.has(entry) && !EXCLUDED_EXTS.has(entry.slice(entry.lastIndexOf('.')).toLowerCase())) {
      const list = fileMap.get(entry) ?? [];
      list.push(relative(ROOT, full).replace(/\\/g, '/'));
      fileMap.set(entry, list);
    }
  }
}

walk(ROOT);

const SUPABASE_FN_RE = /^supabase\/functions\/[^/]+\//;

// Master in src/data, isolated copies in each supabase/function/<fn>/ (Deno runtime, no shared imports).
const SHARED_SUPABASE_FN_FILES = new Set([
  'districts.json',
  'provinces.json',
  'dedup.ts',
]);

const duplicates = Array.from(fileMap.entries()).filter(([name, paths]) => {
  if (paths.length < 2) return false;
  if (paths.every((p) => SUPABASE_FN_RE.test(p))) return false;
  if (SHARED_SUPABASE_FN_FILES.has(name)) {
    const nonFn = paths.filter((p) => !SUPABASE_FN_RE.test(p));
    if (nonFn.length <= 1) return false;
  }
  return true;
});

if (duplicates.length === 0) {
  console.log('✅ Duplicate dosya tespit edilmedi.');
  process.exit(0);
}

console.error(`❌ ${duplicates.length} duplicate dosya adı tespit edildi:\n`);
for (const [name, paths] of duplicates) {
  console.error(`  ${name}:`);
  for (const p of paths) console.error(`    - ${p}`);
}
console.error('\nÇözüm: dosya adlarını farklılaştır veya gereksiz olanı sil.\n');
process.exit(1);
