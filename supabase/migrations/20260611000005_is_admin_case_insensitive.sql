-- 20260611000005_is_admin_case_insensitive.sql
-- is_admin() case-insensitive. DB'de hem 'ADMIN' hem 'admin' rolleri mevcut;
-- lowercase admin hesaplar da admin sayılmalı (admin sipariş görünürlüğü,
-- saha_clinics/orders admin RLS, request_order_invoice admin yolu).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and upper(role) = 'ADMIN'
  );
$function$;
