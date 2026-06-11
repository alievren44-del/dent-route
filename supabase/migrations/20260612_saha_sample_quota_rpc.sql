-- =============================================================================
-- Migration: saha_increment_sample_spent RPC (security-definer, auth.uid based)
-- Draft: 2026-06-12  |  Author: W1-5 (to be applied by Opus via MCP)
-- DO NOT APPLY directly — Opus will apply with MCP confirm_cost / apply_migration.
-- =============================================================================
--
-- Assumptions (verified via grep on supabase/migrations + src/):
--   Table:   public.saha_sample_quotas
--   Columns: rep_id uuid, year_month text, budget_tl numeric(10,2), spent_tl numeric(10,2)
--   UNIQUE constraint: (rep_id, year_month)
--   Source:  supabase/migrations/20260527000001_saha_sampling.sql lines 102-111
--
-- IMPORTANT — Signature change note:
--   The current client code (SampleFormMobile.tsx) calls:
--     supabase.rpc('saha_increment_sample_spent', { _rep_id, _year_month, _amount })
--   This new function uses (p_year_month, p_amount) and derives rep_id from auth.uid().
--   After applying this migration, the client call MUST be updated to the new signature:
--     supabase.rpc('saha_increment_sample_spent', { p_year_month, p_amount })
--   Coordinate with W1-5/Opus before applying.
-- =============================================================================

create or replace function public.saha_increment_sample_spent(
  p_year_month text,
  p_amount     numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rep_id uuid;
  v_budget numeric(10,2);
  v_spent  numeric(10,2);
begin
  -- 1. Auth guard
  v_rep_id := auth.uid();
  if v_rep_id is null then
    raise exception 'not_authenticated' using hint = 'User must be authenticated to call saha_increment_sample_spent';
  end if;

  -- 2. Input validation
  if p_amount < 0 then
    raise exception 'invalid_input' using hint = 'p_amount must be >= 0';
  end if;
  if p_year_month !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_input' using hint = 'p_year_month must match YYYY-MM format';
  end if;

  -- 3. Lock the quota row atomically (SELECT ... FOR UPDATE)
  select budget_tl, spent_tl
    into v_budget, v_spent
    from public.saha_sample_quotas
   where rep_id    = v_rep_id
     and year_month = p_year_month
  for update;

  -- 4a. No quota row — NO-OP (do not hard-block users without a quota record)
  if not found then
    return;
  end if;

  -- 4b. Budget exceeded guard
  if v_spent + p_amount > v_budget then
    raise exception 'budget_exceeded'
      using hint = format(
        'Rep %s has spent %.2f of %.2f budget for %s; requested %.2f would exceed it.',
        v_rep_id, v_spent, v_budget, p_year_month, p_amount
      );
  end if;

  -- 4c. Update spent
  update public.saha_sample_quotas
     set spent_tl   = v_spent + p_amount,
         updated_at = now()
   where rep_id     = v_rep_id
     and year_month  = p_year_month;

end;
$$;

-- Permissions: revoke from anon, grant to authenticated only
revoke all on function public.saha_increment_sample_spent(text, numeric) from anon;
grant execute on function public.saha_increment_sample_spent(text, numeric) to authenticated;
