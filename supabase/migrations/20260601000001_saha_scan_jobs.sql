-- ============================================================================
-- Saha Navigasyon — Scan Jobs (Batch Clinic Scan) Migration
-- ============================================================================
-- Tarih      : 2026-06-01
-- Sprint     : Sprint 2 — Map & Discovery (PROMPT-6)
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   1. saha_scan_jobs            — Tüm il / bölge / Türkiye taraması için iş tanımı.
--   2. saha_scan_job_items       — Bir iş içindeki her ilçenin satır bazlı durumu.
--   3. increment_scan_job_progress() — batch-scan Edge Function her ilçe bitiminde
--                                       çağırır, total_found / new_clinics atomik update.
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS,
--                   CREATE OR REPLACE FUNCTION, IF NOT EXISTS indexler.
-- Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - public.profiles (role IN ('ADMIN','MANAGER','REP'))
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_scan_jobs — kalıcı iş tanımı
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_scan_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  scope_type          text NOT NULL
                        CHECK (scope_type IN ('single_district','whole_province','region','whole_country')),
  scope_params        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Tarama opsiyonları
  radius_km           integer NOT NULL DEFAULT 10
                        CHECK (radius_km BETWEEN 1 AND 50),
  scan_types          text[] NOT NULL DEFAULT ARRAY['dentist']::text[],
  scan_source         text NOT NULL DEFAULT 'both'
                        CHECK (scan_source IN ('google','osm','both')),
  vertical_key        text NOT NULL DEFAULT 'dental',
  -- Sayaçlar
  total_items         integer NOT NULL DEFAULT 0,
  completed_items     integer NOT NULL DEFAULT 0,
  failed_items        integer NOT NULL DEFAULT 0,
  total_clinics_found integer NOT NULL DEFAULT 0,
  total_new_clinics   integer NOT NULL DEFAULT 0,
  -- Audit
  created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_error          text
);

COMMENT ON TABLE public.saha_scan_jobs IS
  'Toplu klinik tarama (batch-scan Edge Function) iş tanımı. scope_type tek ilçe / tüm il / bölge / Türkiye varyantlarını içerir.';
COMMENT ON COLUMN public.saha_scan_jobs.scope_params IS
  'scope_type''a göre değişen parametreler. Örnek: whole_province → {"province":"ankara"}, region → {"region":"marmara"}, single_district → {"province":"ankara","district":"cankaya"}, whole_country → {}.';

-- ----------------------------------------------------------------------------
-- 2. saha_scan_job_items — her ilçenin durumu (1 job → N item)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_scan_job_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES public.saha_scan_jobs(id) ON DELETE CASCADE,
  province_slug       text NOT NULL,
  district_slug       text,
  lat                 double precision NOT NULL,
  lng                 double precision NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed','skipped')),
  -- Sonuçlar
  scanned_count       integer NOT NULL DEFAULT 0,
  new_count           integer NOT NULL DEFAULT 0,
  updated_count       integer NOT NULL DEFAULT 0,
  filtered_out_count  integer NOT NULL DEFAULT 0,
  google_count        integer,
  osm_count           integer,
  error_message       text,
  -- Audit
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_scan_job_items IS
  'saha_scan_jobs içindeki tek bir ilçenin tarama durumu. batch-scan Edge Function ardışık olarak bu satırlardan pending olanları işler.';

-- ----------------------------------------------------------------------------
-- 3. Indexler
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saha_scan_jobs_status     ON public.saha_scan_jobs (status);
CREATE INDEX IF NOT EXISTS idx_saha_scan_jobs_created_by ON public.saha_scan_jobs (created_by);
CREATE INDEX IF NOT EXISTS idx_saha_scan_jobs_created_at ON public.saha_scan_jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_saha_scan_job_items_job     ON public.saha_scan_job_items (job_id);
CREATE INDEX IF NOT EXISTS idx_saha_scan_job_items_status  ON public.saha_scan_job_items (job_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saha_scan_job_items_district
  ON public.saha_scan_job_items (job_id, province_slug, COALESCE(district_slug, ''));

-- ----------------------------------------------------------------------------
-- 4. updated_at trigger
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'saha_scan_jobs_set_updated_at'
  ) THEN
    EXECUTE 'CREATE TRIGGER saha_scan_jobs_set_updated_at
      BEFORE UPDATE ON public.saha_scan_jobs
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. RLS — ADMIN & MANAGER okur/yazar; service_role bypass eder
--    Parla'da role UPPERCASE: 'ADMIN', 'MANAGER', 'REP'.
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_scan_jobs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saha_scan_job_items  ENABLE ROW LEVEL SECURITY;

-- saha_scan_jobs
DROP POLICY IF EXISTS "saha_scan_jobs_admin_select" ON public.saha_scan_jobs;
CREATE POLICY "saha_scan_jobs_admin_select" ON public.saha_scan_jobs
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_scan_jobs_admin_insert" ON public.saha_scan_jobs;
CREATE POLICY "saha_scan_jobs_admin_insert" ON public.saha_scan_jobs
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_scan_jobs_admin_update" ON public.saha_scan_jobs;
CREATE POLICY "saha_scan_jobs_admin_update" ON public.saha_scan_jobs
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_scan_jobs_admin_delete" ON public.saha_scan_jobs;
CREATE POLICY "saha_scan_jobs_admin_delete" ON public.saha_scan_jobs
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

-- saha_scan_job_items (aynı koşul; alt tablo job sahibine bağımlı)
DROP POLICY IF EXISTS "saha_scan_job_items_admin_select" ON public.saha_scan_job_items;
CREATE POLICY "saha_scan_job_items_admin_select" ON public.saha_scan_job_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_scan_job_items_admin_insert" ON public.saha_scan_job_items;
CREATE POLICY "saha_scan_job_items_admin_insert" ON public.saha_scan_job_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_scan_job_items_admin_update" ON public.saha_scan_job_items;
CREATE POLICY "saha_scan_job_items_admin_update" ON public.saha_scan_job_items
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_scan_job_items_admin_delete" ON public.saha_scan_job_items;
CREATE POLICY "saha_scan_job_items_admin_delete" ON public.saha_scan_job_items
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('ADMIN', 'MANAGER')
    )
  );

-- ----------------------------------------------------------------------------
-- 6. increment_scan_job_progress — Edge Function her ilçe bitiminde çağırır.
--    Atomik UPDATE; aynı anda birden fazla worker olsa bile güvenli.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.increment_scan_job_progress(
  p_job_id      uuid,
  p_new_clinics integer,
  p_total_found integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.saha_scan_jobs
     SET completed_items     = completed_items + 1,
         total_clinics_found = total_clinics_found + COALESCE(p_total_found, 0),
         total_new_clinics   = total_new_clinics   + COALESCE(p_new_clinics, 0),
         updated_at          = now()
   WHERE id = p_job_id;
END;
$$;

COMMENT ON FUNCTION public.increment_scan_job_progress(uuid, integer, integer) IS
  'batch-scan Edge Function her ilçe bitiminde çağırır. Atomik UPDATE ile sayaçları artırır.';

-- batch-scan Edge Function service_role ile çağırır ama EXECUTE GRANT
-- authenticated'lara da verilir (admin manuel call edebilir).
GRANT EXECUTE ON FUNCTION public.increment_scan_job_progress(uuid, integer, integer)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Realtime publication — UI 5sn polling + realtime channel kullanır.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    -- saha_scan_jobs
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'saha_scan_jobs'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.saha_scan_jobs';
    END IF;
    -- saha_scan_job_items
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'saha_scan_job_items'
    ) THEN
      EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.saha_scan_job_items';
    END IF;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT * FROM information_schema.tables
--      WHERE table_schema = 'public' AND table_name LIKE 'saha_scan_%';
-- 2. SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.saha_scan_jobs'::regclass;
-- 3. SELECT proname FROM pg_proc WHERE proname = 'increment_scan_job_progress';
-- 4. SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename LIKE 'saha_scan%';
-- ============================================================================
