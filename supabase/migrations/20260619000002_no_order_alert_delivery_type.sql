-- FAZ-3 (debug_reports 2026-06-19): malzeme teslimi ≠ randevu görüşmesi +
-- 1 ay sipariş vermeyen carilere otomatik uyarı (plasiyer + admin).
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Yeni reminder tipleri
--    malzeme_teslim : takvimde teslim kaydı (randevu görüşmesinden ayrı)
--    no_order_alert : 1 ay sipariş yok uyarısı (cron üretir)
-- ----------------------------------------------------------------------------
ALTER TABLE public.saha_reminders DROP CONSTRAINT IF EXISTS saha_reminders_type_check;
ALTER TABLE public.saha_reminders ADD CONSTRAINT saha_reminders_type_check
  CHECK (type = ANY (ARRAY[
    'revisit','appointment','tahsilat','tanitim','task','note',
    'malzeme_teslim','no_order_alert'
  ]));

-- ----------------------------------------------------------------------------
-- 2. 1 ay sipariş vermeyen cari uyarısı
--    Aktif cari (plasiyer atalı + klinik bağlı), son sipariş > 1 ay önce
--    (veya hiç sipariş + cari 1 aydan eski). Aya bir kez (source_ref ay damgalı).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.saha_generate_no_order_reminders()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_count integer := 0;
  v_n     integer := 0;
  v_month text := to_char(now() AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM');
  r       record;
BEGIN
  FOR r IN
    SELECT c.id AS cari_id, c.sales_rep_id, c.clinic_id, c.fatura_unvani,
           COALESCE(MAX(o.created_at), c.created_at) AS last_activity
    FROM public.saha_cariler c
    LEFT JOIN public.orders o ON o.cari_id = c.id
    WHERE c.sales_rep_id IS NOT NULL
      AND c.clinic_id IS NOT NULL
      AND COALESCE(c.durum, 'aktif') <> 'pasif'
    GROUP BY c.id, c.sales_rep_id, c.clinic_id, c.fatura_unvani, c.created_at
    HAVING COALESCE(MAX(o.created_at), c.created_at) < now() - interval '1 month'
  LOOP
    INSERT INTO public.saha_reminders
      (rep_id, account_id, type, title, note, due_at, status, created_by, source_ref)
    VALUES (
      r.sales_rep_id, r.clinic_id::text, 'no_order_alert',
      COALESCE(r.fatura_unvani, 'Klinik') || ' — 1 aydır sipariş yok',
      'Bu klinik 1 aydır malzeme siparişi vermedi. İletişime geç (rakip firma riski).',
      now(), 'open', r.sales_rep_id,
      'no_order:' || r.cari_id::text || ':' || v_month
    )
    ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n > 0 THEN
      v_count := v_count + 1;
      -- Admin/manager'lara bilgi bildirimi (push tablosu)
      INSERT INTO public.notifications (user_id, type, title, message, data)
      SELECT p.id, 'system_alert',
             'Pasif klinik uyarısı',
             COALESCE(r.fatura_unvani, 'Klinik') || ' 1 aydır sipariş vermedi — iletişime geçilmeli.',
             jsonb_build_object(
               'kind', 'no_order_alert',
               'route', '/invoicing/cari/' || r.cari_id::text,
               'cari_id', r.cari_id, 'clinic_id', r.clinic_id
             )
      FROM public.profiles p
      WHERE lower(p.role) IN ('admin', 'manager');
    END IF;
  END LOOP;
  RETURN v_count;
END;
$fn$;

-- Günlük cron 07:00 (idempotent)
SELECT cron.schedule(
  'saha-no-order-alerts',
  '0 7 * * *',
  'SELECT public.saha_generate_no_order_reminders()'
);

-- ----------------------------------------------------------------------------
-- 3. dispatch push başlık etiketleri — yeni tipler için doğru başlık
--    (20260614000003 gövdesi + no_order_alert/malzeme_teslim CASE arms)
-- ----------------------------------------------------------------------------
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
        WHEN 'appointment'    THEN 'Randevu hatırlatması'
        WHEN 'tahsilat'       THEN 'Tahsilat hatırlatması'
        WHEN 'malzeme_teslim' THEN 'Malzeme teslimi'
        WHEN 'no_order_alert' THEN 'Pasif klinik — sipariş yok'
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
