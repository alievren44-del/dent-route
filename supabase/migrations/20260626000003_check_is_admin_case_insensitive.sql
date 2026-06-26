-- Cluster F fix (recurring "/admin/users hata veriyor"): admin Users list came back empty
-- for uppercase-role admins (e.g. profiles.role='ADMIN', as NAV's UsersPage writes it).
-- check_is_admin() — used by the profiles SELECT policy p_admin_select and rep_assignments
-- ra_admin_all — was case-sensitive lowercase (role = 'admin'), while sibling admin fns
-- is_admin()/saha_is_admin() and the NAV client are case-insensitive. So an 'ADMIN' admin
-- passed the client route guard but failed the server-side profiles SELECT RLS, silently
-- receiving only their own row → "kullanıcı yönetimi hata veriyor" (no thrown error → no banner).
-- This aligns check_is_admin with its two siblings already in prod.
-- WEB-SAFE: lowercase 'admin' still passes (UPPER('admin')='ADMIN'); the change only ADDS
-- uppercase recognition — it removes no admin and grants no non-admin. profiles is shared
-- with the website, but website admins use lowercase 'admin' and remain unaffected.
-- Applied to prod (rranpzicmhgfupgabgbi) 2026-06-26. Verified: both admin rows → check_is_admin=true.
--
-- NOTE (systemic, NOT fixed here — needs dual-app role-casing decision):
-- NAV UsersPage writes UPPERCASE role values ('ADMIN'/'MANAGER'/'REP'/'USER') while the web
-- app canonicalizes profiles.role to lowercase. That casing/vocabulary divergence is the deeper
-- root; this migration removes the user-visible failure but the canonicalization should be
-- reconciled end-to-end separately.
create or replace function public.check_is_admin(uid uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = uid AND UPPER(role) = 'ADMIN'
    );
END;
$function$;
