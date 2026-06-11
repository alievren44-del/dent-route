-- ============================================================================
-- 20260610000001_saha_order_to_cash.sql
-- ----------------------------------------------------------------------------
-- ORDER-TO-CASH posting chain.
--
-- Sipariş onaylandığında (orders.status = 'approved') otomatik olarak:
--   1. İlgili müşteri için bir cari (saha_cariler) bulunur ya da yaratılır.
--   2. Bir satış faturası (saha_faturalar, tip='satis') düşülür.
--   3. order_items → saha_fatura_kalemleri kopyalanır (KDV per-line).
--   4. orders.invoice_status = 'invoiced' yapılır.
--
-- Idempotent: aynı sipariş iki kez faturalandırılamaz (uq_saha_faturalar_order).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_faturalar.order_id — bir sipariş ↔ bir fatura bağı (double-post koruması)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_faturalar
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_saha_faturalar_order
  ON public.saha_faturalar(order_id) WHERE order_id IS NOT NULL;

COMMENT ON COLUMN public.saha_faturalar.order_id IS
  'Bu faturayı doğuran sipariş (orders.id). Tek sipariş → tek fatura (unique).';

-- ----------------------------------------------------------------------------
-- 2. post_order_to_cash — siparişi cari/fatura akışına basan fonksiyon
-- ----------------------------------------------------------------------------
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
  -- (a) Idempotent — bu sipariş zaten faturalandıysa mevcut faturayı dön.
  SELECT id INTO v_fatura_id
    FROM public.saha_faturalar
   WHERE order_id = p_order_id
   LIMIT 1;
  IF v_fatura_id IS NOT NULL THEN
    RETURN v_fatura_id;
  END IF;

  -- (b) Siparişi yükle.
  SELECT id, user_id, sales_rep_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_order_to_cash: order % bulunamadı', p_order_id;
  END IF;

  -- (c) Cari çöz; yoksa profil bilgisinden otomatik yarat.
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

    -- Profil satırı yoksa yine de minimal cari aç.
    IF v_cari_id IS NULL THEN
      INSERT INTO public.saha_cariler (profile_id, fatura_unvani, durum, created_by)
      VALUES (v_order.user_id, 'Müşteri', 'aktif', v_order.sales_rep_id)
      RETURNING id INTO v_cari_id;
    END IF;
  END IF;

  -- (d) Cari vadesini al (varsayılan 30).
  SELECT COALESCE(odeme_vadesi_gun, 30) INTO v_vade_gun
    FROM public.saha_cariler
   WHERE id = v_cari_id;
  v_vade_gun := COALESCE(v_vade_gun, 30);

  -- (e) Satış faturası başlığı.
  INSERT INTO public.saha_faturalar
    (cari_id, tip, tarih, vade_tarihi, durum, order_id, created_by)
  VALUES
    (v_cari_id,
     'satis',
     now()::date,
     (now()::date + (v_vade_gun || ' days')::interval)::date,
     'gonderildi',
     p_order_id,
     v_order.sales_rep_id)
  RETURNING id INTO v_fatura_id;

  -- (f) Sipariş kalemleri → fatura kalemleri (KDV per-line, products.tax_rate %).
  --     order_items'ta product_name kolonu yok → ürün adını products.name'den al.
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

  -- (g) Sipariş faturalandı işaretle.
  UPDATE public.orders
     SET invoice_status = 'invoiced'
   WHERE id = p_order_id;

  -- update_fatura_toplam trigger'ı kalemlerden fatura toplamlarını hesaplar.
  RETURN v_fatura_id;
END;
$$;

COMMENT ON FUNCTION public.post_order_to_cash(uuid) IS
  'Onaylanan siparişi cari + satış faturası + fatura kalemlerine basar. Idempotent (order_id unique).';

-- ----------------------------------------------------------------------------
-- 3. Onay hook'unu genişlet — mevcut stock_movements mantığı KORUNUR,
--    sadece post_order_to_cash çağrısı EKLENİR.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    -- (existing) Stok hareketi — stock_movements tablosu varsa.
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

    -- (new) Order-to-cash: cari + fatura + kalemler. Idempotent.
    PERFORM public.post_order_to_cash(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_order_status_change IS
  'orders.status = approved olduğunda stock_movements kaydı düşer (tablo varsa) ve post_order_to_cash ile cari/fatura akışını başlatır.';

DROP TRIGGER IF EXISTS trg_order_status_change ON public.orders;
CREATE TRIGGER trg_order_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();

COMMIT;
