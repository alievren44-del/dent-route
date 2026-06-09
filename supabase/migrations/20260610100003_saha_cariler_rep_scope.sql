-- ============================================================================
-- 20260610100003_saha_cariler_rep_scope.sql
-- ----------------------------------------------------------------------------
-- SORUN: "saha_cariler_rep_select" policy USING (saha_is_rep_or_admin() OR
--   saha_is_manager_or_admin()) → her REP tüm cariyi okuyabilir.
--   Çapraz-rep veri sızıntısı riski.
--
-- FIX: REP sadece kendi sales_rep_id'li carileri görür.
--   ADMIN ve MANAGER tüm carileri görür (işletme ihtiyacı).
--
-- BAĞIMLILIKLAR:
--   - saha_cariler.sales_rep_id kolonu (20260603000003_saha_cari_sales_rep.sql)
--   - public.saha_is_admin() (20260525000001_saha_extension.sql)
--   - public.saha_is_manager_or_admin() (20260603000001_saha_invoicing.sql)
--
-- Idempotent: DROP POLICY IF EXISTS + CREATE POLICY.
-- Diğer cariler policy (INSERT/UPDATE/DELETE) değiştirilmez.
-- ============================================================================

BEGIN;

-- Eski geniş SELECT policy DROP
DROP POLICY IF EXISTS "saha_cariler_rep_select" ON public.saha_cariler;

-- Yeni dar SELECT policy: REP → sadece kendi sales_rep_id carileri
--                         ADMIN/MANAGER → tümü
CREATE POLICY "saha_cariler_rep_select" ON public.saha_cariler
  FOR SELECT
  USING (
    sales_rep_id = auth.uid()
    OR public.saha_is_admin()
    OR public.saha_is_manager_or_admin()
  );

-- Not: post_order_to_cash SECURITY DEFINER → RLS bypass → cari yarat/bul
-- işlemleri etkilenmez (doğru davranış).

COMMIT;
