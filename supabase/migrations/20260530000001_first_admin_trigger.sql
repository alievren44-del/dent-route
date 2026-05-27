-- =====================================================================
-- First Admin Auto-Promotion Trigger
-- ---------------------------------------------------------------------
-- profiles tablosuna INSERT olduğunda, eğer tablo daha önce boşsa,
-- yeni satırın role kolonu otomatik olarak 'ADMIN' olarak set edilir.
--
-- Bu sayede ilk admin'i FirstAdminPage üzerinden (supabase.auth.signUp +
-- handle_new_user trigger akışı) güvenli biçimde oluşturabiliriz.
--
-- Parla şemasında profiles.role TEXT olarak tanımlı (user_role enum
-- değil) — fakat enum değerleri uppercase tutulur (REP / ADMIN / DOCTOR).
-- Bu trigger sadece tablonun boş olduğu ilk INSERT'te tetiklenir; sonraki
-- kayıtlarda hiçbir etkisi yoktur.
--
-- Idempotent: dosya defalarca uygulanabilir (CREATE OR REPLACE + DROP IF
-- EXISTS).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_first_user_as_admin()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  user_count INT;
BEGIN
  SELECT COUNT(*) INTO user_count FROM public.profiles;
  IF user_count = 0 THEN
    NEW.role := 'ADMIN';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS first_user_admin ON public.profiles;
CREATE TRIGGER first_user_admin
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_first_user_as_admin();
