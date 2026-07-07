-- 20260707000001_saha_link_cari_to_profile.sql
-- Cari ↔ kayıtlı profil (app kullanıcısı) bağlama RPC'si.
--
-- Sorun: saha siparişi bir klinikten türetilen cariye bağlanıyor (saha_cariler.
-- clinic_id + profile_id NULL). Klinik zamanla app'e kayıt olan bir hekime denk
-- geldiğinde cari, o profile'a (ve dolayısıyla customer_accounts cari-bakiyesine)
-- bağlanmalı ki sipariş/fatura akışı web-müşteri hesabıyla tek omurga olsun.
--
-- Rep saha_cariler'i doğrudan UPDATE edemez (yalnız MANAGER+); bu yüzden yetkili
-- rep adına SECURITY DEFINER fonksiyon çalışır. Yetki kapısı fonksiyon içinde.
--
-- Idempotent: aynı profile'a tekrar bağlamak no-op (yalnız hesap linkini garanti
-- eder). FARKLI dolu bir profile'a yeniden bağlama SESSİZCE yapılmaz → exception.
--
-- NOT (repo-fact, baseline): public.customer_accounts üzerinde iki trigger var —
--   * trg_fill_customer_account_code (BEFORE INSERT): account_code NULL/'' ise
--     'CAR-'||upper(substr(user_id,1,8)) üretir. Biz açıkça CA-YYYY-NNNN veriyoruz.
--   * ensure_customer_account (profiles AFTER trigger): DOCTOR/ADMIN/PENDING rolü
--     için hesap zaten OTOMATİK açılmış olabilir (status 'active'/'suspended').
--   Bu yüzden INSERT mutlaka user_id üzerinde NOT EXISTS ile korunur (çift-hesap yok).

CREATE OR REPLACE FUNCTION public.saha_link_cari_to_profile(
  p_cari_id    uuid,
  p_profile_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid            uuid := auth.uid();
  v_existing_pid   uuid;
  v_account_id     uuid;
  v_year           text := to_char(now(), 'YYYY');
  v_next_seq       integer;
  v_account_code   text;
BEGIN
  -- Yetki: rep / saha temsilcisi / yönetici / admin (rol büyük-küçük harf karışık).
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND upper(role) IN ('REP', 'SALES_REP', 'ADMIN', 'MANAGER')
  ) THEN
    RAISE EXCEPTION 'yetki yok';
  END IF;

  IF p_cari_id IS NULL THEN
    RAISE EXCEPTION 'cari_id zorunlu';
  END IF;
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'profile_id zorunlu';
  END IF;

  -- Profil var mı?
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RAISE EXCEPTION 'profil bulunamadı: %', p_profile_id;
  END IF;

  -- Cari var mı + mevcut profile_id?
  SELECT profile_id INTO v_existing_pid
  FROM public.saha_cariler
  WHERE id = p_cari_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cari bulunamadı: %', p_cari_id;
  END IF;

  -- Farklı dolu bir profile'a bağlıysa: sessiz relink YOK.
  IF v_existing_pid IS NOT NULL AND v_existing_pid <> p_profile_id THEN
    RAISE EXCEPTION 'cari zaten başka bir profile bağlı: %', v_existing_pid;
  END IF;

  -- customer_accounts satırını garanti et (user_id = profile).
  -- ensure_customer_account trigger'ı bazı rollerde bunu zaten açmış olabilir →
  -- NOT EXISTS ile korunuyoruz (çift-hesap / unique(account_code) çakışması yok).
  SELECT id INTO v_account_id
  FROM public.customer_accounts
  WHERE user_id = p_profile_id
  LIMIT 1;

  IF v_account_id IS NULL THEN
    -- account_code üretimi generate_cari_kodu tarzı max+1 tarama (yeni sequence yok):
    -- CA-YYYY-NNNN. (BEFORE INSERT trigger NULL bırakılsa CAR-<uid8> üretirdi; biz
    -- yıl-bazlı okunur kod veriyoruz.)
    SELECT COALESCE(MAX(
      NULLIF(regexp_replace(account_code, '^CA-' || v_year || '-', ''), '')::integer
    ), 0) + 1
      INTO v_next_seq
    FROM public.customer_accounts
    WHERE account_code LIKE 'CA-' || v_year || '-%';

    v_account_code := 'CA-' || v_year || '-' || lpad(v_next_seq::text, 4, '0');

    INSERT INTO public.customer_accounts (user_id, account_code, credit_limit, current_balance, status)
    SELECT p_profile_id, v_account_code, 0, 0, 'active'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.customer_accounts WHERE user_id = p_profile_id
    )
    RETURNING id INTO v_account_id;

    -- Yarış: NOT EXISTS ile INSERT satır döndürmediyse (trigger arada açtıysa) yeniden oku.
    IF v_account_id IS NULL THEN
      SELECT id INTO v_account_id
      FROM public.customer_accounts
      WHERE user_id = p_profile_id
      LIMIT 1;
    END IF;
  END IF;

  -- Cariyi profile + hesaba bağla (idempotent: aynı değerler tekrar yazılsa da sorun yok).
  UPDATE public.saha_cariler
     SET profile_id = p_profile_id,
         account_id = v_account_id
   WHERE id = p_cari_id;

  RETURN p_cari_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.saha_link_cari_to_profile(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.saha_link_cari_to_profile(uuid, uuid) TO authenticated;
