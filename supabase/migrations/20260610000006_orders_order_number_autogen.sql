-- orders.order_number NOT NULL ama ne default ne BEFORE INSERT trigger vardı;
-- saha createOrder (ve web app dışındaki her inserter) bu kolonu doldurmadığı için
-- "null value in column order_number violates not-null constraint" ile patlıyordu.
-- Çözüm: null/boş geldiğinde sequence'ten otomatik sipariş numarası üret.

create sequence if not exists public.orders_order_number_seq;

create or replace function public.set_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.order_number is null or new.order_number = '' then
    new.order_number := 'SP-' || to_char(now(), 'YYYY') || '-' ||
      lpad(nextval('public.orders_order_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_order_number on public.orders;
create trigger trg_set_order_number
  before insert on public.orders
  for each row execute function public.set_order_number();
