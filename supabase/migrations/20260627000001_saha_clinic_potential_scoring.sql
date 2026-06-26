-- Cluster I-A: clinic potential scoring (0-10) + first-contact marker. NAV-only saha_* tables.
-- Clinic-level latest (indexable for "potansiyele göre sırala") + per-visit history.
-- Applied to prod (rranpzicmhgfupgabgbi) 2026-06-27.
alter table public.saha_clinics
  add column if not exists potential smallint
    check (potential is null or (potential >= 0 and potential <= 10)),
  add column if not exists potential_at timestamptz,
  add column if not exists first_contact_at timestamptz;

create index if not exists saha_clinics_potential_idx
  on public.saha_clinics (potential desc nulls last);

alter table public.saha_visits
  add column if not exists potential smallint
    check (potential is null or (potential >= 0 and potential <= 10));

comment on column public.saha_clinics.potential is 'Cluster I-A: 0-10 çalışma potansiyeli (en son değer; sıralama için).';
comment on column public.saha_visits.potential is 'Cluster I-A: o ziyarette verilen 0-10 potansiyel (geçmiş/audit).';
