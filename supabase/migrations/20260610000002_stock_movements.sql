-- ============================================================================
-- 20260610000002_stock_movements.sql
-- ----------------------------------------------------------------------------
-- Stok Hareketleri Defteri (append-only audit ledger)
--
-- AMAÇ: handle_order_status_change trigger'ı (20260605000001_order_approval.sql)
--   sipariş onaylanınca stock_movements'a NEGATİF satış satırı INSERT eder —
--   ama tablo yoksa sessizce skip ediyordu. Bu migration tabloyu oluşturur ki
--   defter artık kaydı tutsun.
--
-- KRİTİK: products.stock_quantity CANLI/PAYLAŞILAN e-ticaret stoğudur. Bu modül
--   SADECE okur + bu append-only defteri yazar. stock_quantity'yi ASLA değiştirmez.
--
-- Kolonlar trigger'ın INSERT'ine BİREBİR uyacak şekilde:
--   INSERT INTO public.stock_movements (product_id, quantity, type, reference_id, created_at)
--
-- ÇAKIŞMA KORUMASI: CREATE'ler IF NOT EXISTS, policy'ler DROP IF EXISTS. Idempotent.
-- RLS stili 20260603000001_saha_invoicing.sql ile aynı (saha_is_* helper'ları).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. stock_movements — append-only defter
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES public.products(id),
  quantity      integer NOT NULL,          -- işaretli: satış negatif, iade/restock pozitif
  type          text NOT NULL,             -- 'sale' | 'manual' | 'return' | 'adjust'
  reference_id  uuid,                       -- order_id / null
  note          text,
  created_by    uuid REFERENCES public.profiles(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stock_movements IS
  'Append-only stok hareketi defteri. handle_order_status_change trigger satış onayında negatif satır düşer. products.stock_quantity bu modül tarafından DEĞİŞTİRİLMEZ (canlı paylaşılan e-ticaret stoğu).';
COMMENT ON COLUMN public.stock_movements.quantity IS
  'İşaretli miktar: satış negatif, iade/restock pozitif.';
COMMENT ON COLUMN public.stock_movements.type IS
  'sale | manual | return | adjust. sale = trigger otomatik; diğerleri manuel giriş.';
COMMENT ON COLUMN public.stock_movements.reference_id IS
  'İlişkili order_id (satış) veya null (manuel düzeltme).';

-- ----------------------------------------------------------------------------
-- 2. Indexler
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created
  ON public.stock_movements(product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON public.stock_movements(reference_id) WHERE reference_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. RLS
--    SELECT  : REP / MANAGER / ADMIN (defteri okur)
--    INSERT  : MANAGER / ADMIN (manuel düzeltme). SECURITY DEFINER trigger zaten
--              RLS'i bypass ettiği için otomatik satış satırları bu policy'ye
--              tabi değildir.
--    NOT: SELECT/INSERT dışında policy yok → tablo append-only (UPDATE/DELETE engelli).
-- ----------------------------------------------------------------------------
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_movements_staff_select" ON public.stock_movements;
CREATE POLICY "stock_movements_staff_select" ON public.stock_movements
  FOR SELECT
  USING (public.saha_is_rep_or_admin() OR public.saha_is_manager_or_admin());

DROP POLICY IF EXISTS "stock_movements_manager_insert" ON public.stock_movements;
CREATE POLICY "stock_movements_manager_insert" ON public.stock_movements
  FOR INSERT
  WITH CHECK (public.saha_is_manager_or_admin());

COMMIT;

-- ============================================================================
-- POST-MIGRATION KONTROL (manuel)
-- ============================================================================
-- 1. Bir order'ı status=approved yap → SELECT * FROM stock_movements WHERE type='sale';
--    order_items başına negatif satır görmeli.
-- 2. products.stock_quantity bu işlemle DEĞİŞMEMELİ (canlı stok dokunulmaz).
-- ============================================================================
