-- Cluster B fix (recurring "2/5/10km hepsi aynı sayı"): radius was a no-op.
-- Root cause: ORDER BY distance ASC LIMIT 100 returned the nearest 100 regardless of radius;
-- in a dense area ≥100 clinics exist within the inner radius, so widening only added farther
-- clinics that the LIMIT discarded → identical count. ST_DWithin already bounds by radius.
-- Fix: raise the cap so radius is the real filter. NAV-only RPC (no website caller verified).
-- DB proof after fix: Ankara centroid 2km=39, 5km=583, 10km=1512.
-- Applied to prod (rranpzicmhgfupgabgbi) 2026-06-26.

create or replace function public.saha_search_nearby_clinics(
  _lat double precision,
  _lng double precision,
  _radius_m integer,
  _vertical_key text default 'dental',
  _limit integer default 2000
)
returns table(
  id uuid, google_place_id text, name text, lat double precision, lng double precision,
  address text, phone text, rating numeric, user_ratings_total integer, types text[],
  province_slug text, district_slug text, clinic_segment text,
  last_verified_at timestamp with time zone, distance_m double precision
)
language plpgsql
stable
as $function$
declare
  search_point geography;
begin
  search_point := ST_SetSRID(ST_MakePoint(_lng, _lat), 4326)::geography;

  return query
  select
    c.id, c.google_place_id, c.name, c.lat, c.lng, c.address, c.phone, c.rating,
    c.user_ratings_total, c.types, c.province_slug, c.district_slug, c.clinic_segment,
    c.last_verified_at,
    ST_Distance(c.location, search_point) as distance_m
  from public.saha_clinics c
  where c.status = 'active'
    and c.vertical_key = _vertical_key
    and ST_DWithin(c.location, search_point, _radius_m)
  order by distance_m asc
  limit coalesce(_limit, 2000000);  -- radius is the real bound; NULL = effectively unbounded
end;
$function$;
