-- ============================================================================
-- Saha Navigasyon — saha_clinics Open Edit RLS Migration
-- ============================================================================
-- Tarih      : 2026-06-08
-- Sprint     : Sprint 2 — Phase F (Manual Clinic Edit)
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   Tüm authenticated kullanıcılara saha_clinics üzerinde
--   SELECT / INSERT / UPDATE / DELETE yetkisi açar.
--   Plan kararı 2 (kullanıcı onayı — "tüm kullanıcılar düzenleyebilsin").
--   Audit trail saha_clinic_edit_logs tablosunda tutulur
--   (20260608000002_saha_clinic_edit_logs.sql).
--
-- ÖNCEKİ DURUM:
--   - 20260529000001_saha_clinics.sql sadece "saha_clinics_auth_select" SELECT
--     policy'sini tanımlar (status = 'active' filtresi ile).
--   - INSERT/UPDATE/DELETE policy yoktur → sadece service_role yazabilirdi.
--
-- BU MIGRATION:
--   1. Mevcut SELECT policy'yi düşür ve status filtresi olmadan yeniden kur
--      (UI'dan flagged/closed kayıtları da düzenleyebilmek için).
--   2. INSERT / UPDATE / DELETE policy'leri ekle (auth.uid() IS NOT NULL).
--   3. Defensive: olası eski admin policy isimlerini de DROP IF EXISTS et.
--
-- ÇAKIŞMA KORUMASI: DROP POLICY IF EXISTS + CREATE POLICY. Idempotent değil
-- (CREATE POLICY çakışma atar) — bu yüzden her CREATE öncesi DROP yapıyoruz.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Mevcut/defensive policy'leri düşür
-- ----------------------------------------------------------------------------
-- Asıl mevcut policy:
DROP POLICY IF EXISTS "saha_clinics_auth_select" ON public.saha_clinics;

-- Defensive — plan'da listelenen olası admin policy isimleri (yoksa no-op):
DROP POLICY IF EXISTS saha_clinics_admin_update ON public.saha_clinics;
DROP POLICY IF EXISTS saha_clinics_admin_delete ON public.saha_clinics;
DROP POLICY IF EXISTS saha_clinics_admin_insert ON public.saha_clinics;
DROP POLICY IF EXISTS saha_clinics_admin_all    ON public.saha_clinics;

-- Bu migration tekrar uygulanırsa diye aşağıdaki yenileri de düşür:
DROP POLICY IF EXISTS saha_clinics_authenticated_select ON public.saha_clinics;
DROP POLICY IF EXISTS saha_clinics_authenticated_insert ON public.saha_clinics;
DROP POLICY IF EXISTS saha_clinics_authenticated_update ON public.saha_clinics;
DROP POLICY IF EXISTS saha_clinics_authenticated_delete ON public.saha_clinics;

-- ----------------------------------------------------------------------------
-- 2. Authenticated kullanıcılar için tam CRUD policy'leri
-- ----------------------------------------------------------------------------
CREATE POLICY saha_clinics_authenticated_select ON public.saha_clinics
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY saha_clinics_authenticated_insert ON public.saha_clinics
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY saha_clinics_authenticated_update ON public.saha_clinics
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY saha_clinics_authenticated_delete ON public.saha_clinics
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.saha_clinics'::regclass;
-- 2. anon JWT ile UPDATE denersen reddedilmeli; authenticated kabul edilmeli.
-- ============================================================================
