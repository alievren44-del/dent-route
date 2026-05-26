# 🌿 Supabase Branching Workflow — Saha Navigasyon

> Parla web + mobil app + saha navigasyon **aynı Supabase projesini** paylaşır (`rranpzicmhgfupgabgbi`).
> Bu doküman saha migration'larını **Parla prod DB'ye dokunmadan** test etmek için kullanılan workflow'u anlatır.

Politika: `.ai_context/08-shared-db-policy.md`

---

## 🎯 Strateji: Lokal Supabase Stack

Supabase native branching **Pro plan** ($25/ay) gerektirir. Free tier'da branching yok.

**Çözüm:** Lokal Docker stack. Parla prod schema clone'una saha migration'ları uygular. Maliyet 0, full isolation.

```
[Lokal makine]                        [Parla Cloud]
                                      ┌─────────────┐
   Supabase CLI                       │ Prod DB     │
   ↓                                  │             │
   supabase db dump  ───────────────→ │ public      │
   (baseline dump)                    │ fanta,...   │
   ↓                                  └─────────────┘
   supabase/migrations/                       ↑
     00000000000000_parla_baseline_local.sql  │
     20260525000001_saha_extension.sql        │
   ↓                                          │ MERGE prod'a
   supabase start                             │ (manuel, backup'lı)
   ↓
   ┌─────────────────┐
   │ Lokal Postgres  │
   │ 127.0.0.1:54322 │
   └─────────────────┘
```

---

## 0. Tek Sefer Kurulum

### Docker Desktop

Çalışıyor olmalı: `docker ps` test et.

### Supabase CLI

```powershell
# Lokal devDependency olarak yüklendi (npm install --save-dev supabase)
npx supabase --version
```

### Login + link

```powershell
npx supabase login
npx supabase link --project-ref rranpzicmhgfupgabgbi
```

---

## 1. İlk Lokal Reset

```powershell
cd C:\Users\PC\Desktop\navigasyon
npm run db:local-reset
```

Bu komut:
1. Eski lokal stack'i durdurur
2. Parla baseline yoksa prod'tan dump eder (`db:local-dump-baseline`)
3. Stack başlatır (`supabase start`)
4. Migrations otomatik uygulanır:
   - `00000000000000_parla_baseline_local.sql` (Parla prod schema clone)
   - `20260525000001_saha_extension.sql` (saha modülü)

Başarılı çıktı:

```
API:    http://127.0.0.1:54321
DB:     postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio: http://127.0.0.1:54323
```

---

## 2. Test Kullanıcısı

Lokal seed (`supabase/local/seed.sql`) iki test hesabı yaratır:

| Email | Parola | Rol |
|---|---|---|
| `rep@parla.local` | `sahaTest123` | REP |
| `admin@parla.local` | `sahaTest123` | ADMIN |

Apply (yeniden seed gerekirse):

```powershell
docker exec -i supabase_db_navigasyon psql -U postgres -d postgres < supabase/local/seed.sql
```

---

## 3. Lokal'de Dev Server

`.env.local` lokal stack credentials'a point eder:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH
```

Vite `.env.local`'i `.env`'den ÖNCE okur. Lokal dev:

```powershell
npm run dev
```

`http://localhost:5173/login` → `rep@parla.local` / `sahaTest123` ile giriş.

---

## 4. Yeni Migration Yazma Akışı

```powershell
# 1. Yeni migration dosyası yarat (timestamp + saha_ prefix)
$ts = Get-Date -Format "yyyyMMddHHmmss"
New-Item "supabase/migrations/${ts}_saha_visit_form.sql"

# 2. SQL yaz, kaydet

# 3. Lokal kontroller
npm run saha:check-migrations
npm run lint
npm run typecheck

# 4. Lokal'de uygula (reset gerek yok; sadece yeni dosya çalıştır)
docker exec -i supabase_db_navigasyon psql -U postgres -d postgres < "supabase/migrations/${ts}_saha_visit_form.sql"

# 5. Smoke test (Studio veya psql ile yeni tabloları kontrol et)
docker exec supabase_db_navigasyon psql -U postgres -d postgres -c "\d public.saha_*"

# 6. Tam reset gerekirse:
npm run db:local-reset
```

---

## 5. Smoke SQL

```powershell
# Saha tabloları
docker exec supabase_db_navigasyon psql -U postgres -d postgres -c `
  "SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'saha_%';"

# Profile ek kolonlar
docker exec supabase_db_navigasyon psql -U postgres -d postgres -c `
  "SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name LIKE 'kvkk%' OR column_name='avg_fuel_consumption';"

# Permission seeds
docker exec supabase_db_navigasyon psql -U postgres -d postgres -c `
  "SELECT code FROM permissions WHERE code LIKE 'saha:%';"
```

---

## 6. PR Review

GitHub'da navigasyon repo'ya PR aç. CI pipeline:

1. Lint
2. Format check
3. Vertical validate
4. **Saha migration guard** (yasak işlem yakalama)
5. Typecheck
6. Unit test
7. Build

Hepsi yeşil olmalı. `.ai_context/08-shared-db-policy.md` §2.3 allowlist değişiyorsa cross-team approval gerek (Parla web/app developer review).

---

## 7. Prod'a Merge

**Backup ZORUNLU:**

```powershell
# Tarih damgalı backup
$date = Get-Date -Format "yyyy-MM-dd"
npx supabase db dump --linked -f "backup-pre-saha-$date.sql"
```

Backup OneDrive veya Drive'a yedekle.

Prod'a apply (manuel — `supabase db push` ALL migrations uygular, baseline dosyası gitignored ama ileri kademede yine push edilmesin):

```powershell
# Sadece saha extension'ı uygula (baseline lokal-only)
# Önce psql connection string al:
$prodUrl = "postgresql://postgres.<...>:<password>@aws-...supabase.com:6543/postgres"

psql $prodUrl -f "supabase/migrations/20260525000001_saha_extension.sql"
```

Doğrula:

```powershell
psql $prodUrl -c "SELECT * FROM saha_routes LIMIT 1;"
psql $prodUrl -c "SELECT code FROM permissions WHERE code LIKE 'saha:%';"
```

---

## 8. Acil Rollback

Migration prod'da sorun çıkardı?

```powershell
# Backup'tan restore
psql $prodUrl < "backup-pre-saha-2026-05-25.sql"

# Veya hand-written revert
psql $prodUrl -f "supabase/migrations-emergency/revert-saha-extension.sql"
```

Revert script şablonu:

```sql
-- supabase/migrations-emergency/revert-saha-extension.sql
BEGIN;
DROP TABLE IF EXISTS public.saha_assignments CASCADE;
DROP TABLE IF EXISTS public.saha_sync_queue CASCADE;
DROP TABLE IF EXISTS public.saha_mileage_logs CASCADE;
DROP TABLE IF EXISTS public.saha_routes CASCADE;

ALTER TABLE public.profiles DROP COLUMN IF EXISTS avg_fuel_consumption;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS region;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS kvkk_accepted_at;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS kvkk_version;

ALTER TABLE public.rep_visits DROP COLUMN IF EXISTS route_id;
ALTER TABLE public.rep_visits DROP COLUMN IF EXISTS photos;
ALTER TABLE public.rep_visits DROP COLUMN IF EXISTS custom_fields;
ALTER TABLE public.rep_visits DROP COLUMN IF EXISTS next_action;
ALTER TABLE public.rep_visits DROP COLUMN IF EXISTS next_action_due;
ALTER TABLE public.rep_visits DROP COLUMN IF EXISTS check_in_location;

DELETE FROM public.role_permissions WHERE permission_code LIKE 'saha:%';
DELETE FROM public.permissions WHERE code LIKE 'saha:%';

DROP FUNCTION IF EXISTS public.saha_is_admin();
DROP FUNCTION IF EXISTS public.saha_is_rep_or_admin();
COMMIT;
```

---

## 9. Baseline Güncellemesi

Parla web/app developer'ı yeni migration eklediyse lokal baseline güncel değildir:

```powershell
npm run db:local-dump-baseline
npm run db:local-reset
```

Bu komut Parla prod'tan en son schema'yı çeker, lokal'i sıfırlar.

---

## 10. Hızlı Komut Referansı

| Amaç | Komut |
|---|---|
| Login | `npx supabase login` |
| Proje link | `npx supabase link --project-ref rranpzicmhgfupgabgbi` |
| Lokal stack başlat | `npm run db:local-reset` |
| Baseline yenile | `npm run db:local-dump-baseline` |
| Stack durdur | `npx supabase stop` |
| Studio aç | `start http://127.0.0.1:54323` |
| Prod backup | `npx supabase db dump --linked -f backup.sql` |
| Migration guard | `npm run saha:check-migrations` |
| Manuel migration apply | `docker exec -i supabase_db_navigasyon psql -U postgres -d postgres < migration.sql` |

---

## 11. Gelecek: Pro Plan Branching

Saha tenant sayısı artarsa veya tüm geliştirme cloud'a taşınmak istenirse Pro plan'a yükselt:

```powershell
npx supabase branches create saha-dev
npx supabase db push --branch saha-dev
npx supabase branches merge saha-dev
```

Eski branching dökümü `git log` ile bulunur.
