# NAV (dent-route / saha) — ARCHITECTURE

> Bağımlılık / servis / veri / API haritası + katmanlar + blast-radius.
> Feature-sliced monorepo-app: `src/core/*` (yatay altyapı) + `src/features/*` (17 dikey ekran),
> path-alias'larla ayrık (`@core @features @components @lib @config @verticals` — `vite.config.ts`).

---

## 1. Katman haritası

```
┌──────────────────────────────────────────────────────────────────────┐
│  ENTRY: index.html → src/main.tsx                                      │
│  boot: ssoCapture → loadSahaConfig+applyBranding → StatusBar(native)   │
│        → QueryClient+persist → initSyncQueue → otaCheck('nav') → render │
│  ağaç: StrictMode>PersistQueryClientProvider>VerticalProvider>          │
│        BrowserRouter>AuthBootstrap>App                                  │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────┐     ┌──────────────────────────────────┐
│ FEATURES (src/features/, 17)│────▶│ CORE (src/core/, yatay altyapı)  │
│ dikey ekranlar — UI + akış  │     │ adapters auth geolocation offline │
│                             │     │ qr routing sampling storage sync  │
│                             │     │ verticals                         │
└─────────────────────────────┘     └──────────────────────────────────┘
        │                                        │
        │  React Query (offlineFirst)            │  CRM ADAPTER (tek soyutlama noktası)
        ▼                                        ▼
┌─────────────────────────────┐     ┌──────────────────────────────────┐
│ Dexie (offline/db.ts)       │     │ ICRMAdapter ← factory.ts          │
│ + syncQueue (sync_queue)    │     │   ├ SupabaseCRMAdapter (builtin)  │
└─────────────────────────────┘     │   └ CustomRESTAdapter (white-lbl) │
                                     └──────────────────────────────────┘
                                                 │
        ┌────────────────────────────────────────┼───────────────────────────┐
        ▼                                         ▼                           ▼
┌──────────────────┐              ┌──────────────────────────┐   ┌────────────────────┐
│ Supabase DB/Auth │              │ Supabase Edge Fn (Deno)  │   │ Mapbox / Google /  │
│ saha_clinics +   │              │ clinic-scan v1/2/3 ·     │   │ OSM (edge-proxy'li)│
│ RPC'ler (§4)     │              │ batch-scan · *-search ·  │   │ mapbox-gl (client) │
│ proje rranpz…    │              │ *-directions · roi …     │   └────────────────────┘
└──────────────────┘              └──────────────────────────┘
```

**Katman kuralı:** `features/*` → `core/*` çağırır; `core/*` yatay ve feature-agnostik.
CRM erişimi HER ZAMAN `ICRMAdapter` üzerinden (doğrudan supabase-js çağrısı feature'da değil).

---

## 2. CRM Adapter pattern (FACT — mimarinin kalbi)

```
src/core/adapters/
├─ ICRMAdapter.ts     → arayüz (tüm CRM operasyonları)
├─ factory.ts         → createCRMAdapter(config)   ★ TEK adapter-oluşturma noktası
│                        config.crm.type'a göre:
│                          "supabase"     → builtin/SupabaseCRMAdapter (~1000+ satır)
│                          "custom_rest"  → custom-rest/CustomRESTAdapter (white-label)
│                        exhaustive never-check (tip güvenli branch)
├─ builtin/           → SupabaseCRMAdapter — saha_clinics + RPC (canlı CRM)
├─ custom-rest/       → CustomRESTAdapter — harici REST CRM (white-label müşteri)
├─ errors.ts · types.ts
```

**Blast-radius:** `factory.ts` tek geçiş noktası → adapter davranışı değişirse TÜM feature'lar
etkilenir. `ICRMAdapter` arayüzüne yeni metod eklemek her iki adapter'ı da zorunlu kılar
(exhaustive-check derleme hatası verir → güvenli).

---

## 3. Veri katmanı & state

| Mekanizma | Konum | Not |
|-----------|-------|-----|
| Server cache | @tanstack/react-query 5.51 | `networkMode: offlineFirst`, `staleTime: 0`, `refetchOnMount: always` |
| Persist | PersistQueryClientProvider + async-storage-persister | buster `v0.2.0`; SADECE `PERSIST_ALLOW_PREFIXES` allow-list'teki statik lookup'lar |
| **Hariç (bilinçli)** | cari / fatura / order / bakiye | volatile finansal → asla persist edilmez (bayat-veri riski önleme) |
| Offline DB | Dexie 4 (`src/core/offline/db.ts`) | yerel kalıcı depo |
| Sync kuyruğu | `syncQueue.ts` → `initSyncQueue()` (main.tsx boot) | online/offline event kuyruğu → `sync_queue` tablosu (VARSAYIM: greenfield şemada mevcut) |
| Client state | zustand 4.5 | vendor-utils chunk |

**Offline-first akış:** mutation offline iken `syncQueue`'ya yazılır → online event'te
`sync_queue` tablosuna flush. Volatile finansal veriler cache-persist DIŞI tutularak
"offline'da eski bakiye gösterme" hatası engellenir.

---

## 4. API / servis haritası (FACT)

### Supabase RPC (SupabaseCRMAdapter içinde doğrulanmış)
| RPC | Amaç | Adapter satırı |
|-----|------|----------------|
| `saha_search_nearby_clinics` | yarıçap-içi klinik keşfi (Discovery/SahaTara/NearbyProvinces) | L193 |
| `saha_search_clinics` | klinik arama | L135 |
| cari find-or-create | sipariş için cari türet | L625 |
| `approve_order_if_authorized` | sipariş onay yetki kontrolü (admin) | L947 |

Tablo: `saha_clinics` (L117/171/217/264/613 — SupabaseCRMAdapter).

### Edge Functions (Deno, `supabase/functions/`, 13)
| Fonksiyon | Rol |
|-----------|-----|
| `clinic-scan`, `clinic-scan-v2`, `clinic-scan-v3` | toplu klinik kazıma (v3: grid+dedup+specialty-queries) — ⚠️ 3 sürüm paralel |
| `batch-scan` | toplu tarama işi |
| `google-places-search`, `google-directions` | Google proxy (server-only key) |
| `mapbox-directions`, `mapbox-optimize` | Mapbox proxy/rota optimizasyon (server-only secret) |
| `osm-search` | OpenStreetMap arama |
| `enum-neighborhoods` | mahalle enum |
| `doktor-takvimi-scrape` | doktor takvimi scrape |
| `sample-roi-compute` | numune ROI hesaplama (core/sampling ile eşleşir) |
| `admin-create-user` | admin kullanıcı oluşturma (service_role) |

---

## 5. Feature ↔ core ↔ servis eşlemesi (iş akışları)

| Akış | Feature (rota) | Core | Servis/RPC |
|------|----------------|------|------------|
| **Discovery / radius-tarama** | discovery, `/saha/tara`, `/nearby-provinces` | adapters | `saha_search_nearby_clinics` / `saha_search_clinics` |
| **Admin klinik kazıma** | admin (ClinicScan, ScanJobDetail, ScanRoutePlanner) | adapters | edge: clinic-scan-v3, batch-scan, google/osm-search |
| **Rota** | routes/* (plan, active, auto=ilçe, corridor, assigned) | routing/exporters | mapbox-optimize/directions; TSP kalite `test-tsp-quality.cjs` |
| **Ziyaret** | visits (CheckIn→VisitForm→VisitHistory) | geolocation (check-in) | `visits` tablosu |
| **Sipariş (RBAC)** | orders (new=sales_rep → approval=admin → history) | adapters | cari find-or-create + `approve_order_if_authorized` |
| **Fatura/Cari** (`saha:invoicing:access`) | invoicing (cari, fatura, ödeme, çek-senet, aging, stok) | adapters | Supabase tablolar |
| **Numune** | sampling (SamplesPage) + admin (SampleBudget, RegionAssignment) | sampling (hunter-detection, quotas, roi, policies) | edge: sample-roi-compute |
| **Auth/Rol** | auth, onboarding/kvkk, first-admin | auth/ssoCapture | Supabase Auth; SSO hand-off (Parla web→token devri = VARSAYIM) |
| **White-label** | config (vertical seçimi) | verticals (VerticalContext/Loader) | build-time bake (`.saha-config.json` + verticals/*.json) |

**RBAC (FACT):** Roller `admin` / `sales_rep` + permission-tabanlı (`saha:invoicing:access`).
`ProtectedRoute` `requireRole` / `requirePermission` destekler. Rol casing kökten düzeltildi
(case-insensitive saha RLS + NAV lowercase yazar, git `70924a0`).

---

## 6. Şema dünyaları (İKİ ayrı — parite riski)

| Şema | Konum | Durum |
|------|-------|-------|
| **Canlı / eklemeli** | `supabase/migrations/` (`parla_baseline_local` + `saha_*`) | prod'da aktif; adapter buna bağlı (`saha_clinics`, saha_ prefix, IF NOT EXISTS idempotent) |
| **Greenfield / white-label** | `supabase/migrations-greenfield/0001_initial_schema.sql` | generic şema (accounts/products/routes/visits/orders/order_items/payments/campaigns/assignments/sync_queue) — VARSAYIM: henüz deploy edilmemiş |

⚠️ Greenfield (generic `accounts/products`) ile canlı (`saha_clinics`) arasında **parite
doğrulanmamış**. SupabaseCRMAdapter canlı şemaya bağlı; white-label hedefi greenfield'i işaret ediyor.

---

## 7. Blast-radius / risk matrisi (FACT — kaynak: discovery risks)

| # | Nokta | Yarıçap | Şiddet |
|---|-------|---------|--------|
| 1 | `capacitor.config.ts` `webContentsDebuggingEnabled:true` (DEVICE-001) | native APK'daki her cihaz — ADB/USB ile localStorage token okunur | 🔴 Teslim-blocker adayı |
| 2 | `.env.production` commitli + Mapbox public token gömülü (CI'da da hardcoded) | anon "client-safe" ama Mapbox token URL-restrict yoksa abuse; anon key rotasyonu zor | 🟠 |
| 3 | AYNI Supabase projesi (web+parla+NAV, `rranpzicmhgfupgabgbi`) | RLS/rol hatası **3 uygulamayı birden** kırar; rol-casing yakın zamanda düzeltildi | 🔴 Ekosistem-geneli |
| 4 | `deploy-migrations` ON_ERROR_STOP kapalı + best-effort | bozuk migration sessiz atlanır → CI yeşil ama şema-drift gizli; "MCP ile de uygula" manuel borç | 🟠 |
| 5 | Gevşek gate: `saha:check-migrations` continue-on-error, lint non-blocking, max-warnings 25 | regresyon CI'yı geçebilir | 🟡 |
| 6 | Repo kirliliği: `saha-app.zip`, `.adb-screen.png/.adb-ui.xml`, `data-legacy/`, `__wt_diff.txt`, çift `vite.config.ts/.js/.d.ts`, derlenmiş `scripts/*.js+.d.ts` | build artefaktları versiyonlu → merge gürültüsü, yanlış-dosya-düzenleme | 🟡 |
| 7 | `clinic-scan` v1/v2/v3 paralel | ölü-kod; yanlış sürüm çağrılabilir | 🟡 |
| 8 | İki şema dünyası (greenfield vs canlı) | white-label deploy'da parite kırılması | 🟠 |
| 9 | `router.tsx` ~580 satır, ~50 rota `ProtectedRoute>AppShell` tekrarı | bakım maliyeti, tutarsız guard riski | 🟡 |

**VARSAYIM (kanıt yok):** NAV'da Sentry/hata-izleme kurulu mu belirsiz (MEMORY'de web/backend'de
var, NAV kodu görülmedi). Test geçme oranı ölçülmedi (vitest/playwright config mevcut).

---

## 8. Deploy topolojisi (özet — detay PROJECT_CONTEXT §8)

```
                   ┌─────────── main push (CI) ───────────┐
                   ▼                                       ▼
        deploy-cloudflare                        deploy-migrations
        wrangler deploy → Workers                psql → Supavisor pooler
        (dent-route, ./dist)                     (aws-1-eu-central-1:6543)
        saha.parladisdeposu.com                  best-effort, ON_ERROR_STOP kapalı
                   ▲
                   │ (aynı dist)
        build:native → cap sync → gradlew assembleRelease
        Android com.parla.saha "Parla CRM"
        web-bundle güncelleme: Capgo self-host OTA (otaCheck('nav'))
```

**Bağımlı dış servisler:** Supabase (DB/Auth/Storage/EdgeFn) · Cloudflare Workers · Mapbox ·
Google Places/Directions · OSM · Capgo (OTA) · Capacitor Android native servisleri.
