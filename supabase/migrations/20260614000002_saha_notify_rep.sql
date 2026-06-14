-- ============================================================================
-- 20260614000002_saha_notify_rep.sql
-- ----------------------------------------------------------------------------
-- Birleşik bildirim RPC'si: saha_notify_rep.
--
-- SORUN: İki ayrı bildirim tablosu var ve client doğrudan yazamıyor:
--   * public.notifications      → INSERT policy = auth.role()='service_role' SADECE
--                                 (push trigger trg_notify_send_push burada → FCM).
--     Client (authenticated admin) buraya yazamaz → RLS 403, sessiz yutulur.
--   * public.saha_notifications → client rep/admin yazabilir (bell bunu okur) ama
--                                 push trigger YOK.
-- Sonuç: takvim-atama bildirimi hiçbir kanala ulaşmıyordu; route-atama yalnız
-- bell'e ulaşıp push alamıyordu.
--
-- ÇÖZÜM: SECURITY DEFINER RPC her iki tabloya da yazar → tek çağrı = bell + push.
-- Çağıran rep/admin olmalı (abuse guard). authenticated'a execute verilir.
-- Idempotent: CREATE OR REPLACE.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.saha_notify_rep(
  p_user_id   uuid,
  p_saha_type text,          -- saha_notifications.type CHECK kümesinden biri
  p_title     text,
  p_body      text,
  p_data      jsonb DEFAULT '{}'::jsonb,
  p_push      boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  -- Yalnız saha rep/admin başkasına bildirim üretebilir.
  IF NOT public.saha_is_rep_or_admin() THEN
    RAISE EXCEPTION 'forbidden: saha rep/admin required';
  END IF;

  -- 1) In-app bell (NotificationBell saha_notifications okur).
  INSERT INTO public.saha_notifications (user_id, type, title, body, payload)
  VALUES (p_user_id, p_saha_type, p_title, p_body, p_data);

  -- 2) Push kanalı (notifications → trg_notify_send_push → send-push EF → FCM).
  IF p_push THEN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (p_user_id, 'system_alert', p_title, p_body, p_data);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.saha_notify_rep(uuid, text, text, text, jsonb, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.saha_notify_rep(uuid, text, text, text, jsonb, boolean) TO authenticated;

COMMIT;
