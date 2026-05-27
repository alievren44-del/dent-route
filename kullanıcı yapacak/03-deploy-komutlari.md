# 03 — Deploy Komutları

Claude kodlama yaptıktan sonra **sen** çalıştıracaksın. Sırasıyla:

## 1. Node bağımlılıkları

```bash
cd C:\Users\PC\Desktop\navigasyon
npm install
```

İlk seferde uzun sürer. Yeni paketler Claude tarafından eklendi:
- `xlsx` (PROMPT-2)
- `sonner` (PROMPT-4 toast)
- `qrcode` + `@types/qrcode` (PROMPT-5)
- (zaten var: zustand, @capacitor/share)

## 2. Type + lint check

```bash
npm run typecheck
npm run lint
```

Sıfır hata bekleniyor. Çıkarsa Claude'a göster, düzeltir.

## 3. Local Docker stack (opsiyonel — Parla canlı kullanılacaksa atla)

`memory/local_supabase_stack.md` referans:

```bash
npx supabase start
```

Yeni geliştirme için local stack iyi. Production veriye dokunmadan test.

## 4. Migration deploy

### Local stack için
```bash
npx supabase db reset
```
(Local DB'yi sıfırlar + tüm migration'ları çalıştırır.)

### Cloud (Parla veya yeni proje)
```bash
npx supabase db push
```
Onay sorar — yeni migration'ları listeler. Hepsi `saha_*` prefix taşıyor olmalı.

**ÇİFT KONTROL:**
```bash
npm run saha:check-migrations
```

## 5. Edge Function deploy

Tek tek:
```bash
npx supabase functions deploy clinic-scan
npx supabase functions deploy google-places-search
npx supabase functions deploy mapbox-optimize
npx supabase functions deploy sample-roi-compute
npx supabase functions deploy osm-search           # PROMPT-7
npx supabase functions deploy batch-scan           # PROMPT-6
npx supabase functions deploy admin-create-user    # PROMPT-14
```

Veya hepsi:
```bash
npx supabase functions deploy
```

## 6. Bootstrap

```bash
npm run saha:check-setup
```
Her şey ✓ olduğunda:

```bash
npm run saha:create-admin
```
CLI senden email/şifre/ad isteyecek. Veya tarayıcıdan:

```bash
npm run dev
# → http://localhost:5173
# → "İlk Admin Kurulumu" linki görünür (sadece profiles boşsa)
```

## 7. Capacitor (Android APK — opsiyonel)

```bash
npm run cap:android
```
Android Studio açılır. Önce Android Studio kurulu olması lazım: https://developer.android.com/studio

## 8. Production deploy (Cloudflare Pages)

Memory'de `github_repo.md` referans: `alievren44-del/navigasyon` — henüz push edilmemiş.

İlk push:
```bash
git init   # eğer git repo değilse
git remote add origin git@github.com:alievren44-del/navigasyon.git   # ya da HTTPS
git add .
git commit -m "Initial: saha-app scaffold + PROMPT-1..15 implementations"
git push -u origin main
```

Cloudflare Pages otomatik build alır (build cmd: `npm run build`, output: `dist`).

**Cloudflare Pages env vars (Dashboard):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_MAPBOX_PUBLIC_TOKEN`, `VITE_MAPTILER_KEY` — Production environment'ta ayrı kayıt.
- Service role ve secret token'lar ASLA Pages'a girilmez (build-time leak).
