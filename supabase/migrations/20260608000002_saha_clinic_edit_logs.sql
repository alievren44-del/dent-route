-- ============================================================================
-- Saha Navigasyon — saha_clinic_edit_logs Audit Migration
-- ============================================================================
-- Tarih      : 2026-06-08
-- Sprint     : Sprint 2 — Phase F (Manual Clinic Edit)
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   saha_clinics tablosu üzerindeki tüm manuel düzenleme aksiyonlarını
--   (create_manual / update / delete) audit trail olarak kaydet.
--   20260608000001_saha_clinics_edit_open.sql tüm authenticated kullanıcılara
--   düzenleme yetkisi açtığı için, her değişikliğin kim tarafından yapıldığı
--   bu tabloda izlenebilir olmalı.
--
-- BAĞIMLILIKLAR:
--   - public.saha_clinics (20260529000001_saha_clinics.sql)
--   - public.profiles (parla_baseline_local)
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- DROP POLICY IF EXISTS. Idempotent — birden fazla `db push` güvenli.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_clinic_edit_logs — audit tablosu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_clinic_edit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id  uuid REFERENCES public.saha_clinics(id) ON DELETE SET NULL,
  edited_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  edited_at  timestamptz NOT NULL DEFAULT now(),
  action     text NOT NULL
              CHECK (action IN ('create_manual', 'update', 'delete')),
  before     jsonb,
  after      jsonb
);

COMMENT ON TABLE public.saha_clinic_edit_logs IS
  'saha_clinics tablosu üzerindeki manuel düzenleme audit trail''i. action=create_manual|update|delete. clinic FK ON DELETE SET NULL — silindikten sonra da log korunur.';

-- ----------------------------------------------------------------------------
-- 2. Indexler
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_clinic_edit_logs_clinic
  ON public.saha_clinic_edit_logs (clinic_id, edited_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_edit_logs_actor
  ON public.saha_clinic_edit_logs (edited_by, edited_at DESC);

-- ----------------------------------------------------------------------------
-- 3. RLS — admin okur, tüm authenticated yazar (best-effort logging)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_clinic_edit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_edit_logs_admin_select ON public.saha_clinic_edit_logs;
CREATE POLICY clinic_edit_logs_admin_select ON public.saha_clinic_edit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = auth.uid()
         AND role = 'ADMIN'
    )
  );

DROP POLICY IF EXISTS clinic_edit_logs_authenticated_insert ON public.saha_clinic_edit_logs;
CREATE POLICY clinic_edit_logs_authenticated_insert ON public.saha_clinic_edit_logs
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT count(*) FROM saha_clinic_edit_logs;
-- 2. SELECT polname, polcmd FROM pg_policy
--      WHERE polrelid = 'public.saha_clinic_edit_logs'::regclass;
-- ============================================================================
