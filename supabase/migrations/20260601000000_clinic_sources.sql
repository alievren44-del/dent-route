-- ============================================================================
-- Saha Navigasyon — Clinic Sources (Google + OSM) Migration
-- ============================================================================
-- Tarih      : 2026-06-01
-- Sprint     : Sprint 2 — Map & Discovery
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   saha_clinics tablosuna `sources` (text[]) ve `osm_id` kolonlarını ekle.
--   Bu sayede clinic-scan Edge Function Google Places + Overpass (OSM)
--   sonuçlarını tek tabloda birleştirebilir; OSM-only kayıtlar için
--   google_place_id NULL kalabilir.
--
-- ÇAKIŞMA KORUMASI: ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS.
-- Idempotent — birden fazla `db push` güvenli.
--
-- DİKKAT: google_place_id NOT NULL constraint'i OSM-only kayıtları engeller.
-- Bu migration onu da NULLABLE yapar (mevcut UNIQUE constraint NULL'lara izin
-- verir, çünkü Postgres UNIQUE NULL'ları distinct sayar).
-- ============================================================================

BEGIN;

ALTER TABLE public.saha_clinics
  ADD COLUMN IF NOT EXISTS sources TEXT[] NOT NULL DEFAULT ARRAY['google']::TEXT[],
  ADD COLUMN IF NOT EXISTS osm_id TEXT;

-- OSM-only kayıtlar için google_place_id NULL olabilmeli.
ALTER TABLE public.saha_clinics
  ALTER COLUMN google_place_id DROP NOT NULL;

-- osm_id üzerinde unique index — sadece NOT NULL olanlarda (partial).
CREATE UNIQUE INDEX IF NOT EXISTS idx_saha_clinics_osm_id
  ON public.saha_clinics(osm_id) WHERE osm_id IS NOT NULL;

-- sources kolonu üzerinde GIN index (kaynak bazlı sorgular için).
CREATE INDEX IF NOT EXISTS idx_saha_clinics_sources
  ON public.saha_clinics USING GIN (sources);

COMMENT ON COLUMN public.saha_clinics.sources IS
  'Klinik kaydının hangi kaynaklardan toplandığı: [''google''], [''osm''], veya [''google'',''osm''].';
COMMENT ON COLUMN public.saha_clinics.osm_id IS
  'OpenStreetMap element kimliği — format: ''node/123'' veya ''way/456''. Sadece OSM''den gelen kayıtlarda dolu.';

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT column_name, data_type, is_nullable FROM information_schema.columns
--      WHERE table_name = 'saha_clinics' AND column_name IN ('sources','osm_id','google_place_id');
-- 2. SELECT indexname FROM pg_indexes WHERE tablename = 'saha_clinics';
-- ============================================================================
