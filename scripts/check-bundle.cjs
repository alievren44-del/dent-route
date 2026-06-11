/**
 * check-bundle.cjs — postbuild bundle guard (#62)
 *
 * Checks:
 * 1. No eager-loaded mapbox chunk (vendor-mapbox* in modulepreload/script src).
 * 2. Entry JS chunk (pointed to by <script type="module">) is < 350 KB raw (uncompressed).
 *
 * Exit 1 on any violation.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const ENTRY_SIZE_LIMIT = 350 * 1024; // 350 KB

// ---------------------------------------------------------------------------
// Read index.html
// ---------------------------------------------------------------------------
if (!fs.existsSync(INDEX_HTML)) {
  console.error('[check-bundle] ERROR: dist/index.html not found. Run `npm run build` first.');
  process.exit(1);
}

const html = fs.readFileSync(INDEX_HTML, 'utf8');

// ---------------------------------------------------------------------------
// 1. Mapbox eager-load guard
// ---------------------------------------------------------------------------
if (html.includes('vendor-mapbox')) {
  console.error(
    '[check-bundle] FAIL: vendor-mapbox chunk detected in dist/index.html.\n' +
    '  Mapbox is being eagerly loaded at startup (script src or modulepreload).\n' +
    '  Fix: ensure mapbox-gl is dynamically imported inside the route that uses it.\n' +
    '  Look for static `import mapboxgl from "mapbox-gl"` at the top of non-lazy components.'
  );
  process.exit(1);
}
console.log('[check-bundle] OK: vendor-mapbox not in index.html (no eager-load regression).');

// ---------------------------------------------------------------------------
// 2. Entry chunk size guard
// ---------------------------------------------------------------------------
// Find the <script type="module" src="..."> entry point
const entryMatch = html.match(/<script\s+type="module"[^>]*\ssrc="([^"]+)"/);
if (!entryMatch) {
  console.error('[check-bundle] ERROR: Could not find <script type="module" src="..."> in dist/index.html.');
  process.exit(1);
}

const entrySrc = entryMatch[1]; // e.g. "/assets/index-DxexOIL9.js"
// Strip leading slash and resolve against dist/
const entryRelative = entrySrc.replace(/^\//, '');
const entryFile = path.join(DIST_DIR, entryRelative);

if (!fs.existsSync(entryFile)) {
  console.error(`[check-bundle] ERROR: Entry chunk not found at ${entryFile}`);
  process.exit(1);
}

const entrySize = fs.statSync(entryFile).size;
const entrySizeKb = (entrySize / 1024).toFixed(1);
console.log(`[check-bundle] Measuring entry chunk: ${entryRelative} (${entrySizeKb} KB raw / uncompressed)`);

if (entrySize >= ENTRY_SIZE_LIMIT) {
  console.error(
    `[check-bundle] FAIL: Entry chunk too large: ${entrySizeKb} KB >= ${(ENTRY_SIZE_LIMIT / 1024).toFixed(0)} KB limit.\n` +
    '  Reduce imports in the main entry or split more code into lazy-loaded routes.'
  );
  process.exit(1);
}

console.log(
  `[check-bundle] OK: Entry chunk ${entrySizeKb} KB < ${(ENTRY_SIZE_LIMIT / 1024).toFixed(0)} KB limit.`
);
console.log('[check-bundle] All checks passed.');
