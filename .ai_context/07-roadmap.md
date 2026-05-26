# 🗺️ Roadmap — Saha App v1.0

> Bu dosya yaşayan bir doküman. Sprint sonu retroda güncellenir.

---

## Faz Özeti

| Faz | Süre | Hedef | Çıktı |
|---|---|---|---|
| **Faz 1 — MVP** | 8 hafta | Parla'ya production-ready ürün | İlk paying tenant |
| **Faz 2 — Pazar Açılımı** | 6-10 hafta | SaaS satılabilir, ek özellikler | 2-3 yeni tenant |
| **Faz 3 — Ölçek** | 3+ ay | iOS, multi-tenant, AI | 10+ tenant veya enterprise deal |

---

## 🚀 Faz 1 — MVP (8 Hafta)

**Hedef:** Parla Diş Deposu saha satış ekibi için production-ready Android PWA.

**Definition of Done (Faz 1):**
- 13 MVP özelliğinin tamamı çalışıyor (00-master-prompt §5)
- 3 vertical (dental, pharmacy, generic) tam test edildi (UI labels, custom fields)
- Lighthouse PWA score ≥ 90
- Critical path E2E test geçiyor
- 5 sales_rep + 1 manager + 1 admin ile staging test
- KVKK metni hukuki onay aldı

### Sprint 1 — Foundation (Hafta 1-2)

**Cilt 1: Setup**
- [ ] Repo init, `package.json`, `tsconfig`, `vite.config`, Tailwind setup
- [ ] Supabase proje oluştur, migration uygula (`0001_initial_schema.sql`)
- [ ] CI/CD: GitHub Actions (lint + typecheck + build), Cloudflare Pages preview
- [ ] `.saha-config.json` loader (`src/config/loadConfig.ts`)
- [ ] Branding CSS variable system
- [ ] Vertical loader (`src/core/verticals/`) + tüm 13 template JSON validation

**Cilt 2: Auth + Profile**
- [ ] Supabase Auth (email + password)
- [ ] Login page + KVKK consent ekranı (D-014)
- [ ] `profiles` tablosu otomatik oluşturma trigger doğrulandı
- [ ] Rol bazlı route guard (sales_rep / manager / admin)
- [ ] Zustand auth store + persistedQueryClient

**Sprint 1 sonu kontrol:**
- ✅ Boş app çalışıyor, login ediyor, role göre yönleniyor
- ✅ Vertical config'ten label okunur ("Klinik" görünür)
- ✅ Migration sıfırdan uygulanıyor

---

### Sprint 2 — Map & Discovery (Hafta 3)

- [ ] Mapbox GL JS entegrasyonu, dynamic import
- [ ] `MapPage` ana ekran (kullanıcı konumu + atanmış müşteri marker'ları)
- [ ] `core/geolocation/GeolocationService.ts`
- [ ] Built-in adapter `SupabaseCRMAdapter.searchNearby()` (PostGIS `ST_DWithin`)
- [ ] Edge Function `google-places-search` (proxy)
- [ ] Klinik keşfi UI (`ClinicDiscoverPage`)
- [ ] Duplicate detection (google_place_id ile)
- [ ] "Müşteriyi ekle" akışı (Built-in modu için)

**Sprint 2 sonu kontrol:**
- ✅ Konum tabanlı klinik listesi geliyor
- ✅ Google Places'tan yeni klinik keşfedilip eklenebiliyor
- ✅ Vertical-aware: `customerTypes` doğru render oluyor

---

### Sprint 3 — Routes & Optimization (Hafta 4)

- [ ] Klinik seçim sepeti (Zustand slice)
- [ ] `RoutePlannerPage` — seçilen klinikler + "Optimize Et"
- [ ] Edge Function `mapbox-optimize` (proxy, rate limit)
- [ ] `core/routing/OptimizationClient.ts`
- [ ] Polyline render, marker sıralaması
- [ ] `routes` tablosuna INSERT (planned status)
- [ ] `ActiveRoutePage` — sıralı duraklar + map
- [ ] Gerçek zamanlı trafik gösterimi (Directions API annotations)
- [ ] Tekrarlayan rota UI (RRULE picker basit versiyon)
- [ ] Mileage log: rota tamamlanınca distance + fuel hesabı

**Sprint 3 sonu kontrol:**
- ✅ 5 durak seçilip optimize edilir, harita üzerinde sıra görünür
- ✅ Trafikli süre gösterimi
- ✅ Tamamlanan rota mileage_logs'a düşer

---

### Sprint 4 — Visits & Check-in (Hafta 5)

- [ ] `CheckInPage` — büyük tap target, tek dokunuş check-in
- [ ] GPS damgalı `visits` INSERT
- [ ] `VisitFormPage` — outcome (vertical-aware), notes, foto upload
- [ ] Supabase Storage entegrasyonu (photos bucket, RLS)
- [ ] Client-side resize (1600px, JPEG q80)
- [ ] Vertical-aware custom fields (dental: doctor_count, vb.)
- [ ] Ziyaret geçmişi (per-account)
- [ ] WhatsApp deep-link + tel: link

**Sprint 4 sonu kontrol:**
- ✅ Check-in → form → save flow tamamlanır
- ✅ Foto upload + thumbnail görünür
- ✅ WhatsApp butonu doğru numarayı açar

---

### Sprint 5 — Orders & Balance (Hafta 6)

- [ ] Adapter `listProducts()` + ürün arama UI
- [ ] `OrderFormPage` — ürün ekle/çıkar, miktar, indirim
- [ ] `quoteOrder()` çağrısı (fiyat lock)
- [ ] `createOrder()` idempotency_key ile
- [ ] Edge Function `create-order` (server-side validation)
- [ ] `getBalance()` + cached display + manual refresh
- [ ] Ziyaret detayında "Sipariş aç" CTA
- [ ] Müşteri detay sayfasında: bakiye + son siparişler + son ziyaretler

**Sprint 5 sonu kontrol:**
- ✅ Saha temsilcisi 3-5 kalemlik sipariş açabilir
- ✅ Bakiye doğru hesaplanır (Built-in VIEW ile)
- ✅ Idempotency: aynı sipariş 2x kaydolmaz

---

### Sprint 6 — Offline Mode (Hafta 7)

- [ ] Workbox Service Worker setup (Vite plugin)
- [ ] App shell + asset precaching
- [ ] Dexie.js IndexedDB schema (assigned customers + active route + sync_queue mirror)
- [ ] TanStack Query persistedQueryClient
- [ ] `SyncQueue` operations: queue → flush → retry
- [ ] Background Sync API registration
- [ ] UI: "Offline" indicator + "Senkron beklemede X kayıt" badge
- [ ] Conflict resolution (last-write-wins for visits, idempotency for orders)
- [ ] MapTiler opsiyonel offline pack (config-driven)

**Sprint 6 sonu kontrol:**
- ✅ Uçak modunda check-in yapılır → queue'ya düşer
- ✅ Online olunca otomatik sync (Background Sync) çalışır
- ✅ Failure scenarios graceful: sync_queue.error_message görünür

---

### Sprint 7 — Admin & Polish (Hafta 8)

- [ ] `DashboardPage` (manager+admin) — bugünkü check-in'ler, toplam km, sipariş özet
- [ ] `HeatmapPage` — klinik yoğunluk heatmap (Mapbox heatmap layer)
- [ ] `UsersPage` — kullanıcı yönetimi, rol atama (admin)
- [ ] `ClinicsAdminPage` — atanma yönetimi, müşteri CSV import
- [ ] Loading states, empty states, error boundaries
- [ ] Toast notification system
- [ ] PWA manifest + icon set
- [ ] Lighthouse audit + iyileştirme (90+ hedef)
- [ ] E2E Playwright: critical path test
- [ ] Bug fix + polish

**Sprint 7 sonu kontrol (LAUNCH):**
- ✅ Tüm 13 MVP özellik çalışıyor
- ✅ Lighthouse ≥ 90
- ✅ Staging'te 3 gün hata-free
- ✅ KVKK metni production'a hazır
- 🎉 Parla'ya canlı demo

---

## 🌟 Faz 2 — Pazar Açılımı (3-4. Ay)

**Hedef:** Saha app SaaS olarak satılabilir. 2-3 yeni tenant kapatılması.

### Tema 1: Bonus Özellikler (D-017)

- [ ] **Lasso Selection** — Mobil haritada parmakla daire çiz, içindeki klinikleri seç → rota oluştur. SVG path tracking + PostGIS `ST_Within` query
- [ ] **Demographic Overlay** — TÜİK il/ilçe verisi (gelir, nüfus yoğunluk) Mapbox layer'ı olarak. Vertical-aware: dental için "klinik yoğunluk", cafe için "gelir seviyesi"
- [ ] **Photo Compliance Audit** — Vertical'da `features.photoCompliance.enabled=true` ise: ziyarette zorunlu foto kategorileri (raf, vitrin, fiyat etiketi). UI flow: check-out engellenir, kategoriler tamamlanmadan

### Tema 2: Custom REST Adapter Production-Ready

- [ ] Field mapping engine refactor (deep JSONPath)
- [ ] Sandbox/test mode (sample data simülasyonu)
- [ ] Adapter healthcheck dashboard (admin paneli)
- [ ] Webhook desteği (incoming) — CRM güncellemelerini receive et
- [ ] İlk gerçek custom_rest tenant pilot (örn: bir medikal firma)

### Tema 3: Vertical Genişletme

- [ ] Kullanıcı şikayetlerinden gelen vertical iyileştirmeleri
- [ ] 3-5 yeni vertical template (sektör talebine göre)
- [ ] Vertical override UX (admin paneli üzerinden custom field ekleme)

### Tema 4: Faz 1 İyileştirmeleri

- [ ] AI ziyaret prep (Claude API ile klinik özetleme — son 5 ziyaret + sipariş özet)
- [ ] Kampanya/promosyon yönetim arayüzü (sadece gösterim → tam yönetim)
- [ ] Leaderboard / gamification (haftalık en çok ziyaret/sipariş)
- [ ] Tahsilat modülü (eğer talep gelirse)

---

## 🚀 Faz 3 — Ölçek (6+ Ay)

**Hedef:** 10+ aktif tenant veya enterprise deal.

### Tema 1: Platform Genişleme

- [ ] **iOS desteği** (D-002 reopen kriteri karşılanırsa) — iOS Safari'nin PWA limitlerini Capacitor wrapper ile aş
- [ ] **Native mobile** (gerekirse) — Capacitor / React Native (kararı pazara göre)
- [ ] **Multi-tenant** mod (D-008 reopen) — tek deployment, çoklu firma. RLS-only veri izolasyonu

### Tema 2: AI & Otomasyon

- [ ] **Lead skoru** — ziyaret/sipariş/yanıt verisinden ML
- [ ] **Otomatik sıralama** — günün ziyaret listesini AI hazırlar
- [ ] **Konuşma analizi** (opsiyonel) — ziyaret sesi → notlar (Whisper API)
- [ ] **Anomaly detection** — kayıp ziyaret pattern'leri

### Tema 3: TR Pazara Özel Adapter'lar

- [ ] **Logo adapter** — Tiger Wings + GO destekli
- [ ] **Mikro adapter** — Mikro Fly + Jet
- [ ] **Netsis adapter** — talep yoğunsa
- [ ] Logo App Store / Mikro Marketplace entegrasyonu

### Tema 4: Enterprise Features

- [ ] SSO (Microsoft Entra, Google Workspace)
- [ ] Audit log (kim ne zaman ne yaptı, immutable)
- [ ] Bölge bazlı analytics + custom dashboards
- [ ] White-label tam tema (font, illustrasyon, layout)

---

## Sürekli (Tüm Fazlar)

- 🐛 Bug triage haftalık
- 📊 Tenant usage analytics + maliyet raporu
- 🔐 Quarterly security audit
- 📖 Doküman güncelleme (`.ai_context/*`)
- ⚡ Performance monitoring (Sentry / PostHog opsiyonel)
- 💬 Tenant feedback toplama (NPS) — Faz 2 sonrası

---

## Sprint Retrospective Checklist

Her sprint sonu (Cuma):

1. **Ne iyi gitti?** (3 madde)
2. **Ne kötü gitti?** (3 madde)
3. **Bir sonraki sprint için 1 process değişikliği**
4. `.ai_context/` dosyalarında güncellenmesi gereken alan var mı?
5. Yeni risk keşfedildi mi? (`06-risks.md` güncelle)

---

## Karar / Onay Kapıları

| Kapı | Ne zaman | Kim onaylar | Çıktı |
|---|---|---|---|
| **Sprint 4 → Sprint 5** | Hafta 5 sonu | Ali | Visits modülü demo |
| **MVP Launch** | Hafta 8 sonu | Ali + Parla yönetim | Production deploy |
| **Faz 2 Başlama** | Ay 3 | Ali | İkinci tenant pipeline'ı |
| **iOS Karar** | Ay 6 | Ali | iPhone kullanım anketi sonucu |
| **Logo Adapter** | Faz 2 ortası | Ali | İlk Logo'lu tenant lead'i |

---

## Tahmini Süre Riski

⏱️ **Yedek süre:** 8 hafta MVP planında **+2 hafta tampon** önerilir (10 hafta gerçekçi). Riskler:
- Offline mod (Sprint 6) en bilinmeyen — sürpriz çıkabilir
- KVKK metni hukuk onayı (Ali tarafı)
- İlk Mapbox/Google API integration edge case'ler

**Plan:** Sprint 6'yı 1.5 hafta tutmak, gerekirse Sprint 7'yi 1 hafta + 0.5 polish'e bölmek.
