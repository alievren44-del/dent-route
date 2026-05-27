# 01 — Supabase Kurulum

**Hedef:** Parla'nın mevcut Supabase projesini (rranpzicmhgfupgabgbi) ya da yeni bir proje kullanarak Saha modülünü deploy etmek.

## Karar: Parla mı, Yeni proje mi

`memory/parla_supabase_project.md` ve `memory/shared_db_policy.md` referans:

- **Parla projesi (rranpzicmhgfupgabgbi):** Mevcut. `saha_*` prefix politikası ile additive migration. **Önerilen yol.**
- **Yeni proje:** Bağımsız tenant istenirse. Plan'ın PROMPT-1 + PROMPT-3 vs şemaları yeni projeye temiz kurulur.

## A. Parla projesi kullanımı (önerilen)

### 1. CLI login
```bash
npx supabase login
```
Tarayıcı açılır, Parla GitHub hesabıyla yetkilendir. Erişim token şahsi.

### 2. Linkleme
```bash
cd C:\Users\PC\Desktop\navigasyon
npx supabase link --project-ref rranpzicmhgfupgabgbi
```
Veritabanı şifresi sorulursa Supabase Dashboard → Project Settings → Database → "Database Password" kısmından al (resetlemen gerekebilir, dikkat: Parla canlı kullanım var, gece yarısı yap).

### 3. Mevcut migration'ları çek
```bash
npx supabase db pull --schema public
```
Bu Parla'nın canonical şemasını local'e indirir. Sonra Claude'un yazdığı yeni migration'lar üzerine eklenir.

### 4. Çakışma kontrolü
```bash
npm run saha:check-migrations
```
Bu script `saha_*` prefix + allowlist kuralını doğrular.

## B. Yeni proje (alternatif)

1. https://supabase.com/dashboard → New Project
2. Region: **Frankfurt** (eu-central-1) — KVKK ve gecikme için
3. DB password güvenli sakla (parola yöneticisi)
4. Project Settings → API → URL + `anon` + `service_role` key kopyala (02-api-keyleri.md'ye yapıştır)
5. SQL Editor → şu extension'ları aç:
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```
6. `npx supabase link --project-ref <yeni-proje-ref>`
7. **Parla'nın 001_initial_schema'sını** elle SQL Editor'de çalıştır (yoksa Saha migration'ları bağımlılık eksikliğinden patlar) — VEYA Plan PROMPT-1'in "first_user_admin trigger" temiz başlatması için profiles + auth.users yeterli olabilir.

## Storage bucket

Visit fotoğrafları için (PROMPT-9):
```bash
# Supabase Dashboard → Storage → New bucket
# name: visit-photos
# public: NO
```
Veya SQL ile (migration zaten ekleyecek — manuel adım gerek yok eğer migration deploy edildiyse).

## Doğrulama

```bash
npx supabase status   # local stack için
npx supabase projects list   # cloud bağlantı
```

Tablolar gelmemişse `03-deploy-komutlari.md` adımına devam et.
