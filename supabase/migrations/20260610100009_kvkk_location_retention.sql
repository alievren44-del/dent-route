-- ============================================================================
-- KVKK Konum Verisi Saklama Süresi — 90 Gün Purge
-- ============================================================================
-- Tarih      : 2026-06-10
-- Amaç       : KVKK amaç-sınırlama ilkesi (md. 4/1-c).
--              Temsilci check-in koordinatları operasyonel ihtiyacın
--              (rota doğrulama, anomali tespiti) ötesinde süresiz
--              saklanmamalıdır. 90 günden eski kayıtlarda koordinatlar
--              NULL'a düşürülür; ziyaret kaydının kendisi SİLİNMEZ.
--
-- Kapsam     :
--   • public.saha_visits   → check_in_lat, check_in_lng, check_in_accuracy_m
--   • public.rep_visits    → check_in_location (geography(POINT,4326))
--
-- Strateji   :
--   Koordinat alanlarını NULL yapan SECURITY DEFINER fonksiyon.
--   pg_cron yüklüyse cron.schedule ile günlük 03:17 UTC'de çalışır.
--   pg_cron yoksa fonksiyon oluşturulur; uygulama katmanı (app-cron) çağırır.
--
-- Idempotent : CREATE OR REPLACE FUNCTION + DO $$ guard $$
-- BAĞIMLILIKLAR:
--   • public.saha_visits          (20260602000001_saha_visits.sql)
--   • public.rep_visits           (Parla 20260411000002_rep_crm)
--   • extensions: pg_cron (opsiyonel)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. purge_old_checkin_coords()
--    90 günden eski saha_visits ve rep_visits koordinatlarını NULL'a düşür.
--    Ziyaret satırı SİLİNMEZ — yalnızca konum alanları temizlenir.
--    Döndürülen değer: kaç satır güncellendi (bilgi amaçlı).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_old_checkin_coords()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff        timestamptz := now() - interval '90 days';
  v_saha_count    int := 0;
  v_rep_count     int := 0;
BEGIN
  -- saha_visits: üç konum kolonu NULL'a çek
  UPDATE public.saha_visits
  SET
    check_in_lat        = NULL,
    check_in_lng        = NULL,
    check_in_accuracy_m = NULL
  WHERE
    check_in_at < v_cutoff
    AND (
      check_in_lat        IS NOT NULL
      OR check_in_lng     IS NOT NULL
      OR check_in_accuracy_m IS NOT NULL
    );

  GET DIAGNOSTICS v_saha_count = ROW_COUNT;

  -- rep_visits: geography kolon NULL'a çek (varsa)
  -- DO guard: tablo/kolon yoksa silent skip
  BEGIN
    UPDATE public.rep_visits
    SET check_in_location = NULL
    WHERE
      check_in_at < v_cutoff
      AND check_in_location IS NOT NULL;

    GET DIAGNOSTICS v_rep_count = ROW_COUNT;
  EXCEPTION
    WHEN undefined_table OR undefined_column THEN
      -- rep_visits yoksa ya da check_in_location kolonu henüz eklenmemişse atla
      v_rep_count := 0;
  END;

  RETURN jsonb_build_object(
    'purged_at',      now(),
    'cutoff',         v_cutoff,
    'saha_visits',    v_saha_count,
    'rep_visits',     v_rep_count
  );
END;
$$;

COMMENT ON FUNCTION public.purge_old_checkin_coords() IS
  'KVKK md.4/1-c: 90 günden eski check-in koordinatlarını NULL yapar. '
  'Ziyaret kaydını SİLMEZ. pg_cron ile günlük çağrılır; yoksa app-cron çağırır.';

-- Grant: sadece service_role / postgres çağırabilir (RLS bypass)
REVOKE ALL ON FUNCTION public.purge_old_checkin_coords() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_checkin_coords() TO service_role;

-- ----------------------------------------------------------------------------
-- 2. pg_cron günlük schedule (pg_cron yüklüyse)
--    pg_cron mevcut değilse bu blok sessizce atlanır.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- pg_cron uzantısı yüklü mü?
  IF EXISTS (
    SELECT 1
    FROM pg_extension
    WHERE extname = 'pg_cron'
  ) THEN
    -- Varsa önce eski job'ı kaldır (idempotent)
    PERFORM cron.unschedule('kvkk-purge-checkin-coords')
    WHERE EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'kvkk-purge-checkin-coords'
    );

    -- Günlük 03:17 UTC — düşük-trafik saati, diğer cron'larla çakışmaz
    PERFORM cron.schedule(
      'kvkk-purge-checkin-coords',   -- job adı
      '17 3 * * *',                  -- cron ifadesi
      'SELECT public.purge_old_checkin_coords()'  -- tek tirnak: dollar-quote ile dis DO blogu cakismasin
    );

    RAISE NOTICE 'pg_cron job oluşturuldu: kvkk-purge-checkin-coords (günlük 03:17 UTC)';
  ELSE
    RAISE NOTICE 'pg_cron yüklü değil — purge_old_checkin_coords() app-cron ile çağrılmalıdır.';
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. Fonksiyon var mı?
--    SELECT proname, prosecdef FROM pg_proc
--    WHERE proname = 'purge_old_checkin_coords' AND pronamespace = 'public'::regnamespace;
--
-- 2. Test çalıştır (kuru çalıştırma — gerçek veri temizlenmez, cutoff 0 gün ile test):
--    SELECT public.purge_old_checkin_coords();
--
-- 3. pg_cron job listesi (pg_cron varsa):
--    SELECT jobname, schedule, command, active FROM cron.job
--    WHERE jobname = 'kvkk-purge-checkin-coords';
--
-- 4. Etki kontrolü (90 günden eski koordinatlı satır var mı?):
--    SELECT count(*) FROM public.saha_visits
--    WHERE check_in_at < now() - interval '90 days'
--      AND (check_in_lat IS NOT NULL OR check_in_lng IS NOT NULL);
-- ============================================================================
