-- Bug #23 (nav discovery): saha_search_clinics token-AND çok katıydı — çok-kelimeli
-- aramada tek token bile eşleşmezse sonuç boş dönüyordu. Skorlamalı gevşetme:
--   * tüm-token eşleşenler (eski AND davranışı) HER ZAMAN en üstte → geriye-uyumlu
--   * kısmi eşleşenler (>=1 token) altta, eşleşen-token sayısına göre sıralı
-- Dönüş kolonları ve imza birebir aynı (CustomerListPage + DiscoveryPage çağrıları etkilenmez).
-- Canlıya 2026-07-08 MCP apply_migration ile uygulandı (saha_search_clinics_partial_match).
CREATE OR REPLACE FUNCTION public.saha_search_clinics(_q text, _vertical_key text DEFAULT 'dental'::text, _statuses text[] DEFAULT ARRAY['active'::text], _limit integer DEFAULT 40)
 RETURNS TABLE(id uuid, name text, address text, phone text, lat double precision, lng double precision, province_slug text, district_slug text, status text, rating numeric, user_ratings_total integer, potential smallint)
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  with toks as (
    select array_remove(string_to_array(public.tr_norm(_q), ' '), '') as t
  ),
  scored as (
    select
      c.id, c.name, c.address, c.phone, c.lat, c.lng,
      c.province_slug, c.district_slug, c.status, c.rating, c.user_ratings_total, c.potential,
      cardinality(toks.t) as tok_cnt,
      (
        select count(*)
        from unnest(toks.t) as tok
        where position(tok in public.tr_norm(c.name)) > 0
           or position(tok in public.tr_norm(coalesce(c.address, ''))) > 0
      ) as match_cnt
    from public.saha_clinics c, toks
    where c.vertical_key = _vertical_key
      and c.status = any(_statuses)
  )
  select
    s.id, s.name, s.address, s.phone, s.lat, s.lng,
    s.province_slug, s.district_slug, s.status, s.rating, s.user_ratings_total, s.potential
  from scored s
  where s.tok_cnt = 0 or s.match_cnt >= 1
  order by
    (s.match_cnt = s.tok_cnt) desc,
    s.match_cnt desc,
    (position(public.tr_norm(_q) in public.tr_norm(s.name)) = 1) desc,
    s.user_ratings_total desc nulls last,
    s.name asc
  limit greatest(_limit, 1);
$function$;
