-- ============================================================================
-- Saha Navigasyon — Ödeme + Çek/Senet Migration (PROMPT-13)
-- ============================================================================
-- Tarih      : 2026-06-03
-- Sprint     : Sprint 3 — Invoicing & Payments
-- Hedef DB   : Parla Diş Deposu Supabase projesi (rranpzicmhgfupgabgbi)
-- Strateji   : ADDITIVE — saha_* prefix.
--
-- BU MIGRATION:
--   1. saha_odemeler        — ödeme kayıtları (fatura ilişkili)
--   2. saha_cek_senetler    — çek/senet yaşam döngüsü
--   3. update_fatura_odenen — ödeme CRUD'unda fatura.odenen + durum güncelle
--   4. RLS — MANAGER+ tüm CRUD
--
-- BAĞIMLILIKLAR:
--   - public.saha_cariler, public.saha_faturalar (20260603000001)
--   - public.saha_is_manager_or_admin() (20260603000001)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. saha_odemeler — ödeme kayıtları
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_odemeler (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cari_id             uuid NOT NULL REFERENCES public.saha_cariler(id) ON DELETE RESTRICT,
  fatura_id           uuid REFERENCES public.saha_faturalar(id) ON DELETE SET NULL,
  tarih               date NOT NULL DEFAULT CURRENT_DATE,
  tutar               numeric(15,2) NOT NULL CHECK (tutar > 0),
  yontem              text NOT NULL DEFAULT 'nakit'
                        CHECK (yontem IN ('nakit', 'havale', 'cek', 'senet', 'kart')),
  dekont_no           text,
  cek_senet_id        uuid,  -- forward ref; constraint deferred until cek_senetler exists
  aciklama            text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.saha_odemeler IS
  'Ödeme kayıtları. fatura_id null ise serbest tahsilat (cari avansı). yontem cek/senet ise cek_senet_id ile saha_cek_senetler''e bağlı.';

CREATE INDEX IF NOT EXISTS idx_saha_odemeler_cari ON public.saha_odemeler(cari_id);
CREATE INDEX IF NOT EXISTS idx_saha_odemeler_fatura ON public.saha_odemeler(fatura_id) WHERE fatura_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saha_odemeler_tarih ON public.saha_odemeler(tarih DESC);
CREATE INDEX IF NOT EXISTS idx_saha_odemeler_yontem ON public.saha_odemeler(yontem);

-- ----------------------------------------------------------------------------
-- 2. saha_cek_senetler — çek/senet kartı
--    Durum makinesi: portfoyde → tahsile_verildi → tahsil_edildi | karsiliksiz
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saha_cek_senetler (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tip                  text NOT NULL DEFAULT 'cek'
                         CHECK (tip IN ('cek', 'senet')),
  cek_no               text,
  banka                text,
  banka_sube           text,
  kesideci             text NOT NULL,
  kesideci_vkn         text,
  cari_id              uuid REFERENCES public.saha_cariler(id) ON DELETE SET NULL,
  vade_tarihi          date NOT NULL,
  tutar                numeric(15,2) NOT NULL CHECK (tutar > 0),
  durum                text NOT NULL DEFAULT 'portfoyde'
                         CHECK (durum IN ('portfoyde', 'tahsile_verildi', 'tahsil_edildi', 'karsiliksiz', 'iade')),
  tahsile_verildi_banka text,
  tahsile_verildi_tarih date,
  tahsil_tarihi        date,
  karsiliksiz_tarihi   date,
  karsiliksiz_notu     text,
  notlar               text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.saha_cek_senetler IS
  'Çek/senet kartı. Durum: portfoyde → tahsile_verildi → tahsil_edildi | karsiliksiz. CekSenetListPage tabları bu durumlara göre filtreler.';

CREATE INDEX IF NOT EXISTS idx_saha_cek_senet_cari ON public.saha_cek_senetler(cari_id);
CREATE INDEX IF NOT EXISTS idx_saha_cek_senet_durum ON public.saha_cek_senetler(durum);
CREATE INDEX IF NOT EXISTS idx_saha_cek_senet_vade ON public.saha_cek_senetler(vade_tarihi)
  WHERE durum IN ('portfoyde', 'tahsile_verildi');

-- saha_odemeler.cek_senet_id FK (deferred)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'saha_odemeler_cek_senet_fkey'
      AND conrelid = 'public.saha_odemeler'::regclass
  ) THEN
    ALTER TABLE public.saha_odemeler
      ADD CONSTRAINT saha_odemeler_cek_senet_fkey
      FOREIGN KEY (cek_senet_id) REFERENCES public.saha_cek_senetler(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_saha_odemeler_cek_senet
  ON public.saha_odemeler(cek_senet_id) WHERE cek_senet_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. update_fatura_odenen — saha_odemeler CRUD sonrası fatura.odenen güncelle
--    Ayrıca fatura.durum'u otomatik geçişler: kismi_odendi / odendi.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_fatura_odenen()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_fatura_id uuid;
  v_odenen numeric(15,2);
  v_toplam numeric(15,2);
  v_mevcut_durum text;
BEGIN
  v_fatura_id := COALESCE(NEW.fatura_id, OLD.fatura_id);

  IF v_fatura_id IS NULL THEN
    RETURN NULL;  -- serbest tahsilat — faturaya ait değil
  END IF;

  SELECT COALESCE(SUM(tutar), 0)
    INTO v_odenen
  FROM public.saha_odemeler
  WHERE fatura_id = v_fatura_id;

  SELECT toplam, durum
    INTO v_toplam, v_mevcut_durum
  FROM public.saha_faturalar
  WHERE id = v_fatura_id;

  UPDATE public.saha_faturalar
     SET odenen     = v_odenen,
         updated_at = now(),
         durum      = CASE
                        WHEN v_mevcut_durum = 'iptal' THEN v_mevcut_durum
                        WHEN v_odenen >= v_toplam AND v_toplam > 0 THEN 'odendi'
                        WHEN v_odenen > 0 AND v_odenen < v_toplam THEN 'kismi_odendi'
                        WHEN v_odenen = 0 AND v_mevcut_durum IN ('kismi_odendi', 'odendi') THEN 'gonderildi'
                        ELSE v_mevcut_durum
                      END
   WHERE id = v_fatura_id;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.update_fatura_odenen IS
  'saha_odemeler INSERT/UPDATE/DELETE sonrası ilgili faturanın odenen + durum kolonlarını günceller.';

DROP TRIGGER IF EXISTS trg_saha_odemeler_fatura_odenen ON public.saha_odemeler;
CREATE TRIGGER trg_saha_odemeler_fatura_odenen
  AFTER INSERT OR UPDATE OR DELETE ON public.saha_odemeler
  FOR EACH ROW EXECUTE FUNCTION public.update_fatura_odenen();

-- ----------------------------------------------------------------------------
-- 4. updated_at triggers (defansif)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'public'::regnamespace
  ) THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'saha_odemeler_set_updated_at') THEN
      EXECUTE 'CREATE TRIGGER saha_odemeler_set_updated_at
        BEFORE UPDATE ON public.saha_odemeler
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'saha_cek_senetler_set_updated_at') THEN
      EXECUTE 'CREATE TRIGGER saha_cek_senetler_set_updated_at
        BEFORE UPDATE ON public.saha_cek_senetler
        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()';
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. RLS — saha_odemeler (MANAGER+ only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_odemeler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_odemeler_manager_all" ON public.saha_odemeler;
CREATE POLICY "saha_odemeler_manager_all" ON public.saha_odemeler
  FOR ALL
  USING (public.saha_is_manager_or_admin())
  WITH CHECK (public.saha_is_manager_or_admin());

-- ----------------------------------------------------------------------------
-- 6. RLS — saha_cek_senetler (MANAGER+ only)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_cek_senetler ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_cek_senetler_manager_all" ON public.saha_cek_senetler;
CREATE POLICY "saha_cek_senetler_manager_all" ON public.saha_cek_senetler
  FOR ALL
  USING (public.saha_is_manager_or_admin())
  WITH CHECK (public.saha_is_manager_or_admin());

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. INSERT INTO saha_odemeler (cari_id, fatura_id, tutar) VALUES (..., ..., 100);
--    SELECT odenen, durum FROM saha_faturalar WHERE id = <fatura_id>;
--    odenen 100 olmalı; toplam == odenen ise durum 'odendi' olmalı.
-- 2. DELETE FROM saha_odemeler WHERE id = <id>;
--    odenen geri çekilmeli, durum 'gonderildi' olmalı.
-- 3. UPDATE saha_cek_senetler SET durum = 'tahsil_edildi' WHERE id = ...;
--    Tablo update_at trigger ile zaman damgası güncellenmeli.
-- ============================================================================
