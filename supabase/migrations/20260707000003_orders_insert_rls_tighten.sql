-- 20260707000003_orders_insert_rls_tighten.sql
-- orders INSERT RLS sıkılaştırma — doğrudan-client insert'lerinde durum kapısı.
--
-- KAPSAM / NEDEN:
--   * service_role RLS'i BYPASS eder → web checkout (server .cjs, service key)
--     bu policy'den etkilenmez.
--   * SECURITY DEFINER RPC saha_create_order_tx da RLS'i BYPASS eder (definer =
--     tablo sahibi) → yeni Nav akışı bu policy'ye takılmaz; durumu zaten sunucuda
--     'pending'/'approval_pending' set eder.
--   * Bu policy YALNIZCA artık-kalan doğrudan client INSERT'lerini (eski Nav
--     build'leri, REST ile orders'a yazan) kısıtlar. İzin verilen durumlar eski
--     client'ların gönderdiğiyle uyumlu ('pending' / 'approval_pending') — böylece
--     RPC'ye geçmemiş eski cihazlar kırılmaz ama 'approved' vb. enjekte edemez.
--
-- Değişiklik: orders_insert_merged with_check'ine status beyaz-listesi + 'pending'
-- için rol koşulu eklenir. Idempotent (DROP POLICY IF EXISTS + CREATE).

DROP POLICY IF EXISTS orders_insert_merged ON public.orders;

CREATE POLICY orders_insert_merged ON public.orders
  FOR INSERT
  WITH CHECK (
    ((user_id = auth.uid()) OR (sales_rep_id = auth.uid()))
    AND status IN ('pending', 'approval_pending')
    AND (
      status <> 'pending'
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid()
          AND upper(role) IN ('REP', 'SALES_REP', 'ADMIN', 'MANAGER')
      )
    )
  );
