-- Saha sipariş müşterisi: klinik → cari → sipariş omurgası.
--
-- Sorun: OrderFormPage müşteriyi `profiles` (24 app kullanıcısı) içinde arıyordu;
-- gerçek müşteri tabanı `saha_clinics` (3116 prospect). RLS rep'e yalnızca atanan
-- profilleri gösterdiği için aramada tek sonuç ("Yılmaz Diş Polikliniği") çıkıyordu.
--
-- Çözüm: sipariş seçicisi saha_clinics arar; klinik seçilince saha_cariler'de
-- find-or-create yapılır ve sipariş hem kliniğe hem cariye bağlanır. Fatura akışı
-- zaten saha_cariler üzerinden işlediğinden uçtan uca tutarlı olur.

-- 1) Cari ↔ klinik bağı (find-or-create anahtarı)
alter table public.saha_cariler
  add column if not exists clinic_id uuid references public.saha_clinics(id) on delete set null;

-- Bir klinikten en fazla bir cari (idempotent find-or-create)
create unique index if not exists saha_cariler_clinic_id_key
  on public.saha_cariler (clinic_id)
  where clinic_id is not null;

-- 2) Sipariş ↔ cari + klinik
alter table public.orders
  add column if not exists cari_id uuid references public.saha_cariler(id) on delete set null,
  add column if not exists clinic_id uuid references public.saha_clinics(id) on delete set null;

create index if not exists orders_cari_id_idx on public.orders (cari_id);
create index if not exists orders_clinic_id_idx on public.orders (clinic_id);

-- 3) find-or-create RPC.
-- Rep saha_cariler'e doğrudan INSERT edemez (yalnızca manager/admin); bu yüzden
-- security definer fonksiyon ile yetkili rep adına cari oluşturulur.
create or replace function public.saha_get_or_create_cari_for_clinic(p_clinic_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cari_id uuid;
  v_clinic  record;
  v_uid     uuid := auth.uid();
begin
  if p_clinic_id is null then
    raise exception 'clinic_id zorunlu';
  end if;

  -- Yetki: rep / saha temsilcisi / yönetici / admin. (saha_is_rep_or_admin yalnızca
  -- 'REP'|'ADMIN' kabul ediyor; 'sales_rep' rolündeki temsilciler de sipariş açabilmeli.)
  if not exists (
    select 1 from public.profiles
    where id = v_uid and upper(role) in ('REP', 'SALES_REP', 'ADMIN', 'MANAGER')
  ) then
    raise exception 'yetki yok';
  end if;

  -- Var olan cariyi döndür
  select id into v_cari_id
  from public.saha_cariler
  where clinic_id = p_clinic_id
  limit 1;

  if v_cari_id is not null then
    return v_cari_id;
  end if;

  -- Klinikten yeni cari türet
  select id, name, address, raw_payload
  into v_clinic
  from public.saha_clinics
  where id = p_clinic_id;

  if not found then
    raise exception 'klinik bulunamadı: %', p_clinic_id;
  end if;

  -- durum kolonu varsayılanı ('aktif') kullanılır; check constraint 'active' kabul etmiyor.
  insert into public.saha_cariler
    (clinic_id, fatura_unvani, fatura_adresi, il, ilce, sales_rep_id, created_by)
  values
    (p_clinic_id,
     coalesce(nullif(trim(v_clinic.name), ''), 'İsimsiz Klinik'),
     v_clinic.address,
     nullif(v_clinic.raw_payload ->> 'il', ''),
     nullif(v_clinic.raw_payload ->> 'ilce', ''),
     v_uid,
     v_uid)
  returning id into v_cari_id;

  return v_cari_id;
end;
$$;

grant execute on function public.saha_get_or_create_cari_for_clinic(uuid) to authenticated;
