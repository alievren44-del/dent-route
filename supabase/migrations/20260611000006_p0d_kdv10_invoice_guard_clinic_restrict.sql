-- P0-D düzeltmeleri (CTO audit #68 KDV, #46/#103 çift-fatura, #45 saha_clinics açık CRUD)
-- NOT: Bu migration CANLI projeye (rranpzicmhgfupgabgbi) MCP ile zaten uygulandı
--      (2026-06-11). Dosya, CI/#110 glob ile fresh-deploy'da REPRODUCE için eklendi
--      (aksi halde temiz kurulumda post_order_to_cash KDV %20'ye geri döner).
--      Idempotent: CREATE OR REPLACE + DROP POLICY IF EXISTS.

-- #68: post_order_to_cash KDV fallback %20 → %10 (diş/sağlık standardı).
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
  SELECT id INTO v_fatura_id
    FROM public.saha_faturalar
   WHERE order_id = p_order_id
   LIMIT 1;
  IF v_fatura_id IS NOT NULL THEN
    RETURN v_fatura_id;
  END IF;

  SELECT id, user_id, cari_id, sales_rep_id
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'post_order_to_cash: order % bulunamadı', p_order_id;
  END IF;

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
    COALESCE(p.tax_rate / 100.0, 0.10)
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
   WHERE oi.order_id = p_order_id;

  UPDATE public.orders SET invoice_status = 'invoiced' WHERE id = p_order_id;

  RETURN v_fatura_id;
END;
$function$;

-- #46/#103: request_order_invoice — 'invoiced' siparişe ikinci (Bizimhesap) fatura
-- isteğini ENGELLE (trigger saha_faturalar + manuel istek = çift fatura).
CREATE OR REPLACE FUNCTION public.request_order_invoice(p_order_id uuid)
 RETURNS saha_invoice_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.orders;
  v_req   public.saha_invoice_requests;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'order_not_found';
  end if;
  if not (public.is_admin() or v_order.sales_rep_id = auth.uid()) then
    raise exception 'not_authorized';
  end if;
  if v_order.invoice_status = 'invoiced' then
    raise exception 'already_invoiced';
  end if;

  update public.orders set invoice_status = 'invoice_requested' where id = p_order_id;

  insert into public.saha_invoice_requests (order_id, requested_by, status)
    values (p_order_id, auth.uid(), 'requested')
  on conflict (order_id) do update
    set status = 'requested', requested_by = excluded.requested_by, updated_at = now()
  returning * into v_req;

  return v_req;
end;
$function$;

-- #45: saha_clinics update/delete herkese açıktı (auth.uid() IS NOT NULL) → rol-kısıtla.
DROP POLICY IF EXISTS saha_clinics_authenticated_update ON public.saha_clinics;
DROP POLICY IF EXISTS saha_clinics_authenticated_delete ON public.saha_clinics;

CREATE POLICY saha_clinics_rep_admin_update ON public.saha_clinics
  FOR UPDATE
  USING (public.saha_is_rep_or_admin() OR public.saha_is_manager_or_admin())
  WITH CHECK (public.saha_is_rep_or_admin() OR public.saha_is_manager_or_admin());

CREATE POLICY saha_clinics_admin_delete ON public.saha_clinics
  FOR DELETE
  USING (public.saha_is_admin() OR public.saha_is_manager_or_admin());
