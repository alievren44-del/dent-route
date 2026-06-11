-- #70: Server-side sipariş onay yetki kapısı (REP<=5000, MANAGER<=50000, ADMIN sınırsız).
-- Önceden onay sadece client-side approvalRules ile kontrol ediliyordu → rep kendi
-- >5000 TL siparişini adapter/REST ile onaylayabiliyordu. NAV SupabaseCRMAdapter.
-- approveOrder artık bu RPC'yi çağırır. CANLIYA MCP ile uygulandı (2026-06-11);
-- dosya CI/fresh-deploy reproduce için. Idempotent (CREATE OR REPLACE).
-- DEFER: orders UPDATE RLS doğrudan-REST kısıtı ayrı adım (WEB admin onayını bozmamak için).
CREATE OR REPLACE FUNCTION public.approve_order_if_authorized(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_total  numeric;
  v_status text;
  v_role   text;
BEGIN
  SELECT COALESCE(total_amount, total, 0), status
    INTO v_total, v_status
    FROM public.orders
   WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  SELECT upper(COALESCE(role, '')) INTO v_role
    FROM public.profiles
   WHERE id = auth.uid();
  IF v_role IS NULL OR v_role = '' THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF v_role = 'ADMIN' THEN
    NULL;
  ELSIF v_role = 'MANAGER' THEN
    IF v_total > 50000 THEN RAISE EXCEPTION 'over_approval_limit:manager'; END IF;
  ELSIF v_role IN ('REP', 'SALES_REP') THEN  -- canlı DB'de iki rol değeri de var
    IF v_total > 5000 THEN RAISE EXCEPTION 'over_approval_limit:rep'; END IF;
  ELSE
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.orders
     SET status = 'approved', approved_at = now(), approved_by = auth.uid()
   WHERE id = p_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_order_if_authorized(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_order_if_authorized(uuid) TO authenticated;
