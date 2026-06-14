-- ============================================================================
-- RLS helper'ları case-insensitive yap.
-- SORUN: profiles.role uygulamada KÜÇÜK harf ('admin'/'rep') tutuluyor ama
--        helper'lar BÜYÜK harf ('ADMIN'/'REP'/'MANAGER') karşılaştırıyordu →
--        cari/fatura/ödeme/stok/rep_targets insert RLS reddediyordu.
-- ÇÖZÜM: UPPER(role) ile karşılaştır. Hem küçük hem büyük harf eşleşir.
--        Güvenlik düşmez (rep yine admin olmaz). Idempotent (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.saha_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND UPPER(role) = 'ADMIN'
  )
$$;

CREATE OR REPLACE FUNCTION public.saha_is_rep_or_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND UPPER(role) IN ('REP', 'SALES_REP', 'MANAGER', 'ADMIN')
  )
$$;

CREATE OR REPLACE FUNCTION public.saha_is_manager_or_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND UPPER(role) IN ('ADMIN', 'MANAGER')
  )
$$;
