-- Device-test (CDP) bulgusu: NAV OrderHistoryPage/OrderApprovalPage/SalesHubPage
-- siparişleri `customer:profiles!orders_user_id_fkey` + `rep:profiles!orders_sales_rep_id_fkey`
-- embed ile çekiyordu → her ikisi auth.users'a referans olduğundan PostgREST profiles
-- embed'i 400 (PGRST200) veriyordu → /orders/history + /orders/approval SİPARİŞ LİSTELEYEMİYORDU.
-- user_id'de ayrı `orders_user_id_profiles_fkey` (→profiles) zaten vardı; sales_rep_id'de yoktu.
-- Mirror profiles-FK ekle (orphan=0 doğrulandı). Kod hint'leri *_profiles_fkey'e düzeltildi.
-- CANLIYA MCP ile uygulandı (2026-06-11); dosya CI/fresh-deploy reproduce için.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_sales_rep_id_profiles_fkey') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_sales_rep_id_profiles_fkey
      FOREIGN KEY (sales_rep_id) REFERENCES public.profiles(id);
  END IF;
END $$;
