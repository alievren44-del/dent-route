-- ============================================================================
-- Saha Navigasyon — saha_assignments region columns
-- ============================================================================
-- Tarih      : 2026-05-28
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Strateji   : ADDITIVE — saha_assignments tablosuna il/ilçe bölge kolonları
--              ekler. RLS değiştirilmez, sadece kolon + GIN index.
--
-- ÇAKIŞMA KORUMASI: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - public.saha_assignments (20260525000001_saha_extension)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ALTER saha_assignments — region columns
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_assignments
  ADD COLUMN IF NOT EXISTS region_provinces text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS region_districts text[] NOT NULL DEFAULT ARRAY[]::text[];

COMMENT ON COLUMN public.saha_assignments.region_provinces IS
  'Rep''in atandığı il listesi (provinces.json slug formatı: ankara, istanbul, ...). Boş array = sınırlı atama yok.';
COMMENT ON COLUMN public.saha_assignments.region_districts IS
  'Rep''in atandığı ilçe listesi (districts.json slug formatı: cankaya, kadikoy, ...). Boş array = il bazlı yetki yeterli.';

-- ----------------------------------------------------------------------------
-- 2. GIN index — array membership sorguları için
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saha_assignments_region_provinces
  ON public.saha_assignments USING GIN (region_provinces);
CREATE INDEX IF NOT EXISTS idx_saha_assignments_region_districts
  ON public.saha_assignments USING GIN (region_districts);

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'saha_assignments'
--      AND column_name IN ('region_provinces','region_districts');
-- 2. SELECT indexname FROM pg_indexes
--    WHERE tablename = 'saha_assignments'
--      AND indexname LIKE 'idx_saha_assignments_region_%';
-- ============================================================================
