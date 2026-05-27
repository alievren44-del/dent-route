-- ============================================================================
-- Saha Navigasyon — Mahalle (neighborhood) cache tablosu
-- ----------------------------------------------------------------------------
-- enum-neighborhoods Edge Function tarafından doldurulur. Bir district için
-- ilk istek OSM Overpass (gerekiyorsa Mapbox fallback) ile dış kaynaktan
-- mahalleleri çeker; sonraki istekler cache'ten servis edilir.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.saha_neighborhoods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  province_slug text NOT NULL,
  district_slug text NOT NULL,
  name text NOT NULL,
  lat double precision,
  lng double precision,
  source text NOT NULL DEFAULT 'osm' CHECK (source IN ('osm','mapbox','manual')),
  fetched_at timestamptz NOT NULL DEFAULT now()
);

-- Aynı ilçe içinde aynı isimli mahalle (case-insensitive) tek sefer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_neighborhoods_unique
  ON public.saha_neighborhoods (province_slug, district_slug, lower(name));

-- İlçeye göre liste sorgusu için.
CREATE INDEX IF NOT EXISTS idx_neighborhoods_district
  ON public.saha_neighborhoods (province_slug, district_slug);

ALTER TABLE public.saha_neighborhoods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS neighborhoods_authenticated_all ON public.saha_neighborhoods;
CREATE POLICY neighborhoods_authenticated_all ON public.saha_neighborhoods
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

COMMIT;
