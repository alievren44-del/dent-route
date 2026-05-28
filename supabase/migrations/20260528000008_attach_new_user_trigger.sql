-- =====================================================================
-- Attach handle_new_user_profile trigger to auth.users
-- ---------------------------------------------------------------------
-- Parla baseline (00000000000000_parla_baseline_local.sql) function'ı
-- tanımlıyor ama auth.users'a trigger olarak attach etmiyor. Bu yüzden
-- yeni kullanıcı signUp olunca profiles row oluşmuyor. KVKK ekranında
-- UPDATE 0 row affected → kullanıcı sonsuz "Kaydediliyor…".
--
-- Bu migration trigger'ı idempotent şekilde attach eder.
-- =====================================================================

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();
