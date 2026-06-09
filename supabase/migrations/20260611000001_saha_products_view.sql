-- 20260611000001_saha_products_view.sql
-- v_saha_products — numune + saha satış (sipariş) için BİRLEŞİK ürün kataloğu.
--
-- Sorun: navigasyon yalnız public.products'a bakıyordu; canlı katalog 3 kaynağa
-- dağılmış (web sitesi useProducts.ts bunları merge eder):
--   1) public.products (jenerik/legacy) — *_price kolonları CANLIDA HEP NULL,
--      gerçek TL fiyat variant_combinations.price_try'de.
--   2) public.v_fanta_products  (fanta şema view'i) — top-level price_try var.
--   3) public.v_olident_products (olident şema view'i) — TL fiyat ilk variant json'da.
-- Rep'in numune verdiği Fanta/Olident ürünleri products'ta YOK → liste boş geliyordu.
-- Bu view 3 kaynağı tek listede toplar; tüm tüketicilere (SampleFormMobile +
-- SupabaseCRMAdapter.listProducts/getProduct/searchProducts/quoteOrder) tutarlı
-- kolonlar sunar. READ-ONLY. Paylaşılan DB (saha-db allowlist: v_saha_).
--
-- Doğrulanan canlı sayım (2026-06-08): generic 241 / fanta 35 / olident 11 = 287.
-- NOT: bu migration canlıdaki v_fanta_products / v_olident_products view'lerine ve
-- variant_combinations tablosuna referans verir; local baseline'da bunlar yoksa
-- yalnız canlıda çalışır. security_invoker=on → temel tabloların RLS'i uygulanır
-- (katalog zaten anon-okunur; web sitesi anon key ile aynı kaynaklardan okur).

create or replace view public.v_saha_products as
-- 1) Jenerik / legacy ürünler — fiyat & sku variant_combinations'tan (products.*_price null)
select
  p.id::text                                              as id,
  'generic'::text                                         as source,
  p.name::text                                            as name,
  p.brand::text                                           as brand,
  coalesce(p.sku, vc.sku)::text                           as sku,
  p.description                                           as description,
  p.category_id::text                                     as category_id,
  coalesce(p.base_price, vc.price_try, vc.price)          as base_price,
  coalesce(p.sale_price, vc.price_try, vc.price)          as sale_price,
  coalesce(p.currency, 'TRY')::text                       as currency,
  coalesce(p.tax_rate, 10)                                as tax_rate,  -- dental/medikal default %10
  coalesce(p.stock_quantity, vc.stock_quantity)           as stock_quantity,
  p.stock_status::text                                    as stock_status,
  p.is_active                                             as is_active,
  p.main_image::text                                      as main_image,
  (
    select json_agg(
      jsonb_build_object(
        'id', v.id::text,
        'sku', v.sku,
        'price_try', coalesce(v.price_try, v.price),
        'stock_quantity', v.stock_quantity,
        'attributes', coalesce(v.attributes, '{}'::jsonb)
          || jsonb_strip_nulls(jsonb_build_object(
               'iso', v.iso_code,
               'content', v.content_description,
               'file_count', v.file_count
             ))
      ) order by v.sku
    )
    from public.variant_combinations v
    where v.product_id = p.id and coalesce(v.is_active, true)
  )                                                       as product_variants
from public.products p
left join lateral (
  select v.sku, v.price_try, v.price, v.stock_quantity
  from public.variant_combinations v
  where v.product_id = p.id and coalesce(v.is_active, true)
  order by (case when coalesce(v.price_try, 0) > 0 then 0 else 1 end), v.price_try nulls last
  limit 1
) vc on true
where coalesce(p.is_active, false)

union all
-- 2) Fanta kataloğu — top-level price_try (fallback ilk variant)
select
  f.id::text,
  'fanta'::text,
  f.name,
  f.brand,
  (f.product_variants::jsonb -> 0 ->> 'sku'),
  f.description,
  f.category_id::text,
  coalesce(f.price_try, nullif((f.product_variants::jsonb -> 0 ->> 'price_try')::numeric, 0)),
  coalesce(f.price_try, nullif((f.product_variants::jsonb -> 0 ->> 'price_try')::numeric, 0)),
  'TRY'::text,
  10,
  f.stock_quantity,
  f.stock_status,
  f.is_active,
  f.main_image,
  f.product_variants
from public.v_fanta_products f
where coalesce(f.is_active, false)

union all
-- 3) Olident kataloğu — TL fiyat ilk variant json'dan (0 → null)
select
  o.id::text,
  'olident'::text,
  o.name,
  o.brand,
  (o.product_variants::jsonb -> 0 ->> 'sku'),
  o.description,
  o.category_id::text,
  nullif((o.product_variants::jsonb -> 0 ->> 'price_try')::numeric, 0),
  nullif((o.product_variants::jsonb -> 0 ->> 'price_try')::numeric, 0),
  'TRY'::text,
  10,
  o.stock_quantity,
  o.stock_status,
  o.is_active,
  o.main_image,
  o.product_variants
from public.v_olident_products o
where coalesce(o.is_active, false);

alter view public.v_saha_products set (security_invoker = on);

grant select on public.v_saha_products to anon, authenticated;
