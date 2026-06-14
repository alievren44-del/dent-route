-- ============================================================================
-- 20260614000005_reminder_attachments.sql
-- ----------------------------------------------------------------------------
-- FAZ D: Randevuya foto/ses eki. saha_reminder_attachments + private bucket
-- 'reminder-files'. Path: {reminder_id}/{uuid}.{ext}. RLS: reminder sahibi rep
-- veya admin. (visit-photos paterni; ancak admin için UPPER(role)/saha_is_admin
-- kullanır — visit_photos eski policy'si role='ADMIN' lowercase'i kaçırıyordu.)
-- Idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.saha_reminder_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reminder_id   uuid NOT NULL REFERENCES public.saha_reminders(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('photo','audio')),
  storage_path  text NOT NULL,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saha_reminder_attachments_reminder_idx
  ON public.saha_reminder_attachments (reminder_id);

ALTER TABLE public.saha_reminder_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ra_select ON public.saha_reminder_attachments;
CREATE POLICY ra_select ON public.saha_reminder_attachments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.saha_reminders r
          WHERE r.id = reminder_id AND (r.rep_id = auth.uid() OR public.saha_is_admin())));

DROP POLICY IF EXISTS ra_insert ON public.saha_reminder_attachments;
CREATE POLICY ra_insert ON public.saha_reminder_attachments FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.saha_reminders r
          WHERE r.id = reminder_id AND (r.rep_id = auth.uid() OR public.saha_is_admin())));

DROP POLICY IF EXISTS ra_delete ON public.saha_reminder_attachments;
CREATE POLICY ra_delete ON public.saha_reminder_attachments FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.saha_reminders r
          WHERE r.id = reminder_id AND (r.rep_id = auth.uid() OR public.saha_is_admin())));

-- Private bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('reminder-files', 'reminder-files', false)
ON CONFLICT (id) DO NOTHING;

-- Storage object policies (path 1. segment = reminder_id)
DROP POLICY IF EXISTS reminder_files_insert ON storage.objects;
CREATE POLICY reminder_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'reminder-files' AND EXISTS (
    SELECT 1 FROM public.saha_reminders r
    WHERE r.id::text = split_part(name, '/', 1) AND (r.rep_id = auth.uid() OR public.saha_is_admin())));

DROP POLICY IF EXISTS reminder_files_select ON storage.objects;
CREATE POLICY reminder_files_select ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'reminder-files' AND EXISTS (
    SELECT 1 FROM public.saha_reminders r
    WHERE r.id::text = split_part(name, '/', 1) AND (r.rep_id = auth.uid() OR public.saha_is_admin())));

DROP POLICY IF EXISTS reminder_files_delete ON storage.objects;
CREATE POLICY reminder_files_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'reminder-files' AND EXISTS (
    SELECT 1 FROM public.saha_reminders r
    WHERE r.id::text = split_part(name, '/', 1) AND (r.rep_id = auth.uid() OR public.saha_is_admin())));

COMMIT;
