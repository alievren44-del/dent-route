-- ============================================================================
-- Saha Navigasyon — Clinics Persistent Database Migration
-- ============================================================================
-- Tarih      : 2026-05-29
-- Sprint     : Sprint 2 — Map & Discovery
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   1. saha_clinics tablosu — Google Places taramasından toplanan kalıcı
--      klinik veritabanı. clinic-scan Edge Function bu tabloya UPSERT yapar
--      (google_place_id conflict).
--   2. saha_search_nearby_clinics RPC — Discovery sayfası bu tablodan
--      ST_DWithin ile çeker (live Google çağrısı yok, <50ms).
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS, trigger guard. Idempotent — birden fazla `db push`
-- güvenli.
--
-- BAĞIMLILIKLAR:
--   - PostGIS extension (20260525000001_saha_extension.sql tarafından kuruldu)
--   - public.set_updated_at() fonksiyonu (varsa trigger bağlanır, yoksa
--     migration düşmez — guard ile)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_clinics — kalıcı klinik veritabanı
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_clinics (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_place_id       text UNIQUE NOT NULL,
  name                  text NOT NULL,
  lat                   double precision NOT NULL,
  lng                   double precision NOT NULL,
  location              geography(Point, 4326) GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
  ) STORED,
  address               text,
  phone                 text,
  website               text,
  rating                numeric(2,1),
  user_ratings_total    integer,
  types                 text[] NOT NULL DEFAULT ARRAY[]::text[],
  vertical_key          text NOT NULL DEFAULT 'dental',
  province_slug         text,
  district_slug         text,
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'closed', 'duplicate', 'flagged')),
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  last_verified_at      timestamptz,
  raw_payload           jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_clinics IS
  'Google Places taramasından toplanan kalıcı klinik veritabanı. clinic-scan Edge Function bu tabloya UPSERT yapar (google_place_id conflict). Discovery sayfası bu tablodan ST_DWithin ile çeker (live Google çağrısı yok).';

-- ----------------------------------------------------------------------------
-- 2. Indexler
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saha_clinics_location ON public.saha_clinics USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_saha_clinics_province ON public.saha_clinics (province_slug, district_slug);
CREATE INDEX IF NOT EXISTS idx_saha_clinics_vertical ON public.saha_clinics (vertical_key);
CREATE INDEX IF NOT EXISTS idx_saha_clinics_status ON public.saha_clinics (status) WHERE status <> 'active';
CREATE INDEX IF NOT EXISTS idx_saha_clinics_types ON public.saha_clinics USING GIN (types);
CREATE INDEX IF NOT EXISTS idx_saha_clinics_last_verified ON public.saha_clinics (last_verified_at);

-- ----------------------------------------------------------------------------
-- 3. updated_at trigger (defensive — set_updated_at varsa bağla)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'saha_clinics_set_updated_at'
  ) THEN
    EXECUTE 'CREATE TRIGGER saha_clinics_set_updated_at
      BEFORE UPDATE ON public.saha_clinics
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. RLS — tüm authenticated okur, sadece service_role yazar (Edge Function)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_clinics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_clinics_auth_select" ON public.saha_clinics;
CREATE POLICY "saha_clinics_auth_select" ON public.saha_clinics
  FOR SELECT TO authenticated USING (status = 'active');

-- INSERT/UPDATE/DELETE policy yok = sadece service_role bypass eder.

-- ----------------------------------------------------------------------------
-- 5. saha_search_nearby_clinics — Discovery RPC
-- ----------------------------------------------------------------------------
-- NOT: saha_search_nearby_clinics burada TANIMLANMAZ. Bu dosyadaki eski 13-kolon
-- sürümü, hemen ÖNCE uygulanan 20260528000006_saha_search_nearby_clinics_v2.sql'in
-- 15-kolon sürümünü (clinic_segment + last_verified_at) `CREATE OR REPLACE` ile
-- DOWNGRADE etmeye çalışıyordu → psql "cannot change return type of existing function"
-- → deploy-migrations job FAIL (her push'ta "run failed" mail). Doğru/canlı sürüm v2'de.

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT count(*) FROM saha_clinics;
-- 2. SELECT proname FROM pg_proc WHERE proname = 'saha_search_nearby_clinics';
-- 3. SELECT * FROM saha_search_nearby_clinics(41.0082, 28.9784, 5000);
-- ============================================================================
