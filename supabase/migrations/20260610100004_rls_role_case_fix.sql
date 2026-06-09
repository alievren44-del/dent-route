-- ============================================================================
-- 20260610100004_rls_role_case_fix.sql  (prod'a uygulanan minimal versiyon)
-- ----------------------------------------------------------------------------
-- SORUN: Bazı inline policy'ler raw 'ADMIN'/'MANAGER' literal kullanıyordu.
--   profiles.role prod'da KARIŞIK case ('admin' + 'ADMIN' birlikte) → lowercase
--   'admin' user'lar audit log YAZAMIYOR (compliance gap) + saha erişimi kırık.
--
-- DOĞRULAMA (prod snapshot): saha_is_admin()/saha_is_rep_or_admin()/
--   saha_is_manager_or_admin() helper'ları ZATEN UPPER(role) kullanıyor
--   (case-insensitive). Yani helper'lara DOKUNULMADI. Sadece raw-literal inline
--   policy'ler helper'a çevrildi (REP+ADMIN+MANAGER coverage korunarak).
-- ============================================================================

-- admin_audit_logs (lowercase 'admin' audit log yazamıyordu)
DROP POLICY IF EXISTS "admin_audit_logs_admin_insert" ON public.admin_audit_logs;
CREATE POLICY "admin_audit_logs_admin_insert" ON public.admin_audit_logs
  FOR INSERT WITH CHECK (public.saha_is_admin());
DROP POLICY IF EXISTS "admin_audit_logs_admin_select" ON public.admin_audit_logs;
CREATE POLICY "admin_audit_logs_admin_select" ON public.admin_audit_logs
  FOR SELECT USING (public.saha_is_admin());

-- saha_account_notes
DROP POLICY IF EXISTS "saha_account_notes_own_select" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_select" ON public.saha_account_notes
  FOR SELECT USING (rep_id = auth.uid() OR public.saha_is_manager_or_admin());
DROP POLICY IF EXISTS "saha_account_notes_own_insert" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_insert" ON public.saha_account_notes
  FOR INSERT WITH CHECK (rep_id = auth.uid() OR public.saha_is_manager_or_admin());
DROP POLICY IF EXISTS "saha_account_notes_own_delete" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_delete" ON public.saha_account_notes
  FOR DELETE USING (rep_id = auth.uid() OR public.saha_is_manager_or_admin());

-- saha_visits (insert REP+ADMIN+MANAGER korundu)
DROP POLICY IF EXISTS "saha_visits_own_select" ON public.saha_visits;
CREATE POLICY "saha_visits_own_select" ON public.saha_visits
  FOR SELECT USING (rep_id = auth.uid() OR public.saha_is_manager_or_admin());
DROP POLICY IF EXISTS "saha_visits_own_insert" ON public.saha_visits;
CREATE POLICY "saha_visits_own_insert" ON public.saha_visits
  FOR INSERT WITH CHECK (rep_id = auth.uid() AND (public.saha_is_rep_or_admin() OR public.saha_is_manager_or_admin()));
DROP POLICY IF EXISTS "saha_visits_own_update" ON public.saha_visits;
CREATE POLICY "saha_visits_own_update" ON public.saha_visits
  FOR UPDATE USING (rep_id = auth.uid() OR public.saha_is_manager_or_admin());
DROP POLICY IF EXISTS "saha_visits_admin_delete" ON public.saha_visits;
CREATE POLICY "saha_visits_admin_delete" ON public.saha_visits
  FOR DELETE USING (public.saha_is_admin());
