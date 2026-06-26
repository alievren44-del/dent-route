-- Cluster A fix (recurring "clinic bulunamadı"): Turkish/accent-folded clinic search.
-- Root cause: DB search used ILIKE '%term%' → Turkish dotted-İ broken, accent-sensitive,
-- contiguous-substring only. Client foldTr() ran too late (only on already-fetched rows).
-- No unaccent/pg_trgm extension needed; translate-based IMMUTABLE folder. ~5586 rows → seq scan cheap.
-- Applied to prod (rranpzicmhgfupgabgbi) 2026-06-26. NAV-only saha_clinics (no website caller).

create or replace function public.tr_norm(t text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(
    translate(
      coalesce(t, ''),
      'İIıŞşÇçĞğÜüÖöÂâÄäÀàÁáÊêËëÈèÉéÎîÏïÌìÍíÔôÒòÓóÛûÙùÚúÑñ',
      'iiissccgguuooaaaaaaaaeeeeeeeeiiiiiiiioooooouuuuuunn'
    )
  );
$$;

comment on function public.tr_norm(text) is 'Turkish + Latin accent folding to ASCII lowercase for diacritic/İ-insensitive search.';

-- Token-AND search: every whitespace token must appear (substring) in folded name OR address.
create or replace function public.saha_search_clinics(
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
  user_ratings_total int
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
    c.province_slug, c.district_slug, c.status, c.rating, c.user_ratings_total
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

comment on function public.saha_search_clinics(text, text, text[], int) is 'Cluster A: diacritic-insensitive, token-AND clinic search over saha_clinics (name+address).';

grant execute on function public.tr_norm(text) to anon, authenticated;
grant execute on function public.saha_search_clinics(text, text, text[], int) to anon, authenticated;
