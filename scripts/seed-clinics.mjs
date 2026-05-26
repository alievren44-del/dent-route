#!/usr/bin/env node
/**
 * Seed saha_clinics for Malatya / Mardin / Sivas.
 * Direct Google Places API + Supabase REST UPSERT (Edge Fn bypass — admin auth gerekmez).
 *
 * Requires env vars:
 *   GOOGLE_PLACES_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js';

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GOOGLE_KEY) {
  console.error('GOOGLE_PLACES_API_KEY env eksik');
  process.exit(1);
}
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL veya SUPABASE_SERVICE_ROLE_KEY env eksik');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TARGETS = [
  { slug: 'malatya', ad: 'Malatya', lat: 38.3554, lng: 38.3335 },
  { slug: 'mardin', ad: 'Mardin', lat: 37.3212, lng: 40.7245 },
  { slug: 'sivas', ad: 'Sivas', lat: 39.7477, lng: 37.0179 },
];

const TYPES = ['dentist', 'doctor'];
const RADIUS_M = 30000;
const MAX_PAGES = 3;
const PAGE_WAIT_MS = 2100;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function fetchType(lat, lng, type) {
  const all = [];
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams();
    if (pageToken) {
      params.set('pagetoken', pageToken);
    } else {
      params.set('location', `${lat},${lng}`);
      params.set('rankby', 'distance');
      params.set('type', type);
    }
    params.set('key', GOOGLE_KEY);
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn(`  http_${resp.status} type=${type} page=${page}`);
      break;
    }
    const json = await resp.json();
    const status = json?.status ?? 'UNKNOWN';
    if (status === 'OVER_QUERY_LIMIT') { console.warn('  OVER_QUERY_LIMIT'); break; }
    if (status !== 'OK' && status !== 'ZERO_RESULTS') {
      console.warn(`  google_${status} type=${type}`);
      break;
    }
    const results = Array.isArray(json?.results) ? json.results : [];
    all.push(...results);
    pageToken = typeof json?.next_page_token === 'string' ? json.next_page_token : undefined;
    if (!pageToken) break;
    await sleep(PAGE_WAIT_MS);
  }
  return all;
}

async function scanProvince(province) {
  console.log(`\n=== ${province.ad} (${province.slug}) tarama başladı ===`);
  const dedup = new Map();
  for (const type of TYPES) {
    process.stdout.write(`  type=${type}...`);
    const results = await fetchType(province.lat, province.lng, type);
    for (const r of results) {
      const placeId = r?.place_id;
      const name = r?.name;
      const gLat = r?.geometry?.location?.lat;
      const gLng = r?.geometry?.location?.lng;
      if (!placeId || !name || typeof gLat !== 'number' || typeof gLng !== 'number') continue;
      const dist = haversineM(province.lat, province.lng, gLat, gLng);
      if (dist > RADIUS_M) continue;
      if (dedup.has(placeId)) continue;
      dedup.set(placeId, {
        google_place_id: placeId,
        name,
        lat: gLat,
        lng: gLng,
        address: typeof r?.vicinity === 'string' ? r.vicinity : null,
        rating: typeof r?.rating === 'number' ? r.rating : null,
        user_ratings_total: typeof r?.user_ratings_total === 'number' ? r.user_ratings_total : null,
        types: Array.isArray(r?.types) ? r.types : [],
        province_slug: province.slug,
        district_slug: null,
        vertical_key: 'dental',
        last_seen_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        raw_payload: r,
      });
    }
    console.log(` ${results.length} sonuç`);
  }

  const payload = Array.from(dedup.values());
  if (payload.length === 0) {
    console.log('  ⚠️ sonuç yok');
    return { scanned: 0, new: 0, updated: 0 };
  }

  const placeIds = payload.map((p) => p.google_place_id);
  const { data: existing } = await supabase
    .from('saha_clinics')
    .select('google_place_id')
    .in('google_place_id', placeIds);
  const existingSet = new Set((existing ?? []).map((e) => e.google_place_id));
  const newCount = payload.filter((p) => !existingSet.has(p.google_place_id)).length;

  const { error } = await supabase
    .from('saha_clinics')
    .upsert(payload, { onConflict: 'google_place_id' });
  if (error) {
    console.error('  ❌ UPSERT hatası:', error.message);
    return { scanned: payload.length, new: 0, updated: 0, error: error.message };
  }

  console.log(`  ✅ Toplam ${payload.length} (yeni ${newCount}, güncellenen ${payload.length - newCount})`);
  return { scanned: payload.length, new: newCount, updated: payload.length - newCount };
}

const summary = [];
for (const target of TARGETS) {
  const result = await scanProvince(target);
  summary.push({ province: target.slug, ...result });
}

console.log('\n=== ÖZET ===');
for (const s of summary) {
  console.log(`${s.province.padEnd(10)} scanned=${s.scanned} new=${s.new} updated=${s.updated}${s.error ? ' ERROR=' + s.error : ''}`);
}
