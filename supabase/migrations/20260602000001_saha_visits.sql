-- ============================================================================
-- Saha Navigasyon — Visits (Ziyaret Modülü) Migration
-- ============================================================================
-- Tarih      : 2026-06-02
-- Sprint     : Sprint 2 (PROMPT-8/9/10) — Check-in + Visit Form + History
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   Saha-native ziyaret kayıtları. Parla'nın mevcut public.rep_visits
--   tablosundan AYRI (`saha_visits`) — saha modülünün ihtiyaçlarına göre
--   optimize edilmiş schema (multi-photo + custom_fields + status state machine).
--
-- NOT (önemli): Bu tablo `rep_visits` ile sync edilmez. Parla web uygulamasının
--   mevcut rep_visits sorgularında bu kayıtlar GÖRÜNMEZ. Yeniden kullanım
--   istenirse view veya trigger ile bridge yazılmalıdır.
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, DO blocks FK guard'ları,
-- DROP POLICY IF EXISTS. Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - public.profiles                          (Parla 001_initial_schema)
--   - public.set_updated_at()                  (20260525000001_saha_extension.sql)
--   - public.saha_is_admin()                   (20260525000001_saha_extension.sql)
--   - public.saha_is_rep_or_admin()            (20260525000001_saha_extension.sql)
--   - storage.buckets                          (Supabase Storage)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_visits — saha-native ziyaret kaydı
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_visits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          text NOT NULL,
  rep_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  route_id            uuid REFERENCES public.saha_routes(id) ON DELETE SET NULL,

  check_in_at         timestamptz NOT NULL DEFAULT now(),
  check_out_at        timestamptz,

  check_in_lat        double precision,
  check_in_lng        double precision,
  check_in_accuracy_m double precision,
  distance_to_account_m double precision,

  status              text NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','completed','cancelled')),

  outcome             text,
  met_person          text,
  notes               text,
  custom_fields       jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_visit_date     date,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_visits IS
  'Saha-native ziyaret kayıtları. Parla rep_visits tablosundan ayrı. Multi-photo + custom_fields + state machine (in_progress→completed|cancelled).';

COMMENT ON COLUMN public.saha_visits.account_id IS
  'Müşteri ID. profiles.id (UUID stringi) veya dealer_clinic_canonical.id olabilir — app layer karar verir.';
COMMENT ON COLUMN public.saha_visits.distance_to_account_m IS
  'Check-in anında rep konumu ile account konumu arasındaki mesafe (metre). Telemetri için.';

CREATE INDEX IF NOT EXISTS idx_saha_visits_rep_checkin
  ON public.saha_visits(rep_id, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_saha_visits_account_checkin
  ON public.saha_visits(account_id, check_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_saha_visits_status
  ON public.saha_visits(status);
CREATE INDEX IF NOT EXISTS idx_saha_visits_route
  ON public.saha_visits(route_id);
CREATE INDEX IF NOT EXISTS idx_saha_visits_custom_fields_gin
  ON public.saha_visits USING GIN (custom_fields);

-- ----------------------------------------------------------------------------
-- 2. saha_visit_photos — ziyaret foto eklentileri (multi-photo)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_visit_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id      uuid NOT NULL REFERENCES public.saha_visits(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,
  category      text NOT NULL DEFAULT 'other'
                  CHECK (category IN ('storefront','shelf','price_tag','other')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_visit_photos IS
  'Bir ziyarete bağlı fotoğraflar. storage_path → storage.objects (bucket: visit-photos). category UI gruplaması için.';

CREATE INDEX IF NOT EXISTS idx_saha_visit_photos_visit
  ON public.saha_visit_photos(visit_id);

-- ----------------------------------------------------------------------------
-- 3. updated_at trigger
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'saha_visits_set_updated_at'
    ) THEN
      EXECUTE 'CREATE TRIGGER saha_visits_set_updated_at
        BEFORE UPDATE ON public.saha_visits
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. RLS — saha_visits + saha_visit_photos
--    REP: kendi kayıtlarını görür/yazar. ADMIN/MANAGER: hepsini görür.
--    Parla profiles.role enum UPPERCASE: 'REP', 'ADMIN', 'MANAGER', 'DOCTOR', ...
-- ----------------------------------------------------------------------------

-- saha_visits ------------------------------------------------------------
ALTER TABLE public.saha_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_visits_own_select" ON public.saha_visits;
CREATE POLICY "saha_visits_own_select" ON public.saha_visits
  FOR SELECT USING (
    rep_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_visits_own_insert" ON public.saha_visits;
CREATE POLICY "saha_visits_own_insert" ON public.saha_visits
  FOR INSERT WITH CHECK (
    rep_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('REP', 'ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_visits_own_update" ON public.saha_visits;
CREATE POLICY "saha_visits_own_update" ON public.saha_visits
  FOR UPDATE USING (
    rep_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
    )
  );

DROP POLICY IF EXISTS "saha_visits_admin_delete" ON public.saha_visits;
CREATE POLICY "saha_visits_admin_delete" ON public.saha_visits
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- saha_visit_photos ------------------------------------------------------
ALTER TABLE public.saha_visit_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_visit_photos_parent_select" ON public.saha_visit_photos;
CREATE POLICY "saha_visit_photos_parent_select" ON public.saha_visit_photos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id = saha_visit_photos.visit_id
        AND (
          v.rep_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
          )
        )
    )
  );

DROP POLICY IF EXISTS "saha_visit_photos_parent_insert" ON public.saha_visit_photos;
CREATE POLICY "saha_visit_photos_parent_insert" ON public.saha_visit_photos
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id = saha_visit_photos.visit_id
        AND (
          v.rep_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
          )
        )
    )
  );

DROP POLICY IF EXISTS "saha_visit_photos_parent_update" ON public.saha_visit_photos;
CREATE POLICY "saha_visit_photos_parent_update" ON public.saha_visit_photos
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id = saha_visit_photos.visit_id
        AND (
          v.rep_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
          )
        )
    )
  );

DROP POLICY IF EXISTS "saha_visit_photos_admin_delete" ON public.saha_visit_photos;
CREATE POLICY "saha_visit_photos_admin_delete" ON public.saha_visit_photos
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id = saha_visit_photos.visit_id
        AND (
          v.rep_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
          )
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Storage bucket — visit-photos (private)
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('visit-photos', 'visit-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS — rep kendi ziyaret klasörlerine yazar/okur, admin/manager hepsini görür.
-- Path konvansiyonu: {visit_id}/{uuid}.jpg
-- Bu policy seti `storage.objects` üzerinde çalışır. visit ownership kontrolü
-- saha_visits tablosuna join ile yapılır.

DROP POLICY IF EXISTS "visit_photos_owner_select" ON storage.objects;
CREATE POLICY "visit_photos_owner_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'visit-photos'
    AND EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id::text = split_part(storage.objects.name, '/', 1)
        AND (
          v.rep_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('ADMIN', 'MANAGER')
          )
        )
    )
  );

DROP POLICY IF EXISTS "visit_photos_owner_insert" ON storage.objects;
CREATE POLICY "visit_photos_owner_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'visit-photos'
    AND EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id::text = split_part(storage.objects.name, '/', 1)
        AND v.rep_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "visit_photos_owner_update" ON storage.objects;
CREATE POLICY "visit_photos_owner_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'visit-photos'
    AND EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id::text = split_part(storage.objects.name, '/', 1)
        AND v.rep_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "visit_photos_owner_delete" ON storage.objects;
CREATE POLICY "visit_photos_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'visit-photos'
    AND EXISTS (
      SELECT 1 FROM public.saha_visits v
      WHERE v.id::text = split_part(storage.objects.name, '/', 1)
        AND (
          v.rep_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
          )
        )
    )
  );

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name IN ('saha_visits','saha_visit_photos');
-- 2. SELECT tgname FROM pg_trigger WHERE tgname = 'saha_visits_set_updated_at';
-- 3. SELECT polname, tablename FROM pg_policies
--    WHERE tablename IN ('saha_visits','saha_visit_photos');
-- 4. SELECT id, name, public FROM storage.buckets WHERE id = 'visit-photos';
-- 5. SELECT polname FROM pg_policies
--    WHERE tablename = 'objects' AND polname LIKE 'visit_photos_%';
-- ============================================================================
