-- ============================================================================
-- 20260614000007_security_hardening.sql  (Sprint I)
-- ----------------------------------------------------------------------------
-- 1) profiles self-escalation guard: tek UPDATE policy `profiles_update_own`
--    (auth.uid()=id, with_check NULL) + guard yok → HERHANGİ kullanıcı kendi
--    role'ünü 'admin' yapabiliyordu. Trigger ile role/is_approved değişimini
--    yalnız admin'e (saha_is_admin) izinli yap.
-- 2) Admin başkasının profilini yönetebilsin: profiles_admin_update policy
--    (saha_is_admin) — eskiden admin UPDATE policy yoktu, UsersPage DB'de kırıktı.
-- 3) admin_audit_logs append-only: anon/authenticated DELETE/UPDATE/TRUNCATE
--    GRANT'ları kaldır (audit log tahrif/silme önle). INSERT+SELECT kalır.
-- Idempotent.
-- ============================================================================

BEGIN;

-- 1) Self-escalation guard
CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role)
     OR (NEW.is_approved IS DISTINCT FROM OLD.is_approved) THEN
    IF NOT public.saha_is_admin() THEN
      RAISE EXCEPTION 'forbidden: rol/onay degisikligi yalniz admin';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_prevent_role_self_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_role_self_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_escalation();

-- 2) Admin başkasının profilini güncelleyebilsin (true ADMIN; MANAGER değil)
DROP POLICY IF EXISTS profiles_admin_update ON public.profiles;
CREATE POLICY profiles_admin_update ON public.profiles
  FOR UPDATE USING (public.saha_is_admin()) WITH CHECK (public.saha_is_admin());

-- 3) Audit log append-only
REVOKE DELETE, UPDATE, TRUNCATE ON public.admin_audit_logs FROM authenticated;
REVOKE ALL ON public.admin_audit_logs FROM anon;

COMMIT;
