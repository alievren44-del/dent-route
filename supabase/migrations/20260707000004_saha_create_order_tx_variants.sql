-- 20260707000004_saha_create_order_tx_variants.sql
-- saha_create_order_tx v2 — kalem bazında VARYANT desteği.
--
-- Sorun: saha siparişi varyantlı ürünlerde (elmas frez ISO/boy, kanal eğesi
-- taper vb.) varyant seçimi taşımıyordu → order_items.variant_id NULL,
-- selected_options NULL, sku ürün-seviyesi kalıyordu.
--
-- Çözüm: items[] artık opsiyonel variant_id (TEXT — generic'te uuid,
-- fanta/olident'te embedded id) kabul eder. Fiyat/sku/attributes SUNUCUDA
-- v_saha_products.product_variants jsonb'sinden çözülür (client fiyatına
-- güven yok). Varyantsız çağrılar birebir eski davranış (geri uyumlu).
-- order_items: variant_id yalnız uuid-castable ise kolona yazılır;
-- selected_options = varyant attributes (+sku); vat_rate mevcut kolonlara
-- dokunulmaz.

CREATE OR REPLACE FUNCTION public.saha_create_order_tx(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_role       text;
  v_idem       text;
  v_cari       uuid;
  v_clinic     uuid;
  v_user_id    uuid;
  v_notes      text;
  v_items      jsonb;
  v_item       jsonb;
  v_pid        text;
  v_pid_uuid   uuid;
  v_variant    text;
  v_velem      jsonb;
  v_vid_uuid   uuid;
  v_attrs      jsonb;
  v_qty        integer;
  v_price      numeric;
  v_pname      text;
  v_psku       text;
  v_line       numeric;
  v_subtotal   numeric := 0;
  v_vat        numeric;
  v_total      numeric;
  v_status     text;
  v_order_no   text;
  v_order_id   uuid;
  v_lines      jsonb := '[]'::jsonb;
  v_existing   record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;
  SELECT upper(COALESCE(role, '')) INTO v_role
  FROM public.profiles
  WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('REP', 'SALES_REP', 'ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;

  v_idem := NULLIF(p_payload ->> 'idempotency_key', '');
  IF v_idem IS NULL THEN
    RAISE EXCEPTION 'idempotency_key zorunlu';
  END IF;

  SELECT id, order_number, status INTO v_existing
  FROM public.orders
  WHERE idempotency_key = v_idem
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'order_id',     v_existing.id,
      'order_number', v_existing.order_number,
      'status',       v_existing.status,
      'reused',       true
    );
  END IF;

  v_cari   := NULLIF(p_payload ->> 'cari_id', '')::uuid;
  v_clinic := NULLIF(p_payload ->> 'clinic_id', '')::uuid;
  IF v_cari IS NULL AND v_clinic IS NOT NULL THEN
    v_cari := public.saha_get_or_create_cari_for_clinic(v_clinic);
  END IF;

  v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;
  IF v_user_id IS NULL AND v_cari IS NOT NULL THEN
    SELECT profile_id INTO v_user_id
    FROM public.saha_cariler
    WHERE id = v_cari;
  END IF;

  v_notes := NULLIF(p_payload ->> 'notes', '');

  v_items := p_payload -> 'items';
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items zorunlu (en az 1 kalem)';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_pid     := NULLIF(v_item ->> 'product_id', '');
    v_variant := NULLIF(v_item ->> 'variant_id', '');
    v_qty     := (v_item ->> 'quantity')::integer;

    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'product_id zorunlu';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'geçersiz miktar: %', v_item ->> 'quantity';
    END IF;

    BEGIN
      v_pid_uuid := v_pid::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_pid_uuid := NULL;
    END;

    v_velem    := NULL;
    v_vid_uuid := NULL;
    v_attrs    := NULL;

    IF v_variant IS NOT NULL THEN
      -- Varyant: fiyat/sku/attrs sunucuda product_variants jsonb'sinden.
      SELECT vp.name, elem
        INTO v_pname, v_velem
      FROM public.v_saha_products vp,
           jsonb_array_elements(COALESCE(vp.product_variants::jsonb, '[]'::jsonb)) AS elem  -- view kolonu json (json_agg) → jsonb cast şart
      WHERE vp.id = v_pid AND elem ->> 'id' = v_variant
      LIMIT 1;

      IF v_velem IS NULL THEN
        RAISE EXCEPTION 'varyant bulunamadı: % (ürün %)', v_variant, v_pid;
      END IF;

      v_price := NULLIF(v_velem ->> 'price_try', '')::numeric;
      v_psku  := COALESCE(NULLIF(v_velem ->> 'sku', ''), v_pid);
      v_attrs := COALESCE(v_velem -> 'attributes', '{}'::jsonb);

      BEGIN
        v_vid_uuid := v_variant::uuid;  -- generic varyant; fanta/olident text → NULL
      EXCEPTION WHEN invalid_text_representation THEN
        v_vid_uuid := NULL;
      END;
    ELSE
      SELECT name, sku, COALESCE(sale_price, base_price)
        INTO v_pname, v_psku, v_price
      FROM public.v_saha_products
      WHERE id = v_pid
      LIMIT 1;
    END IF;

    IF v_pname IS NULL OR v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION 'fiyat çözülemedi: %', v_pid;  -- sıfır-fiyat fallback YOK
    END IF;

    v_line := v_qty * v_price;
    v_subtotal := v_subtotal + v_line;

    v_lines := v_lines || jsonb_build_object(
      'product_id',       v_pid_uuid,
      'variant_id',       v_vid_uuid,
      'selected_options', v_attrs,
      'sku',              v_psku,
      'product_name',     v_pname,
      'quantity',         v_qty,
      'unit_price',       v_price,
      'line_total',       v_line
    );
  END LOOP;

  v_vat   := round(v_subtotal * 0.10, 2);
  v_total := v_subtotal + v_vat;

  IF v_role IN ('REP', 'SALES_REP', 'ADMIN') THEN
    v_status := 'pending';
  ELSIF v_role = 'MANAGER' THEN
    IF v_total > 50000 THEN
      v_status := 'approval_pending';
    ELSE
      v_status := 'pending';
    END IF;
  ELSE
    v_status := 'approval_pending';
  END IF;

  v_order_no := 'SAH-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text), 1, 6);

  BEGIN
    INSERT INTO public.orders (
      order_number, user_id, cari_id, clinic_id, sales_rep_id,
      status, subtotal, vat_amount, total, total_amount, shipping_amount,
      notes, idempotency_key
    ) VALUES (
      v_order_no, v_user_id, v_cari, v_clinic, v_uid,
      v_status, v_subtotal, v_vat, v_total, v_total, 0,
      v_notes, v_idem
    )
    RETURNING id INTO v_order_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id, order_number, status INTO v_existing
    FROM public.orders
    WHERE idempotency_key = v_idem
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id',     v_existing.id,
        'order_number', v_existing.order_number,
        'status',       v_existing.status,
        'reused',       true
      );
    END IF;
    RAISE;
  END;

  INSERT INTO public.order_items
    (order_id, product_id, variant_id, selected_options, sku, product_name, quantity, unit_price, line_total)
  SELECT
    v_order_id,
    (l ->> 'product_id')::uuid,
    (l ->> 'variant_id')::uuid,
    NULLIF(l -> 'selected_options', 'null'::jsonb),
    l ->> 'sku',
    l ->> 'product_name',
    (l ->> 'quantity')::integer,
    (l ->> 'unit_price')::numeric,
    (l ->> 'line_total')::numeric
  FROM jsonb_array_elements(v_lines) AS l;

  RETURN jsonb_build_object(
    'order_id',     v_order_id,
    'order_number', v_order_no,
    'status',       v_status,
    'total',        v_total,
    'reused',       false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.saha_create_order_tx(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.saha_create_order_tx(jsonb) TO authenticated;
