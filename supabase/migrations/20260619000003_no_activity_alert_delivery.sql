-- FAZ-3.1 (2026-06-19): 1-ay-pasif uyarısını SİPARİŞ + TESLİMAT birlikte değerlendir.
-- Önceki sürüm yalnızca orders.created_at'e bakıyordu. Artık cari "aktif" sayılır
-- eğer son SİPARİŞ veya son tamamlanan MALZEME TESLİMİ (saha_reminders type=
-- 'malzeme_teslim', status='done') 1 ay içindeyse. Her ikisi de 1 aydan eskiyse
-- (rakip riski) plasiyer + admin'e uyarı.
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
    SELECT
      c.id AS cari_id, c.sales_rep_id, c.clinic_id, c.fatura_unvani,
      GREATEST(
        MAX(o.created_at),                 -- son sipariş
        MAX(d.due_at),                     -- son tamamlanan malzeme teslimi
        c.created_at                       -- cari oluşturma (taban)
      ) AS last_activity
    FROM public.saha_cariler c
    LEFT JOIN public.orders o
      ON o.cari_id = c.id
    LEFT JOIN public.saha_reminders d
      ON d.account_id = c.clinic_id::text
     AND d.type = 'malzeme_teslim'
     AND d.status = 'done'
    WHERE c.sales_rep_id IS NOT NULL
      AND c.clinic_id IS NOT NULL
      AND COALESCE(c.durum, 'aktif') <> 'pasif'
    GROUP BY c.id, c.sales_rep_id, c.clinic_id, c.fatura_unvani, c.created_at
    HAVING GREATEST(MAX(o.created_at), MAX(d.due_at), c.created_at)
           < now() - interval '1 month'
  LOOP
    INSERT INTO public.saha_reminders
      (rep_id, account_id, type, title, note, due_at, status, created_by, source_ref)
    VALUES (
      r.sales_rep_id, r.clinic_id::text, 'no_order_alert',
      COALESCE(r.fatura_unvani, 'Klinik') || ' — 1 aydır sipariş/teslimat yok',
      'Bu klinik 1 aydır sipariş vermedi ve malzeme teslimi yapılmadı. İletişime geç (rakip firma riski).',
      now(), 'open', r.sales_rep_id,
      'no_order:' || r.cari_id::text || ':' || v_month
    )
    ON CONFLICT (source_ref) WHERE source_ref IS NOT NULL DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;

    IF v_n > 0 THEN
      v_count := v_count + 1;
      INSERT INTO public.notifications (user_id, type, title, message, data)
      SELECT p.id, 'system_alert',
             'Pasif klinik uyarısı',
             COALESCE(r.fatura_unvani, 'Klinik') || ' 1 aydır sipariş/teslimat yok — iletişime geçilmeli.',
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
