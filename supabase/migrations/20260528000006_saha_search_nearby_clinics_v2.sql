-- saha_search_nearby_clinics v2 — last_verified_at + clinic_segment ekler
-- SahaTaraPage'in freshness rozeti + segment chip için.

CREATE OR REPLACE FUNCTION public.saha_search_nearby_clinics(
  _lat float8,
  _lng float8,
  _radius_m integer,
  _vertical_key text DEFAULT 'dental',
  _limit integer DEFAULT 100
)
RETURNS TABLE (
  id                  uuid,
  google_place_id     text,
  name                text,
  lat                 double precision,
  lng                 double precision,
  address             text,
  phone               text,
  rating              numeric,
  user_ratings_total  integer,
  types               text[],
  province_slug       text,
  district_slug       text,
  clinic_segment      text,
  last_verified_at    timestamptz,
  distance_m          double precision
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
    c.province_slug,
    c.district_slug,
    c.clinic_segment,
    c.last_verified_at,
    ST_Distance(c.location, search_point) AS distance_m
  FROM public.saha_clinics c
  WHERE
    c.status = 'active'
    AND c.vertical_key = _vertical_key
    AND ST_DWithin(c.location, search_point, _radius_m)
  ORDER BY distance_m ASC
  LIMIT _limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.saha_search_nearby_clinics(float8, float8, integer, text, integer)
  TO authenticated, service_role;
