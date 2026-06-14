-- ============================================================================
-- 20260614000010_collection_reconcile.sql  (Sprint J1)
-- ----------------------------------------------------------------------------
-- rep_collections (Parla-paylaşımlı saha tahsilatı) CONFIRMED olunca, eşleşen
-- saha_cariler VARSA saha_odemeler'e (NAV muhasebe defteri + KPI) köprüler.
-- → tahsilat artık KPI'a (saha_odemeler.created_by) ve cari görünürlüğüne yansır.
--
-- GÜVENLİ tasarım (money + cross-app):
--  * Cari yoksa ATLA (saha_cariler NOT NULL alanları → auto-create YOK, körü-veri yok).
--  * Idempotent: saha_odemeler.rep_collection_id + uniq → ON CONFLICT DO NOTHING.
--  * Exception-safe: köprü hatası rep_collections UPDATE'ini BLOKLAMAZ (Parla yazımı
--    bozulmaz) — iç BEGIN/EXCEPTION.
--  * Link: rep_collections.client_id (klinik) = saha_cariler.clinic_id.
--  * method→yontem map (CHECK: nakit/havale/cek/senet/kart), fallback havale.
-- Idempotent migration.
-- ============================================================================

BEGIN;

ALTER TABLE public.saha_odemeler ADD COLUMN IF NOT EXISTS rep_collection_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS saha_odemeler_rep_collection_uq
  ON public.saha_odemeler (rep_collection_id) WHERE rep_collection_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_rep_collection()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_cari uuid;
  v_rep  uuid;
  v_yontem text;
BEGIN
  -- Yalnız CONFIRMED'e GEÇİŞTE (yeni-confirmed) köprüle.
  IF NEW.status <> 'CONFIRMED' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED' THEN RETURN NEW; END IF;

  BEGIN
    -- Eşleşen cari (klinik bazlı). Yoksa sessizce atla.
    SELECT id INTO v_cari FROM public.saha_cariler
      WHERE clinic_id::text = NEW.client_id LIMIT 1;
    IF v_cari IS NULL THEN RETURN NEW; END IF;

    -- rep_id text → uuid güvenli cast
    BEGIN v_rep := NEW.rep_id::uuid; EXCEPTION WHEN others THEN v_rep := NULL; END;

    -- method → yontem (CHECK kümesi)
    v_yontem := CASE lower(COALESCE(NEW.method,''))
      WHEN 'cash' THEN 'nakit' WHEN 'nakit' THEN 'nakit'
      WHEN 'transfer' THEN 'havale' WHEN 'havale' THEN 'havale' WHEN 'eft' THEN 'havale'
      WHEN 'check' THEN 'cek' WHEN 'cheque' THEN 'cek' WHEN 'cek' THEN 'cek'
      WHEN 'promissory' THEN 'senet' WHEN 'promissory_note' THEN 'senet' WHEN 'senet' THEN 'senet'
      WHEN 'card' THEN 'kart' WHEN 'credit_card' THEN 'kart' WHEN 'kart' THEN 'kart'
      ELSE 'havale' END;

    IF COALESCE(NEW.amount,0) <= 0 THEN RETURN NEW; END IF;  -- tutar CHECK >0

    INSERT INTO public.saha_odemeler
      (cari_id, tarih, tutar, yontem, dekont_no, aciklama, created_by, rep_collection_id)
    VALUES
      (v_cari, COALESCE(NEW.created_at::date, current_date), NEW.amount, v_yontem,
       NULLIF(NEW.reference_no, ''), 'Saha tahsilatı (otomatik aktarıldı)', v_rep, NEW.id)
    ON CONFLICT (rep_collection_id) WHERE rep_collection_id IS NOT NULL DO NOTHING;
  EXCEPTION WHEN others THEN
    -- Köprü hatası rep_collections akışını bozmasın (cross-app güvenlik).
    RAISE WARNING 'reconcile_rep_collection skip: %', SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_reconcile_rep_collection ON public.rep_collections;
CREATE TRIGGER trg_reconcile_rep_collection
  AFTER INSERT OR UPDATE ON public.rep_collections
  FOR EACH ROW EXECUTE FUNCTION public.reconcile_rep_collection();

-- Backfill: mevcut CONFIRMED rep_collections (cari'si olanlar) → saha_odemeler.
INSERT INTO public.saha_odemeler
  (cari_id, tarih, tutar, yontem, dekont_no, aciklama, created_by, rep_collection_id)
SELECT
  c.id, COALESCE(rc.created_at::date, current_date), rc.amount,
  CASE lower(COALESCE(rc.method,''))
    WHEN 'cash' THEN 'nakit' WHEN 'nakit' THEN 'nakit'
    WHEN 'transfer' THEN 'havale' WHEN 'havale' THEN 'havale' WHEN 'eft' THEN 'havale'
    WHEN 'check' THEN 'cek' WHEN 'cheque' THEN 'cek' WHEN 'cek' THEN 'cek'
    WHEN 'promissory' THEN 'senet' WHEN 'promissory_note' THEN 'senet' WHEN 'senet' THEN 'senet'
    WHEN 'card' THEN 'kart' WHEN 'credit_card' THEN 'kart' WHEN 'kart' THEN 'kart'
    ELSE 'havale' END,
  NULLIF(rc.reference_no,''), 'Saha tahsilatı (backfill)',
  CASE WHEN rc.rep_id ~ '^[0-9a-fA-F-]{36}$' THEN rc.rep_id::uuid ELSE NULL END,
  rc.id
FROM public.rep_collections rc
JOIN public.saha_cariler c ON c.clinic_id::text = rc.client_id
WHERE rc.status = 'CONFIRMED' AND COALESCE(rc.amount,0) > 0
ON CONFLICT (rep_collection_id) WHERE rep_collection_id IS NOT NULL DO NOTHING;

COMMIT;
