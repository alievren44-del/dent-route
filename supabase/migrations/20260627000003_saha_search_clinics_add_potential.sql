-- Cluster I-A follow-up: expose clinic potential in the search RPC so /clinics
-- potential-sort is correct even in no-GPS text-search mode (results that arrive only
-- via this RPC otherwise had potential=null). Additive return column; existing callers
-- (DiscoveryPage global search, CalendarPage pickers, adapter) ignore the extra field.
-- Return-type change requires DROP+CREATE. Applied to prod (rranpzicmhgfupgabgbi) 2026-06-27.
drop function if exists public.saha_search_clinics(text, text, text[], int);

create function public.saha_search_clinics(
  _q text,
  _vertical_key text default 'dental',
  _statuses text[] default array['active']::text[],
  _limit int default 40
)
returns table(
  id uuid,
  name text,
  address text,
  phone text,
  lat double precision,
  lng double precision,
  province_slug text,
  district_slug text,
  status text,
  rating numeric,
  user_ratings_total int,
  potential smallint
)
language sql
stable
parallel safe
as $$
  with toks as (
    select array_remove(string_to_array(public.tr_norm(_q), ' '), '') as t
  )
  select
    c.id, c.name, c.address, c.phone, c.lat, c.lng,
    c.province_slug, c.district_slug, c.status, c.rating, c.user_ratings_total, c.potential
  from public.saha_clinics c, toks
  where c.vertical_key = _vertical_key
    and c.status = any(_statuses)
    and (
      cardinality(toks.t) = 0
      or (
        select bool_and(
          position(tok in public.tr_norm(c.name)) > 0
          or position(tok in public.tr_norm(coalesce(c.address, ''))) > 0
        )
        from unnest(toks.t) as tok
      )
    )
  order by
    (position(public.tr_norm(_q) in public.tr_norm(c.name)) = 1) desc,
    c.user_ratings_total desc nulls last,
    c.name asc
  limit greatest(_limit, 1);
$$;

comment on function public.saha_search_clinics(text, text, text[], int) is 'Cluster A: diacritic-insensitive token-AND clinic search (name+address) + potential (I-A).';

grant execute on function public.saha_search_clinics(text, text, text[], int) to anon, authenticated;
