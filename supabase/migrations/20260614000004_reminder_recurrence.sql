-- ============================================================================
-- 20260614000004_reminder_recurrence.sql
-- ----------------------------------------------------------------------------
-- FAZ C3: Tekrarlayan randevu. saha_reminders.recurrence ('none'|'weekly'|'monthly').
-- markDone (frontend) recurrence<>'none' ise tamamlanınca sonraki occurrence'ı üretir.
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.saha_reminders
  ADD COLUMN IF NOT EXISTS recurrence text NOT NULL DEFAULT 'none';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'saha_reminders_recurrence_check'
  ) THEN
    ALTER TABLE public.saha_reminders
      ADD CONSTRAINT saha_reminders_recurrence_check
      CHECK (recurrence IN ('none','weekly','monthly'));
  END IF;
END $$;

COMMIT;
