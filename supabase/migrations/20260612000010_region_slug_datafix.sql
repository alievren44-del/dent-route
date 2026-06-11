-- ============================================================================
-- DRAFT — region_slug_datafix
-- ============================================================================
-- Tarih        : 2026-06-12
-- Hedef DB     : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Durum        : DRAFT — MCP apply_migration YOK. Opus inceleyip uygulayacak.
--
-- ROLLBACK NOTU:
--   Bu migration sadece data UPDATE'dir, DDL değişiklik yoktur.
--   Geri almak için: values geri yüklenebilir — ancak önceki mixed-case
--   değerler artık slug formatına döndürüldüğünden tam geri dönüş için
--   bu migration öncesi yedek gereklidir. Güvenli geri alma:
--     1. pg_dump / Supabase point-in-time restore ile önceki state'e dön.
--     2. Ya da dönüştürme etkileri kabul edilebilir (slug→slug zaten idempotent).
--
-- ============================================================================
-- DOĞRULANACAK VARSAYIMLAR (apply öncesi Opus kontrol etmeli):
-- 1. saha_assignments tablosu public şemasında mevcut.
-- 2. region_provinces (text[]) ve region_districts (text[]) kolonları mevcut
--    (20260528000002_saha_assignments_regions.sql tarafından eklendi).
-- 3. '__region_meta__' sentinel değeri account_id kolonunda tutulur.
--    region_provinces/region_districts ayrı veri kolonları olup sentinel ROW'u
--    silinmeden kendi data'sı normalize edilir (aşağıya bakın).
-- 4. PostgreSQL'de unaccent extension kullanmak yerine translate() ile Türkçe
--    karakter çevirimi yapılmaktadır — unaccent TR için eksik harfleri kapsayamaz.
-- 5. Mevcut veri boyutu küçük (< 1000 satır bekleniyor) — full table scan OK.
-- ============================================================================
--
-- TS slugify ile SQL TRANSLATE eşleme kuralları (ZORUNLU UYUM):
-- TS geo-helpers.ts TR_MAP:
--   ç → c,  Ç → C,  ğ → g,  Ğ → G,  ı → i,  İ → I,
--   ö → o,  Ö → O,  ş → s,  Ş → S,  ü → u,  Ü → U
-- SQL LOWER() sonrası büyük-harf mapping (Ç→C, Ğ→G, İ→I, Ö→O, Ş→S, Ü→U)
-- lower(translate(...)) → ç→c, ğ→g, ı→i, i→i, ö→o, ş→s, ü→u (tümü küçük)
-- regexp_replace sonrası pipe '|' karakteri korunur (compound district key).
--
-- '__region_meta__' SENTINEL MUAMELE:
--   Bu satır region verisi TAŞIYAN bir saha_assignments row'udur.
--   account_id='__region_meta__' olan satırların region_provinces/region_districts
--   kolonları gerçek il/ilçe data'sı içerir (RegionAssignmentPage upsert eder).
--   Bu nedenle sentinel satırlar da dahil edilmeli — account_id'e göre
--   filtreleme YAPILMAZ, tüm satırlardaki array değerleri normalize edilir.
--   Sentinel row olması account_id değerini değiştirmez (normalize edilmez).
--
-- ============================================================================
-- IDEMPOTENCY:
--   normalizeSlugArr fonksiyonu zaten-slug değerleri değiştirmez.
--   İki kez çalışsa da sonuç aynı.
-- ============================================================================

BEGIN;

-- Helper: tek bir text değeri slug-normalize et (TS slugify ile aynı kural).
-- Compound district key formatı: '<il>|<ilçe>' — pipe korunur.
-- Örnek: 'Çankaya' → 'cankaya', 'Ankara|Çankaya' → 'ankara|cankaya'
CREATE OR REPLACE FUNCTION pg_temp.slug_normalize_tr(val text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT
    regexp_replace(
      lower(
        translate(
          val,
          'çÇğĞıİöÖşŞüÜ',
          'cCgGiIoOsSuU'
        )
      ),
      '[^a-z0-9|]+',   -- pipe '|' compound key separator korunur
      '-',
      'g'
    )
    -- baştaki ve sondaki tire temizle (her segment için)
    -- NOT: compound key'de pipe etrafındaki tireler de temizlenir
$$;

-- Helper: text[] dizisindeki her elemanı normalize et
CREATE OR REPLACE FUNCTION pg_temp.normalizeSlugArr(arr text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE STRICT
AS $$
  SELECT ARRAY(
    SELECT
      regexp_replace(
        regexp_replace(
          pg_temp.slug_normalize_tr(elem),
          '^-+', '', 'g'   -- baştaki tire
        ),
        '-+$', '', 'g'     -- sondaki tire
      )
    FROM unnest(arr) AS elem
  )
$$;

-- DATA FIX: saha_assignments region_provinces / region_districts normalize
-- Sadece normalize sonrası farklı olan satırları güncelle (idempotent).
UPDATE public.saha_assignments
SET
  region_provinces = pg_temp.normalizeSlugArr(region_provinces),
  region_districts = pg_temp.normalizeSlugArr(region_districts)
WHERE
  -- En az bir normalize-gerekli değer varsa güncelle
  -- (array_to_string karşılaştırması yeterli — slug sonucu farklı mı?)
  (
    array_to_string(region_provinces, ',') !=
    array_to_string(pg_temp.normalizeSlugArr(region_provinces), ',')
  )
  OR
  (
    array_to_string(region_districts, ',') !=
    array_to_string(pg_temp.normalizeSlugArr(region_districts), ',')
  );

-- Doğrulama sorgusu (apply sonrası manuel çalıştır):
-- SELECT id, account_id, region_provinces, region_districts
-- FROM public.saha_assignments
-- WHERE region_provinces != '{}'::text[] OR region_districts != '{}'::text[]
-- ORDER BY account_id;

COMMIT;
