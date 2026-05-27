# 3-App Deployment Rehberi — Subdomain + SSO + APK

Bu döküman 3 app entegrasyonunun **manuel adımlarını** içerir. Kod tarafı tamam — bu liste user'ın dashboard/CLI işleri.

## Mimari Özet

```
parladisdeposu.com           → Parla Web (B2C/B2B + admin)        Vercel
app.parladisdeposu.com       → Parla App landing (opsiyonel)      Vercel/CF
saha.parladisdeposu.com      → Saha Navigasyon (CRM + saha rep)   Cloudflare Pages
                                ↓ /apk → APK direct download
                                ↓ ortak Supabase: rranpzicmhgfupgabgbi
```

---

## 1. DNS — Cloudflare DNS Dashboard

**Hedef**: `saha.parladisdeposu.com` → CF Pages

1. Cloudflare Dashboard → **parladisdeposu.com** → **DNS** → **Add record**
2. Type: `CNAME`
3. Name: `saha`
4. Target: `dent-route-saha.pages.dev`
5. Proxy: ON (turuncu bulut)
6. Save

**Süre**: 1-24 saat DNS propagasyon. `dig saha.parladisdeposu.com` ile doğrula.

---

## 2. Cloudflare Pages — Custom Domain

1. CF Dashboard → **Workers & Pages** → `dent-route-saha`
2. **Custom domains** → **Set up a custom domain**
3. Domain: `saha.parladisdeposu.com`
4. CF Pages otomatik TLS sertifikası ister (Let's Encrypt) — ONAY VER
5. Bekle (5-10dk)

**Doğrulama**: `https://saha.parladisdeposu.com` açılır, TLS yeşil.

---

## 3. Cloudflare Pages — Environment Variables

1. CF Dashboard → Workers & Pages → `dent-route-saha` → **Settings** → **Environment variables**
2. **Production** + **Preview** her ikisine ekle:

```
VITE_SUPABASE_URL=https://rranpzicmhgfupgabgbi.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_9wnwTdO3WiIczkuKaLNnsg__CD2eUXW
VITE_MAPBOX_PUBLIC_TOKEN=pk.eyJ1IjoiYWxpZXZyZW40NCIs... (mevcut .env'den kopya)
NODE_VERSION=20
```

3. **Save and deploy** — yeni deploy tetiklenir.

---

## 4. Supabase Auth — Allowed Redirect URLs

1. Supabase Dashboard → Project `rranpzicmhgfupgabgbi` → **Authentication** → **URL Configuration**
2. **Site URL**:
   ```
   https://www.parladisdeposu.com
   ```
3. **Redirect URLs** (her satır ayrı):
   ```
   https://www.parladisdeposu.com/**
   https://parladisdeposu.com/**
   https://saha.parladisdeposu.com/**
   https://app.parladisdeposu.com/**
   http://localhost:5173/**
   http://localhost:3000/**
   ```
4. Save

---

## 5. Edge Function `ALLOWED_ORIGINS`

1. Supabase Dashboard → **Project Settings** → **Edge Functions** → **Secrets**
2. `ALLOWED_ORIGINS` değerini güncelle:

```
https://saha.parladisdeposu.com,https://www.parladisdeposu.com,https://parladisdeposu.com,https://app.parladisdeposu.com,http://localhost:5173
```

3. Save — secrets runtime'da okunur, redeploy gerekmez.

**Test**: DevTools Network'te `mapbox-optimize` invoke → `Access-Control-Allow-Origin: https://saha.parladisdeposu.com` kontrol.

---

## 6. APK Build — Keystore + İlk Build

> **DİKKAT**: Keystore parolasını kaybedersen yeni APK aynı imzayla çıkamaz. LastPass/1Password'a kaydet + USB yedek al.

```bash
# 1. Keystore oluştur (tek seferlik)
cd C:\Users\PC\Desktop\navigasyon
bash scripts/generate-keystore.sh "ÇokGüçlüParola123!" "AnahtarParolası456!"

# 2. APK build et
bash scripts/build-apk.sh "ÇokGüçlüParola123!" "AnahtarParolası456!"

# Çıktı: public/apk/saha-latest.apk + version.json
```

**Sonraki sürüm**: package.json'da version bump → tekrar `build-apk.sh`

---

## 7. APK Deploy — CF Pages Public Path

APK build sonrası `public/apk/` klasörü oluşur. CF Pages bu klasörü otomatik serve eder.

```bash
git add public/apk/
git commit -m "chore: APK v1.0.0"
git push origin main
```

CF Pages otomatik deploy → `https://saha.parladisdeposu.com/apk` indirme sayfası, `/apk/saha-latest.apk` direkt indirme.

**Plus** `_headers` ile MIME ayarı (zaten OK olmalı):
```
/apk/*
  Content-Type: application/vnd.android.package-archive
```

---

## 8. SSO Notu (V2'de tam yapılır)

Mevcut implementasyon: 3 app aynı `localStorage` key (`parla-shared-auth`) kullanır. **Ama localStorage subdomain'ler arası paylaşılmaz**. Tam SSO için:

**Şu an çalışan**: tek subdomain'de tek login persist
**Şu an çalışmayan**: cross-subdomain SSO (web → saha geçişinde re-login gerek)

**Tam SSO için (V2)**:
- `@supabase/ssr` adapter kullan
- Cookie-based session
- `domain: '.parladisdeposu.com'` cookie set
- Veya: parladisdeposu.com'da merkezi auth endpoint + redirect SSO

Şimdilik kullanıcılar her subdomain'de bir kez login olmalı.

---

## 9. Parla Web `/saha-satis/*` Temizliği

**Konum**: `C:\Users\PC\Desktop\web sitesi\src\pages\rep\`

```bash
cd "C:\Users\PC\Desktop\web sitesi"

# Sayfaları sil
rm src/pages/rep/RepCollections.tsx
rm src/pages/rep/RepTasks.tsx
rm src/pages/rep/RepVisits.tsx
rm src/pages/RepDashboard.tsx

# Router'dan kaldır + redirect ekle
# (src/router/index.tsx satır 306-309 sil, yerine 3rd-party redirect:)
```

**`src/router/index.tsx`** içine ekle:
```tsx
// /saha-satis* → saha.parladisdeposu.com'a yönlendir
<Route path="saha-satis/*" element={
  <Navigate to="https://saha.parladisdeposu.com" replace />
} />
```

**`src/utils/roleRedirect.ts`** içinde `sales_rep` role redirect'i güncelle:
```ts
case 'sales_rep':
case 'rep':
case 'REP':
  return 'https://saha.parladisdeposu.com';  // external
```

Diğer dosyalardaki `/saha-satis/*` link'lerini bul + güncelle:
- `src/components/AdminPanel/NotificationBroadcaster.tsx:331`
- `src/components/AdminPanel/RepManager.tsx` (4 satır)
- `src/components/Header.tsx:216`

---

## 10. Test Kontrol Listesi

### Domain + Deploy
- [ ] `https://saha.parladisdeposu.com` açılır, TLS yeşil
- [ ] `https://saha.parladisdeposu.com/apk` indirme sayfası açılır
- [ ] DevTools Network: ALLOWED_ORIGINS doğru CORS header

### Auth + RLS
- [ ] `alievren_44@hotmail.com.tr` login → kvkk OK → Saha açılır
- [ ] saha_routes insert çalışır (RLS düzeltildi)
- [ ] Admin → "Plasiyere Ata" çalışır

### Yeni sayfalar
- [ ] `/tahsilatlar` → rep_collections okur/yazar
- [ ] `/gorevler` → rep_tasks okur/yazar
- [ ] NavDrawer'da link'ler görünür

### APK
- [ ] `bash scripts/generate-keystore.sh` çalışır, keystore üretir
- [ ] `bash scripts/build-apk.sh` çalışır, APK üretir
- [ ] APK Android telefona kurulur, login çalışır
- [ ] Mapbox harita render eder, GPS izni alınır

### Edge fn CORS
- [ ] Saha'dan mapbox-optimize invoke → 200
- [ ] Saha'dan clinic-scan-v3 invoke → 200

---

## Sonraki Adımlar (V2)

- Tam SSO (cookie-based, @supabase/ssr)
- Auto-update banner (APK version check)
- Parla Web /saha-satis dosyaları sil + redirect
- Monorepo (turborepo) — 3 app + paylaşılan paketler
- Play Console Internal Track (direct APK yerine)
