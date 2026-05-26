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
import { resolve } from 'node:path';
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
]);

const EXCLUDED_FILES = new Set([
  'index.ts',
  'index.tsx',
  'index.css',
  'types.ts',
  'README.md',
  '.gitkeep',
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
    } else if (!EXCLUDED_FILES.has(entry)) {
      const list = fileMap.get(entry) ?? [];
      list.push(full.replace(ROOT + '/', ''));
      fileMap.set(entry, list);
    }
  }
}

walk(ROOT);

const duplicates = Array.from(fileMap.entries()).filter(([, paths]) => paths.length > 1);

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
