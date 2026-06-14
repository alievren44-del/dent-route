-- ============================================================================
-- 20260614000006_reminder_outcome.sql
-- ----------------------------------------------------------------------------
-- FAZ F: Randevu tamamlamada sonuç + not kaydı. Plasiyer "Tamamla" derken ne
-- olduğunu (görüşüldü/tekrar-aranacak/sipariş/tahsil-edildi…) + not kaydeder →
-- sonradan hatırlama kolaylığı. UI sonuç kümesini kısıtlar (kolon serbest text).
-- Idempotent.
-- ============================================================================

BEGIN;

ALTER TABLE public.saha_reminders ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE public.saha_reminders ADD COLUMN IF NOT EXISTS completion_note text;
ALTER TABLE public.saha_reminders ADD COLUMN IF NOT EXISTS completed_at timestamptz;

COMMIT;
