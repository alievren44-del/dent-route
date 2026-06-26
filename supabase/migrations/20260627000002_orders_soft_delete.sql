-- Cluster I-C: soft-delete for orders ("satış silme", admin-only, non-financial statuses only).
-- orders is SHARED with the website. Additive nullable column — website queries ignore it.
-- NAV order lists filter deleted_at IS NULL. Hard-delete avoided (orphans payments/
-- account_transactions/saha_faturalar via SET NULL; blocked by referral_rewards/refund_ledger
-- RESTRICT). Soft-delete is reversible + audit-friendly.
-- NOTE: web admin order views should ALSO filter deleted_at IS NULL (separate repo — flagged).
-- Applied to prod (rranpzicmhgfupgabgbi) 2026-06-27.
alter table public.orders
  add column if not exists deleted_at timestamptz;

create index if not exists orders_deleted_at_idx on public.orders (deleted_at) where deleted_at is not null;

comment on column public.orders.deleted_at is 'Cluster I-C: soft-delete timestamp (NAV admin satış-silme). NULL = aktif.';
