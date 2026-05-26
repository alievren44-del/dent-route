# 🧭 Saha Satış Uygulaması — Master Prompt v1.0

> **Bu dosya `.ai_context/` sisteminin giriş noktasıdır.**
> Claude Code, Antigravity veya başka bir AI asistan bu projede çalışmaya başlarken **ÖNCE bu dosyayı baştan sona okumalıdır**. Sonra `01-decisions.md`, `02-architecture.md` ve `03-database-schema.md` sırasıyla okunmalıdır.

---

## 1. Proje Kimliği

| Alan | Değer |
|---|---|
| **Proje Adı** | Saha Satış Uygulaması (kod adı: `saha-app`) |
| **İlk Müşteri** | Parla Diş Deposu (saha satış ekibi) |
| **Ürün Tipi** | Saha satış otomasyonu, **white-label SaaS** olarak satılmaya hazır |
| **Sektör Odağı** | Dental B2B (genişletilebilir) |
| **Faz** | MVP (v0.1) |
| **Hedef Çıkış** | ~8 hafta (tek geliştirici) |

### Tek cümle özet
> Saha satış temsilcilerinin anlık konuma göre çevredeki klinikleri keşfedip, seçilen kliniklere yakıt/zaman optimize rota oluşturmasını, ziyaret kayıtları tutmasını ve mobil sipariş açmasını sağlayan Android-öncelikli PWA.

---

## 2. Çalışma Prensipleri (AI asistanlar için)

1. **Approval-gated workflow:** Hiçbir kod değişikliği, dosya oluşturma veya yeniden yapılandırma kullanıcının onayı olmadan yapılmaz. Önce öneri sun, sonra "başla" komutu bekle.
2. **Türkçe iletişim:** Kullanıcı ile iletişim Türkçe. Kod, commit mesajları ve teknik dokümanlar İngilizce. Dosya isimleri İngilizce.
3. **Decision lock'a sadakat:** `01-decisions.md` dosyasındaki kararlar **kilitlidir**. Değiştirilmesi için kullanıcının açık talimatı gerekir.
4. **Riskli alanlarda durakla:** Performans, güvenlik, lisans veya KVKK riski varsa kod yazmadan önce kullanıcıya bildir.
5. **YAGNI prensibi:** Spekülatif özellik geliştirilmez. Sadece scope'da olan veya açıkça istenmiş olan yapılır.
6. **Minimal output formatı:** Yanıtlarda gereksiz formatlama, başlık enflasyonu ve bullet patlaması olmaz. Mobil ekran dostu kalsın.

---

## 3. Stack Kararları (Locked)

```
Frontend:
  - React 18 + TypeScript (strict)
  - Vite
  - Tailwind CSS (CSS variables ile branding)
  - TanStack Query (server state + offline cache)
  - Zustand (client state)
  - React Router v6
  - Mapbox GL JS (harita)
  - Workbox (Service Worker)
  - Dexie.js (IndexedDB wrapper)

Backend:
  - Supabase (PostgreSQL 15+ + PostGIS)
  - Supabase Auth
  - Row Level Security (RLS)
  - Edge Functions (Deno, TypeScript)
  - Supabase Storage (foto upload)

Dış Servisler:
  - Mapbox Optimization API v1 (çoklu durak optimize)
  - Mapbox Directions API (trafikli rota)
  - Google Places API (klinik keşfi, autocomplete)

Deploy:
  - Cloudflare Pages (frontend)
  - Supabase (backend, self-hosted veya cloud)

Geliştirme:
  - Antigravity (IDE)
  - Claude Code (CLI agent)
  - Git + GitHub
  - GitHub Actions (lint, test, build, duplicate file check)
```

### Hedef Platform
- **Android Chrome 100+** (PWA olarak yüklenebilir)
- **iOS desteği yok** (MVP'de bilinçli kapsam dışı — Faz 3'te değerlendirilecek)
- **Masaüstü** Manager/Admin paneli için (Chrome/Firefox/Edge)

---

## 4. Mimari Özet

**Hexagonal / Adapter Pattern:**

```
┌──────────────────────────────────────┐
│  SAHA APP CORE (CRM-agnostik)        │
│  Harita · Rota · Ziyaret · Auth      │
└─────────────────┬────────────────────┘
                  │
        ┌─────────▼─────────┐
        │   ICRMAdapter     │  ← Sözleşme
        └─────────┬─────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
┌────────────┐       ┌──────────────┐
│ Built-in   │       │ Custom REST  │
│ (Supabase) │       │ (Adapter)    │
└────────────┘       └──────────────┘
```

**İki katman:**
- **Built-in CRM** (`accounts`, `products`, `orders` vb.): Sadece `crm.type=supabase` modunda kullanılır
- **Saha Layer** (`visits`, `routes`, `mileage_logs` vb.): Her zaman Supabase'de, adapter-bağımsız

Detay: `02-architecture.md` ve `03-database-schema.md`

---

## 5. MVP Scope (13 Özellik)

### ✅ Yapılacak

1. Konum tabanlı klinik keşfi (Google Places) + kendi DB
2. Çoklu durak rota optimizasyonu (Mapbox Optimization)
3. Gerçek zamanlı trafikli süre (Mapbox Directions)
4. Ziyaret check-in/check-out + GPS damgalı kayıt
5. Ziyaret kanıtı foto upload (Supabase Storage)
6. WhatsApp deep-link + telefon arama
7. Müşteri geçmişi (sipariş + ziyaret) — adapter'dan
8. Cari bakiye gösterimi — adapter'dan (cached + refresh)
9. Mobil sipariş açma (adapter'a `createOrder`)
10. Yakıt/km tracking (Mapbox mesafe × kullanıcı ortalama tüketim)
11. Tekrarlayan rotalar (RRULE bazlı, haftalık/aylık döngü)
12. Manager dashboard + heatmap (admin web)
13. Offline mod (Workbox + IndexedDB + sync_queue)

### ❌ Kapsam Dışı (Faz 2+'a)

- AI ziyaret prep (klinik özetleme)
- Kampanya/promosyon yönetim arayüzü (sadece gösterim MVP'de)
- Leaderboard / gamification
- E-fatura/e-irsaliye kesme (ERP'nin işi)
- Tahsilat
- iOS desteği
- Logo/Mikro/Netsis adapter'ları (talep oluşunca yazılır)
- Multi-tenant tek deployment (her firma kendi kurulumu)

---

## 6. Kalite Standartları

- **TypeScript strict mode** — `any` kullanımı PR'da reddedilir
- **ESLint + Prettier** — pre-commit hook
- **Test:** Vitest (unit), Playwright (kritik akış)
- **Lighthouse PWA score:** ≥ 90 (production build'de)
- **Bundle size:** Initial < 300KB gzip, route chunks < 100KB
- **Performance budget:** Map ilk render < 2s (3G fast), check-in submit < 500ms (offline kuyruğa anında)
- **Erişilebilirlik:** Tüm interaktif element en az 44×44px (tactile, eldiven varsa bile)
- **Lokalizasyon:** UI Türkçe, kod İngilizce; i18n hazır yapı (gelecek için)

---

## 7. Branding & White-Label

- **Config-driven:** `config/.saha-config.json`
- **Minimum scope:** `name`, `logo`, `primaryColor`, `accentColor`
- **Tailwind:** CSS variables ile renkler runtime'da değişir
- **Tek tasarım dili:** Sade, satıcı odaklı, mobile-first

```json
{
  "branding": {
    "name": "Parla Saha",
    "logo": "/assets/parla-logo.svg",
    "primaryColor": "#2563EB",
    "accentColor": "#10B981"
  }
}
```

---

## 7.5 Vertical Template System (Sektör Şablonu)

App **sektör-agnostiktir**. Her deployment kendi sektörünü seçer (diş, eczane, oto yedek parça, cafe vb.). Yeni sektör eklemek **kod değişikliği gerektirmez**, sadece bir JSON template dosyası eklenir.

**Konsept:**
- `verticals/` dizininde sektör başına bir JSON şablon
- `.saha-config.json`'da `vertical.extends: "dental"` ile şablon seçilir
- `vertical.overrides` ile bu deployment'a özel ayarlar yapılır
- UI etiketleri ("Klinik" / "Eczane" / "Bayi"), müşteri tipleri, Google Places type'ları, ziyaret outcome'ları ve custom fields hep template'tan gelir

**Hazır şablonlar (v1.0):**
`dental`, `pharmacy`, `optician`, `veterinary`, `medical_supply`, `cafe_restaurant`, `mini_market`, `cosmetics_beauty`, `automotive_parts`, `construction_materials`, `industrial_supply`, `agriculture_feed`, `generic`

Detay: `05-verticals.md`

---

## 8. Güvenlik & Uyum

- **API key'ler asla client'a sızmaz** — Mapbox/Google çağrıları Supabase Edge Function proxy
- **RLS her tabloda zorunlu** — `disable_rls = false` migration politikası
- **KVKK aydınlatma metni** — ilk login'de zorunlu kabul
- **GPS tracking** sadece aktif rota süresince (battery + privacy)
- **Veri saklama:** ziyaret kayıtları 2 yıl, GPS log 90 gün, foto 1 yıl
- **HTTPS zorunlu** (Cloudflare Pages varsayılan)

---

## 9. Bootstrap Akışı (Claude Code için)

Yeni bir kuruluma proje verildiğinde:

```bash
npm run saha:bootstrap
```

Bu komut sırasıyla:

1. `config/.saha-config.json` okunur
2. `crm.type` kontrol edilir
3. **`supabase` ise:**
   - Mevcut tablolar tespit edilir
   - Beklenen şema ile diff alınır
   - Eksikse migration uygulanır, varsa olduğu gibi kullanılır
4. **`custom_rest` ise:**
   - Adapter bağlantısı test edilir
   - Endpoint sözleşmesi doğrulanır
5. Saha-specific tablolar her durumda kontrol edilir/oluşturulur
6. Bootstrap raporu sunulur (✅/⚠️/❌ format)

---

## 10. Yapı (Folder Structure)

Detayı `02-architecture.md`'de. Özet:

```
saha-app/
├── .ai_context/          ← Bu dizin: AI asistanlar için context
├── src/
│   ├── core/             ← CRM-agnostik iş mantığı
│   │   ├── adapters/     ← ICRMAdapter + implementations
│   │   ├── routing/      ← Mapbox optimization wrapper
│   │   ├── sync/         ← Offline queue + Background Sync
│   │   └── auth/
│   ├── features/         ← UI feature modülleri
│   │   ├── map/
│   │   ├── clinics/
│   │   ├── routes/
│   │   ├── visits/
│   │   ├── orders/
│   │   └── admin/
│   ├── components/       ← Reusable UI
│   ├── lib/              ← Util, formatter, helpers
│   └── config/           ← Runtime config loader
├── supabase/
│   ├── migrations/       ← SQL migrations
│   └── functions/        ← Edge Functions
├── config/
│   └── .saha-config.json ← Per-deployment config
├── public/
└── tests/
```

---

## 11. Tamamlanmamış Konular (Open Questions)

- KVKK aydınlatma metni final içerik (hukuk ile)
- Parla Diş Deposu ürün kataloğu hangi DB'de? (sonradan adapter ile bağlanacak)
- Mapbox usage alert eşik değerleri
- Foto upload boyut limiti (önerilen: 2MB, server-side resize)

Bu konular ilgili faz başlangıcında ele alınacak.

---

## 12. Sürüm Tarihçesi

| Versiyon | Tarih | Değişiklik |
|---|---|---|
| 1.0 | 2026-05-20 | İlk sürüm. MVP scope, stack ve mimari kilitlendi. |

---

> **Sonraki dosyalar:**
> - `01-decisions.md` — Kilitli karar tablosu
> - `02-architecture.md` — Detaylı mimari + folder structure
> - `03-database-schema.md` — Tablo şeması ve RLS politikaları
> - `04-adapter-contract.md` — ICRMAdapter interface'i ve sözleşme
> - `05-verticals.md` — Vertical Template System ve sektör şablonları
> - `06-risks.md` — Risk register ve mitigation'lar
> - `07-roadmap.md` — Faz 1/2/3 sprint planı
