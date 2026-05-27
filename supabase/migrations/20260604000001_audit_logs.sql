-- ============================================================================
-- Saha Navigasyon — Admin Audit Logs Migration
-- ============================================================================
-- Tarih      : 2026-06-04
-- Sprint     : Sprint 2 (PROMPT-14) — Admin User Management
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   Admin tarafından yapılan kullanıcı/role/region/etc. değişikliklerinin
--   denetim izi. admin-create-user, profiles.role update, password reset,
--   deactivate gibi eylemler buraya işlenir.
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, IF NOT EXISTS index,
-- DROP POLICY IF EXISTS. Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - auth.users (Supabase Auth)
--   - public.profiles (Parla baseline)
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  target_table  text,
  target_id     text,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.admin_audit_logs IS
  'Admin eylem denetim izi. Edge functions (admin-create-user, vb.) ve UI mutasyonları buraya kayıt düşer.';
COMMENT ON COLUMN public.admin_audit_logs.action IS
  'Kanonik eylem kodu. Örn: create_user, change_role, reset_password, deactivate_user, assign_region.';
COMMENT ON COLUMN public.admin_audit_logs.target_id IS
  'Hedef kaydın id''si (text — UUID veya başka tip olabilir).';

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor
  ON public.admin_audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_created
  ON public.admin_audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON public.admin_audit_logs(target_table, target_id);

ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_audit_logs_admin_select" ON public.admin_audit_logs;
CREATE POLICY "admin_audit_logs_admin_select" ON public.admin_audit_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- INSERT only via service-role (Edge Function) or admin UI mutations.
-- authenticated rolü direkt INSERT engellendi — sadece SECURITY DEFINER fonksiyonlar /
-- service_role bypass eder.
DROP POLICY IF EXISTS "admin_audit_logs_admin_insert" ON public.admin_audit_logs;
CREATE POLICY "admin_audit_logs_admin_insert" ON public.admin_audit_logs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'admin_audit_logs';
-- 2. SELECT polname FROM pg_policies WHERE tablename = 'admin_audit_logs';
-- 3. SELECT indexname FROM pg_indexes WHERE tablename = 'admin_audit_logs';
-- ============================================================================
