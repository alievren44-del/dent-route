-- ============================================================================
-- Saha Navigasyon — Müşteri/Klinik Kartı Notları (saha_account_notes) Migration
-- ============================================================================
-- Tarih      : 2026-06-03
-- Sprint     : Sprint 3 — Customer Notes (BUG-4)
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   Müşteri (doktor/klinik) kartına serbest metin not ekleme. CustomerDetailPage
--   "Notlar" sekmesi bu tabloyu kullanır. Her not bir temsilciye (rep_id) aittir.
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS.
-- Idempotent — birden fazla `db push` güvenli.
--
-- RLS deseni saha_visits (20260602000001_saha_visits.sql) ile birebir aynı:
--   inline public.profiles lookup + UPPERCASE role IN ('ADMIN','MANAGER') + auth.uid().
--
-- BAĞIMLILIKLAR:
--   - public.profiles                          (Parla 001_initial_schema)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_account_notes — müşteri kartı notları
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_account_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL,
  rep_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_account_notes IS
  'Müşteri (doktor/klinik) kartına eklenen serbest metin notlar. account_id = profiles.id. rep_id notu yazan temsilci.';

CREATE INDEX IF NOT EXISTS idx_saha_account_notes_account_created
  ON public.saha_account_notes(account_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. RLS — saha_account_notes
--    REP: kendi notlarını görür/yazar/siler. ADMIN/MANAGER: hepsini görür/yönetir.
--    Parla profiles.role enum UPPERCASE: 'REP', 'ADMIN', 'MANAGER', 'DOCTOR', ...
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_account_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_account_notes_own_select" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_select" ON public.saha_account_notes
  FOR SELECT USING (
    rep_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_account_notes_own_insert" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_insert" ON public.saha_account_notes
  FOR INSERT WITH CHECK (
    rep_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_account_notes_own_delete" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_delete" ON public.saha_account_notes
  FOR DELETE USING (
    rep_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
    )
  );

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'saha_account_notes';
-- 2. SELECT indexname FROM pg_indexes
--    WHERE tablename = 'saha_account_notes';
-- 3. SELECT polname FROM pg_policies WHERE tablename = 'saha_account_notes';
-- ============================================================================
