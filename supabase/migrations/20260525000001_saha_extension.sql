-- ============================================================================
-- Saha Navigasyon — Parla DB Extension Migration
-- ============================================================================
-- Tarih      : 2026-05-25
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Strateji   : ADDITIVE — Parla'nın mevcut profiles/orders/products/rep_visits
--              tablolarına dokunmadan, navigasyon-saha katmanını ekler.
--
-- ÇAKIŞMA KORUMASI: Tüm CREATE'ler `IF NOT EXISTS`, tüm ALTER ADD COLUMN'lar
-- `IF NOT EXISTS`, constraint eklemeleri pg_constraint kontrolü içinde.
-- Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR (Parla'nın halihazırda kurmuş olması gereken tablolar):
--   - public.profiles                          (Parla 001_initial_schema)
--   - public.rep_visits                        (Parla 20260411000002_rep_crm)
--   - public.dealer_clinic_canonical           (Parla 20260518000003)
--   - public.permissions / role_permissions    (Parla 20260502000008_rbac)
--   - public.has_permission(uuid, text)        (Parla 20260502000008_rbac)
--   - public.user_role enum                    (REP, ADMIN, DOCTOR, vb.)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS (PostGIS — yakınlık sorguları için)
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ----------------------------------------------------------------------------
-- 2. profiles ALTER — saha rep'in araç/bölge profili
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avg_fuel_consumption numeric(5,2) DEFAULT 7.0,
  ADD COLUMN IF NOT EXISTS region               text,
  ADD COLUMN IF NOT EXISTS kvkk_accepted_at     timestamptz,
  ADD COLUMN IF NOT EXISTS kvkk_version         text;

COMMENT ON COLUMN public.profiles.avg_fuel_consumption IS
  'Saha rep aracının L/100km tüketimi. Yakıt maliyet tahmini için.';
COMMENT ON COLUMN public.profiles.region IS
  'Bölge etiketi (örn: "Avrupa", "Anadolu"). Manager filter için.';
COMMENT ON COLUMN public.profiles.kvkk_accepted_at IS
  'KVKK aydınlatma metnine ilk kabul zamanı. NULL ise navigasyon login engellenir.';

-- ----------------------------------------------------------------------------
-- 3. rep_visits ALTER — saha modülünün ihtiyaç duyduğu kolonlar
-- ----------------------------------------------------------------------------
-- Parla'da zaten var: rep_id, client_id, visit_type, status, notes,
-- location_lat, location_lng, check_in_at, check_out_at, outcome,
-- follow_up_date, created_at
ALTER TABLE public.rep_visits
  ADD COLUMN IF NOT EXISTS route_id        uuid,
  ADD COLUMN IF NOT EXISTS photos          text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS custom_fields   jsonb  NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS next_action     text,
  ADD COLUMN IF NOT EXISTS next_action_due date,
  ADD COLUMN IF NOT EXISTS check_in_location geography(POINT, 4326);

CREATE INDEX IF NOT EXISTS idx_rep_visits_custom_fields_gin
  ON public.rep_visits USING GIN (custom_fields);
CREATE INDEX IF NOT EXISTS idx_rep_visits_check_in_location
  ON public.rep_visits USING GIST (check_in_location);

-- ----------------------------------------------------------------------------
-- 4. saha_routes — çoklu durak optimize edilmiş rotalar
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_routes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name                text,
  account_ids         text[] NOT NULL,
  status              text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned','active','completed','cancelled')),
  is_recurring        boolean NOT NULL DEFAULT false,
  recurrence_rule     text,
  optimized           boolean NOT NULL DEFAULT false,
  total_distance_km   numeric(8,2),
  total_duration_min  integer,
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_routes IS
  'Saha rep''in planladığı/optimize ettiği rotalar. account_ids = optimize sıralı klinik ID dizisi.';

CREATE INDEX IF NOT EXISTS idx_saha_routes_profile_status
  ON public.saha_routes(profile_id, status);
CREATE INDEX IF NOT EXISTS idx_saha_routes_active
  ON public.saha_routes(profile_id) WHERE status = 'active';

-- rep_visits.route_id FK → saha_routes (kolon önceden eklendi, FK şimdi)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_visits_route_id_fkey'
      AND conrelid = 'public.rep_visits'::regclass
  ) THEN
    ALTER TABLE public.rep_visits
      ADD CONSTRAINT rep_visits_route_id_fkey
      FOREIGN KEY (route_id) REFERENCES public.saha_routes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rep_visits_route ON public.rep_visits(route_id);

-- ----------------------------------------------------------------------------
-- 5. saha_mileage_logs — yakıt/km kayıtları (Mapbox rota mesafesi bazlı)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_mileage_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id           uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  route_id             uuid REFERENCES public.saha_routes(id) ON DELETE SET NULL,
  distance_km          numeric(8,2) NOT NULL,
  duration_min         integer,
  estimated_fuel_l     numeric(8,3),
  estimated_fuel_cost  numeric(10,2),
  log_date             date NOT NULL DEFAULT CURRENT_DATE,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saha_mileage_logs_profile_date
  ON public.saha_mileage_logs(profile_id, log_date DESC);

-- ----------------------------------------------------------------------------
-- 6. saha_sync_queue — offline işlem kuyruğu
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_sync_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation_type  text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','completed','failed')),
  error_message   text,
  retry_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_saha_sync_queue_pending
  ON public.saha_sync_queue(profile_id, status) WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 7. saha_assignments — rep ↔ klinik eşlemesi
--    account_id TEXT — Parla'da klinik = profiles.id (UUID stringi) olabilir,
--    veya dealer_clinic_canonical.id de geçerli. App layer karar verir.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id   text NOT NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  assigned_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (profile_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_saha_assignments_profile
  ON public.saha_assignments(profile_id);
CREATE INDEX IF NOT EXISTS idx_saha_assignments_account
  ON public.saha_assignments(account_id);

-- ----------------------------------------------------------------------------
-- 8. updated_at trigger (Parla'nın set_updated_at fonksiyonu varsa kullan)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) THEN
    -- saha_routes trigger
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'saha_routes_set_updated_at'
    ) THEN
      EXECUTE 'CREATE TRIGGER saha_routes_set_updated_at
        BEFORE UPDATE ON public.saha_routes
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;
  ELSE
    -- Parla'da set_updated_at yoksa kendimiz yaratalım (defansif)
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $func$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $func$;

    EXECUTE 'CREATE TRIGGER saha_routes_set_updated_at
      BEFORE UPDATE ON public.saha_routes
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 9. RLS — saha_* tabloları
--    Strateji: REP rolü kendi kayıtlarını görür/yazar, ADMIN her şeyi görür.
--    Parla'da `has_permission()` ve `profiles.role` kolonu mevcut.
-- ----------------------------------------------------------------------------

-- Yardımcı: aktif kullanıcı saha REP veya ADMIN mi?
CREATE OR REPLACE FUNCTION public.saha_is_rep_or_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('REP', 'ADMIN')
  )
$$;

CREATE OR REPLACE FUNCTION public.saha_is_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  )
$$;

-- saha_routes
ALTER TABLE public.saha_routes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_routes_own_select" ON public.saha_routes;
CREATE POLICY "saha_routes_own_select" ON public.saha_routes
  FOR SELECT USING (profile_id = auth.uid() OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_routes_own_insert" ON public.saha_routes;
CREATE POLICY "saha_routes_own_insert" ON public.saha_routes
  FOR INSERT WITH CHECK (profile_id = auth.uid() AND public.saha_is_rep_or_admin());

DROP POLICY IF EXISTS "saha_routes_own_update" ON public.saha_routes;
CREATE POLICY "saha_routes_own_update" ON public.saha_routes
  FOR UPDATE USING (profile_id = auth.uid() OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_routes_admin_delete" ON public.saha_routes;
CREATE POLICY "saha_routes_admin_delete" ON public.saha_routes
  FOR DELETE USING (public.saha_is_admin());

-- saha_mileage_logs
ALTER TABLE public.saha_mileage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_mileage_own_select" ON public.saha_mileage_logs;
CREATE POLICY "saha_mileage_own_select" ON public.saha_mileage_logs
  FOR SELECT USING (profile_id = auth.uid() OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_mileage_own_insert" ON public.saha_mileage_logs;
CREATE POLICY "saha_mileage_own_insert" ON public.saha_mileage_logs
  FOR INSERT WITH CHECK (profile_id = auth.uid() AND public.saha_is_rep_or_admin());

-- saha_sync_queue
ALTER TABLE public.saha_sync_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_sync_own_all" ON public.saha_sync_queue;
CREATE POLICY "saha_sync_own_all" ON public.saha_sync_queue
  FOR ALL
  USING (profile_id = auth.uid() OR public.saha_is_admin())
  WITH CHECK (profile_id = auth.uid() OR public.saha_is_admin());

-- saha_assignments
ALTER TABLE public.saha_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_assignments_self_select" ON public.saha_assignments;
CREATE POLICY "saha_assignments_self_select" ON public.saha_assignments
  FOR SELECT USING (profile_id = auth.uid() OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_assignments_admin_write" ON public.saha_assignments;
CREATE POLICY "saha_assignments_admin_write" ON public.saha_assignments
  FOR INSERT WITH CHECK (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_assignments_admin_update" ON public.saha_assignments;
CREATE POLICY "saha_assignments_admin_update" ON public.saha_assignments
  FOR UPDATE USING (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_assignments_admin_delete" ON public.saha_assignments;
CREATE POLICY "saha_assignments_admin_delete" ON public.saha_assignments
  FOR DELETE USING (public.saha_is_admin());

-- ----------------------------------------------------------------------------
-- 10. RBAC permission seeds (Parla permissions / role_permissions tablolarına)
--     has_permission(uid, 'saha:*') kontrolü için.
-- ----------------------------------------------------------------------------

INSERT INTO public.permissions (code, description) VALUES
  ('saha:visit:create',     'Saha — Ziyaret oluştur'),
  ('saha:visit:read',       'Saha — Ziyaret oku'),
  ('saha:route:create',     'Saha — Rota oluştur'),
  ('saha:route:read',       'Saha — Rota oku'),
  ('saha:order:create',     'Saha — Sipariş oluştur'),
  ('saha:assignment:read',  'Saha — Kendi atamalarını gör'),
  ('saha:assignment:write', 'Saha — Atama yönet'),
  ('saha:admin',            'Saha — Tüm rotalar/ziyaretler/heatmap')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_code) VALUES
  ('REP',   'saha:visit:create'),
  ('REP',   'saha:visit:read'),
  ('REP',   'saha:route:create'),
  ('REP',   'saha:route:read'),
  ('REP',   'saha:order:create'),
  ('REP',   'saha:assignment:read'),
  ('ADMIN', 'saha:visit:create'),
  ('ADMIN', 'saha:visit:read'),
  ('ADMIN', 'saha:route:create'),
  ('ADMIN', 'saha:route:read'),
  ('ADMIN', 'saha:order:create'),
  ('ADMIN', 'saha:assignment:read'),
  ('ADMIN', 'saha:assignment:write'),
  ('ADMIN', 'saha:admin')
ON CONFLICT DO NOTHING;

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT * FROM saha_routes LIMIT 1;
-- 2. SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'rep_visits' AND column_name IN ('route_id','photos','custom_fields');
-- 3. SELECT * FROM permissions WHERE code LIKE 'saha:%';
-- 4. SELECT * FROM role_permissions WHERE permission_code LIKE 'saha:%';
-- ============================================================================
