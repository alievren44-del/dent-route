-- ============================================================================
-- saha_clinics_near_polyline RPC
-- ============================================================================
-- A→B rotasının polilinine yakın klinikleri (buffer içinde) listeler.
-- ST_Buffer + ST_Intersects geography. GIST index hit.
--
-- Polyline frontend'den GeoJSON LineString olarak gelir (decoded coordinates).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.saha_clinics_near_polyline(
  _line_geojson text,
  _buffer_m int DEFAULT 2000,
  _vertical_key text DEFAULT 'dental',
  _limit int DEFAULT 50
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
  clinic_segment text,
  province_slug text,
  district_slug text
)
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
DECLARE
  line_geom geometry;
  buffer_geog geography;
BEGIN
  line_geom := ST_GeomFromGeoJSON(_line_geojson);
  buffer_geog := ST_Buffer(line_geom::geography, _buffer_m);

  RETURN QUERY
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
    c.clinic_segment,
    c.province_slug,
    c.district_slug
  FROM public.saha_clinics c
  WHERE c.status = 'active'
    AND c.vertical_key = _vertical_key
    AND ST_Intersects(c.location, buffer_geog)
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.saha_clinics_near_polyline(text, int, text, int)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.saha_clinics_near_polyline IS
  'A→B rotasının polilinine yakın klinikleri buffer içinde döndürür. CorridorRoutePage için.';
