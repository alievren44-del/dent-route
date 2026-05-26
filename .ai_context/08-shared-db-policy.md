# 🔐 Shared DB Policy — Paylaşımlı Parla Supabase

> Tarih: 2026-05-25
> Karar: Navigasyon, Parla web ve Parla mobil app aynı Supabase projesini paylaşır (`rranpzicmhgfupgabgbi`).
> Bu doküman üç ürün arasında **DB karışmama disiplinini** belirler.

---

## 1. Ürünler ve Sahiplik

| Ürün | Repo Konumu | DB Sorumluluk |
|---|---|---|
| **Parla Web Sitesi** | `Desktop/web sitesi/` | `public.*` (çekirdek B2B sistem) |
| **Parla Mobil App** | `Desktop/parla app/` | `public.*` (paylaşımlı — web ile aynı) |
| **Saha Navigasyon** | `Desktop/navigasyon/` | `public.saha_*` (yeni katman) + allowlist ALTER |

**Aynı Supabase projesi, üç ayrı codebase. Migration'lar zaman damgasına göre uygulanır.**

---

## 2. Tablo Sahipliği Matrisi

### 2.1 Saha-Owned (navigasyon yazabilir)

Tüm `saha_` prefix tablolar **yalnızca navigasyon repo** tarafından yönetilir:

- `saha_routes`
- `saha_mileage_logs`
- `saha_sync_queue`
- `saha_assignments`
- (gelecek: `saha_*` ile başlayan her şey)

CI guard (`scripts/check-saha-migrations.ts`) navigasyon migration'larının yalnızca bu prefix'i yarattığını doğrular.

### 2.2 Parla-Owned (navigasyon DOKUNMAZ)

Bu tabloları yalnızca Parla web/app repo migration'ları değiştirebilir:

- `orders`, `order_items`, `order_status_history`
- `products`, `variant_combinations`, `product_reviews`, `brands`
- `customer_accounts`, `account_transactions`, `wallet_transactions`
- `addresses`, `wishlist`, `cart_items`, `pending_carts`, `shared_carts`
- `campaigns`, `coupons`, `kit_templates`
- `notifications`, `device_tokens`, `scheduled_notifications`
- `backorder_*`, `rma_requests`, `rma_*`
- `blog_posts`, `banners`, `legal_pages`, `email_templates`
- `auth_events`, `admin_action_log`, `rate_limit_events`
- `dealer_clinic_canonical`, `fanta_*`, `olident_*`, `okodent_*`, `clearone_*`, `biowhiten_*`
- `aging_report` views, `effective_stock`
- (genel kural: `saha_` prefix DEĞİL ve allowlist'te DEĞİL ise Parla'nındır)

### 2.3 Shared (allowlist ile dokunulabilir)

Sprint 1 boyunca navigasyon **açıkça izinli** olarak şu Parla tablolarına dokunur:

| Tablo | İzinli İşlem | Eklenen Kolonlar | Gerekçe |
|---|---|---|---|
| `profiles` | `ALTER ADD COLUMN` | `avg_fuel_consumption`, `region`, `kvkk_accepted_at`, `kvkk_version` | Saha rep'in araç + KVKK bilgisi |
| `rep_visits` | `ALTER ADD COLUMN` | `route_id`, `photos`, `custom_fields`, `next_action`, `next_action_due`, `check_in_location` | Saha modülünün ihtiyaç duyduğu metadata |
| `permissions` | `INSERT … ON CONFLICT DO NOTHING` | `saha:*` izin kodları | RBAC seed |
| `role_permissions` | `INSERT … ON CONFLICT DO NOTHING` | REP/ADMIN → saha izinleri | RBAC seed |

**Bu allowlist kilitlidir.** Yeni Parla tablosu ALTER etmek isteniyorsa:

1. PR ile bu dokümanı güncelle (allowlist tablo + kolonlar).
2. CI guard script'inde `PARLA_TABLE_ALTER_ALLOWLIST` veya `PARLA_TABLE_INSERT_ALLOWLIST` güncelle.
3. Parla web/app developer'ı PR'ı review etsin (cross-team approval).
4. Ancak ondan sonra migration yazılır.

---

## 3. Naming Convention

### Migration dosya adı

Tüm navigasyon migration'ları:

```
supabase/migrations/<YYYYMMDDHHMMSS>_saha_<topic>.sql
```

Örnek: `20260525000001_saha_extension.sql`

- Timestamp: 14 hane (Parla repo stiliyle uyumlu)
- `saha_` zorunlu ek
- Topic: lowercase, snake_case, kısa

### CI guard regex

`^\d{14}_saha_[a-z0-9_]+\.sql$`

`migrations-greenfield/` dizini guard'dan muaftır (yeni tenant deployment referansı).

### Tablo adı

- `saha_<entity>` — örn: `saha_routes`, `saha_visits`, `saha_mileage_logs`
- View: `saha_<entity>_view` veya `v_saha_<entity>`
- Function: `saha_<verb>_<entity>` — örn: `saha_is_admin()`, `saha_is_rep_or_admin()`
- RLS policy: serbest, ama tablo adı saha_ prefix taşır.

### Permission code

- `saha:<resource>:<action>` — örn: `saha:visit:create`, `saha:route:read`
- Parla'nın diğer kodlarıyla çakışmaz çünkü `saha:` namespace.

---

## 4. Migration Workflow (Supabase Branching)

**Asla doğrudan Parla prod Supabase'ine push yapılmaz.**

Akış:

```
1. Geliştirici navigasyon repo'da migration yazar:
   supabase/migrations/20260601000001_saha_xxx.sql

2. Lokal lint + CI guard:
   npm run saha:check-migrations
   npm run lint
   npm run typecheck

3. Branch oluştur (ilk kez):
   supabase link --project-ref rranpzicmhgfupgabgbi
   supabase branches create saha-dev

4. Branch'e push:
   supabase db push --branch saha-dev

5. Branch'te smoke test:
   - Şema farkı al: supabase db diff --branch saha-dev
   - Manuel SQL sorgu ile yeni tabloları doğrula
   - Navigasyon app'ı branch URL'ine point edip test et

6. PR review:
   - GitHub PR aç (navigasyon repo)
   - Parla web/app developer review etsin (cross-team)
   - CI: lint + typecheck + saha:check-migrations + build geçmeli

7. Prod merge:
   - PR onaylanınca: supabase branches merge saha-dev
   - VEYA: supabase db push (main'e direkt — branch silinir)

8. Backup ZORUNLU prod push'tan önce:
   supabase db dump --db-url <prod-url> > backup-pre-saha-YYYY-MM-DD.sql
```

Detay: `supabase/branching-workflow.md`

---

## 5. Yasak İşlemler

Navigasyon migration'ı şunları YAPMAZ:

- ❌ `CREATE TABLE public.<allowlist-disi>` — saha_ prefix olmayan tablo yaratamaz
- ❌ `DROP TABLE public.<parla-table>` — Parla tablosu silemez
- ❌ `ALTER TABLE public.<allowlist-disi>` — allowlist dışı ALTER
- ❌ `DELETE FROM public.<parla-table>` — Parla verisini silemez
- ❌ `CREATE FUNCTION public.<non-saha-name>` — saha_ prefix olmayan veya `set_updated_at` dışı fonksiyon
- ❌ `auth.users` tablosuna doğrudan müdahale — Supabase Auth yönetir

İhtiyaç ortaya çıkarsa: önce policy doc güncelle, sonra migration.

---

## 6. RLS Politikaları

Navigasyon'un eklediği RLS politikaları:

- `saha_routes_*`, `saha_mileage_*`, `saha_sync_*`, `saha_assignments_*`
- Yardımcı fonksiyonlar: `saha_is_admin()`, `saha_is_rep_or_admin()`

**Parla'nın mevcut RLS politikalarını DEĞİŞTİRMEZ.** Sadece kendi tablolarına politika ekler.

Cross-table query (örn: navigasyon `profiles`'tan rol okur):
- `SELECT` izni Parla'nın RLS'siyle çalışır (kullanıcı kendi profilini görür).
- `UPDATE kvkk_accepted_at` Parla RLS'sinde mevcut "Users can update own profile" politikasıyla çalışır.

---

## 7. Auth Sharing

- Tek `auth.users` tablosu (Supabase yönetir)
- Parla web `parla-app-auth` storage key (Parla web'in localStorage'ı)
- Parla mobile kendi storage key
- Saha navigasyon `saha-app-auth` storage key — ayrı session ama aynı user

Aynı kullanıcı (örn: REP rolündeki saha temsilcisi) Parla web'e ve navigasyon'a aynı email/parola ile girer. Session'lar bağımsız (cookie/storage ayrı).

---

## 8. Acil Durum (Emergency Rollback)

Saha migration prod'da sorun yaratırsa:

```bash
# 1. Migration revert (DROP yeni tablolar, ALTER geri al)
psql <prod-url> -f supabase/migrations-emergency/revert-saha-extension.sql

# 2. Veya backup'tan restore
psql <prod-url> < backup-pre-saha-YYYY-MM-DD.sql
```

Revert script'i her major migration için yazılmalı (Sprint 2'den itibaren zorunlu).

---

## 9. Sürüm

| Versiyon | Tarih | Değişiklik |
|---|---|---|
| 1.0 | 2026-05-25 | İlk sürüm. Sprint 1 ALTER allowlist + CI guard. |
