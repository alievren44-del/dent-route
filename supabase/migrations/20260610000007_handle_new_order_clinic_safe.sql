-- handle_new_order (orders AFTER INSERT) iki notifications kaydı atıyor: müşteri
-- bildirimi (user_id = NEW.user_id) + admin broadcast (user_id NULL). Klinik-bazlı
-- siparişte NEW.user_id NULL olduğundan müşteri bildirimi anlamsız + notifications
-- RLS'i tetikliyordu ("new row violates row-level security policy for notifications").
--
-- Çözüm: fonksiyonu SECURITY DEFINER yap (sistem bildirimi, RLS bypass) ve müşteri
-- bildirimini yalnızca gerçek müşteri (user_id NOT NULL) varsa at.
create or replace function public.handle_new_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Müşteriye bildirim — sadece profile-bazlı müşteri varsa.
  if new.user_id is not null then
    insert into public.notifications (user_id, type, title, message, data)
    values (
      new.user_id,
      'new_order',
      'Siparişiniz alındı',
      'Sipariş no: ' || coalesce(new.order_number, new.id::text),
      jsonb_build_object('order_id', new.id)
    );
  end if;

  -- Admin broadcast (user_id NULL).
  insert into public.notifications (user_id, type, title, message, data)
  values (
    null,
    'new_order',
    'Yeni sipariş',
    'Yeni sipariş geldi: ' || coalesce(new.order_number, new.id::text),
    jsonb_build_object('order_id', new.id)
  );

  return new;
end;
$$;
