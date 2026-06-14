-- ============================================================================
-- 20260614000009_admin_broadcast.sql  (Sprint H2)
-- ----------------------------------------------------------------------------
-- Admin toplu bildirim (broadcast): hedef kullanıcılara hem bell hem push yazar.
-- SECURITY DEFINER + admin guard. Idempotent.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.saha_broadcast(
  p_title text,
  p_body text,
  p_target text DEFAULT 'reps'   -- 'reps' | 'all'
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_count integer := 0; u record;
BEGIN
  IF NOT public.saha_is_admin() THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;
  FOR u IN
    SELECT id FROM public.profiles
    WHERE (p_target = 'all')
       OR (p_target = 'reps' AND UPPER(role) IN ('REP','SALES_REP','MANAGER'))
  LOOP
    INSERT INTO public.saha_notifications (user_id, type, title, body, payload)
    VALUES (u.id, 'system', p_title, p_body, jsonb_build_object('kind','broadcast'));
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (u.id, 'system_alert', p_title, p_body, jsonb_build_object('kind','broadcast'));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.saha_broadcast(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.saha_broadcast(text, text, text) TO authenticated;

COMMIT;
