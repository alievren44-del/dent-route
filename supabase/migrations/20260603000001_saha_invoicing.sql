-- ============================================================================
-- Saha Navigasyon — Cari + Fatura Migration (PROMPT-12)
-- ============================================================================
-- Tarih      : 2026-06-03
-- Sprint     : Sprint 3 — Invoicing & Payments
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Strateji   : ADDITIVE — saha_* prefix; mevcut tablolara dokunmaz.
--
-- ÇAKIŞMA KORUMASI: Tüm CREATE'ler `IF NOT EXISTS`, RLS policy'leri
-- DROP IF EXISTS ile yeniden. Idempotent.
--
-- BU MIGRATION:
--   1. saha_cariler           — cari kart (1:1 customer_accounts/profiles)
--   2. saha_faturalar         — başlık tablo (durum, tarih, vade, toplamlar)
--   3. saha_fatura_kalemleri  — satır kalemleri (ürün, miktar, fiyat, KDV)
--   4. generate_cari_kodu     — otomatik CR-2026-0001 formatı
--   5. set_cari_kodu          — BEFORE INSERT trigger
--   6. update_fatura_toplam   — kalem değişikliği başlığa yansıtır
--   7. RLS:
--      - cariler:           REP+ okur, MANAGER+ yazar
--      - faturalar:         MANAGER+ tüm CRUD
--      - fatura_kalemleri:  MANAGER+ tüm CRUD (cascade fatura)
--
-- BAĞIMLILIKLAR:
--   - public.profiles (Parla baseline)
--   - public.customer_accounts (Parla baseline)
--   - public.set_updated_at()  (saha_extension 20260525000001)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 0. Yardımcı: saha_is_manager_or_admin (cari/fatura RLS için)
--    REP yetki dışı — sadece MANAGER ve ADMIN.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saha_is_manager_or_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('ADMIN', 'MANAGER')
  )
$$;

-- ----------------------------------------------------------------------------
-- 1. saha_cariler — cari hesap kartı
--    Bir cari, opsiyonel olarak bir customer_account veya profile'a bağlanır.
--    Açılış bakiyesi + vergi/fatura bilgileri burada tutulur.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_cariler (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cari_kodu            text UNIQUE NOT NULL,
  account_id           uuid REFERENCES public.customer_accounts(id) ON DELETE SET NULL,
  profile_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  fatura_unvani        text NOT NULL,
  vergi_no             text,
  vergi_dairesi        text,
  fatura_adresi        text,
  il                   text,
  ilce                 text,
  iban                 text,
  banka_adi            text,
  odeme_vadesi_gun     integer NOT NULL DEFAULT 30,
  kredi_limiti         numeric(15,2) NOT NULL DEFAULT 0,
  acilis_bakiyesi      numeric(15,2) NOT NULL DEFAULT 0,
  durum                text NOT NULL DEFAULT 'aktif'
                         CHECK (durum IN ('aktif', 'pasif', 'kara_liste')),
  notlar               text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.saha_cariler IS
  'Cari hesap kartı. cari_kodu otomatik (generate_cari_kodu trigger). account_id veya profile_id ile mevcut Parla müşterilerine bağlanabilir.';
COMMENT ON COLUMN public.saha_cariler.cari_kodu IS
  'Otomatik üretilen kod: CR-YYYY-NNNN. Trigger set_cari_kodu.';
COMMENT ON COLUMN public.saha_cariler.odeme_vadesi_gun IS
  'Fatura kesildikten sonra vade gün sayısı (default 30). InvoiceFormPage vade tarihini bundan hesaplar.';

CREATE INDEX IF NOT EXISTS idx_saha_cariler_account ON public.saha_cariler(account_id);
CREATE INDEX IF NOT EXISTS idx_saha_cariler_profile ON public.saha_cariler(profile_id);
CREATE INDEX IF NOT EXISTS idx_saha_cariler_vergi_no ON public.saha_cariler(vergi_no) WHERE vergi_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saha_cariler_il ON public.saha_cariler(il, ilce);
CREATE INDEX IF NOT EXISTS idx_saha_cariler_durum ON public.saha_cariler(durum) WHERE durum <> 'aktif';

-- ----------------------------------------------------------------------------
-- 2. saha_faturalar — fatura başlığı
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_faturalar (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fatura_no            text UNIQUE,
  cari_id              uuid NOT NULL REFERENCES public.saha_cariler(id) ON DELETE RESTRICT,
  tip                  text NOT NULL DEFAULT 'satis'
                         CHECK (tip IN ('satis', 'iade')),
  tarih                date NOT NULL DEFAULT CURRENT_DATE,
  vade_tarihi          date,
  ara_toplam           numeric(15,2) NOT NULL DEFAULT 0,
  iskonto_toplam       numeric(15,2) NOT NULL DEFAULT 0,
  kdv_tutari           numeric(15,2) NOT NULL DEFAULT 0,
  toplam               numeric(15,2) NOT NULL DEFAULT 0,
  odenen               numeric(15,2) NOT NULL DEFAULT 0,
  kalan                numeric(15,2) GENERATED ALWAYS AS (toplam - odenen) STORED,
  para_birimi          text NOT NULL DEFAULT 'TRY',
  durum                text NOT NULL DEFAULT 'taslak'
                         CHECK (durum IN ('taslak', 'gonderildi', 'kismi_odendi', 'odendi', 'iptal', 'gecikti')),
  aciklama             text,
  efatura_uuid         text,
  efatura_durum        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.saha_faturalar IS
  'Fatura başlığı. ara_toplam/kdv_tutari/toplam kalem trigger ile otomatik güncellenir. odenen saha_odemeler trigger ile güncellenir (20260603000002 migration).';
COMMENT ON COLUMN public.saha_faturalar.kalan IS
  'GENERATED column — toplam - odenen. PaymentForm bu kolona göre seçilebilir bakiyeli faturaları listeler.';
COMMENT ON COLUMN public.saha_faturalar.durum IS
  'taslak → gonderildi → kismi_odendi → odendi. iptal terminal. gecikti = vade_tarihi < now() AND kalan > 0.';

CREATE INDEX IF NOT EXISTS idx_saha_faturalar_cari ON public.saha_faturalar(cari_id);
CREATE INDEX IF NOT EXISTS idx_saha_faturalar_durum ON public.saha_faturalar(durum);
CREATE INDEX IF NOT EXISTS idx_saha_faturalar_tarih ON public.saha_faturalar(tarih DESC);
CREATE INDEX IF NOT EXISTS idx_saha_faturalar_vade ON public.saha_faturalar(vade_tarihi)
  WHERE durum NOT IN ('odendi', 'iptal');

-- ----------------------------------------------------------------------------
-- 3. saha_fatura_kalemleri — fatura satırları
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_fatura_kalemleri (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fatura_id            uuid NOT NULL REFERENCES public.saha_faturalar(id) ON DELETE CASCADE,
  sira                 integer NOT NULL DEFAULT 1,
  urun_id              uuid REFERENCES public.products(id) ON DELETE SET NULL,
  urun_adi             text NOT NULL,
  birim                text NOT NULL DEFAULT 'adet',
  miktar               numeric(12,3) NOT NULL CHECK (miktar > 0),
  birim_fiyat          numeric(15,4) NOT NULL CHECK (birim_fiyat >= 0),
  iskonto_orani        numeric(5,4) NOT NULL DEFAULT 0 CHECK (iskonto_orani >= 0 AND iskonto_orani <= 1),
  kdv_orani            numeric(5,4) NOT NULL DEFAULT 0.20 CHECK (kdv_orani >= 0 AND kdv_orani <= 1),
  net_tutar            numeric(15,2) GENERATED ALWAYS AS (
                         ROUND((miktar * birim_fiyat) * (1 - iskonto_orani), 2)
                       ) STORED,
  kdv_tutari           numeric(15,2) GENERATED ALWAYS AS (
                         ROUND((miktar * birim_fiyat) * (1 - iskonto_orani) * kdv_orani, 2)
                       ) STORED,
  satir_toplam         numeric(15,2) GENERATED ALWAYS AS (
                         ROUND((miktar * birim_fiyat) * (1 - iskonto_orani) * (1 + kdv_orani), 2)
                       ) STORED,
  created_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.saha_fatura_kalemleri IS
  'Fatura kalemleri. net_tutar/kdv_tutari/satir_toplam GENERATED — DB içinde hesaplanır. Frontend invoiceCalc.ts ile aynı formül.';

CREATE INDEX IF NOT EXISTS idx_saha_kalemleri_fatura ON public.saha_fatura_kalemleri(fatura_id);
CREATE INDEX IF NOT EXISTS idx_saha_kalemleri_urun ON public.saha_fatura_kalemleri(urun_id) WHERE urun_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. generate_cari_kodu — otomatik kod üretimi
--    Format: CR-2026-0001 (yıl bazlı sequence)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_cari_kodu()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  current_year text := to_char(now(), 'YYYY');
  next_seq integer;
  candidate text;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(cari_kodu, '^CR-' || current_year || '-', ''), '')::integer
  ), 0) + 1
    INTO next_seq
  FROM public.saha_cariler
  WHERE cari_kodu LIKE 'CR-' || current_year || '-%';

  candidate := 'CR-' || current_year || '-' || lpad(next_seq::text, 4, '0');
  RETURN candidate;
END;
$$;

COMMENT ON FUNCTION public.generate_cari_kodu IS
  'Cari kod üretici: CR-YYYY-NNNN. set_cari_kodu trigger ile BEFORE INSERT çağrılır.';

-- ----------------------------------------------------------------------------
-- 5. set_cari_kodu trigger — cari_kodu boşsa otomatik doldur
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_cari_kodu()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cari_kodu IS NULL OR NEW.cari_kodu = '' THEN
    NEW.cari_kodu := public.generate_cari_kodu();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saha_cariler_set_kod ON public.saha_cariler;
CREATE TRIGGER trg_saha_cariler_set_kod
  BEFORE INSERT ON public.saha_cariler
  FOR EACH ROW EXECUTE FUNCTION public.set_cari_kodu();

-- ----------------------------------------------------------------------------
-- 6. Fatura no üretimi — FT-YYYY-NNNN (taslak'tan gönderildi'ye geçişte set)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_fatura_no()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  current_year text := to_char(now(), 'YYYY');
  next_seq integer;
BEGIN
  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(fatura_no, '^FT-' || current_year || '-', ''), '')::integer
  ), 0) + 1
    INTO next_seq
  FROM public.saha_faturalar
  WHERE fatura_no LIKE 'FT-' || current_year || '-%';

  RETURN 'FT-' || current_year || '-' || lpad(next_seq::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_fatura_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- taslak'tan başka duruma geçişte fatura_no üret
  IF (NEW.fatura_no IS NULL OR NEW.fatura_no = '')
     AND NEW.durum <> 'taslak' THEN
    NEW.fatura_no := public.generate_fatura_no();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_saha_faturalar_set_no ON public.saha_faturalar;
CREATE TRIGGER trg_saha_faturalar_set_no
  BEFORE INSERT OR UPDATE OF durum ON public.saha_faturalar
  FOR EACH ROW EXECUTE FUNCTION public.set_fatura_no();

-- ----------------------------------------------------------------------------
-- 7. update_fatura_toplam — kalem CRUD sonrası başlık toplamlarını güncelle
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_fatura_toplam()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_fatura_id uuid;
  v_ara numeric(15,2);
  v_iskonto numeric(15,2);
  v_kdv numeric(15,2);
  v_toplam numeric(15,2);
BEGIN
  v_fatura_id := COALESCE(NEW.fatura_id, OLD.fatura_id);

  SELECT
    COALESCE(SUM(ROUND(miktar * birim_fiyat, 2)), 0),
    COALESCE(SUM(ROUND(miktar * birim_fiyat * iskonto_orani, 2)), 0),
    COALESCE(SUM(kdv_tutari), 0),
    COALESCE(SUM(satir_toplam), 0)
    INTO v_ara, v_iskonto, v_kdv, v_toplam
  FROM public.saha_fatura_kalemleri
  WHERE fatura_id = v_fatura_id;

  UPDATE public.saha_faturalar
     SET ara_toplam     = v_ara - v_iskonto,
         iskonto_toplam = v_iskonto,
         kdv_tutari     = v_kdv,
         toplam         = v_toplam,
         updated_at     = now()
   WHERE id = v_fatura_id;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_saha_kalemleri_fatura_toplam ON public.saha_fatura_kalemleri;
CREATE TRIGGER trg_saha_kalemleri_fatura_toplam
  AFTER INSERT OR UPDATE OR DELETE ON public.saha_fatura_kalemleri
  FOR EACH ROW EXECUTE FUNCTION public.update_fatura_toplam();

-- ----------------------------------------------------------------------------
-- 8. updated_at triggers (defansif, set_updated_at varsa)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'saha_cariler_set_updated_at') THEN
      EXECUTE 'CREATE TRIGGER saha_cariler_set_updated_at
        BEFORE UPDATE ON public.saha_cariler
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'saha_faturalar_set_updated_at') THEN
      EXECUTE 'CREATE TRIGGER saha_faturalar_set_updated_at
        BEFORE UPDATE ON public.saha_faturalar
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 9. RLS — saha_cariler
--    REP+ okur (kendi yönettiği müşteriler dahil tüm aktif cariler),
--    MANAGER+ yazar.
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_cariler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_cariler_rep_select" ON public.saha_cariler;
CREATE POLICY "saha_cariler_rep_select" ON public.saha_cariler
  FOR SELECT
  USING (public.saha_is_rep_or_admin() OR public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_cariler_manager_insert" ON public.saha_cariler;
CREATE POLICY "saha_cariler_manager_insert" ON public.saha_cariler
  FOR INSERT
  WITH CHECK (public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_cariler_manager_update" ON public.saha_cariler;
CREATE POLICY "saha_cariler_manager_update" ON public.saha_cariler
  FOR UPDATE
  USING (public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "saha_cariler_admin_delete" ON public.saha_cariler;
CREATE POLICY "saha_cariler_admin_delete" ON public.saha_cariler
  FOR DELETE
  USING (public.saha_is_admin());

-- ----------------------------------------------------------------------------
-- 10. RLS — saha_faturalar (MANAGER+ only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_faturalar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_faturalar_manager_all" ON public.saha_faturalar;
CREATE POLICY "saha_faturalar_manager_all" ON public.saha_faturalar
  FOR ALL
  USING (public.saha_is_manager_or_admin())
  WITH CHECK (public.saha_is_manager_or_admin());

-- ----------------------------------------------------------------------------
-- 11. RLS — saha_fatura_kalemleri (MANAGER+ only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_fatura_kalemleri ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_kalemleri_manager_all" ON public.saha_fatura_kalemleri;
CREATE POLICY "saha_kalemleri_manager_all" ON public.saha_fatura_kalemleri
  FOR ALL
  USING (public.saha_is_manager_or_admin())
  WITH CHECK (public.saha_is_manager_or_admin());

-- ----------------------------------------------------------------------------
-- 12. GRANT EXECUTE on helper functions
-- ----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.saha_is_manager_or_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_cari_kodu() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_fatura_no() TO authenticated;

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. INSERT INTO saha_cariler (fatura_unvani) VALUES ('Test A.Ş.');
--    SELECT cari_kodu FROM saha_cariler;  -- CR-2026-0001 görmeli
-- 2. INSERT INTO saha_faturalar (cari_id, durum) VALUES (<cari_id>, 'gonderildi');
--    SELECT fatura_no FROM saha_faturalar;  -- FT-2026-0001 görmeli
-- 3. Kalem insert → SELECT toplam FROM saha_faturalar; otomatik güncellenmeli.
-- ============================================================================
