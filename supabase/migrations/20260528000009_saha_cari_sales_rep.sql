-- ============================================================================
-- saha_cariler.sales_rep_id — Cariye atanmış plasiyer (saha rep) referansı
-- ============================================================================
-- Admin yeni cari oluştururken bir plasiyer atayabilir. Plasiyer kendi
-- atanmış carileri için ziyaret/sipariş/tahsilat yapar; admin tüm carileri
-- görür. profile_id zaten "müşteri (klinik) profili" için kullanılıyor —
-- ayrı kolon gerek.
-- ============================================================================

ALTER TABLE public.saha_cariler
  ADD COLUMN IF NOT EXISTS sales_rep_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_saha_cariler_sales_rep
  ON public.saha_cariler(sales_rep_id) WHERE sales_rep_id IS NOT NULL;

COMMENT ON COLUMN public.saha_cariler.sales_rep_id IS
  'Cariye atanmış saha plasiyeri (profiles.id). NULL = atanmamış (admin görür).';
