# RELEASE CHECKLIST — NAV (dent-route / saha)

> Production-readiness + deploy + rollback + kritik-yol. Bu repo **iki hedefe** yayınlanır:
> **WEB → Cloudflare Workers** (`dent-route`, saha.parladisdeposu.com) ve
> **NATIVE → Capacitor Android** (`com.parla.saha`) + **OTA** (Capgo self-host).
> Backend = **Supabase Edge Functions (Deno)** aynı ortak proje `rranpzicmhgfupgabgbi`.
>
> Kural: **push / deploy / OTA publish / prod migration = KULLANICI ONAYI.** Onaysız yayın yok.

---

## 0. Önkoşul — Yayın Öncesi Gate (her yayın)

- [ ] `npm run typecheck` temiz (tsc, TS 5.4).
- [ ] `npm run test` (vitest, jsdom) yeşil — **geçme oranını gerçekten gör**, "config var" yeterli değil.
- [ ] `npm run build` başarılı (dummy env ile CI'da da). Bundle boyutunda anormal artış yok.
- [ ] Etkilenen akış için `playwright` E2E (varsa) yeşil.
- [ ] `format:check` (prettier) + eslint (lint non-blocking olsa da yeni-warning ekleme).
- [ ] `validate-verticals` geçti (vertical şablonları bozulmadı).
- [ ] Değişiklik **FACT ile doğrulandı**, statik grep değil runtime davranışı görüldü.
- [ ] Geri-alma noktası biliniyor (commit SHA / tag). "Nasıl geri alırım?" cevabı hazır.

---

## 1. Güvenlik Gate (durdurucu — özellikle native release)

- [ ] `capacitor.config.ts` → **`webContentsDebuggingEnabled: false`** (DEVICE-001).
      Release APK'da açık kalırsa ADB/USB ile localStorage token okunabilir. **TESLİM-BLOCKER.**
- [ ] `.env.production` içine **secret/service_role/private key SIZMADI** (yalnız anon + Mapbox public).
- [ ] Mapbox public token URL-restrict edilmiş mi (abuse riski) — mümkünse doğrula.
- [ ] Server-only key'ler (`MAPBOX_SECRET_TOKEN`, `GOOGLE_PLACES_API_KEY`) yalnız edge function
      env'inde; koda/repoya gömülü değil.
- [ ] KVKK consent akışı (`/onboarding/kvkk`) bozulmadı (TR kişisel-veri uyumu).

---

## 2. Ortak-DB / Backend Gate (üç uygulama ortak — EN riskli)

> `rranpzicmhgfupgabgbi` web + parla + NAV tarafından paylaşılıyor. Bir hata **tüm ekosistemi** vurur.

- [ ] Migration **idempotent** (`IF NOT EXISTS`) ve **`saha_` prefix**'li (parla tablolarını ezme).
- [ ] RLS / rol değişikliği → rol-casing case-insensitive korundu (bkz. `70924a0`), NAV lowercase yazar.
- [ ] **CI `deploy-migrations` job `ON_ERROR_STOP` KAPALI** → CI yeşil ≠ migration uygulandı.
      Migration'ı Supabase'de manuel/MCP ile **de** teyit et (`list_migrations` / gerçek tablo kontrolü).
- [ ] Edge function değişikliği (clinic-scan v1/v2/v3, google/osm, sample-roi vb.) deploy edildi ve
      canlı çağrıyla doğrulandı.
- [ ] RPC sözleşmeleri korundu: `saha_search_nearby_clinics`, `saha_search_clinics`,
      `approve_order_if_authorized`, cari find-or-create.

---

## 3. WEB Deploy (Cloudflare Workers Static Assets)

- [ ] `wrangler.jsonc` (name=`dent-route`, assets=`./dist`, SPA fallback) doğru.
- [ ] `_redirects` (`/* → index 200`) ve `_headers` (X-Frame DENY, CSP-lite, sw.js no-cache) yerinde.
- [ ] Service worker (`vite-plugin-pwa` injectManifest) güncellendi; eski SW cache sorunu yok.
- [ ] Query persist buster (`v0.2.0`) — şema/format değiştiyse buster bump edildi (bayat cache önleme).
- [ ] Deploy: `npx wrangler deploy` (Node 22, CLOUDFLARE_API_TOKEN/ACCOUNT_ID). **Onayla.**
- [ ] Yayın sonrası saha.parladisdeposu.com'da smoke: login → /takvim → /harita → bir RPC akışı.

---

## 4. NATIVE Deploy (Capacitor Android APK)

- [ ] Güvenlik Gate (§1) geçti — özellikle `webContentsDebuggingEnabled:false`.
- [ ] `npm run build:native` (VITE_BUILD_TARGET=native) → `cap sync` → `gradlew assembleRelease`.
- [ ] Keystore mevcut/doğru (`generate-keystore.sh`), sürüm kodu artırıldı.
- [ ] appId `com.parla.saha`, appName "Parla CRM", `webDir=dist` doğru.
- [ ] Android 15 edge-to-edge StatusBar (#1F4E78) bootstrap çalışıyor.
- [ ] Cihazda smoke: kurulum → SSO/login → push/local notification → offline→online senkron.

---

## 5. OTA (Capgo self-host — canlı cihazları etkiler)

- [ ] Yalnızca **web-bundle** değişti (native kod/plugin değişmedi). Native değiştiyse OTA değil, APK gerekir.
- [ ] `otaCheck('nav')` kanal/sürüm doğru; `autoUpdate:false` (kontrollü).
- [ ] `scripts/publish-ota.mjs` ile yayın — **KULLANICI ONAYI** (canlı telefonlar güncellenir).
- [ ] Yayın sonrası en az bir cihazda: indir → checksum-doğrula → uygula → yeni sürüm aktif.
- [ ] Geri-alma: önceki bundle'ı yeniden yayınlayabilecek durumdasın.

---

## 6. Rollback Planı (her yayında hazır)

- **Web:** önceki başarılı commit'ten `dist` build + `wrangler deploy`, veya Cloudflare'de önceki
  deployment'a dönüş. `_headers` sw.js no-cache olduğu için SW hızlı düzelir.
- **Native:** yeni APK dağıtımını durdur; kritikse OTA ile önceki güvenli bundle'ı it (hotfix yolu).
- **OTA:** önceki aktif bundle'ı tekrar yayınla (idempotent), cihazlar geri düşer.
- **DB/Edge:** migration idempotent + geri-alınabilir mi? Değilse **yayınlama**. Edge fn önceki
  sürümü redeploy. Ortak DB'de veri kaybı riski varsa yayından ÖNCE dur.

---

## 7. Yayın Sonrası

- [ ] Smoke testler (web + cihaz) geçti.
- [ ] Hata izleme kontrolü — **NOT:** NAV'da Sentry kurulu mu **VARSAYIM/doğrulanmadı**; kuruluysa
      event akışını kontrol et, değilse "izleme yok" riskini kullanıcıya hatırlat.
- [ ] Değişen FACT'ler `.claude/` dokümanlarına + MEMORY'ye geri yazıldı.
- [ ] Geri-alma noktası (SHA/tag) not edildi.
