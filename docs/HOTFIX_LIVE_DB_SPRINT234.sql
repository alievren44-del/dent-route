-- ============================================================================
-- CANLI DB HOTFIX — Sprint 2/4 (proje rranpzicmhgfupgabgbi)
-- Supabase Dashboard → SQL Editor → yapıştır → RUN. İdempotent.
-- Sıra: 1) stock_movements  2) order-to-cash  3) rep_targets
-- (Sprint 3 e-Fatura için DB değişikliği YOK — efatura_uuid/efatura_durum zaten var.)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) STOCK MOVEMENTS (append-only ledger; products.stock_quantity'ye DOKUNMAZ)
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id),
  quantity      integer NOT NULL,
  type          text NOT NULL,
  reference_id  uuid,
  note          text,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created
  ON public.stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON public.stock_movements(reference_id) WHERE reference_id IS NOT NULL;

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_staff_select" ON public.stock_movements;
CREATE POLICY "stock_movements_staff_select" ON public.stock_movements
  FOR SELECT
  USING (public.saha_is_rep_or_admin() OR public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "stock_movements_manager_insert" ON public.stock_movements;
CREATE POLICY "stock_movements_manager_insert" ON public.stock_movements
  FOR INSERT
  WITH CHECK (public.saha_is_manager_or_admin());

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) ORDER-TO-CASH (sipariş onaylanınca → cari + fatura + kalemler)
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;

ALTER TABLE public.saha_faturalar
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_saha_faturalar_order
  ON public.saha_faturalar(order_id) WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.post_order_to_cash(p_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order        record;
  v_cari_id      uuid;
  v_vade_gun     integer;
  v_fatura_id    uuid;
BEGIN
  SELECT id INTO v_fatura_id
    FROM public.saha_faturalar
   WHERE order_id = p_order_id
   LIMIT 1;
  IF v_fatura_id IS NOT NULL THEN
    RETURN v_fatura_id;
  END IF;

  SELECT id, user_id, sales_rep_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_order_to_cash: order % bulunamadı', p_order_id;
  END IF;

  SELECT id INTO v_cari_id
    FROM public.saha_cariler
   WHERE profile_id = v_order.user_id
   LIMIT 1;

  IF v_cari_id IS NULL THEN
    INSERT INTO public.saha_cariler (profile_id, fatura_unvani, il, durum, created_by)
    SELECT
      v_order.user_id,
      COALESCE(pr.klinik_adi, pr.ad_soyad, 'Müşteri'),
      pr.city,
      'aktif',
      v_order.sales_rep_id
      FROM public.profiles pr
     WHERE pr.id = v_order.user_id
    RETURNING id INTO v_cari_id;

    IF v_cari_id IS NULL THEN
      INSERT INTO public.saha_cariler (profile_id, fatura_unvani, durum, created_by)
      VALUES (v_order.user_id, 'Müşteri', 'aktif', v_order.sales_rep_id)
      RETURNING id INTO v_cari_id;
    END IF;
  END IF;

  SELECT COALESCE(odeme_vadesi_gun, 30) INTO v_vade_gun
    FROM public.saha_cariler
   WHERE id = v_cari_id;
  v_vade_gun := COALESCE(v_vade_gun, 30);

  INSERT INTO public.saha_faturalar
    (cari_id, tip, tarih, vade_tarihi, durum, order_id, created_by)
  VALUES
    (v_cari_id, 'satis', now()::date,
     (now()::date + (v_vade_gun || ' days')::interval)::date,
     'gonderildi', p_order_id, v_order.sales_rep_id)
  RETURNING id INTO v_fatura_id;

  INSERT INTO public.saha_fatura_kalemleri
    (fatura_id, sira, urun_id, urun_adi, birim, miktar, birim_fiyat, kdv_orani)
  SELECT
    v_fatura_id,
    ROW_NUMBER() OVER (ORDER BY oi.id),
    oi.product_id,
    COALESCE(p.name, 'Ürün'),
    'adet',
    oi.quantity,
    oi.unit_price,
    COALESCE(p.tax_rate / 100.0, 0.20)
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
   WHERE oi.order_id = p_order_id;

  UPDATE public.orders SET invoice_status = 'invoiced' WHERE id = p_order_id;

  RETURN v_fatura_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'stock_movements'
    ) THEN
      EXECUTE
        'INSERT INTO public.stock_movements (product_id, quantity, type, reference_id, created_at)
           SELECT product_id, -quantity, ''sale'', $1, now()
             FROM public.order_items
            WHERE order_id = $1'
        USING NEW.id;
    END IF;

    PERFORM public.post_order_to_cash(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_change ON public.orders;
CREATE TRIGGER trg_order_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) REP TARGETS (plasiyer hedefleri — KPI panosu)
-- ─────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE TABLE IF NOT EXISTS public.saha_rep_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year_month text NOT NULL,
  visit_target integer DEFAULT 0,
  order_target_tl numeric(15,2) DEFAULT 0,
  collection_target_tl numeric(15,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rep_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_saha_rep_targets_rep ON public.saha_rep_targets(rep_id);
CREATE INDEX IF NOT EXISTS idx_saha_rep_targets_month ON public.saha_rep_targets(year_month);

ALTER TABLE public.saha_rep_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_rep_targets_own_select" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_own_select" ON public.saha_rep_targets
  FOR SELECT USING (auth.uid() = rep_id OR public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_rep_targets_manager_insert" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_manager_insert" ON public.saha_rep_targets
  FOR INSERT WITH CHECK (public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_rep_targets_manager_update" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_manager_update" ON public.saha_rep_targets
  FOR UPDATE USING (public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_rep_targets_admin_delete" ON public.saha_rep_targets;
CREATE POLICY "saha_rep_targets_admin_delete" ON public.saha_rep_targets
  FOR DELETE USING (public.saha_is_admin());

COMMIT;
