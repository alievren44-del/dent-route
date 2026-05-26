-- ============================================================================
-- Saha App v1.0 - Initial Schema Migration
-- ============================================================================
-- Created: 2026-05-20
-- 
-- Bu migration iki katmanlı şemayı oluşturur:
--   - Built-in CRM (sadece config.crm.type='supabase' modunda kullanılır)
--   - Saha Layer (her zaman var, adapter bağımsız)
--
-- Çalıştırma: supabase db push
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "postgis";        -- coğrafi sorgular

-- ----------------------------------------------------------------------------
-- 2. HELPER FUNCTIONS (önce yardımcılar; tablolar bunlara bağımlı değil)
-- ----------------------------------------------------------------------------

-- Otomatik updated_at güncelleyici
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. SAHA LAYER — PROFILES (her zaman var)
-- ----------------------------------------------------------------------------

CREATE TABLE public.profiles (
  id                    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name             TEXT NOT NULL,
  email                 TEXT,
  phone                 TEXT,
  role                  TEXT NOT NULL DEFAULT 'sales_rep'
                          CHECK (role IN ('sales_rep', 'manager', 'admin')),
  region                TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  avg_fuel_consumption  NUMERIC(5,2) DEFAULT 7.0,  -- L/100km
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Otomatik profile oluştur (yeni auth user için)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 4. ROLE HELPER FUNCTIONS (RLS politikaları bunlara bağlı)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auth_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.auth_user_role() = 'admin'
$$;

CREATE OR REPLACE FUNCTION public.is_manager_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.auth_user_role() IN ('manager', 'admin')
$$;

CREATE OR REPLACE FUNCTION public.my_region()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT region FROM public.profiles WHERE id = auth.uid()
$$;

-- ----------------------------------------------------------------------------
-- 5. BUILT-IN CRM LAYER — ACCOUNTS
-- ----------------------------------------------------------------------------

CREATE TABLE public.accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT,
  name          TEXT NOT NULL,
  type          TEXT,                              -- vertical template'in customerTypes anahtarı (validation app layer'da)
  tax_id        TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  email         TEXT,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'inactive', 'prospect')),
  region        TEXT,                              -- manager filter için
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb, -- vertical template'in customFields'ından
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- custom_fields üzerinde JSONB GIN index (özel alan sorgulamak için)
CREATE INDEX idx_accounts_custom_fields_gin ON public.accounts USING GIN (custom_fields);

CREATE TRIGGER accounts_set_updated_at
  BEFORE UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_accounts_status ON public.accounts(status);
CREATE INDEX idx_accounts_region ON public.accounts(region);
CREATE INDEX idx_accounts_external_id ON public.accounts(external_id) WHERE external_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. ACCOUNT ADDRESSES (PostGIS)
-- ----------------------------------------------------------------------------

CREATE TABLE public.account_addresses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  label             TEXT DEFAULT 'primary',
  address_line      TEXT NOT NULL,
  district          TEXT,
  city              TEXT,
  postal_code       TEXT,
  country           TEXT DEFAULT 'TR',
  location          GEOGRAPHY(POINT, 4326),
  google_place_id   TEXT,
  is_primary        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_addresses_location 
  ON public.account_addresses USING GIST (location);
CREATE INDEX idx_account_addresses_account 
  ON public.account_addresses(account_id);
CREATE UNIQUE INDEX idx_account_addresses_google_place 
  ON public.account_addresses(google_place_id) 
  WHERE google_place_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 7. ACCOUNT CONTACTS
-- ----------------------------------------------------------------------------

CREATE TABLE public.account_contacts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  title         TEXT,
  phone         TEXT,
  whatsapp      TEXT,
  email         TEXT,
  is_primary    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_contacts_account ON public.account_contacts(account_id);

-- ----------------------------------------------------------------------------
-- 8. PRODUCTS
-- ----------------------------------------------------------------------------

CREATE TABLE public.products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     TEXT,
  sku             TEXT UNIQUE,
  name            TEXT NOT NULL,
  description     TEXT,
  category        TEXT,
  unit            TEXT NOT NULL DEFAULT 'adet',
  base_price      NUMERIC(12,2),
  currency        TEXT NOT NULL DEFAULT 'TRY',
  vat_rate        NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  stock_quantity  NUMERIC(12,3),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  image_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_products_active ON public.products(is_active);
CREATE INDEX idx_products_category ON public.products(category);

-- ----------------------------------------------------------------------------
-- 9. ACCOUNT PRICES (müşteri özel fiyat)
-- ----------------------------------------------------------------------------

CREATE TABLE public.account_prices (
  account_id    UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price         NUMERIC(12,2) NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'TRY',
  valid_from    DATE,
  valid_until   DATE,
  PRIMARY KEY (account_id, product_id)
);

-- ----------------------------------------------------------------------------
-- 10. CAMPAIGNS
-- ----------------------------------------------------------------------------

CREATE TABLE public.campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  description           TEXT,
  discount_type         TEXT CHECK (discount_type IN ('percent', 'fixed', 'buy_x_get_y')),
  discount_value        NUMERIC(10,2),
  conditions            JSONB,
  starts_at             TIMESTAMPTZ,
  ends_at               TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  applies_to_products   UUID[],
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_active 
  ON public.campaigns(is_active, ends_at) 
  WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 11. ROUTES (Saha Layer — visits'ten önce çünkü visits.route_id referans verir)
-- ----------------------------------------------------------------------------

CREATE TABLE public.routes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name                  TEXT,
  account_ids           TEXT[] NOT NULL,
  status                TEXT NOT NULL DEFAULT 'planned'
                          CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  is_recurring          BOOLEAN NOT NULL DEFAULT FALSE,
  recurrence_rule       TEXT,  -- RFC 5545 RRULE
  optimized             BOOLEAN NOT NULL DEFAULT FALSE,
  total_distance_km     NUMERIC(8,2),
  total_duration_min    INTEGER,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER routes_set_updated_at
  BEFORE UPDATE ON public.routes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_routes_profile_status ON public.routes(profile_id, status);
CREATE INDEX idx_routes_active 
  ON public.routes(profile_id) 
  WHERE status = 'active';

-- ----------------------------------------------------------------------------
-- 12. VISITS (Saha Layer)
-- ----------------------------------------------------------------------------

CREATE TABLE public.visits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id            TEXT NOT NULL,  -- TEXT: hem UUID hem external ID
  route_id              UUID REFERENCES public.routes(id) ON DELETE SET NULL,
  checked_in_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checked_out_at        TIMESTAMPTZ,
  check_in_location     GEOGRAPHY(POINT, 4326),
  outcome               TEXT,                                       -- vertical template'in visitOutcomes anahtarı (validation app layer'da)
  notes                 TEXT,
  photos                TEXT[] NOT NULL DEFAULT '{}',
  next_action           TEXT,
  next_action_due       DATE,
  custom_fields         JSONB NOT NULL DEFAULT '{}'::jsonb,         -- vertical template'in visitCustomFields'ından
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_visits_profile ON public.visits(profile_id);
CREATE INDEX idx_visits_account ON public.visits(account_id);
CREATE INDEX idx_visits_route ON public.visits(route_id);
CREATE INDEX idx_visits_checked_in ON public.visits(checked_in_at DESC);

-- ----------------------------------------------------------------------------
-- 13. ASSIGNMENTS
-- ----------------------------------------------------------------------------

CREATE TABLE public.assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id    TEXT NOT NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (profile_id, account_id)
);

CREATE INDEX idx_assignments_profile ON public.assignments(profile_id);
CREATE INDEX idx_assignments_account ON public.assignments(account_id);

-- Yardımcı: mevcut kullanıcının atanmış account_id listesi
CREATE OR REPLACE FUNCTION public.my_assigned_accounts()
RETURNS SETOF TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT account_id FROM public.assignments WHERE profile_id = auth.uid()
$$;

-- ----------------------------------------------------------------------------
-- 14. ORDERS
-- ----------------------------------------------------------------------------

CREATE TABLE public.orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id       TEXT,
  account_id        UUID NOT NULL REFERENCES public.accounts(id),
  created_by        UUID NOT NULL REFERENCES public.profiles(id),
  visit_id          UUID REFERENCES public.visits(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('draft', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  total_amount      NUMERIC(12,2),
  currency          TEXT NOT NULL DEFAULT 'TRY',
  notes             TEXT,
  idempotency_key   TEXT UNIQUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_orders_account ON public.orders(account_id);
CREATE INDEX idx_orders_created_by ON public.orders(created_by);
CREATE INDEX idx_orders_status ON public.orders(status);
CREATE INDEX idx_orders_visit ON public.orders(visit_id);

-- ----------------------------------------------------------------------------
-- 15. ORDER ITEMS
-- ----------------------------------------------------------------------------

CREATE TABLE public.order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES public.products(id),
  product_sku       TEXT,
  product_name      TEXT NOT NULL,
  quantity          NUMERIC(12,3) NOT NULL,
  unit_price        NUMERIC(12,2) NOT NULL,
  discount_amount   NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat_rate          NUMERIC(5,2) NOT NULL DEFAULT 20.0,
  line_total        NUMERIC(12,2) GENERATED ALWAYS AS ((quantity * unit_price) - discount_amount) STORED,
  campaign_id       UUID REFERENCES public.campaigns(id) ON DELETE SET NULL
);

CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_product ON public.order_items(product_id);

-- ----------------------------------------------------------------------------
-- 16. PAYMENTS (gelecek için hazır)
-- ----------------------------------------------------------------------------

CREATE TABLE public.payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES public.accounts(id),
  amount          NUMERIC(12,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'TRY',
  payment_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  method          TEXT,
  reference       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_account ON public.payments(account_id);

-- ----------------------------------------------------------------------------
-- 17. MILEAGE LOGS
-- ----------------------------------------------------------------------------

CREATE TABLE public.mileage_logs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  route_id                UUID REFERENCES public.routes(id) ON DELETE SET NULL,
  distance_km             NUMERIC(8,2) NOT NULL,
  duration_min            INTEGER,
  estimated_fuel_l        NUMERIC(8,3),
  estimated_fuel_cost     NUMERIC(10,2),
  log_date                DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mileage_logs_profile_date ON public.mileage_logs(profile_id, log_date DESC);

-- ----------------------------------------------------------------------------
-- 18. ACCOUNT NOTES
-- ----------------------------------------------------------------------------

CREATE TABLE public.account_notes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    TEXT NOT NULL,
  profile_id    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  note          TEXT NOT NULL,
  pinned        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_notes_account ON public.account_notes(account_id);
CREATE INDEX idx_account_notes_pinned 
  ON public.account_notes(account_id, pinned) 
  WHERE pinned = TRUE;

-- ----------------------------------------------------------------------------
-- 19. SYNC QUEUE (offline mod)
-- ----------------------------------------------------------------------------

CREATE TABLE public.sync_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  operation_type    TEXT NOT NULL,
  payload           JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message     TEXT,
  retry_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);

CREATE INDEX idx_sync_queue_pending 
  ON public.sync_queue(profile_id, status) 
  WHERE status = 'pending';

-- ----------------------------------------------------------------------------
-- 20. ACCOUNT BALANCES VIEW
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.account_balances AS
SELECT
  a.id AS account_id,
  COALESCE(orders_sum.total, 0) AS total_orders,
  COALESCE(payments_sum.total, 0) AS total_paid,
  COALESCE(orders_sum.total, 0) - COALESCE(payments_sum.total, 0) AS balance,
  GREATEST(orders_sum.last_at, payments_sum.last_at) AS last_movement_at
FROM public.accounts a
LEFT JOIN (
  SELECT account_id, SUM(total_amount) AS total, MAX(updated_at) AS last_at
  FROM public.orders
  WHERE status IN ('confirmed', 'shipped', 'delivered')
  GROUP BY account_id
) orders_sum ON orders_sum.account_id = a.id
LEFT JOIN (
  SELECT account_id, SUM(amount) AS total, MAX(created_at) AS last_at
  FROM public.payments
  GROUP BY account_id
) payments_sum ON payments_sum.account_id = a.id;

-- ----------------------------------------------------------------------------
-- 21. RLS — Enable on all tables
-- ----------------------------------------------------------------------------

ALTER TABLE public.profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_addresses   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_prices      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mileage_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_queue          ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 22. RLS POLICIES — profiles
-- ----------------------------------------------------------------------------

CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_manager_or_admin());

CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE USING (id = auth.uid() OR public.is_admin());

CREATE POLICY "profiles_all_admin" ON public.profiles
  FOR ALL USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 23. RLS POLICIES — accounts
-- ----------------------------------------------------------------------------

CREATE POLICY "accounts_select_assigned" ON public.accounts
  FOR SELECT USING (
    public.is_admin()
    OR (public.is_manager_or_admin() AND region = public.my_region())
    OR id::TEXT IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "accounts_all_admin" ON public.accounts
  FOR ALL USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 24. RLS POLICIES — account_addresses, account_contacts, account_prices, account_notes
-- ----------------------------------------------------------------------------

CREATE POLICY "account_addresses_select" ON public.account_addresses
  FOR SELECT USING (
    public.is_admin()
    OR account_id::TEXT IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "account_addresses_all_admin" ON public.account_addresses
  FOR ALL USING (public.is_admin());

CREATE POLICY "account_contacts_select" ON public.account_contacts
  FOR SELECT USING (
    public.is_admin()
    OR account_id::TEXT IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "account_contacts_all_admin" ON public.account_contacts
  FOR ALL USING (public.is_admin());

CREATE POLICY "account_prices_select" ON public.account_prices
  FOR SELECT USING (
    public.is_admin()
    OR account_id::TEXT IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "account_prices_all_admin" ON public.account_prices
  FOR ALL USING (public.is_admin());

CREATE POLICY "account_notes_select" ON public.account_notes
  FOR SELECT USING (
    public.is_admin()
    OR public.is_manager_or_admin()
    OR account_id IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "account_notes_insert_own" ON public.account_notes
  FOR INSERT WITH CHECK (
    profile_id = auth.uid()
    AND account_id IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "account_notes_update_own" ON public.account_notes
  FOR UPDATE USING (profile_id = auth.uid() OR public.is_admin());

CREATE POLICY "account_notes_delete_admin" ON public.account_notes
  FOR DELETE USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 25. RLS POLICIES — products, campaigns (herkes okur, admin yazar)
-- ----------------------------------------------------------------------------

CREATE POLICY "products_select_all" ON public.products
  FOR SELECT USING (TRUE);

CREATE POLICY "products_all_admin" ON public.products
  FOR ALL USING (public.is_admin());

CREATE POLICY "campaigns_select_active" ON public.campaigns
  FOR SELECT USING (is_active OR public.is_manager_or_admin());

CREATE POLICY "campaigns_all_admin" ON public.campaigns
  FOR ALL USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 26. RLS POLICIES — routes
-- ----------------------------------------------------------------------------

CREATE POLICY "routes_select_own_or_manager" ON public.routes
  FOR SELECT USING (
    profile_id = auth.uid()
    OR public.is_admin()
    OR (public.is_manager_or_admin() AND EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = routes.profile_id 
      AND p.region = public.my_region()
    ))
  );

CREATE POLICY "routes_insert_own" ON public.routes
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "routes_update_own" ON public.routes
  FOR UPDATE USING (profile_id = auth.uid() OR public.is_admin());

CREATE POLICY "routes_delete_own" ON public.routes
  FOR DELETE USING (profile_id = auth.uid() OR public.is_admin());

-- ----------------------------------------------------------------------------
-- 27. RLS POLICIES — visits
-- ----------------------------------------------------------------------------

CREATE POLICY "visits_select_own_or_manager" ON public.visits
  FOR SELECT USING (
    profile_id = auth.uid()
    OR public.is_admin()
    OR (public.is_manager_or_admin() AND EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = visits.profile_id 
      AND p.region = public.my_region()
    ))
  );

CREATE POLICY "visits_insert_own" ON public.visits
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "visits_update_own" ON public.visits
  FOR UPDATE USING (profile_id = auth.uid() OR public.is_admin());

CREATE POLICY "visits_delete_admin" ON public.visits
  FOR DELETE USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 28. RLS POLICIES — assignments
-- ----------------------------------------------------------------------------

CREATE POLICY "assignments_select_own_or_manager" ON public.assignments
  FOR SELECT USING (
    profile_id = auth.uid() 
    OR public.is_manager_or_admin()
  );

CREATE POLICY "assignments_all_admin" ON public.assignments
  FOR ALL USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 29. RLS POLICIES — orders, order_items
-- ----------------------------------------------------------------------------

CREATE POLICY "orders_select_own_or_manager" ON public.orders
  FOR SELECT USING (
    created_by = auth.uid()
    OR public.is_admin()
    OR (public.is_manager_or_admin() AND EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = orders.created_by 
      AND p.region = public.my_region()
    ))
  );

CREATE POLICY "orders_insert_own" ON public.orders
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND account_id::TEXT IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "orders_update_own_draft" ON public.orders
  FOR UPDATE USING (
    (created_by = auth.uid() AND status IN ('draft', 'pending'))
    OR public.is_admin()
  );

CREATE POLICY "order_items_select" ON public.order_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.orders o 
      WHERE o.id = order_items.order_id 
      AND (o.created_by = auth.uid() OR public.is_manager_or_admin())
    )
  );

CREATE POLICY "order_items_insert" ON public.order_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.orders o 
      WHERE o.id = order_items.order_id 
      AND o.created_by = auth.uid()
    )
  );

CREATE POLICY "order_items_all_admin" ON public.order_items
  FOR ALL USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 30. RLS POLICIES — payments
-- ----------------------------------------------------------------------------

CREATE POLICY "payments_select_assigned_or_manager" ON public.payments
  FOR SELECT USING (
    public.is_manager_or_admin()
    OR account_id::TEXT IN (SELECT public.my_assigned_accounts())
  );

CREATE POLICY "payments_all_admin" ON public.payments
  FOR ALL USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 31. RLS POLICIES — mileage_logs
-- ----------------------------------------------------------------------------

CREATE POLICY "mileage_logs_select_own_or_manager" ON public.mileage_logs
  FOR SELECT USING (
    profile_id = auth.uid()
    OR public.is_admin()
    OR (public.is_manager_or_admin() AND EXISTS (
      SELECT 1 FROM public.profiles p 
      WHERE p.id = mileage_logs.profile_id 
      AND p.region = public.my_region()
    ))
  );

CREATE POLICY "mileage_logs_insert_own" ON public.mileage_logs
  FOR INSERT WITH CHECK (profile_id = auth.uid());

CREATE POLICY "mileage_logs_all_admin" ON public.mileage_logs
  FOR ALL USING (public.is_admin());

-- ----------------------------------------------------------------------------
-- 32. RLS POLICIES — sync_queue
-- ----------------------------------------------------------------------------

CREATE POLICY "sync_queue_own_only" ON public.sync_queue
  FOR ALL USING (profile_id = auth.uid() OR public.is_admin());

-- ----------------------------------------------------------------------------
-- DONE
-- ----------------------------------------------------------------------------
-- Bu migration tamamlandığında:
--   * 15 tablo + 1 view oluşturuldu
--   * Tüm tablolarda RLS aktif
--   * PostGIS spatial index'ler kuruldu
--   * Role helper fonksiyonlar kullanılabilir
--   * Otomatik profile oluşturma trigger'ı aktif
-- ----------------------------------------------------------------------------
