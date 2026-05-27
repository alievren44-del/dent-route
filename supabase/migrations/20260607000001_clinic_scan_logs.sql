-- ============================================================================
-- saha_clinic_scan_logs — tek-ilçe taramaların kalıcı geçmişi.
-- ============================================================================
-- Tarih    : 2026-05-27
-- Amaç     : clinic-scan ve clinic-scan-v2 her tek seferlik çağrıda 1 satır
--            ekler. result_summary JSONB içinde scanned/new/updated/filtered/
--            errors saklanır. UI "Tarama Geçmişi" panelinde okur.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.saha_clinic_scan_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  performed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  scan_mode text NOT NULL DEFAULT 'v1' CHECK (scan_mode IN ('v1', 'v2')),
  province_slug text NOT NULL,
  district_slug text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  radius_m integer NOT NULL,
  source text NOT NULL DEFAULT 'google' CHECK (source IN ('google','osm','both')),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_clinic_scan_logs_perf_at
  ON public.saha_clinic_scan_logs (performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_scan_logs_province_district
  ON public.saha_clinic_scan_logs (province_slug, district_slug, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_clinic_scan_logs_actor
  ON public.saha_clinic_scan_logs (performed_by, performed_at DESC);

-- RLS — admin all, others none
ALTER TABLE public.saha_clinic_scan_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clinic_scan_logs_admin_select ON public.saha_clinic_scan_logs;
CREATE POLICY clinic_scan_logs_admin_select ON public.saha_clinic_scan_logs
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

DROP POLICY IF EXISTS clinic_scan_logs_admin_insert ON public.saha_clinic_scan_logs;
CREATE POLICY clinic_scan_logs_admin_insert ON public.saha_clinic_scan_logs
  FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- service_role bypass: EF service key kullanıyor, RLS atlanır otomatik.

COMMIT;
