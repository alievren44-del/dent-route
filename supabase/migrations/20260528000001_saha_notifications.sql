-- ============================================================================
-- Saha Navigasyon — Notifications Migration
-- ============================================================================
-- Tarih      : 2026-05-28
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Strateji   : ADDITIVE — saha_notifications tablosu ekler.
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE / INDEX IF NOT EXISTS, DROP POLICY IF EXISTS
-- önce CREATE POLICY. Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - auth.users                       (Supabase Auth)
--   - public.saha_is_admin()           (20260525000001_saha_extension)
--
-- INSERT POLICY YOK: yalnızca service_role (Edge Function / cron) yazabilir.
-- RLS açık + INSERT policy tanımsız = authenticated rolüne yazma kapalı.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_notifications — kullanıcı bildirimleri
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL
                CHECK (type IN (
                  'sample_follow_up',
                  'order_approval',
                  'order_status_change',
                  'mileage_reminder',
                  'system'
                )),
  title       text NOT NULL,
  body        text,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_notifications IS
  'Saha rep/admin için in-app bildirim feed''i. type=sample_follow_up|order_approval|order_status_change|mileage_reminder|system. payload jsonb içinde accountId/sampleId/orderId gibi deep-link verisi taşır. INSERT yalnızca service_role tarafından (Edge Function / cron).';

-- ----------------------------------------------------------------------------
-- 2. Indexler
-- ----------------------------------------------------------------------------
-- Unread-first feed: read_at NULL olanlar önde, sonra created_at DESC
CREATE INDEX IF NOT EXISTS idx_saha_notifications_user_unread
  ON public.saha_notifications(user_id, read_at, created_at DESC);

-- Düz liste / arşiv sayfası
CREATE INDEX IF NOT EXISTS idx_saha_notifications_user_created
  ON public.saha_notifications(user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. RLS — sadece sahibi okur ve günceller (read_at için)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_notifications_own_select" ON public.saha_notifications;
CREATE POLICY "saha_notifications_own_select" ON public.saha_notifications
  FOR SELECT USING (auth.uid() = user_id OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_notifications_own_update" ON public.saha_notifications;
CREATE POLICY "saha_notifications_own_update" ON public.saha_notifications
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- NOT: INSERT/DELETE policy tanımlı değil — RLS açık olduğundan authenticated
-- rolü yazamaz. service_role RLS'i bypass eder (Edge Function / cron job).

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'saha_notifications';
-- 2. SELECT indexname FROM pg_indexes WHERE tablename = 'saha_notifications';
-- 3. SELECT polname FROM pg_policy
--    WHERE polrelid = 'public.saha_notifications'::regclass;
-- ============================================================================
