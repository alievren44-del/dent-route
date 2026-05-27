# AKTUEL YAPILACAKLAR (2026-05-26 son durum)

Önceki dosyaların çoğunda yazan adımlar **zaten yapılmış**. Bu dosya gerçekten kalanları içerir.

## ZATEN YAPILMIŞ — atla

| Adım | Kaynak / Doğrulama |
|------|---------------------|
| ✅ Node + `npm install` (xlsx/sonner/qrcode dahil) | `node_modules/` mevcut, paketler yüklü |
| ✅ Git init + GitHub remote | `alievren44-del/dent-route` zaten push edilmiş (Sprint 5-7 commit'leri) |
| ✅ Supabase CLI login + link Parla projesine | `supabase/.temp/project-ref` = `rranpzicmhgfupgabgbi` |
| ✅ `.env` Supabase URL + anon key | Parla `web sitesi/.env`'den kopyalanmış |
| ✅ `.env` Service Role Key | Az önce ben kopyaladım (Parla `web sitesi/.env`'den) |
| ✅ `.env` Mapbox Public Token | `pk.eyJ1IjoiYWxpZXZyZW40NCI...` mevcut |
| ✅ `.saha-config.json` | `config/` altında mevcut |
| ✅ 15 migration dosyası | `supabase/migrations/` altında 15 dosya hazır (8'i yeni dalga) |
| ✅ Edge Function kodları | 6 fonksiyon yazıldı (clinic-scan update + 4 yeni) |

## KALAN İŞLER — sıraya göre

### 1. Eksik 2 API key'i .env'e ekle (5 dk)

Mevcut `.env` dosyanda 2 satır halen boş:

```env
MAPBOX_SECRET_TOKEN=
GOOGLE_PLACES_API_KEY=
```

- **MAPBOX_SECRET_TOKEN:** screenshot `10.png`'de "saha server option" satırında `sk.eyJ1...` ile başlayan değer. Mapbox dashboard → Tokens sayfasından kopyala.
- **GOOGLE_PLACES_API_KEY:** screenshot `9.png`'de pop-up dialog'taki `AIzaSyD...` değeri. Google Cloud Console → Credentials sayfasından kopyala.

**Google Cloud bütçe alarmı zorunlu:** Billing → Budgets → $20/ay limit (Places API ~$17/1000 sorgu).

### 2. Yeni migration'ları Parla DB'sine push (10 dk)

Parla canlı DB'de **8 yeni migration** uygulanmadı:

```
20260530000001_first_admin_trigger.sql
20260601000000_clinic_sources.sql
20260601000001_saha_scan_jobs.sql
20260602000001_saha_visits.sql
20260603000001_saha_invoicing.sql
20260603000002_saha_payments.sql
20260604000001_audit_logs.sql
20260605000001_order_approval.sql
```

```bash
cd C:\Users\PC\Desktop\navigasyon
npm run saha:check-migrations    # önce çakışma kontrolü
npx supabase db push             # cloud'a uygula
```

`db push` onay sorar — gelen liste sadece yukarıdaki 8 dosyayı içermeli. Başka migration eklenmişse **DURDUR** + bana göster.

> **ÖNEMLİ:** Parla canlı kullanımda. Push gece geç saatte yap (1-2 dk DDL alıyor, lock olabilir).

### 3. Edge Function deploy (5 dk)

```bash
npx supabase functions deploy clinic-scan          # filtre + OSM merge güncellemesi
npx supabase functions deploy osm-search           # YENİ
npx supabase functions deploy batch-scan           # YENİ
npx supabase functions deploy admin-create-user    # YENİ
# zaten deploy edilmişler (değişmedi): google-places-search, mapbox-optimize, sample-roi-compute
```

### 4. Edge Function secrets (1 dk)

```bash
npx supabase secrets set GOOGLE_PLACES_API_KEY="<.env'den kopyala>"
npx supabase secrets set MAPBOX_SECRET_TOKEN="<.env'den kopyala>"
npx supabase secrets set ALLOWED_ORIGINS="http://localhost:5173,https://dent-route-saha.pages.dev"
```

`ALLOWED_ORIGINS` zaten setli olabilir — `npx supabase secrets list` ile kontrol et.

### 5. İlk admin oluştur (2 dk)

```bash
npm run saha:check-setup         # env + DB bağlantı kontrol
npm run saha:create-admin        # CLI ile interaktif admin
```

VEYA tarayıcıdan:

```bash
npm run dev
# → http://localhost:5173
# → "İlk Admin Kurulumu" linki gözükür (profiles tablosu boşsa)
```

Parla'da zaten admin kullanıcılar var — bu adımı atlayabilirsin. Mevcut admin hesabınla giriş yap.

### 6. Sivas Excel'i taşı (1 dk)

```bash
# Excel'i bul (Desktop'taydı muhtemelen):
copy "C:\Users\PC\Desktop\Sivas_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx" "C:\Users\PC\Desktop\navigasyon\data-legacy\"

npm run saha:import-sivas
```

Veya `/admin/clinics` web UI → "Klinik Excel" sekmesinden yükle.

### 7. Test akışı

`05-test-akisi.md` checklist'i adım adım dolaş — 15 PROMPT'un her birinin doğrulama maddelerini geç.

### 8. Git commit + push

```bash
cd C:\Users\PC\Desktop\navigasyon
git add .
git commit -m "feat: Sprint 8+ — 15 PROMPT bulk implementation (admin bootstrap, OSM, batch scan, visits, invoicing, orders)"
git push origin main
```

Cloudflare Pages otomatik build alır. Production env vars Cloudflare dashboard'dan ayrı set edilmeli (`VITE_*` prefixli olanlar).

## NOT — GitHub repo adı

Memory `github_repo.md` dosyamda "alievren44-del/navigasyon" yazıyordu — gerçek remote `alievren44-del/dent-route`. Memory güncellemesi gerekli.
