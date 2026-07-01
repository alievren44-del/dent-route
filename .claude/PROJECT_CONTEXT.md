# NAV (dent-route / saha) — PROJECT_CONTEXT

> Saha (field-sales) CRM + klinik keşif PWA. `package.json` name=`saha-app` v0.1.0 —
> "Field sales automation PWA — vertical-agnostic, white-label SaaS-ready".
> Repo: `C:/Users/PC/Desktop/navigasyon`. Domain: `saha.parladisdeposu.com`.
> Bu ekosistemdeki 3. uygulama (WEB + PARLA + **NAV**), üçü de AYNI Supabase projesine bağlı.

---

## 1. Stack (FACT — package.json)

| Katman | Teknoloji | Sürüm |
|--------|-----------|-------|
| Runtime | Node | `>=20` (`.nvmrc`) |
| Dil | TypeScript | 5.4 |
| Build | Vite (`type: module`) | 5.3 |
| UI | React | 18.3 |
| Router | react-router-dom | 6.24 |
| Data/cache | @tanstack/react-query + persist-client + async-storage-persister | 5.51 |
| Backend SDK | @supabase/supabase-js | 2.45 |
| Offline DB | dexie + dexie-react-hooks | 4 |
| Harita | mapbox-gl (+ @types/mapbox-gl) | 3.5 |
| Form | react-hook-form + @hookform/resolvers + zod | 7.52 / 3.23 |
| UI yardımcı | lucide-react, sonner, recharts (2.15), tailwindcss (3.4) | — |
| Export/dosya | xlsx, qrcode, html2canvas, modern-screenshot | — |
| Client state | zustand | 4.5 |
| PWA | vite-plugin-pwa (injectManifest → `src/service-worker.ts`) + workbox-window | 0.20 |

**Native (Capacitor 8):** `@capacitor/core` + `android` + `app` + `browser` + `filesystem` +
`keyboard` + `local-notifications` + `preferences` + `push-notifications` + `share` +
`splash-screen` + `status-bar`. OTA: `@capgo/capacitor-updater` 8.49.

**Test/kalite:** vitest 1.6 (jsdom) + @testing-library, @playwright/test 1.45, eslint 8.57,
prettier 3.3, supabase CLI 2.101, tsx, cross-env.

---

## 2. Dizin yapısı (FACT — gerçek klasörler)

```
navigasyon/
├─ index.html                → src/main.tsx (giriş)
├─ vite.config.ts            path-alias tanımları (@core,@features,@components,@lib,@config,@verticals)
│  ⚠️ vite.config.js + vite.config.d.ts DERLENMİŞ KOPYALAR commitli (bkz. risk #6)
├─ capacitor.config.ts       appId com.parla.saha, appName "Parla CRM", webDir dist
├─ tailwind.config.ts · postcss.config.js · tsconfig*.json · playwright.config.ts
├─ wrangler.jsonc            Cloudflare Workers (name dent-route, assets ./dist)
├─ _redirects (/*→index 200) · _headers (X-Frame DENY, CSP-lite, cache)
├─ .env / .env.example / .env.production   (bkz. §5)
├─ src/
│  ├─ main.tsx               boot sırası (bkz. §3)
│  ├─ App.tsx · router.tsx   (~580 satır, ~50 rota — risk #9)
│  ├─ service-worker.ts      injectManifest hedefi
│  ├─ core/                  YATAY ALTYAPI
│  │  ├─ adapters/           ICRMAdapter.ts · factory.ts · builtin/ · custom-rest/ · errors.ts · types.ts
│  │  ├─ auth/               ssoCapture (SSO hand-off)
│  │  ├─ geolocation/ · qr/ · storage/ · sync/
│  │  ├─ offline/            db.ts (Dexie) + syncQueue.ts (initSyncQueue)
│  │  ├─ routing/            exporters (rota dışa aktarım)
│  │  ├─ sampling/           hunter-detection · policies · quotas · roi (numune suistimal motoru)
│  │  └─ verticals/          VerticalContext / VerticalLoader
│  ├─ features/              17 DİKEY EKRAN GRUBU:
│  │     admin app auth calendar customers discovery invoicing map
│  │     notifications orders rep-ops routes sales sampling visits
│  │     (+ config data debug ota components lib styles src altında)
│  ├─ config/                env.ts · loadConfig.ts (loadSahaConfig) · branding.ts (applyBranding) · types.ts
│  ├─ components/ · lib/ · types/ · styles/ · data/ · debug/ · ota/
├─ verticals/                13 sektör şablonu (JSON, bkz. §6)
├─ supabase/
│  ├─ functions/             13 edge function (Deno, bkz. §7 — .cjs DEĞİL)
│  ├─ migrations/            parla_baseline_local + saha_* eklemeli migration'lar
│  └─ migrations-greenfield/ 0001_initial_schema.sql (white-label sıfırdan şema)
├─ scripts/                  bootstrap + import + ota + tsp-test (bkz. §4)
├─ android/                  Capacitor Android projesi
├─ config/ · docs/ · public/ · dist/ · tests/
└─ ⚠️ REPO KİRLİLİĞİ: saha-app.zip · .adb-screen.png · .adb-ui.xml ·
   data-legacy/ · __wt_diff.txt · scripts/*.js+*.d.ts derlenmiş kopyalar (risk #6)
```

---

## 3. Giriş noktaları & boot (FACT)

**HTML → JS:** `index.html` → `src/main.tsx`.

`main.tsx` boot sırası:
1. `@core/auth/ssoCapture` import edilir — **React mount ÖNCESİ** SSO hash yakalanır.
2. `debugLog`
3. `loadSahaConfig()` + `applyBranding()` (config/loadConfig.ts + branding.ts)
4. Capacitor native ise StatusBar bootstrap (Android 15 edge-to-edge, `#1F4E78`)
5. QueryClient + persister kurulumu
6. `initSyncQueue()` (offline kuyruğu — online/offline event dinleyici)
7. OTA: `import('./ota/checkUpdate')` → `otaCheck('nav')`
8. `createRoot` render ağacı:
   `StrictMode > PersistQueryClientProvider > VerticalProvider > BrowserRouter > AuthBootstrap > App`

**Router (`src/router.tsx`, `AppRouter`):** tüm sayfalar `lazy()`.
- Shell DIŞI (auth): `/login`, `/onboarding/kvkk`, `/onboarding/first-admin`, `/apk`|`/indir`
- Kök `/` → `/takvim` (Navigate)
- Korumalı rotalar: `<ProtectedRoute requireRole|requirePermission>` + `<AppShell>` sarmalar
- ~50 rota: `/harita`, `/clinics`(+`/:id`,`/discover`), `/saha/tara`, `/nearby-provinces`,
  `/routes/*`(plan,active,auto,corridor,assigned), `/visits/*`, `/takvim`, `/sales`,
  `/orders/*`(new=rep, approval=admin, history),
  `/invoicing/*`(cari,fatura,odeme,cek-senet,aging — perm `saha:invoicing:access`),
  `/admin/*`(dashboard,regions,users,heatmap,clinic-scan,route-planner,broadcast,stock,rep-kpi,bi,tr-seed,audit-logs)

**React Query politikası (FACT):** `networkMode: offlineFirst`, `staleTime: 0`,
`refetchOnMount: always`. Persist buster `v0.2.0`. Sadece statik lookup query'ler persist
edilir (`PERSIST_ALLOW_PREFIXES` allow-list); volatile finansal listeler
(cari/fatura/order/bakiye) **BİLİNÇLİ** hariç tutulur.

---

## 4. Çalıştırma (FACT — package.json scripts)

```bash
# Geliştirme
npm run dev              # vite dev server
npm run build            # tsc -b && vite build  (+ postbuild: check-bundle.cjs)
npm run preview
npm run typecheck        # tsc --noEmit

# Kalite
npm run lint             # eslint … --max-warnings 25   (gevşek gate — risk #5)
npm run format:check     # prettier --check
npm run test             # vitest run
npm run test:e2e         # playwright test

# Saha bootstrap / seed
npm run saha:bootstrap        # tsx scripts/saha-bootstrap.ts
npm run saha:create-admin     # bootstrap-admin.ts (first-admin)
npm run saha:check-setup
npm run saha:validate-verticals
npm run saha:import-sivas     # legacy hekim listesi import
npm run saha:check-migrations # continue-on-error gate
npm run check:duplicates

# Supabase (yerel)
npm run supabase:start | stop | reset | push
npm run db:local-reset | db:local-dump-baseline

# Native (Capacitor Android)
npm run build:native          # cross-env VITE_BUILD_TARGET=native vite build
npm run cap:sync              # build:native + cap sync
npm run cap:android          # + cap open android
npm run cap:android:build    # + gradlew assembleRelease
```

Ek script'ler (`scripts/`, `.cjs`/`.mjs` yerel node): `publish-ota.mjs` (OTA yayın),
`test-tsp-quality.cjs` (rota TSP kalite), `scan-province.cjs`, `seed-clinics.mjs`,
`import-hekim-listesi.cjs`, `merge-districts.cjs`, `regeocode-orphans.cjs`,
`build-apk.sh` + `generate-keystore.sh` (APK imzalama).

---

## 5. Env (FACT)

| Dosya | Rol |
|-------|-----|
| `.env.example` | Şablon — Supabase / Mapbox / Google / MapTiler / CustomCRM. **server-only** uyarıları burada: `MAPBOX_SECRET_TOKEN`, `GOOGLE_PLACES_API_KEY`, service_role |
| `.env.production` | ⚠️ **REPO'DA COMMITLİ** canlı key'ler gömülü (risk #2) |
| `.env` | Yerel geliştirme |

**Doğrulanan değerler (.env.production):**
- `VITE_SUPABASE_URL = rranpzicmhgfupgabgbi.supabase.co` (AYNI Parla projesi)
- anon/publishable key (client-safe)
- `VITE_MAPBOX_PUBLIC_TOKEN` gömülü (mapbox-gl için)
- `VITE_ENABLE_FEEDBACK=1` (geçici beta feedback FAB)
- `VITE_BUILD_TARGET=native` (native build modunda)

service_role SADECE bootstrap script'lerde ve edge function'larda kullanılır — client bundle'da anon-key.

---

## 6. Vertical / white-label yapılandırma (FACT)

13 sektör şablonu `verticals/*.json`:
`dental` · `pharmacy` · `veterinary` · `optician` · `cosmetics_beauty` · `medical_supply` ·
`industrial_supply` · `automotive_parts` · `cafe_restaurant` · `mini_market` ·
`agriculture_feed` · `construction_materials` · `generic`.

Aktif dikey `.saha-config.json` + vertical `extends` ile **build-time bake** edilir
(`loadSahaConfig` + `applyBranding`). CRM adapter tipi config ile `supabase` veya
`custom_rest` seçilebilir (bkz. ARCHITECTURE §CRM Adapter).

---

## 7. Backend & entegrasyonlar (FACT)

**Backend = Supabase Edge Functions (Deno)** — `.cjs`/Express DEĞİL. `supabase/functions/` (13):
`admin-create-user` · `clinic-scan` · `clinic-scan-v2` · `clinic-scan-v3` (v1/v2/v3 paralel — risk #7) ·
`batch-scan` · `google-places-search` · `google-directions` · `mapbox-directions` ·
`mapbox-optimize` · `osm-search` · `enum-neighborhoods` · `doktor-takvimi-scrape` · `sample-roi-compute`.

**Entegrasyonlar:**
- **Supabase** — DB + Auth + Storage + edge fn (proje `rranpzicmhgfupgabgbi`, web/parla ile ortak).
- **Mapbox** (mapbox-gl + `VITE_MAPBOX_PUBLIC_TOKEN`; secret `MAPBOX_SECRET_TOKEN` edge fn `mapbox-directions`/`mapbox-optimize`).
- **Google Places / Directions** — `google-places-search` / `google-directions` edge fn (server-only `GOOGLE_PLACES_API_KEY`).
- **OpenStreetMap** — `osm-search` edge fn. Opsiyonel **MapTiler**.
- **Capacitor native servisleri** — Push/Local Notifications, Share, Filesystem, Browser (OAuth), Preferences.
- **OTA** — self-hosted `@capgo/capacitor-updater` (`autoUpdate:false`, `otaCheck('nav')`, yayın `scripts/publish-ota.mjs`).
- **KVKK consent** — `onboarding/kvkk` (TR kişisel-veri uyumu).

---

## 8. Deploy (FACT — 2 hedef)

**(1) WEB → Cloudflare Workers Static Assets**
- `wrangler.jsonc` name=`dent-route`, assets=`./dist`, SPA fallback.
- CI: `npx wrangler deploy` (Node 22; secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`).
- `_redirects` (/*→index 200), `_headers` (X-Frame DENY, CSP-lite, asset immutable cache, sw.js no-cache).
- Domain: **saha.parladisdeposu.com**.

**(2) NATIVE → Capacitor Android**
- appId `com.parla.saha`, appName "Parla CRM", webDir `dist`.
- `npm run build:native` → `cap sync` → `gradlew assembleRelease` (`scripts/build-apk.sh` + `generate-keystore.sh`).
- Web-bundle güncelleme: Capgo self-host OTA (`autoUpdate:false`).

**CI (`.github/workflows/ci.yml`, push/PR main+develop):**
- `validate` job: `format:check` → `validate-verticals` → `saha:check-migrations` (continue-on-error) →
  `typecheck` → `vitest` → `build` (dummy env).
- `lint` job: **non-blocking**.
- `deploy-migrations` job (main push): Supabase migration'ları Supavisor pooler
  (`aws-1-eu-central-1:6543` IPv4) üzerinden `psql` ile **BEST-EFFORT** apply
  (`ON_ERROR_STOP` kapalı, idempotent — risk #4).
- `deploy-cloudflare` job. Ayrıca `duplicate-check.yml`.

**DB migrations:**
- `supabase/migrations/` — `parla_baseline_local` + `saha_*` eklemeli (saha_ prefix, IF NOT EXISTS idempotent).
- `supabase/migrations-greenfield/0001_initial_schema.sql` — white-label sıfırdan-kurulum şeması
  (profiles/accounts/products/routes/visits/orders/order_items/payments/campaigns/assignments/sync_queue…).
- Prod PAYLAŞIMLI Parla DB'ye eklemeli.

---

## 9. Bilinmesi gereken riskler (özet — detay ARCHITECTURE §Blast-radius)

1. `capacitor.config.ts` `webContentsDebuggingEnabled: true` — yorumda "TEST BİTİNCE false" (DEVICE-001). **Teslim-blocker adayı** (ADB ile localStorage token okunabilir).
2. `.env.production` repo'da commitli + Mapbox public token gömülü → token URL-restrict edilmemişse abuse.
3. AYNI Supabase projesi web+parla+NAV ortak → RLS hatası tüm ekosistemi etkiler (rol-casing yakın zamanda düzeltildi, kırılgan).
4. `deploy-migrations` ON_ERROR_STOP kapalı → bozuk migration sessiz atlanır, CI yeşil kalır.
5. Kalite gate'leri gevşek (`saha:check-migrations` continue-on-error, lint non-blocking, max-warnings 25).
6. Repo kirli — build artefaktları versiyonlanmış.
7. `clinic-scan` v1/v2/v3 paralel (ölü-kod riski).
8. İki şema dünyası (greenfield generic vs canlı `saha_clinics`) — parite doğrulanmalı.
9. `router.tsx` ~580 satır tek dosya, ~50 rota boilerplate.

**VARSAYIM (kanıtlanmadı):** Sentry/hata-izleme NAV'da kurulu mu belirsiz (web/backend'de var).
Test kapsamı geçme oranı ölçülmedi (vitest/playwright config mevcut ama yeşil olduğu doğrulanmadı).
