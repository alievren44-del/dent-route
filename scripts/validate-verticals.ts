#!/usr/bin/env tsx
/**
 * Validate Verticals
 *
 * Tüm verticals/*.json dosyalarının schema'ya uyduğunu doğrular.
 * CI'da pre-build adımı olarak çalışır.
 *
 *   npm run saha:validate-verticals
 */

import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';

const ROOT = resolve(import.meta.dirname ?? process.cwd(), '..');
const VERTICALS_DIR = resolve(ROOT, 'verticals');

const REQUIRED_FIELDS = [
  'id',
  'displayName',
  'labels',
  'customerTypes',
  'googlePlacesTypes',
  'visitOutcomes',
  'customFields',
];

let errorCount = 0;
const failed: string[] = [];

const files = readdirSync(VERTICALS_DIR).filter((f) => f.endsWith('.json'));
console.log(`\n🔍 ${files.length} vertical template doğrulanıyor...\n`);

for (const file of files) {
  const path = resolve(VERTICALS_DIR, file);
  const id = file.replace(/\.json$/, '');

  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'));

    // Required field check
    const missing = REQUIRED_FIELDS.filter((field) => !(field in data));
    if (missing.length > 0) {
      console.error(`✗ ${file}: eksik alan(lar): ${missing.join(', ')}`);
      errorCount++;
      failed.push(file);
      continue;
    }

    // ID consistency
    if (data.id !== id) {
      console.error(`✗ ${file}: dosya adı (${id}) ile id alanı (${data.id}) uyuşmuyor`);
      errorCount++;
      failed.push(file);
      continue;
    }

    // Labels yapı kontrolü
    if (
      !data.labels?.customer?.singular ||
      !data.labels?.customer?.plural ||
      !data.labels?.customer_type ||
      !data.labels?.discovery
    ) {
      console.error(`✗ ${file}: labels yapısı eksik`);
      errorCount++;
      failed.push(file);
      continue;
    }

    // customerTypes en az 1 olmalı
    if (!Array.isArray(data.customerTypes) || data.customerTypes.length === 0) {
      console.error(`✗ ${file}: customerTypes en az 1 öğe içermeli`);
      errorCount++;
      failed.push(file);
      continue;
    }

    // visitOutcomes en az 1 olmalı
    if (!Array.isArray(data.visitOutcomes) || data.visitOutcomes.length === 0) {
      console.error(`✗ ${file}: visitOutcomes en az 1 öğe içermeli`);
      errorCount++;
      failed.push(file);
      continue;
    }

    console.log(
      `✓ ${file.padEnd(28)} → ${data.displayName} (${data.customerTypes.length} tip, ${data.visitOutcomes.length} outcome)`,
    );
  } catch (err) {
    console.error(`✗ ${file}: JSON parse hatası — ${err instanceof Error ? err.message : err}`);
    errorCount++;
    failed.push(file);
  }
}

console.log(`\n${'─'.repeat(60)}`);
if (errorCount === 0) {
  console.log(`✅ Tüm ${files.length} vertical template valid.\n`);
  process.exit(0);
} else {
  console.error(`❌ ${errorCount} dosya başarısız: ${failed.join(', ')}\n`);
  process.exit(1);
}
