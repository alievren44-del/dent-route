-- ============================================================================
-- Saha Navigasyon — Scan Budget Cap (Google Places günlük bütçe sınırı)
-- ============================================================================
-- Tarih    : 2026-06-10
-- Amaç     : whole_country × max intensity gibi yüksek-maliyet kombinasyonları
--            için runaway Google Places faturasını önler.
--
-- Değişiklikler
-- ─────────────
-- 1. saha_api_usage  → queries_count INT kolonu eklenir (mevcut satırlar 0 alır).
--    Bir satır = 1 scan çağrısı; queries_count = o çağrıda yapılan Places sorgu sayısı.
--
-- 2. saha_scan_budget_config tablosu — yönetici tarafından ayarlanabilir günlük limit.
--    Sadece 1 satır tutulur (id = 1).
--
-- 3. check_scan_budget(p_estimated_queries INT) → BOOL SECURITY DEFINER
--    Bugünkü kümülatif queries_count + p_estimated_queries ≤ günlük_limit ise TRUE,
--    aşılıyorsa FALSE döner. Edge Function dispatch öncesi çağırır.
--
-- 4. record_scan_queries(p_user_id UUID, p_queries INT, p_meta JSONB) → void SECURITY DEFINER
--    Bir district scan tamamlandıktan sonra kullanılan sorgu sayısını loglar.
--    (clinic-scan/batch-scan tarafından çağrılır.)
--
-- Idempotent: IF NOT EXISTS, CREATE OR REPLACE, kolona DEFAULT+NULL guard.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_api_usage — queries_count kolonu ekle
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_api_usage
  ADD COLUMN IF NOT EXISTS queries_count INT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.saha_api_usage.queries_count IS
  'Bu scan çağrısında fiilen yapılan Google Places API sorgu sayısı (gridPoints × queries).';

-- ----------------------------------------------------------------------------
-- 2. saha_scan_budget_config — günlük limit config
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_scan_budget_config (
  id                    INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- tek satır
  daily_query_limit     INT  NOT NULL DEFAULT 5000,   -- günlük max Google Places sorgusu
  whole_country_max_ok  BOOL NOT NULL DEFAULT FALSE,  -- whole_country+max admin onayı gerektirir
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.saha_scan_budget_config IS
  'Scan için günlük Google Places bütçe limiti. Yalnızca 1 satır (id=1). ADMIN günceller.';

-- Varsayılan config satırını yerleştir (zaten varsa dokunma)
INSERT INTO public.saha_scan_budget_config (id, daily_query_limit, whole_country_max_ok)
VALUES (1, 5000, FALSE)
ON CONFLICT (id) DO NOTHING;

-- RLS: sadece ADMIN okur/günceller
ALTER TABLE public.saha_scan_budget_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scan_budget_config_admin_select" ON public.saha_scan_budget_config;
CREATE POLICY "scan_budget_config_admin_select" ON public.saha_scan_budget_config
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  );

DROP POLICY IF EXISTS "scan_budget_config_admin_update" ON public.saha_scan_budget_config;
CREATE POLICY "scan_budget_config_admin_update" ON public.saha_scan_budget_config
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'ADMIN')
  );

-- ----------------------------------------------------------------------------
-- 3. check_scan_budget(p_estimated_queries INT) → BOOLEAN
--    TRUE  = bütçe var, scan devam edebilir
--    FALSE = günlük limit aşılacak, scan reddedilmeli
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_scan_budget(
  p_estimated_queries INT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_limit       INT;
  v_today_start TIMESTAMPTZ;
  v_used        BIGINT;
BEGIN
  -- Config'den günlük limiti al (tablo yoksa / boşsa 5000 default)
  SELECT daily_query_limit
    INTO v_limit
    FROM public.saha_scan_budget_config
   WHERE id = 1;

  IF v_limit IS NULL THEN
    v_limit := 5000;
  END IF;

  -- Bugün UTC başlangıcı
  v_today_start := date_trunc('day', NOW() AT TIME ZONE 'UTC');

  -- Bugün tüm kullanıcıların birlikte harcadığı sorgu sayısı
  -- (site geneli bütçe — tek bir temsilcinin patlataması önlenir)
  SELECT COALESCE(SUM(queries_count), 0)
    INTO v_used
    FROM public.saha_api_usage
   WHERE endpoint IN ('clinic-scan', 'google-places-search')
     AND used_at >= v_today_start;

  RETURN (v_used + p_estimated_queries) <= v_limit;
END;
$$;

COMMENT ON FUNCTION public.check_scan_budget(INT) IS
  'Bugünkü kümülatif Google Places sorgu sayısı + tahmini yük ≤ günlük limit ise TRUE döner. batch-scan dispatch öncesi çağırır.';

GRANT EXECUTE ON FUNCTION public.check_scan_budget(INT)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. record_scan_queries(p_user_id UUID, p_queries INT, p_meta JSONB) → void
--    Bir district scan'dan sonra kullanılan sorgu sayısını kaydeder.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_scan_queries(
  p_user_id UUID,
  p_queries  INT,
  p_meta     JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.saha_api_usage (user_id, endpoint, queries_count, request_meta)
  VALUES (p_user_id, 'clinic-scan', GREATEST(p_queries, 0), p_meta);
END;
$$;

COMMENT ON FUNCTION public.record_scan_queries(UUID, INT, JSONB) IS
  'Bir district scan sonrası kullanılan Google Places sorgu sayısını saha_api_usage''a kaydeder. batch-scan çağırır.';

GRANT EXECUTE ON FUNCTION public.record_scan_queries(UUID, INT, JSONB)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. İndeks — günlük toplamlarda hız için
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_saha_api_usage_endpoint_day
  ON public.saha_api_usage (endpoint, used_at DESC);

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- SELECT daily_query_limit, whole_country_max_ok FROM saha_scan_budget_config WHERE id = 1;
-- SELECT public.check_scan_budget(100);   -- TRUE beklenir (ilk çalıştırmada 0 kayıt)
-- SELECT public.check_scan_budget(99999); -- FALSE beklenir (5000 limitini aşar)
-- SELECT proname FROM pg_proc WHERE proname IN ('check_scan_budget','record_scan_queries');
-- ============================================================================
