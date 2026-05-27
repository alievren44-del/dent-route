-- ============================================================================
-- saha_clinics_count_by_province RPC
-- ============================================================================
-- Belirli il slug listesindeki aktif klinik sayısını tek round-trip'te döndürür.
-- "Yakınımdaki İller" sayfası için: GPS centroid → 50km'deki provinces.json
-- iller filtrelenir → bu RPC ile her birinin klinik sayısı alınır.
--
-- Performans: GROUP BY province_slug + idx_saha_clinics_province index hit.
-- Tipik <10ms.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.saha_clinics_count_by_province(
  _slugs text[],
  _vertical_key text DEFAULT 'dental'
)
RETURNS TABLE (
  province_slug text,
  count bigint
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    c.province_slug,
    COUNT(*)::bigint AS count
  FROM public.saha_clinics c
  WHERE c.status = 'active'
    AND c.vertical_key = _vertical_key
    AND c.province_slug = ANY(_slugs)
  GROUP BY c.province_slug;
$$;

GRANT EXECUTE ON FUNCTION public.saha_clinics_count_by_province(text[], text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.saha_clinics_count_by_province IS
  'Belirli il slug listesindeki aktif klinik sayısını döndürür. NearbyProvincesPage için.';
