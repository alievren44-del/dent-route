-- ============================================================================
-- 20260605000001_order_approval.sql
-- ----------------------------------------------------------------------------
-- Sipariş onay akışı (Sprint 2 / PROMPT-15)
--
-- 1. orders tablosuna onay/red alanları eklenir (idempotent — IF NOT EXISTS).
-- 2. order_items.quantity_delivered (kısmi teslimat) eklenir.
-- 3. handle_order_status_change trigger'ı approved → stock_movements (varsa).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. orders — onay alanları
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS approved_by       uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason  text,
  ADD COLUMN IF NOT EXISTS idempotency_key   text;

COMMENT ON COLUMN public.orders.approved_by IS
  'Siparişi onaylayan/reddeden profil. NULL → henüz işlem yapılmadı veya self-approve.';
COMMENT ON COLUMN public.orders.idempotency_key IS
  'Client tarafından üretilen unique key — aynı sipariş iki kez yaratılmasın diye.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON public.orders(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_status
  ON public.orders(status);

CREATE INDEX IF NOT EXISTS idx_orders_status_approval_pending
  ON public.orders(created_at DESC) WHERE status = 'approval_pending';

-- ----------------------------------------------------------------------------
-- 2. order_items — kısmi teslimat
-- ----------------------------------------------------------------------------
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS quantity_delivered numeric(10,3) DEFAULT 0;

COMMENT ON COLUMN public.order_items.quantity_delivered IS
  'Teslim edilen miktar (kısmi/backorder için). 0 → henüz teslim yok, quantity → tam teslim.';

-- ----------------------------------------------------------------------------
-- 3. Stok hareketi trigger'ı — status=approved olunca, stock_movements
--    tablosu varsa, satış hareketi olarak negatif kaydet.
--    stock_movements yoksa sessizce skip — diğer kurulumlar bozulmasın.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'stock_movements'
    ) THEN
      EXECUTE
        'INSERT INTO public.stock_movements (product_id, quantity, type, reference_id, created_at)
           SELECT product_id, -quantity, ''sale'', $1, now()
             FROM public.order_items
            WHERE order_id = $1'
        USING NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_order_status_change IS
  'orders.status = approved olduğunda otomatik stock_movements kaydı düşer (tablo varsa).';

DROP TRIGGER IF EXISTS trg_order_status_change ON public.orders;
CREATE TRIGGER trg_order_status_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_order_status_change();

COMMIT;
