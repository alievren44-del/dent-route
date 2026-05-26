-- ============================================================================
-- Lokal Supabase Seed — Test kullanıcıları + saha verisi
-- ============================================================================
-- Bu dosya `npx supabase db reset` sonrası çağrılır.
-- Production'a UYGULANMAZ.
-- ============================================================================

BEGIN;

-- ─── Test Auth Users ─────────────────────────────────────────
-- supabase auth admin tools yerine direct insert (lokal-only)
-- Parolalar: 'sahaTest123' (bcrypt hash)

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated',
    'rep@parla.local',
    crypt('sahaTest123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Test Saha Rep"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated',
    'admin@parla.local',
    crypt('sahaTest123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Test Saha Admin"}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

-- Parla'nın handle_new_user trigger'ı profile yaratmış olabilir; yoksa zorla yarat.
-- Parla profiles Türkçe canonical: ad_soyad, telefon, klinik_adi.
INSERT INTO public.profiles (id, ad_soyad, email, role, region, avg_fuel_consumption, is_approved)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Test Saha Rep',   'rep@parla.local',   'REP',   'İstanbul-Avrupa', 7.0, true),
  ('22222222-2222-2222-2222-222222222222', 'Test Saha Admin', 'admin@parla.local', 'ADMIN', NULL,              7.0, true)
ON CONFLICT (id) DO UPDATE SET
  ad_soyad = EXCLUDED.ad_soyad,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  region = EXCLUDED.region,
  avg_fuel_consumption = EXCLUDED.avg_fuel_consumption,
  is_approved = EXCLUDED.is_approved;

-- ─── Test Saha Verisi ────────────────────────────────────────

-- Test atama: rep'e iki klinik atanır (rastgele Parla profile UUID'leri)
-- NOT: Gerçek profile id'leri Parla'da bulunduğu için lokal'de stub UUID kullanıyoruz.
INSERT INTO public.saha_assignments (profile_id, account_id, assigned_by)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'test-clinic-001', '22222222-2222-2222-2222-222222222222'),
  ('11111111-1111-1111-1111-111111111111', 'test-clinic-002', '22222222-2222-2222-2222-222222222222')
ON CONFLICT (profile_id, account_id) DO NOTHING;

COMMIT;

-- Smoke test:
-- SELECT email, role FROM auth.users JOIN profiles USING (id);
-- SELECT * FROM saha_assignments;
