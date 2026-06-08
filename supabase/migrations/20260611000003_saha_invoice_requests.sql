-- 20260611000003_saha_invoice_requests.sql
-- Faz 2 — saha siparişini "faturaya gönder" kuyruğu (parla backend tüketir).
--
-- Aynı Supabase; navigasyon RPC ile order'ı invoice_requested işaretler + istek
-- satırı yazar. Parla backend (dry-run/canlı Bizimhesap) bu kuyruğu işleyip
-- invoices üretir. E-fatura tetikleme cross-repo olduğundan navigasyon yalnız
-- "talebi" kaydeder; üretim parla tarafında.

create table if not exists public.saha_invoice_requests (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  requested_by uuid references public.profiles(id),
  status       text not null default 'requested',   -- requested|processing|invoiced|failed
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (order_id)
);

create index if not exists idx_saha_invoice_requests_status on public.saha_invoice_requests(status);

alter table public.saha_invoice_requests enable row level security;

drop policy if exists saha_invoice_requests_admin_all on public.saha_invoice_requests;
create policy saha_invoice_requests_admin_all on public.saha_invoice_requests
  for all using (is_admin()) with check (is_admin());

drop policy if exists saha_invoice_requests_rep_select on public.saha_invoice_requests;
create policy saha_invoice_requests_rep_select on public.saha_invoice_requests
  for select using (
    exists (select 1 from public.orders o
            where o.id = saha_invoice_requests.order_id and o.sales_rep_id = auth.uid())
  );

grant select on public.saha_invoice_requests to authenticated;

-- RPC: siparişi faturaya gönder (yetki: admin veya siparişin plasiyeri).
create or replace function public.request_order_invoice(p_order_id uuid)
returns public.saha_invoice_requests
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_order public.orders;
  v_req   public.saha_invoice_requests;
begin
  select * into v_order from public.orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'order_not_found';
  end if;
  if not (public.is_admin() or v_order.sales_rep_id = auth.uid()) then
    raise exception 'not_authorized';
  end if;

  update public.orders set invoice_status = 'invoice_requested' where id = p_order_id;

  insert into public.saha_invoice_requests (order_id, requested_by, status)
    values (p_order_id, auth.uid(), 'requested')
  on conflict (order_id) do update
    set status = 'requested', requested_by = excluded.requested_by, updated_at = now()
  returning * into v_req;

  return v_req;
end;
$function$;

grant execute on function public.request_order_invoice(uuid) to authenticated;
