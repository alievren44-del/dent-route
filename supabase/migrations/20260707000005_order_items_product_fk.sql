-- 20260707000005_order_items_product_fk.sql
-- order_items.product_id → products FK (eksikti; PostgREST products(...) embed'i
-- bu FK olmadan çalışmıyor → web sipariş detayında kalemler boş dönüyordu).
-- Ön-kontrol: 0 orphan (24/24 product_id products'ta mevcut). ON DELETE SET NULL:
-- ürün silinirse kalem snapshot'ı (product_name/sku) korunur. CANLIYA UYGULANDI 2026-07-07.
ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
