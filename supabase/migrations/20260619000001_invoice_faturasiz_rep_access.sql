-- FAZ-1: Faturasız satış + plasiyer fatura erişim genişletme (debug_reports 2026-06-18/19)
-- Karar (2026-06-19): her plasiyer her cariye fatura kesebilir (orders ile tutarlı,
-- "erişim engelini kaldır" isteği). Faturasız satış = resmi FT-no üretilmez ama
-- cari hareketi/borç normal işlenir (bazı hekimler faturasız ürün istiyor).

-- ----------------------------------------------------------------------------
-- 1. faturasiz kolon
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_faturalar
  ADD COLUMN IF NOT EXISTS faturasiz boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.saha_faturalar.faturasiz IS
  'true ise resmi fatura no (FT-YYYY-NNNN) üretilmez; cari borç/hareket normal işlenir.';

-- ----------------------------------------------------------------------------
-- 2. set_fatura_no trigger — faturasız ise resmi no atlanır
--    (generate_fatura_no SECURITY DEFINER + advisory-lock korunur; sadece guard eklenir)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_fatura_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Faturasız satışta resmi no üretme; aksi halde taslak'tan çıkışta üret.
  IF NOT COALESCE(NEW.faturasiz, false)
     AND (NEW.fatura_no IS NULL OR NEW.fatura_no = '')
     AND NEW.durum <> 'taslak' THEN
    NEW.fatura_no := public.generate_fatura_no();
  END IF;
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. RLS — plasiyer artık her cariye fatura kesebilir/görebilir
--    (eski: yalnızca sales_rep_id = auth.uid() VEYA NULL cari)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS saha_faturalar_rep_insert ON public.saha_faturalar;
CREATE POLICY saha_faturalar_rep_insert ON public.saha_faturalar
  FOR INSERT TO authenticated
  WITH CHECK (public.saha_is_rep_or_admin());

DROP POLICY IF EXISTS saha_faturalar_rep_select ON public.saha_faturalar;
CREATE POLICY saha_faturalar_rep_select ON public.saha_faturalar
  FOR SELECT TO authenticated
  USING (public.saha_is_rep_or_admin());

DROP POLICY IF EXISTS saha_kalemleri_rep_insert ON public.saha_fatura_kalemleri;
CREATE POLICY saha_kalemleri_rep_insert ON public.saha_fatura_kalemleri
  FOR INSERT TO authenticated
  WITH CHECK (public.saha_is_rep_or_admin());

DROP POLICY IF EXISTS saha_kalemleri_rep_select ON public.saha_fatura_kalemleri;
CREATE POLICY saha_kalemleri_rep_select ON public.saha_fatura_kalemleri
  FOR SELECT TO authenticated
  USING (public.saha_is_rep_or_admin());
