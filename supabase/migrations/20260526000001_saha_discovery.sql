-- ============================================================================
-- Saha Navigasyon — Discovery & API Usage Migration
-- ============================================================================
-- Tarih      : 2026-05-26
-- Sprint     : Sprint 2 — Map & Discovery
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   1. saha_api_usage tablosu — Edge Function (google-places-search,
--      mapbox-optimize) rate-limit + maliyet izleme.
--   2. saha_search_nearby_accounts RPC — Map ekranı için yakın klinik araması
--      (Parla accounts / account_addresses üzerinden PostGIS ST_DWithin).
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS. Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - PostGIS extension (20260525000001_saha_extension.sql tarafından kuruldu)
--   - auth.users (Supabase Auth)
--   - public.accounts / account_addresses / account_contacts (Parla CRM —
--     mevcut değilse RPC create edilir ama çağrı 42P01 verir; tablo yokken
--     migration düşmesin diye RPC SECURITY INVOKER + tablo varlığı runtime'da).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_api_usage — Edge Function rate limit / cost log
-- ----------------------------------------------------------------------------
-- Per-user-per-day API usage tracking (rate limit + cost monitoring)
CREATE TABLE IF NOT EXISTS public.saha_api_usage (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  used_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_meta JSONB
);

CREATE INDEX IF NOT EXISTS idx_saha_api_usage_user_endpoint_day
  ON public.saha_api_usage (user_id, endpoint, used_at DESC);

ALTER TABLE public.saha_api_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_api_usage_self_read" ON public.saha_api_usage;
CREATE POLICY "saha_api_usage_self_read" ON public.saha_api_usage
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT only via service-role (Edge Function); deny direct user inserts
DROP POLICY IF EXISTS "saha_api_usage_no_user_insert" ON public.saha_api_usage;
-- (no policy = no access for authenticated; service_role bypasses RLS)

COMMENT ON TABLE public.saha_api_usage IS
  'API usage log for rate limiting Edge Functions (google-places-search, mapbox-optimize). Service-role inserts only.';

-- ----------------------------------------------------------------------------
-- 2. saha_search_nearby_accounts — Discovery RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saha_search_nearby_accounts(
  _lat float8,
  _lng float8,
  _radius_m integer,
  _customer_type text DEFAULT NULL,
  _limit integer DEFAULT 50
)
RETURNS TABLE (
  id           uuid,
  name         text,
  type         text,
  phone        text,
  whatsapp     text,
  email        text,
  status       text,
  region       text,
  addresses    jsonb,
  contacts     jsonb,
  custom_fields jsonb,
  created_at   timestamptz,
  updated_at   timestamptz,
  distance_m   double precision
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
AS $$
DECLARE
  search_point geography;
BEGIN
  search_point := ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography;

  RETURN QUERY
  SELECT
    a.id,
    a.name,
    a.type,
    a.phone,
    a.whatsapp,
    a.email,
    a.status,
    a.region,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'addressLine', addr.address_line,
          'district',    addr.district,
          'city',        addr.city,
          'location',    jsonb_build_object(
            'lat', ST_Y(addr.location::geometry),
            'lng', ST_X(addr.location::geometry)
          ),
          'isPrimary',   addr.is_primary
        )
      )
      FROM public.account_addresses addr
      WHERE addr.account_id = a.id),
      '[]'::jsonb
    ) AS addresses,
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'fullName', c.full_name,
          'title',    c.title,
          'phone',    c.phone,
          'whatsapp', c.whatsapp,
          'email',    c.email,
          'isPrimary', c.is_primary
        )
      )
      FROM public.account_contacts c
      WHERE c.account_id = a.id),
      NULL
    ) AS contacts,
    a.custom_fields,
    a.created_at,
    a.updated_at,
    ST_Distance(addr_primary.location, search_point) AS distance_m
  FROM public.accounts a
  JOIN LATERAL (
    SELECT location
    FROM public.account_addresses
    WHERE account_id = a.id
    ORDER BY is_primary DESC NULLS LAST
    LIMIT 1
  ) addr_primary ON TRUE
  WHERE
    addr_primary.location IS NOT NULL
    AND ST_DWithin(addr_primary.location, search_point, _radius_m)
    AND (_customer_type IS NULL OR a.type = _customer_type)
    AND COALESCE(a.status, 'active') <> 'deleted'
  ORDER BY distance_m ASC
  LIMIT _limit;
END;
$$;

COMMENT ON FUNCTION public.saha_search_nearby_accounts IS
  'Discovery: returns nearby accounts within _radius_m meters of (_lat,_lng). Uses primary address location. SECURITY INVOKER → RLS on accounts/account_addresses applies.';

GRANT EXECUTE ON FUNCTION public.saha_search_nearby_accounts(float8, float8, integer, text, integer) TO authenticated;

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT * FROM saha_api_usage LIMIT 1;
-- 2. SELECT proname FROM pg_proc WHERE proname = 'saha_search_nearby_accounts';
-- 3. SELECT * FROM saha_search_nearby_accounts(41.0082, 28.9784, 5000);
-- ============================================================================
