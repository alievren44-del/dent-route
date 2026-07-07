-- 20260707000002_saha_create_order_tx.sql
-- Saha siparişi oluşturma — TEK transaction, sunucu-otoriteli RPC.
--
-- Sorun (kök-neden): Nav client sipariş başlığını + kalemleri ayrı REST çağrılarıyla
-- INSERT ediyor; fiyat/durum/order_number client'tan geliyordu. Bu:
--   * fiyat manipülasyonuna açık (client priceTL),
--   * client status='approved' geçebilir (onay kapısı atlanır),
--   * yarı-yazılmış sipariş (başlık var, kalem yok) bırakabilir.
-- Çözüm: bu SECURITY DEFINER fonksiyon her şeyi sunucuda yapar; fiyat
-- v_saha_products'tan, durum role'e göre, order_number sunucuda. Fonksiyon = tek
-- transaction (P6): herhangi bir exception başlık + kalemleri birlikte geri alır.
--
-- Mevcut akışla çakışmaz: status burada yalnız 'pending' / 'approval_pending' set
-- edilir; 'approved'a geçiş ayrı (approve_order_if_authorized → handle_order_status_change
-- → post_order_to_cash, saha_faturalar.order_id üzerinde idempotent).
--
-- P4 fiyat: v_saha_products (id text, name, sku, base_price, sale_price kolonları —
-- 20260611000001_saha_products_view.sql). Fiyat = coalesce(sale_price, base_price).
-- Ürün view'de yoksa ya da fiyat NULL/<=0 ise → exception. SIFIR-FİYAT FALLBACK YOK.
-- TODO-REVIEW: view kolon adları (name/sku/base_price/sale_price) canlı v_saha_products
-- ile birebir; şema değişirse burada güncelle.

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
  v_pid        text;    -- v_saha_products.id TEXT: fanta/olident id'leri uuid DEĞİL ('fanta-1')
  v_pid_uuid   uuid;    -- order_items.product_id uuid — yalnız cast edilebilenler dolar
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
  v_lines      jsonb := '[]'::jsonb;   -- çözülmüş satırlar (fiyat sunucudan)
  v_existing   record;
BEGIN
  -- Yetki (FILE 1 ile aynı rol kapısı).
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;
  SELECT upper(COALESCE(role, '')) INTO v_role
  FROM public.profiles
  WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('REP', 'SALES_REP', 'ADMIN', 'MANAGER') THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;

  -- idempotency_key zorunlu.
  v_idem := NULLIF(p_payload ->> 'idempotency_key', '');
  IF v_idem IS NULL THEN
    RAISE EXCEPTION 'idempotency_key zorunlu';
  END IF;

  -- Idempotency: aynı key ile sipariş varsa yeniden döndür (yeni insert yok).
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

  -- Cari çöz: clinic_id verilmiş + cari_id yok ise klinikten find-or-create.
  v_cari   := NULLIF(p_payload ->> 'cari_id', '')::uuid;
  v_clinic := NULLIF(p_payload ->> 'clinic_id', '')::uuid;
  IF v_cari IS NULL AND v_clinic IS NOT NULL THEN
    v_cari := public.saha_get_or_create_cari_for_clinic(v_clinic);
  END IF;

  -- P1: orders.user_id — payload user_id (legacy doğrudan-profil siparişi) ya da
  -- cari kayıtlı bir profile bağlıysa onun profile_id'si. Aksi halde NULL (prospect).
  v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;
  IF v_user_id IS NULL AND v_cari IS NOT NULL THEN
    SELECT profile_id INTO v_user_id
    FROM public.saha_cariler
    WHERE id = v_cari;
  END IF;

  v_notes := NULLIF(p_payload ->> 'notes', '');

  -- Kalemler.
  v_items := p_payload -> 'items';
  IF v_items IS NULL OR jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items zorunlu (en az 1 kalem)';
  END IF;

  -- P4: her kalemin fiyatını SUNUCUDA çöz; subtotal biriktir.
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_pid := NULLIF(v_item ->> 'product_id', '');
    v_qty := (v_item ->> 'quantity')::integer;

    IF v_pid IS NULL THEN
      RAISE EXCEPTION 'product_id zorunlu';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'geçersiz miktar: %', v_item ->> 'quantity';
    END IF;

    -- v_saha_products.id TEXT (generic=uuid-text, fanta/olident='fanta-1' gibi).
    -- order_items.product_id uuid → yalnız uuid-castable id'lerde dolar, diğerlerinde
    -- NULL + sku/product_name snapshot (post_order_to_cash LEFT JOIN ile aynı davranış).
    BEGIN
      v_pid_uuid := v_pid::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      v_pid_uuid := NULL;
    END;

    SELECT name, sku, COALESCE(sale_price, base_price)
      INTO v_pname, v_psku, v_price
    FROM public.v_saha_products
    WHERE id = v_pid
    LIMIT 1;

    IF NOT FOUND OR v_price IS NULL OR v_price <= 0 THEN
      RAISE EXCEPTION 'fiyat çözülemedi: %', v_pid;  -- sıfır-fiyat fallback YOK
    END IF;

    v_line := v_qty * v_price;
    v_subtotal := v_subtotal + v_line;

    v_lines := v_lines || jsonb_build_object(
      'product_id',   v_pid_uuid,   -- uuid ya da NULL (fanta/olident)
      'sku',          v_psku,
      'product_name', v_pname,
      'quantity',     v_qty,
      'unit_price',   v_price,
      'line_total',   v_line
    );
  END LOOP;

  -- KDV %10 (KDV_RATE=0.10), numeric 2-ondalık yuvarlama.
  v_vat   := round(v_subtotal * 0.10, 2);
  v_total := v_subtotal + v_vat;

  -- P7: durum SUNUCUDA. Client status geçemez.
  -- REP/SALES_REP/ADMIN → 'pending'. MANAGER → total>50000 ise 'approval_pending',
  -- değilse 'pending'. Beklenmeyen rol (authz sonrası ulaşılamaz) → 'approval_pending'.
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

  -- order_number SUNUCUDA üretilir (client SAH-<epoch>-<rand> değeri yok sayılır).
  v_order_no := 'SAH-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text), 1, 6);

  -- Tek transaction: başlık + kalemler birlikte (P6).
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
    -- idempotency_key yarışı: paralel çağrı önce yazmış → mevcut siparişi döndür.
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
    RAISE;  -- başka bir unique çakışması → geri al
  END;

  INSERT INTO public.order_items (order_id, product_id, sku, product_name, quantity, unit_price, line_total)
  SELECT
    v_order_id,
    (l ->> 'product_id')::uuid,
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
