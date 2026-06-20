-- ============================================================================
-- 20260621000001_notify_admin_on_reminder_delete.sql
-- Saha bug (FAB): plasiyer randevu/reminder silince admin'e bildirim
-- ("X, bir randevuyu sildi"). saha_reminders DELETE-RLS zaten var
-- (saha_reminders_own_delete: rep-kendi VEYA admin) — bu sadece bildirim ekler.
-- AFTER DELETE trigger → saha_notify_rep (bell + push). EXCEPTION-safe:
-- bildirim hatası DELETE'i ASLA bloklamaz. Yalnız REP silince bildirir (admin sus).
-- saha_notifications.type CHECK 'reminder_deleted' kabul etmiyor → 'system' + payload.event.
-- PROD'A MCP-APPLIED 2026-06-21.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notify_admin_on_reminder_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_admin record;
BEGIN
  IF v_actor IS NULL OR public.saha_is_admin() THEN
    RETURN OLD;
  END IF;
  SELECT COALESCE(ad_soyad, email, 'Plasiyer') INTO v_actor_name FROM public.profiles WHERE id = v_actor;
  FOR v_admin IN SELECT id FROM public.profiles WHERE lower(role) = 'admin' LOOP
    BEGIN
      PERFORM public.saha_notify_rep(
        v_admin.id,
        'system',
        'Randevu silindi',
        COALESCE(v_actor_name, 'Plasiyer') || ', bir randevuyu sildi: ' || COALESCE(OLD.title, '(başlıksız)'),
        jsonb_build_object('event', 'reminder_deleted', 'reminder_id', OLD.id, 'rep_id', OLD.rep_id, 'type', OLD.type, 'title', OLD.title, 'due_at', OLD.due_at, 'deleted_by', v_actor),
        true
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
  RETURN OLD;
END
$function$;

DROP TRIGGER IF EXISTS trg_notify_admin_reminder_delete ON public.saha_reminders;
CREATE TRIGGER trg_notify_admin_reminder_delete
  AFTER DELETE ON public.saha_reminders
  FOR EACH ROW EXECUTE FUNCTION public.notify_admin_on_reminder_delete();
