-- ============================================================================
-- Saha Navigasyon — saha_clinics clinic_segment Migration
-- ============================================================================
-- Tarih      : 2026-06-09
-- Sprint     : Sprint 2 — Phase 2 (clinic-scan-v3)
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   clinic-scan-v3 KAMU segment ayrımı için saha_clinics tablosuna
--   `clinic_segment` kolonu ekler. Değerler:
--     - 'private' (default) — özel muayenehane / klinik
--     - 'kamu'              — ADSM, devlet/şehir hastanesi, diş hekimliği
--                              fakültesi, sağlık bakanlığı kaynaklı
--   filters-v3.ts KAMU_KEYWORDS listesi segment atamasını yapar.
--
-- ÇAKIŞMA KORUMASI: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Idempotent — birden fazla `db push` güvenli.
-- ============================================================================

BEGIN;

ALTER TABLE public.saha_clinics
  ADD COLUMN IF NOT EXISTS clinic_segment text NOT NULL DEFAULT 'private'
    CHECK (clinic_segment IN ('private','kamu'));

CREATE INDEX IF NOT EXISTS idx_saha_clinics_segment
  ON public.saha_clinics(clinic_segment);

COMMENT ON COLUMN public.saha_clinics.clinic_segment IS
  'Klinik segmenti. private=özel muayenehane/klinik (varsayılan); kamu=ADSM, devlet/şehir hastanesi, diş hekimliği fakültesi, sağlık bakanlığı. clinic-scan-v3 filters-v3.ts içinde KAMU_KEYWORDS ile otomatik atanır.';

COMMIT;
