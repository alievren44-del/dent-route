-- ============================================================================
-- Saha Navigasyon — Sampling (Numune Yönetimi) Migration
-- ============================================================================
-- Tarih      : 2026-05-27
-- Sprint     : Sprint 5.5 — Saha-native cross-vertical sample tracking
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Amaç       :
--   DentRoute Prompt 14 port'u — Numune verme/takip/dönüşüm workflow'unun
--   Saha-native, cross-vertical (dental + pharmacy + future verticals)
--   karşılığı. 5 yeni tablo:
--     1. saha_samples            (ana numune kaydı)
--     2. saha_sample_lines       (numune satırları — çoklu ürün)
--     3. saha_sample_quotas      (rep aylık bütçe)
--     4. saha_sample_policies    (vertical+kategori admin override)
--     5. saha_blacklist          (numune avcı kara listesi)
--
-- ÇAKIŞMA KORUMASI: CREATE TABLE IF NOT EXISTS, DO blocks FK guard'ları,
-- DROP POLICY IF EXISTS. Idempotent — birden fazla `db push` güvenli.
--
-- BAĞIMLILIKLAR:
--   - public.profiles                          (Parla 001_initial_schema)
--   - public.accounts                          (Parla CRM — defensive FK)
--   - public.set_updated_at()                  (20260525000001_saha_extension.sql)
--   - public.saha_is_admin()                   (20260525000001_saha_extension.sql)
--   - public.saha_is_rep_or_admin()            (20260525000001_saha_extension.sql)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_samples — ana numune kaydı
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_samples (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL,
  rep_id                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  given_at              timestamptz NOT NULL DEFAULT now(),
  follow_up_at          timestamptz NOT NULL,
  status                text NOT NULL DEFAULT 'verildi'
                          CHECK (status IN ('verildi','denendi','donusturuldu','red','kayip','iade')),
  converted_order_id    uuid,
  photo_url             text,
  signature_url         text,
  kvkk_consent_version  text NOT NULL,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_samples IS
  'Saha-native numune kayıtları. Cross-vertical (dental/pharmacy/diğer). given_at→follow_up_at default +14 gün (client tarafında hesaplanır). status workflow: verildi→denendi→donusturuldu|red|kayip|iade.';

CREATE INDEX IF NOT EXISTS idx_saha_samples_rep_given
  ON public.saha_samples(rep_id, given_at DESC);
CREATE INDEX IF NOT EXISTS idx_saha_samples_account_given
  ON public.saha_samples(account_id, given_at DESC);
CREATE INDEX IF NOT EXISTS idx_saha_samples_status_followup
  ON public.saha_samples(status, follow_up_at);
CREATE INDEX IF NOT EXISTS idx_saha_samples_account
  ON public.saha_samples(account_id);

-- accounts FK — defensive (Parla CRM'inde accounts olmayabilir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'accounts'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saha_samples_account_id_fkey'
      AND conrelid = 'public.saha_samples'::regclass
  ) THEN
    ALTER TABLE public.saha_samples
      ADD CONSTRAINT saha_samples_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. saha_sample_lines — numune satırları (bir numunede çoklu ürün)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_sample_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id     uuid NOT NULL REFERENCES public.saha_samples(id) ON DELETE CASCADE,
  product_id    uuid,
  product_name  text NOT NULL,
  qty           numeric(10,3) NOT NULL,
  unit          text NOT NULL DEFAULT 'adet',
  unit_cost_tl  numeric(10,2),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_sample_lines IS
  'Bir numune kaydına bağlı ürün satırları. product_id Parla products.id (nullable — schema farklı verticallerde değişir). product_name snapshot.';

CREATE INDEX IF NOT EXISTS idx_saha_sample_lines_sample
  ON public.saha_sample_lines(sample_id);

-- ----------------------------------------------------------------------------
-- 3. saha_sample_quotas — rep aylık bütçe
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_sample_quotas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year_month  text NOT NULL,
  budget_tl   numeric(10,2) NOT NULL DEFAULT 0,
  spent_tl    numeric(10,2) NOT NULL DEFAULT 0,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rep_id, year_month)
);

COMMENT ON TABLE public.saha_sample_quotas IS
  'Rep başına aylık numune bütçesi (TL). year_month "YYYY-MM" formatında. spent_tl uygulama tarafında trigger-free güncellenir.';

-- ----------------------------------------------------------------------------
-- 4. saha_sample_policies — vertical+kategori admin override
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_sample_policies (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertical_key            text NOT NULL,
  product_category_key    text NOT NULL,
  max_per_account_yearly  integer NOT NULL DEFAULT 999,
  cooldown_days           integer NOT NULL DEFAULT 0,
  min_conversion_pct      integer NOT NULL DEFAULT 0,
  created_by              uuid REFERENCES public.profiles(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vertical_key, product_category_key)
);

COMMENT ON TABLE public.saha_sample_policies IS
  'Vertical + kategori bazlı numune politika override. verticals/*.json default değerleri burada admin tarafından override edilebilir.';

-- ----------------------------------------------------------------------------
-- 5. saha_blacklist — numune avcı kara listesi
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_blacklist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL,
  reason        text NOT NULL,
  banned_until  timestamptz,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

COMMENT ON TABLE public.saha_blacklist IS
  'Numune avcısı (hunter) tespit edilmiş account kara listesi. banned_until NULL → süresiz ban. Rep numune verirken UI tarafında kontrol edilir.';

CREATE INDEX IF NOT EXISTS idx_saha_blacklist_banned_until
  ON public.saha_blacklist(banned_until);

-- accounts FK — defensive
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'accounts'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saha_blacklist_account_id_fkey'
      AND conrelid = 'public.saha_blacklist'::regclass
  ) THEN
    ALTER TABLE public.saha_blacklist
      ADD CONSTRAINT saha_blacklist_account_id_fkey
      FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. updated_at trigger'ları (public.set_updated_at — Sprint 1)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'saha_samples_set_updated_at'
    ) THEN
      EXECUTE 'CREATE TRIGGER saha_samples_set_updated_at
        BEFORE UPDATE ON public.saha_samples
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'saha_sample_quotas_set_updated_at'
    ) THEN
      EXECUTE 'CREATE TRIGGER saha_sample_quotas_set_updated_at
        BEFORE UPDATE ON public.saha_sample_quotas
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger WHERE tgname = 'saha_sample_policies_set_updated_at'
    ) THEN
      EXECUTE 'CREATE TRIGGER saha_sample_policies_set_updated_at
        BEFORE UPDATE ON public.saha_sample_policies
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. RLS — tüm tablolar için enable + policy
-- ----------------------------------------------------------------------------

-- saha_samples ------------------------------------------------------------
ALTER TABLE public.saha_samples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_samples_own_select" ON public.saha_samples;
CREATE POLICY "saha_samples_own_select" ON public.saha_samples
  FOR SELECT USING (auth.uid() = rep_id OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_samples_own_insert" ON public.saha_samples;
CREATE POLICY "saha_samples_own_insert" ON public.saha_samples
  FOR INSERT WITH CHECK (auth.uid() = rep_id AND public.saha_is_rep_or_admin());

DROP POLICY IF EXISTS "saha_samples_own_update" ON public.saha_samples;
CREATE POLICY "saha_samples_own_update" ON public.saha_samples
  FOR UPDATE USING (auth.uid() = rep_id OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_samples_admin_delete" ON public.saha_samples;
CREATE POLICY "saha_samples_admin_delete" ON public.saha_samples
  FOR DELETE USING (public.saha_is_admin());

-- saha_sample_lines -------------------------------------------------------
ALTER TABLE public.saha_sample_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_sample_lines_parent_select" ON public.saha_sample_lines;
CREATE POLICY "saha_sample_lines_parent_select" ON public.saha_sample_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.saha_samples s
      WHERE s.id = saha_sample_lines.sample_id
        AND (s.rep_id = auth.uid() OR public.saha_is_admin())
    )
  );

DROP POLICY IF EXISTS "saha_sample_lines_parent_insert" ON public.saha_sample_lines;
CREATE POLICY "saha_sample_lines_parent_insert" ON public.saha_sample_lines
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.saha_samples s
      WHERE s.id = saha_sample_lines.sample_id
        AND (s.rep_id = auth.uid() OR public.saha_is_admin())
    )
  );

DROP POLICY IF EXISTS "saha_sample_lines_parent_update" ON public.saha_sample_lines;
CREATE POLICY "saha_sample_lines_parent_update" ON public.saha_sample_lines
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM public.saha_samples s
      WHERE s.id = saha_sample_lines.sample_id
        AND (s.rep_id = auth.uid() OR public.saha_is_admin())
    )
  );

DROP POLICY IF EXISTS "saha_sample_lines_admin_delete" ON public.saha_sample_lines;
CREATE POLICY "saha_sample_lines_admin_delete" ON public.saha_sample_lines
  FOR DELETE USING (public.saha_is_admin());

-- saha_sample_quotas ------------------------------------------------------
ALTER TABLE public.saha_sample_quotas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_sample_quotas_own_select" ON public.saha_sample_quotas;
CREATE POLICY "saha_sample_quotas_own_select" ON public.saha_sample_quotas
  FOR SELECT USING (auth.uid() = rep_id OR public.saha_is_admin());

DROP POLICY IF EXISTS "saha_sample_quotas_admin_insert" ON public.saha_sample_quotas;
CREATE POLICY "saha_sample_quotas_admin_insert" ON public.saha_sample_quotas
  FOR INSERT WITH CHECK (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_sample_quotas_admin_update" ON public.saha_sample_quotas;
CREATE POLICY "saha_sample_quotas_admin_update" ON public.saha_sample_quotas
  FOR UPDATE USING (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_sample_quotas_admin_delete" ON public.saha_sample_quotas;
CREATE POLICY "saha_sample_quotas_admin_delete" ON public.saha_sample_quotas
  FOR DELETE USING (public.saha_is_admin());

-- saha_sample_policies ----------------------------------------------------
ALTER TABLE public.saha_sample_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_sample_policies_auth_select" ON public.saha_sample_policies;
CREATE POLICY "saha_sample_policies_auth_select" ON public.saha_sample_policies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "saha_sample_policies_admin_insert" ON public.saha_sample_policies;
CREATE POLICY "saha_sample_policies_admin_insert" ON public.saha_sample_policies
  FOR INSERT WITH CHECK (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_sample_policies_admin_update" ON public.saha_sample_policies;
CREATE POLICY "saha_sample_policies_admin_update" ON public.saha_sample_policies
  FOR UPDATE USING (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_sample_policies_admin_delete" ON public.saha_sample_policies;
CREATE POLICY "saha_sample_policies_admin_delete" ON public.saha_sample_policies
  FOR DELETE USING (public.saha_is_admin());

-- saha_blacklist ----------------------------------------------------------
ALTER TABLE public.saha_blacklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_blacklist_auth_select" ON public.saha_blacklist;
CREATE POLICY "saha_blacklist_auth_select" ON public.saha_blacklist
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "saha_blacklist_admin_insert" ON public.saha_blacklist;
CREATE POLICY "saha_blacklist_admin_insert" ON public.saha_blacklist
  FOR INSERT WITH CHECK (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_blacklist_admin_update" ON public.saha_blacklist;
CREATE POLICY "saha_blacklist_admin_update" ON public.saha_blacklist
  FOR UPDATE USING (public.saha_is_admin());

DROP POLICY IF EXISTS "saha_blacklist_admin_delete" ON public.saha_blacklist;
CREATE POLICY "saha_blacklist_admin_delete" ON public.saha_blacklist
  FOR DELETE USING (public.saha_is_admin());

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name LIKE 'saha_sample%' OR table_name = 'saha_blacklist';
-- 2. SELECT tgname FROM pg_trigger WHERE tgname LIKE 'saha_sample%_set_updated_at';
-- 3. SELECT polname, tablename FROM pg_policies WHERE tablename IN
--    ('saha_samples','saha_sample_lines','saha_sample_quotas','saha_sample_policies','saha_blacklist');
-- ============================================================================
