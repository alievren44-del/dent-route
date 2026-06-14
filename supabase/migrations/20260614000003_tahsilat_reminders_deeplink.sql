-- ============================================================================
-- 20260614000003_tahsilat_reminders_deeplink.sql
-- ----------------------------------------------------------------------------
-- FAZ A (plasiyer takvim):
--  A1) Tahsilat vade → otomatik 'tahsilat' reminder (çek/senet + fatura vadesi
--      yaklaşınca). Mevcut saha_dispatch_due_reminders() bunları push'lar.
--  A2) Bildirim deep-link'i spesifik randevuya: dispatch route = /takvim?reminder=<id>.
-- Idempotent (CREATE OR REPLACE / IF NOT EXISTS / ON CONFLICT).
-- ============================================================================

BEGIN;

-- A1: dedupe anahtarı (cron her gün çalışır; aynı çek/fatura için çift üretmesin)
ALTER TABLE public.saha_reminders ADD COLUMN IF NOT EXISTS source_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS saha_reminders_source_ref_uq
  ON public.saha_reminders (source_ref) WHERE source_ref IS NOT NULL;

-- A1: vade yaklaşan çek/senet + fatura → tahsilat reminder üret.
CREATE OR REPLACE FUNCTION public.saha_generate_collection_reminders()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_count integer := 0;
  v_n     integer := 0;
BEGIN
  -- Çek/senet: portföyde/tahsile-verilmiş + vadesi 0-3 gün içinde.
  INSERT INTO public.saha_reminders
    (rep_id, account_id, type, title, note, due_at, status, created_by, source_ref)
  SELECT
    cr.sales_rep_id,
    cr.account_id::text,
    'tahsilat',
    'Çek/Senet vadesi: ' || to_char(c.tutar, 'FM999G999G990D00') || ' TL',
    'Vade ' || to_char(c.vade_tarihi, 'DD.MM.YYYY'),
    (c.vade_tarihi::timestamp + interval '9 hours') AT TIME ZONE 'Europe/Istanbul',
    'open',
    cr.sales_rep_id,
    'cek:' || c.id::text
  FROM public.saha_cek_senetler c
  JOIN public.saha_cariler cr ON cr.id = c.cari_id
  WHERE c.durum IN ('portfoyde','tahsile_verildi')
    AND c.vade_tarihi >= current_date
    AND c.vade_tarihi <= current_date + 3
    AND cr.sales_rep_id IS NOT NULL
  ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  -- Fatura: ödenmemiş bakiye + vadesi 0-3 gün içinde.
  INSERT INTO public.saha_reminders
    (rep_id, account_id, type, title, note, due_at, status, created_by, source_ref)
  SELECT
    cr.sales_rep_id,
    cr.account_id::text,
    'tahsilat',
    'Fatura vadesi: ' || COALESCE(f.fatura_no, '—') || ' (' || to_char(f.kalan, 'FM999G999G990D00') || ' TL)',
    'Vade ' || to_char(f.vade_tarihi, 'DD.MM.YYYY'),
    (f.vade_tarihi::timestamp + interval '9 hours') AT TIME ZONE 'Europe/Istanbul',
    'open',
    cr.sales_rep_id,
    'fatura:' || f.id::text
  FROM public.saha_faturalar f
  JOIN public.saha_cariler cr ON cr.id = f.cari_id
  WHERE f.kalan > 0
    AND f.durum NOT IN ('odendi','iptal')
    AND f.vade_tarihi >= current_date
    AND f.vade_tarihi <= current_date + 3
    AND cr.sales_rep_id IS NOT NULL
  ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT; v_count := v_count + v_n;

  RETURN v_count;
END;
$fn$;

-- Günlük cron (06:00). cron.schedule aynı isimle idempotent (varsa günceller).
SELECT cron.schedule(
  'saha-collection-reminders',
  '0 6 * * *',
  'SELECT public.saha_generate_collection_reminders()'
);

-- A2: dispatch push deep-link'ini spesifik randevuya yönlendir (/takvim?reminder=<id>).
CREATE OR REPLACE FUNCTION public.saha_dispatch_due_reminders()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  r        record;
  v_count  integer := 0;
  v_clinic record;
  v_msg    text;
  v_route  text;
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
    v_route := '/takvim?reminder=' || r.id::text;

    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
      r.rep_id,
      'system_alert',
      CASE r.type
        WHEN 'appointment' THEN 'Randevu hatırlatması'
        WHEN 'tahsilat'    THEN 'Tahsilat hatırlatması'
        ELSE 'Ziyaret hatırlatması' END,
      v_msg,
      jsonb_build_object(
        'kind', 'visit_reminder', 'route', v_route, 'deeplink', v_route,
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
$fn$;

COMMIT;
