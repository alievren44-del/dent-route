-- ============================================================================
-- saha_clinics_by_district RPC
-- ============================================================================
-- Belirli il+ilçe içindeki aktif klinikleri listeler. Auto-route sayfası için.
-- idx_saha_clinics_province (province_slug, district_slug) index hit.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.saha_clinics_by_district(
  _province_slug text,
  _district_slug text,
  _vertical_key text DEFAULT 'dental',
  _limit int DEFAULT 200
)
RETURNS TABLE (
  id uuid,
  google_place_id text,
  name text,
  lat float8,
  lng float8,
  address text,
  phone text,
  rating numeric,
  user_ratings_total int,
  types text[],
  clinic_segment text
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    c.id,
    c.google_place_id,
    c.name,
    c.lat,
    c.lng,
    c.address,
    c.phone,
    c.rating,
    c.user_ratings_total,
    c.types,
    c.clinic_segment
  FROM public.saha_clinics c
  WHERE c.status = 'active'
    AND c.vertical_key = _vertical_key
    AND c.province_slug = _province_slug
    AND c.district_slug = _district_slug
  ORDER BY c.clinic_segment, c.name
  LIMIT _limit;
$$;

GRANT EXECUTE ON FUNCTION public.saha_clinics_by_district(text, text, text, int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.saha_clinics_by_district IS
  'İlçe içindeki tüm aktif klinikleri listeler. DistrictAutoRoutePage için.';
