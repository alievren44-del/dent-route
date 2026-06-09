-- 20260611000004_saha_rep_order_insert_policy.sql
-- Sipariş oluşturma RLS hatası fix: "new row violates row-level security policy
-- for table orders". Mevcut INSERT policy'leri user_id (=MÜŞTERİ) bazlıydı; saha
-- siparişinde user_id=müşteri, sales_rep_id=plasiyer → insert reddediliyordu.
-- createOrder sales_rep_id=auth.uid() set eder; bu policy plasiyeri (ve admin'i) kapsar.

drop policy if exists orders_rep_insert on public.orders;
create policy orders_rep_insert on public.orders
  for insert with check (sales_rep_id = auth.uid());

drop policy if exists order_items_rep_insert on public.order_items;
create policy order_items_rep_insert on public.order_items
  for insert with check (
    exists (select 1 from public.orders o
            where o.id = order_items.order_id and o.sales_rep_id = auth.uid())
  );
