-- ============================================================================
-- CANLI DB HOTFIX — Supabase SQL Editor'a yapıştır, RUN.
-- Telefon testinin ÇALIŞMASI için gerekli (bug3 cari + bug4 not).
-- İdempotent: birden fazla çalıştırmak güvenli.
-- ============================================================================

-- BUG 3 — saha_cariler.sales_rep_id eksik kolon (migration sıra hatası)
ALTER TABLE public.saha_cariler
  ADD COLUMN IF NOT EXISTS sales_rep_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_saha_cariler_sales_rep
  ON public.saha_cariler(sales_rep_id) WHERE sales_rep_id IS NOT NULL;

-- BUG 4 — saha_account_notes tablo + RLS (müşteri kartı notları)
BEGIN;

CREATE TABLE IF NOT EXISTS public.saha_account_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL,
  rep_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saha_account_notes_account_created
  ON public.saha_account_notes(account_id, created_at DESC);

ALTER TABLE public.saha_account_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saha_account_notes_own_select" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_select" ON public.saha_account_notes
  FOR SELECT USING (
    rep_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('ADMIN','MANAGER'))
  );

DROP POLICY IF EXISTS "saha_account_notes_own_insert" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_insert" ON public.saha_account_notes
  FOR INSERT WITH CHECK (
    rep_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('ADMIN','MANAGER'))
  );

DROP POLICY IF EXISTS "saha_account_notes_own_delete" ON public.saha_account_notes;
CREATE POLICY "saha_account_notes_own_delete" ON public.saha_account_notes
  FOR DELETE USING (
    rep_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('ADMIN','MANAGER'))
  );

COMMIT;
