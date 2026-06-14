-- ============================================================================
-- 20260614000008_dispatch_bell_dualwrite.sql  (Sprint J2)
-- ----------------------------------------------------------------------------
-- saha_dispatch_due_reminders şimdiye dek yalnız `notifications` (push) tablosuna
-- yazıyordu → cron-hatırlatma push olarak gidiyor AMA in-app bell (saha_notifications,
-- NotificationsPage'in okuduğu) BOŞ kalıyordu. Dual-write: aynı döngüde bell'e de
-- yaz (type='system', NotificationsPage gösterir + deep-link route taşır).
-- Idempotent (CREATE OR REPLACE). notified_at guard tekrar-yazmayı önler.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.saha_dispatch_due_reminders()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  r record; v_count integer := 0; v_clinic record; v_msg text; v_route text; v_title text;
BEGIN
  FOR r IN
    SELECT * FROM public.saha_reminders
    WHERE status = 'open' AND notified_at IS NULL AND due_at <= now()
    ORDER BY due_at ASC LIMIT 200
  LOOP
    SELECT name, phone INTO v_clinic FROM public.saha_clinics WHERE id::text = r.account_id;
    v_msg := COALESCE(v_clinic.name, 'Klinik')
             || CASE WHEN r.note IS NOT NULL AND r.note <> '' THEN ' · ' || r.note ELSE '' END;
    v_route := '/takvim?reminder=' || r.id::text;
    v_title := CASE r.type WHEN 'appointment' THEN 'Randevu hatırlatması'
                           WHEN 'tahsilat' THEN 'Tahsilat hatırlatması'
                           ELSE 'Ziyaret hatırlatması' END;

    -- Push kanalı (FCM trigger)
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (r.rep_id, 'system_alert', v_title, v_msg,
      jsonb_build_object(
        'kind','visit_reminder','route',v_route,'deeplink',v_route,
        'actionTypeId','VISIT_REMINDER','reminder_id',r.id,'reminder_type',r.type,
        'account_id',r.account_id,'clinic_name',v_clinic.name,
        'clinic_phone',v_clinic.phone,'note',r.note));

    -- In-app bell (NotificationsPage / NotificationBell okur) — eskiden eksikti.
    INSERT INTO public.saha_notifications (user_id, type, title, body, payload)
    VALUES (r.rep_id, 'system', v_title, v_msg,
      jsonb_build_object('kind','visit_reminder','route',v_route,'reminder_id',r.id));

    UPDATE public.saha_reminders SET notified_at = now(), push_count = push_count + 1 WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

COMMIT;
