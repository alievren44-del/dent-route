-- ============================================================================
-- Saha Navigasyon — Rep Targets (Plasiyer Hedefleri) Migration
-- ============================================================================
-- Tarih   : 2026-06-10
-- Amaç    : Aylık plasiyer hedefleri (ziyaret / sipariş ₺ / tahsilat ₺).
--           RepKpiPage actual vs target karşılaştırması için kaynak tablo.
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS.
-- Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - public.profiles                          (Parla 001_initial_schema)
--   - public.set_updated_at()                  (20260525000001_saha_extension.sql)
--   - public.saha_is_admin()                   (20260525000001_saha_extension.sql)
--   - public.saha_is_manager_or_admin()        (20260603000001_saha_invoicing.sql)
--
-- RLS: rep kendi hedefini okur (rep_id = auth.uid()),
--      ADMIN/MANAGER tümünü okur + yazar.
--      (saha_sample_quotas policy stilinin aynası.)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_rep_targets — rep aylık hedefleri
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_rep_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year_month text NOT NULL,                 -- 'YYYY-MM'
  visit_target integer DEFAULT 0,
  order_target_tl numeric(15,2) DEFAULT 0,
  collection_target_tl numeric(15,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rep_id, year_month)
);

COMMENT ON TABLE public.saha_rep_targets IS
  'Plasiyer başına aylık hedefler (ziyaret adedi, sipariş ₺, tahsilat ₺). year_month "YYYY-MM". RepKpiPage actual vs target karşılaştırması.';

CREATE INDEX IF NOT EXISTS idx_saha_rep_targets_rep
  ON public.saha_rep_targets(rep_id);
CREATE INDEX IF NOT EXISTS idx_saha_rep_targets_month
  ON public.saha_rep_targets(year_month);

-- ----------------------------------------------------------------------------
-- 2. RLS — rep okur kendi; ADMIN/MANAGER okur+yazar tümünü
--    (saha_sample_quotas policy stilinin aynası)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_rep_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_rep_targets_own_select" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_own_select" ON public.saha_rep_targets
  FOR SELECT USING (auth.uid() = rep_id OR public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_rep_targets_manager_insert" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_manager_insert" ON public.saha_rep_targets
  FOR INSERT WITH CHECK (public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_rep_targets_manager_update" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_manager_update" ON public.saha_rep_targets
  FOR UPDATE USING (public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_rep_targets_admin_delete" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_admin_delete" ON public.saha_rep_targets
  FOR DELETE USING (public.saha_is_admin());

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'saha_rep_targets';
-- 2. SELECT polname, tablename FROM pg_policies WHERE tablename = 'saha_rep_targets';
-- ============================================================================
