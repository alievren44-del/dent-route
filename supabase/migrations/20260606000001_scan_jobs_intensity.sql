-- ============================================================================
-- saha_scan_jobs — scan intensity kolonu
-- ============================================================================
-- Tarih    : 2026-05-27
-- Amaç     : Tarama yoğunluğu (standard/high/max) değerini job'a bağla.
--            batch-scan EF clinic-scan'i çağırırken intensity'yi propagate eder.
-- Idempotent: IF NOT EXISTS guard.
-- ============================================================================

BEGIN;

ALTER TABLE public.saha_scan_jobs
  ADD COLUMN IF NOT EXISTS scan_intensity text NOT NULL DEFAULT 'standard'
    CHECK (scan_intensity IN ('standard','high','max'));

COMMENT ON COLUMN public.saha_scan_jobs.scan_intensity IS
  'Tarama yoğunluğu — standard: sadece type sorgusu, high: +2 keyword, max: +4 keyword. Maliyet sırasıyla 1x/3x/5x.';

COMMIT;
