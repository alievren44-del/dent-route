# Kullanıcı Görevleri — Önce Bunu Oku

Bu klasör Claude'un **yapamadığı** ama uygulamanın çalışması için **senin yapman gereken** adımları içerir.

## Klasör mantığı

| Dosya | Ne zaman |
|-------|----------|
| 01-supabase-kurulum.md | İlk başta — DB olmadan hiçbir şey çalışmaz |
| 02-api-keyleri.md | Supabase'den sonra — Mapbox, Google, env doldur |
| 03-deploy-komutlari.md | Kodlama bitince — migration + Edge Function deploy |
| 04-sivas-excel.md | PROMPT-2 hazır olunca — eski veri yükleme |
| 05-test-akisi.md | Her PROMPT sonrası doğrulama listesi |
| 06-bilinen-notlar.md | Plan + repo arası küçük tutarsızlıklar |

## Claude'un yapacakları (paralel devam ediyor)

`memory/MEMORY.md` index + bu repo'da `src/`, `scripts/`, `supabase/` altındaki tüm kod, migration, Edge Function dosyaları.

Senin kodlama yapman gerekmez. Sadece bu klasördeki yapılacaklar.

## Sıra

1. `01-supabase-kurulum.md` → Supabase projesi ayarla
2. `02-api-keyleri.md` → tüm key'ler `.env` içinde
3. Claude'un yazdığı kodu `npm install` ile yükle
4. `03-deploy-komutlari.md` → migration + Edge Functions deploy
5. `npm run dev` → tarayıcıda http://localhost:5173 → "İlk Admin Kurulumu" akışı
6. PROMPT'lar bittikçe `05-test-akisi.md` doğrulama
7. `06-bilinen-notlar.md` → plan/repo farkları
