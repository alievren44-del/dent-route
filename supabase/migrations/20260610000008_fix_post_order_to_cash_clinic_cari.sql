-- ============================================================================
-- Fix: post_order_to_cash klinik siparişinde orders.cari_id'yi kullanmalı.
-- ----------------------------------------------------------------------------
-- Bug: Fonksiyon cari'yi yalnızca `profile_id = orders.user_id` ile çözüyordu.
-- Klinik siparişlerinde (saha_get_or_create_cari_for_clinic akışı) orders.user_id
-- NULL, orders.cari_id ise dolu. Sonuç: eşleşme bulunamayıp profile_id=NULL'lu
-- sahte "Müşteri" carisi açılıyor ve fatura yanlış cariye kesiliyordu; gerçek
-- klinik carisi faturasız/bakiyesiz kalıyordu.
--
-- Fix: önce orders.cari_id'yi kullan; yalnızca NULL ise (eski profil-bazlı
-- siparişler) user_id'den çöz/yarat.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_order_to_cash(p_order_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_order        record;
  v_cari_id      uuid;
  v_vade_gun     integer;
  v_fatura_id    uuid;
BEGIN
  -- (a) Idempotent: bu sipariş için fatura zaten varsa onu döndür.
  SELECT id INTO v_fatura_id
    FROM public.saha_faturalar
   WHERE order_id = p_order_id
   LIMIT 1;
  IF v_fatura_id IS NOT NULL THEN
    RETURN v_fatura_id;
  END IF;

  -- (b) Siparişi yükle (cari_id dahil).
  SELECT id, user_id, cari_id, sales_rep_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_order_to_cash: order % bulunamadı', p_order_id;
  END IF;

  -- (c) Cari çöz.
  -- Klinik siparişinde orders.cari_id zaten bağlıdır; onu doğrudan kullan.
  -- Sadece eski profil-bazlı siparişlerde (cari_id NULL, user_id dolu) profilden çöz/yarat.
  v_cari_id := v_order.cari_id;

  IF v_cari_id IS NULL THEN
    SELECT id INTO v_cari_id
      FROM public.saha_cariler
     WHERE profile_id = v_order.user_id
     LIMIT 1;
  END IF;

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

  -- (e) Fatura başlığı.
  INSERT INTO public.saha_faturalar
    (cari_id, tip, tarih, vade_tarihi, durum, order_id, created_by)
  VALUES
    (v_cari_id, 'satis', now()::date,
     (now()::date + (v_vade_gun || ' days')::interval)::date,
     'gonderildi', p_order_id, v_order.sales_rep_id)
  RETURNING id INTO v_fatura_id;

  -- (f) Fatura kalemleri (sipariş satırlarından).
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
$function$;
