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

-- 4. saha_notifications
CREATE TABLE IF NOT EXISTS public.saha_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('route_assigned','route_note','route_updated','system')),
  title text NOT NULL,
  message text,
  data jsonb DEFAULT '{}'::jsonb,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saha_notifications_user_unread
  ON public.saha_notifications (user_id, is_read, created_at DESC);

ALTER TABLE public.saha_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY saha_notifications_own_select ON public.saha_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR saha_is_admin());

CREATE POLICY saha_notifications_own_update ON public.saha_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR saha_is_admin());

CREATE POLICY saha_notifications_admin_insert ON public.saha_notifications
  FOR INSERT TO authenticated
  WITH CHECK (saha_is_rep_or_admin());

GRANT SELECT, INSERT, UPDATE ON public.saha_notifications TO authenticated;
