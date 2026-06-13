-- ============================================================================
-- 20260614000001_saha_reminders_calendar.sql
-- ----------------------------------------------------------------------------
-- Plasiyer Takvim & Hatırlatma sistemi + push dispatch + admin atama.
-- Tümü idempotent (IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- Bu dosya, oturumda MCP ile prod'a uygulanan değişiklikleri repo'ya taşır
-- (deploy-migrations her dosyayı yeniden uyguladığı için file = source of truth).
-- ============================================================================

BEGIN;

-- 0) RLS rol helper'ları — case-insensitive + tam rol kümesi.
-- ÖNEMLİ: Eski migration dosyaları bunları case-sensitive ('ADMIN'/'REP') ya da
-- eksik ('REP','ADMIN' — SALES_REP yok) tanımlıyor. deploy-migrations TÜM dosyaları
-- her seferinde yeniden uyguladığı için, bu EN SON timestamp'li dosya doğru sürümü
-- yeniden kurar (lexicographic sırada son → kazanır). sales_rep/manager rolleri +
-- karışık case ('admin'+'ADMIN') prod'da birlikte var.
CREATE OR REPLACE FUNCTION public.saha_is_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND UPPER(role) = 'ADMIN') $$;

CREATE OR REPLACE FUNCTION public.saha_is_manager_or_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND UPPER(role) IN ('ADMIN','MANAGER')) $$;

CREATE OR REPLACE FUNCTION public.saha_is_rep_or_admin()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND UPPER(role) IN ('REP','SALES_REP','MANAGER','ADMIN')) $$;

-- 1) Check-in idempotency (çift check-in + offline retry guard)
ALTER TABLE public.saha_visits ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS saha_visits_idempotency_key_uq
  ON public.saha_visits (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 2) saha_reminders — takvim/hatırlatma kayıtları
CREATE TABLE IF NOT EXISTS public.saha_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  account_id  text,
  visit_id    uuid REFERENCES public.saha_visits(id) ON DELETE SET NULL,
  type        text NOT NULL DEFAULT 'revisit',
  title       text,
  note        text,
  due_at      timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'open',
  created_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notified_at timestamptz,
  push_count  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Admin atama: hatırlatmayı kimin atadığı (rep_id != assigned_by ise atanmış).
ALTER TABLE public.saha_reminders ADD COLUMN IF NOT EXISTS notified_at timestamptz;
ALTER TABLE public.saha_reminders ADD COLUMN IF NOT EXISTS push_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.saha_reminders
  ADD COLUMN IF NOT EXISTS assigned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.saha_reminders DROP CONSTRAINT IF EXISTS saha_reminders_type_check;
ALTER TABLE public.saha_reminders ADD CONSTRAINT saha_reminders_type_check
  CHECK (type = ANY (ARRAY['revisit','appointment','tahsilat','tanitim','task','note']));
ALTER TABLE public.saha_reminders DROP CONSTRAINT IF EXISTS saha_reminders_status_check;
ALTER TABLE public.saha_reminders ADD CONSTRAINT saha_reminders_status_check
  CHECK (status = ANY (ARRAY['open','done','cancelled']));

CREATE INDEX IF NOT EXISTS saha_reminders_rep_due_idx ON public.saha_reminders (rep_id, due_at);
CREATE INDEX IF NOT EXISTS saha_reminders_visit_idx ON public.saha_reminders (visit_id);
CREATE INDEX IF NOT EXISTS saha_reminders_push_due_idx
  ON public.saha_reminders (due_at) WHERE status = 'open' AND notified_at IS NULL;

DROP TRIGGER IF EXISTS set_saha_reminders_updated_at ON public.saha_reminders;
CREATE TRIGGER set_saha_reminders_updated_at
  BEFORE UPDATE ON public.saha_reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.saha_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS saha_reminders_own_select ON public.saha_reminders;
CREATE POLICY saha_reminders_own_select ON public.saha_reminders
  FOR SELECT TO authenticated
  USING (rep_id = auth.uid() OR saha_is_admin());

-- INSERT: kendi hatırlatması (rep) VEYA admin (başka rep'e atama dahil).
DROP POLICY IF EXISTS saha_reminders_own_insert ON public.saha_reminders;
CREATE POLICY saha_reminders_own_insert ON public.saha_reminders
  FOR INSERT TO authenticated
  WITH CHECK ((rep_id = auth.uid() AND saha_is_rep_or_admin()) OR saha_is_admin());

DROP POLICY IF EXISTS saha_reminders_own_update ON public.saha_reminders;
CREATE POLICY saha_reminders_own_update ON public.saha_reminders
  FOR UPDATE TO authenticated
  USING (rep_id = auth.uid() OR saha_is_admin())
  WITH CHECK (rep_id = auth.uid() OR saha_is_admin());

DROP POLICY IF EXISTS saha_reminders_own_delete ON public.saha_reminders;
CREATE POLICY saha_reminders_own_delete ON public.saha_reminders
  FOR DELETE TO authenticated
  USING (rep_id = auth.uid() OR saha_is_admin());

-- 3) İzinler: invoicing erişimi + admin'in plasiyere atama yapabilmesi
INSERT INTO public.permissions (code, description) VALUES
  ('saha:invoicing:access', 'Saha: fatura/cari/ödeme/çek-senet/aging ekranlarına erişim'),
  ('saha:calendar:assignable', 'Saha: admin bu plasiyerin takvimine görev/randevu atayabilir')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_code)
SELECT r, 'saha:invoicing:access' FROM (VALUES ('admin'), ('ADMIN')) AS x(r)
ON CONFLICT DO NOTHING;

-- 4) Due reminder dispatch — notifications insert → mevcut send-push → FCM
CREATE OR REPLACE FUNCTION public.saha_dispatch_due_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r        record;
  v_count  integer := 0;
  v_clinic record;
  v_msg    text;
BEGIN
  FOR r IN
    SELECT * FROM public.saha_reminders
    WHERE status = 'open' AND notified_at IS NULL AND due_at <= now()
    ORDER BY due_at ASC
    LIMIT 200
  LOOP
    SELECT name, phone INTO v_clinic
      FROM public.saha_clinics WHERE id::text = r.account_id;

    v_msg := COALESCE(v_clinic.name, 'Klinik')
             || CASE WHEN r.note IS NOT NULL AND r.note <> '' THEN ' · ' || r.note ELSE '' END;

    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      r.rep_id,
      'system_alert',
      CASE r.type WHEN 'appointment' THEN 'Randevu hatırlatması' ELSE 'Ziyaret hatırlatması' END,
      v_msg,
      jsonb_build_object(
        'kind', 'visit_reminder', 'route', '/takvim', 'deeplink', '/takvim',
        'actionTypeId', 'VISIT_REMINDER', 'reminder_id', r.id, 'reminder_type', r.type,
        'account_id', r.account_id, 'clinic_name', v_clinic.name,
        'clinic_phone', v_clinic.phone, 'note', r.note
      )
    );

    UPDATE public.saha_reminders
       SET notified_at = now(), push_count = push_count + 1
     WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

COMMIT;

-- 5) pg_cron job (her 15 dk). Extension/cron yoksa migration'ı bloklama.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('saha-reminder-dispatch', '*/15 * * * *',
                          'select public.saha_dispatch_due_reminders();');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule atlandı: %', SQLERRM;
END;
$cron$;
