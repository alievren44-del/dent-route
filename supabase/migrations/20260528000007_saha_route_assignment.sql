-- ============================================================================
-- Saha Route Assignment + Notifications
-- ============================================================================
-- 1) saha_routes'a atama kolonları: assigned_to, assigned_by, assignment_note
-- 2) saha_routes.status'a yeni değer: 'assigned' (admin atadı, user kabul bekliyor)
-- 3) saha_notifications tablo (saha-içi bildirimler)
-- 4) RLS: assigned_to user route'u görür/günceller; admin tüm route'lara erişir.
-- ============================================================================

-- 1. saha_routes ALTER
ALTER TABLE public.saha_routes
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignment_note text,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

-- 2. status check genişlet ('assigned' ekle)
ALTER TABLE public.saha_routes DROP CONSTRAINT IF EXISTS saha_routes_status_check;
ALTER TABLE public.saha_routes ADD CONSTRAINT saha_routes_status_check
  CHECK (status IN ('planned','assigned','active','completed','cancelled'));

-- 3. RLS: assigned_to da kendi rota'sını görsün/güncellesin
DROP POLICY IF EXISTS saha_routes_own_select ON public.saha_routes;
CREATE POLICY saha_routes_own_select ON public.saha_routes
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR assigned_to = auth.uid()
    OR saha_is_admin()
  );

DROP POLICY IF EXISTS saha_routes_own_update ON public.saha_routes;
CREATE POLICY saha_routes_own_update ON public.saha_routes
  FOR UPDATE TO authenticated
  USING (
    profile_id = auth.uid()
    OR assigned_to = auth.uid()
    OR saha_is_admin()
  );

-- Admin başkasına atadığında profile_id != auth.uid() olabilir. INSERT policy esnet:
DROP POLICY IF EXISTS saha_routes_own_insert ON public.saha_routes;
CREATE POLICY saha_routes_own_insert ON public.saha_routes
  FOR INSERT TO authenticated
  WITH CHECK (
    (profile_id = auth.uid() AND saha_is_rep_or_admin())
    OR (saha_is_admin() AND assigned_to IS NOT NULL)
  );

-- 4. saha_notifications — tablo 20260528000001'de tanımlandı.
--    Bu migration sadece type CHECK constraint'i genişletir + rep/admin INSERT
--    policy'sini ekler (route assignment akışı için).

-- type CHECK genişlet: route_* tiplerini ekle
ALTER TABLE public.saha_notifications DROP CONSTRAINT IF EXISTS saha_notifications_type_check;
ALTER TABLE public.saha_notifications ADD CONSTRAINT saha_notifications_type_check
  CHECK (type IN (
    'sample_follow_up',
    'order_approval',
    'order_status_change',
    'mileage_reminder',
    'route_assigned',
    'route_note',
    'route_updated',
    'system'
  ));

-- Admin/rep route atama sırasında INSERT yapabilsin (orijinal migration
-- INSERT'i service_role'a bırakmıştı; saha-içi atamada client tarafı yazar).
DROP POLICY IF EXISTS saha_notifications_admin_insert ON public.saha_notifications;
CREATE POLICY saha_notifications_admin_insert ON public.saha_notifications
  FOR INSERT TO authenticated
  WITH CHECK (saha_is_rep_or_admin());

GRANT SELECT, INSERT, UPDATE ON public.saha_notifications TO authenticated;
