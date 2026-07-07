-- 20260707000006_orders_add_shipped_at.sql
-- orders.shipped_at kolonu eksikti → admin-orders.cjs PATCH /:id/tracking bu kolonu
-- YAZIYOR (400→500 "Kargo bilgisi güncellenemedi") + orderRepository read select'i
-- bekliyordu. Additive fix: admin kargo-yazma + müşteri sipariş-detay kargo-tarihi
-- onarılır. CANLIYA UYGULANDI 2026-07-07 (release audit F1-E blocker).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shipped_at timestamptz;
