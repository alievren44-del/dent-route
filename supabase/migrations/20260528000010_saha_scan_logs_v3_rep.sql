-- ============================================================================
-- saha_clinic_scan_logs — v3 scan_mode + REP/ADMIN okuma yetkisi
-- ----------------------------------------------------------------------------
-- 1. CHECK constraint genişlet: 'v3' eklenir
-- 2. RLS SELECT policy: REP/SALES_REP de okuyabilsin (corridor-enrichment
--    için "son tarama" kontrolü)
-- ============================================================================

-- 1. scan_mode CHECK genişlet
ALTER TABLE public.saha_clinic_scan_logs DROP CONSTRAINT IF EXISTS saha_clinic_scan_logs_scan_mode_check;
ALTER TABLE public.saha_clinic_scan_logs ADD CONSTRAINT saha_clinic_scan_logs_scan_mode_check
  CHECK (scan_mode IN ('v1', 'v2', 'v3'));

-- 2. SELECT policy: ADMIN + REP/SALES_REP/MANAGER
DROP POLICY IF EXISTS clinic_scan_logs_admin_select ON public.saha_clinic_scan_logs;
DROP POLICY IF EXISTS clinic_scan_logs_authenticated_select ON public.saha_clinic_scan_logs;
CREATE POLICY clinic_scan_logs_authenticated_select ON public.saha_clinic_scan_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND upper(role::text) IN ('ADMIN', 'REP', 'SALES_REP', 'MANAGER')
    )
  );

-- INSERT yalnızca ADMIN ve service_role (corridor-enrichment service_role'le yazar)
-- mevcut admin_insert policy korunur.
