# Kullanıcı (Ali) Yapacakları — DentRoute Saha App

Bu dosya **sadece kullanıcı eylemi gerektiren** işleri listeler. Kod tarafını ekip halleder.

---

## 1. Hesap & Billing (Acil — yoksa servisler patlar)

### Google Cloud
- [ ] **Billing → Budgets & Alerts**: $50/ay limit + email alert kur
  - https://console.cloud.google.com/billing → Budgets & alerts → CREATE BUDGET
- [ ] **Library**: `Places API` (klasik) zaten enable. İleride `Places API (New)`a geçmek için **enable** et (kod henüz kullanmıyor, hazır olsun)
- [ ] **Credentials → API keys**: Mevcut key restriction → API → Places API ✓ (zaten yapıldı)

### Mapbox
- [ ] **Account → Statistics → Set up usage alert**: $1 limit + email alert
  - https://account.mapbox.com → Statistics
- [ ] Pay-as-you-go modeline yapışıp kredi kart Mapbox sayfasında kayıtlı kalsın (otomatik fatura)

### Supabase
- [ ] **Project Settings → Edge Functions → Secrets** doğrula:
  - `GOOGLE_PLACES_API_KEY` ✓ (eklenmiş)
  - `MAPBOX_SECRET_TOKEN` ✓
  - `ALLOWED_ORIGINS` ✓
  - **Yeni eklenecek (CF Pages deploy sonrası)**: `ALLOWED_ORIGINS`a prod domain ekle (örn `https://saha.parla.com`)
- [ ] **Auth → URL Configuration → Site URL**: prod URL (deploy sonrası)
- [ ] **Auth → URL Configuration → Redirect URLs**: localhost:5173 + prod URL

### Cloudflare (deploy için)
- [ ] **Cloudflare hesabı** (ücretsiz): https://dash.cloudflare.com
- [ ] **Pages → Create project**: GitHub `alievren44-del/dent-route` repo'sunu bağla
  - Build command: `npm run build`
  - Build output: `dist`
  - Root directory: `/`
  - Environment variables (build):
    - `VITE_SUPABASE_URL=https://rranpzicmhgfupgabgbi.supabase.co`
    - `VITE_SUPABASE_ANON_KEY=sb_publishable_9wnwTdO3WiIczkuKaLNnsg__CD2eUXW`
    - `VITE_MAPBOX_PUBLIC_TOKEN=pk.eyJ1IjoiYWxpZXZyZW40NCIsImEiOiJjbXBtczg3cXowY2k0MnNzOWo2MzA1NDhvIn0.X8ehMO7Hg35KvUtan5VdDA`
- [ ] Custom domain (opsiyonel): `saha.parla.com` veya benzeri DNS A/CNAME

---

## 2. Görsel & İçerik (Kod tarafı yapamaz)

### App ikonları
- [ ] `public/icons/icon-192.png` (192×192 PNG, dental ikon + Parla branding)
- [ ] `public/icons/icon-512.png` (512×512 PNG)
- [ ] `public/favicon.ico`
- [ ] Tasarım önerisi: diş + harita pin kombine

### KVKK metni
- [ ] `data/master/kvkk_metinleri.json` veya direkt frontend constant — saha rep ekrana göstereceği gerçek KVKK aydınlatma metni (yasal hukuki metin, avukat onaylı)
- [ ] Versiyon: `v1` (kod buna referans veriyor)
- [ ] Numune KVKK metni: "Klinik bu numuneyi teslim aldığını ve KVKK kapsamında bilgilendirildiğini beyan eder" benzeri

### Branding renkleri
- [ ] `config/.saha-config.json` `branding.primaryColor` + `accentColor` — Parla logo'sundan dental palet
- [ ] Logo: `public/logo.svg` (opsiyonel — Header'da gösterilebilir)

---

## 3. İçerik Doğrulama (Manuel kontrol)

### Numune politikaları (`verticals/dental.json`)
- [ ] `samplePolicy.categories.composite_adhesive.maxPerAccountYearly`: şu an 2 — Parla iş kuralı bu mu?
- [ ] `samplePolicy.categories.implant.maxPerAccountYearly`: şu an 1 — implant tek seferlik tipik
- [ ] `samplePolicy.defaultBudgetTl`: 5000 — saha rep aylık gerçek bütçesi ne?
- [ ] `samplePolicy.conversionWindowDays`: 90 gün — Parla'da gerçek dönüşüm penceresi?

### TR İl/İlçe verisi
- [ ] `src/data/tr-locations/districts.json` ~530 ilçe — Parla saha bölgesi (Ankara/İstanbul) tam mı kontrol
- [ ] Eksik ilçeler için ekleme veya kabul

### Parla Supabase schema kontrol (CRM adapter için)
- [ ] `public.products` tablosu var mı? (adapter.listProducts için)
  - Yoksa Parla'nın ürün tablosu adı ne (`urunler`, `fanta_products`, ...)?
- [ ] `public.orders` tablosunun gerçek FK kolon adı: `customer_id` mi `klinik_id` mi `account_id` mi?
- [ ] `orders.total_amount` kolon adı doğru mu?

---

## 4. Test Kullanıcıları (Production)

- [ ] Gerçek saha rep kullanıcıları (email + isim listesi):
  - örn: `osman@parla.com.tr` (REP) — şehir Ankara
  - örn: `mehmet@parla.com.tr` (REP) — şehir İstanbul
- [ ] Manager/Admin: yetkili email listesi
- [ ] Şifreleri sen koy, ekip create-user SQL'le yaratır (request)

---

## 5. Mobil Cihaz Testi

- [ ] Android Chrome ile `saha.parla.com` (deploy sonra) aç
- [ ] **Ana ekrana ekle** (Chrome menü → 3-nokta → "Ana ekrana ekle") → PWA install
- [ ] Konum izni → discovery test
- [ ] Foto çekme + numune form test
- [ ] Offline test (uçak modu → cache çalışıyor mu)
- [ ] iPhone Safari benzeri (opsiyonel)

---

## 6. Operasyonel Hazırlık (Production)

- [ ] Saha rep'lerine eğitim (15 dk video / canlı toplantı)
- [ ] Kullanıcı el kitabı (Discovery → Rota → Ziyaret → Numune → Sipariş akışı)
- [ ] Destek hattı (Hatalı kayıt nasıl düzeltilir, KVKK iptal nasıl yapılır)
- [ ] Yedekleme planı (haftalık manuel DB export, ekip script yazacak)

---

## İlk Klinik Tarama (kritik — saha rep kullanmadan önce)

1. Admin hesabıyla login (`superadmin@parladisdeposu.com` veya başka admin)
2. `/admin/clinic-scan` sayfası
3. Sırayla tara:
   - **Malatya** → İl seç → İlçe boş (tüm il merkez) → Yarıçap 30km → Tarama Başlat
   - **Mardin** → aynı
   - **Sivas** → aynı
4. Beklenen: her şehir ~100-300 klinik bulur, `saha_clinics` tablosuna yazılır
5. Discovery sayfası artık bu illerde **anında sonuç döner** (Google live çağrısı yok)

Aylık güncelleme: aynı sayfa, ay sonunda elle "Tara" → yeni klinikler eklenir.

## Mobile APK Build (Capacitor)

`npm run cap:android` Android Studio gerekli. README "Mobile APK Build" bölümüne bak.

Tek seferlik:
```powershell
npm install              # Capacitor deps yüklensin
npx cap add android      # android/ klasörü yaratılır
npm run cap:android      # Android Studio aç
```

Production URL ayarı: `capacitor.config.ts` → `server.url` satırı (yorum kaldır + prod domain).

## Durum Özeti (otomatik güncellenir, ekip işlerken)

- ✅ Sprint 1 — Foundation (auth + adapter + vertical)
- ✅ Sprint 2 — Map & Discovery (TR master, MapPage, Google Places, dedup)
- ✅ Sprint 3 — Routes (Mapbox optimize + 2-opt + marker color, planner + active)
- ✅ Sprint 5 — Orders & Balance (Parla schema bağlandı)
- ✅ Sprint 5.5 — Numune (DB + UI + Hunter + ROI)
- ✅ Sprint 6 — Offline (syncQueue + Dexie + banner)
- ✅ Sprint 7 — Admin & Polish (dashboard, heatmap, region, bildirim, QR, CSV)
- ✅ Klinik DB + clinic-scan Edge Fn + Admin Tarama UI (live API kaldırıldı)
- ✅ Capacitor APK setup (kullanıcı `npx cap add android` yapacak)
- ⏳ CF Pages Deploy (kullanıcı dashboard'tan)
- ⏳ İlk klinik seed (Malatya/Mardin/Sivas — admin tarafından)

Bittikçe `🔄` → `✅`.

---

**Son güncelleme**: 2026-05-26
