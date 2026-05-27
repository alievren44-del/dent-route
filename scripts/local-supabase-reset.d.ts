#!/usr/bin/env tsx
/**
 * Lokal Supabase Reset
 *
 * `supabase start` migrations/ klasöründeki dosyaları timestamp sırasıyla
 * uygular. İlk dosya `00000000000000_parla_baseline_local.sql` (gitignored)
 * Parla schema'yı yükler, sonraki saha migrations onun üstüne ALTER eder.
 *
 * Bu script:
 *   1. baseline mevcut mu kontrol et
 *   2. yoksa Parla prod'tan dump et
 *   3. supabase start
 *   4. status göster
 */
export {};
