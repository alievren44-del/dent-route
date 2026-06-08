-- 20260611000002_saha_sales_phase2_rls_templates.sql
-- Faz 2 — takım görünürlük RLS + hazır şablon sipariş.
--
-- Sorun: orders/order_items "own" policy'leri user_id (=MÜŞTERİ) bazlıydı; plasiyer
-- kendi GİRDİĞİ siparişi (sales_rep_id) RLS ile göremiyordu → SalesHub/OrderHistory
-- rep hesabında boş. Çözüm: sales_rep_id = auth.uid() SELECT policy'leri. Admin
-- zaten is_admin() ile hepsini görür (yönetici hepsini, rep kendininki).

drop policy if exists orders_rep_select_own on public.orders;
create policy orders_rep_select_own on public.orders
  for select using (sales_rep_id = auth.uid());

drop policy if exists order_items_rep_select_own on public.order_items;
create policy order_items_rep_select_own on public.order_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id and o.sales_rep_id = auth.uid()
    )
  );

-- Hazır şablon sipariş (SFA order template): rep sık satışı kaydeder, tek tıkla doldurur.
create table if not exists public.saha_order_templates (
  id         uuid primary key default gen_random_uuid(),
  rep_id     uuid not null references public.profiles(id) on delete cascade,
  name       text not null,
  clinic_id  uuid,
  lines      jsonb not null default '[]'::jsonb,  -- [{product_id, product_name, qty, unit_price}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rep_id, name)
);

create index if not exists idx_saha_order_templates_rep on public.saha_order_templates(rep_id);

alter table public.saha_order_templates enable row level security;

drop policy if exists saha_order_templates_rep_all on public.saha_order_templates;
create policy saha_order_templates_rep_all on public.saha_order_templates
  for all using (rep_id = auth.uid()) with check (rep_id = auth.uid());

drop policy if exists saha_order_templates_admin_all on public.saha_order_templates;
create policy saha_order_templates_admin_all on public.saha_order_templates
  for all using (is_admin()) with check (is_admin());

grant select, insert, update, delete on public.saha_order_templates to authenticated;
