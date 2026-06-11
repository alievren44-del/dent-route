-- ============================================================================
-- DRAFT — saha_rep_regions helper function
-- ============================================================================
-- Tarih        : 2026-06-12
-- Hedef DB     : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Durum        : DRAFT — MCP apply_migration YOK. Opus inceleyip uygulayacak.
--
-- ROLLBACK NOTU:
--   DROP FUNCTION IF EXISTS public.saha_rep_regions(uuid);
--   CREATE OR REPLACE kullanıldığından güvenli geri alma: yukarıdaki DROP yeterli.
--
-- ============================================================================
-- DOĞRULANACAK VARSAYIMLAR (apply öncesi Opus kontrol etmeli):
-- 1. saha_assignments.profile_id UUID — rep'i bağlayan kolon (profiles.id).
--    Tablo DDL: profile_id uuid NOT NULL REFERENCES public.profiles(id).
--    (ConfirmED: 20260525000001_saha_extension.sql:153)
-- 2. '__region_meta__' sentinel account_id — bölge meta satırını ayırt eder.
--    Bu fonksiyon SADECE sentinel satırı okur; account_id = '__region_meta__'
--    olan satırda region_provinces/region_districts bölge tanımını taşır.
--    Sentinel satır yoksa (henüz atama yapılmamış rep) boş array döner.
-- 3. STABLE + SECURITY INVOKER + search_path = public, pg_temp — RLS policy
--    içinden çağrılabilir; caller'ın row-level güvenliği geçerli kalır.
--    NOT: SECURITY DEFINER DEĞİL — rep kendi bölgesini okuyabilir çünkü
--    saha_assignments RLS policy'si zaten profile_id = auth.uid() izin verir.
-- 4. GRANT EXECUTE TO authenticated — sadece giriş yapmış kullanıcılar çağırabilir.
-- ============================================================================

-- Sentinel sabit — RegionAssignmentPage ile senkron olmalı
-- (TS: const REGION_META_ACCOUNT_ID = '__region_meta__')
-- Değiştirilirse her iki yerde güncellenmeli.

CREATE OR REPLACE FUNCTION public.saha_rep_regions(uid uuid)
RETURNS TABLE(provinces text[], districts text[])
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    sa.region_provinces  AS provinces,
    sa.region_districts  AS districts
  FROM public.saha_assignments sa
  WHERE sa.profile_id = uid
    AND sa.account_id  = '__region_meta__'
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.saha_rep_regions(uuid) IS
  'Bir rep''in (profile_id=uid) bölge tanımını döndürür: '
  'saha_assignments içindeki __region_meta__ sentinel satırından region_provinces/districts okunur. '
  'Sentinel satır yoksa 0 satır döner (rep''e bölge atanmamış). '
  'STABLE + SECURITY INVOKER — RLS policy içinde kullanılabilir.';

GRANT EXECUTE ON FUNCTION public.saha_rep_regions(uuid) TO authenticated;

-- ============================================================================
-- KULLANIM ÖRNEĞİ (client veya RLS policy içinde):
--
--   -- Tüm bölge bilgisini al:
--   SELECT * FROM public.saha_rep_regions(auth.uid());
--
--   -- Provinces dizisini al:
--   SELECT provinces FROM public.saha_rep_regions(auth.uid());
--
--   -- Belirli il atanmış mı?
--   SELECT 'ankara' = ANY(provinces)
--   FROM public.saha_rep_regions(auth.uid());
--
-- NOT: Client-side soft filter için (Parça C) Supabase JS SDK ile çağrı:
--   const { data } = await supabase.rpc('saha_rep_regions', { uid: userId });
-- ============================================================================
