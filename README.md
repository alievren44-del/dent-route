# 🚀 Saha Satış Uygulaması

Saha satış temsilcileri için Android-öncelikli PWA. Anlık konum bazlı müşteri keşfi, çoklu durak rota optimizasyonu, ziyaret kayıtları ve mobil sipariş.

İlk müşteri: **Parla Diş Deposu**. Mimari white-label SaaS olarak satılabilir — 13 sektör template'ı (diş, eczane, oto yedek, cafe, vb.) hazır gelir.

---

## ⚡ Hızlı Başlangıç

```bash
# 1. Bağımlılıkları kur
npm install

# 2. Config dosyasını oluştur ve düzenle
cp config/.saha-config.example.json config/.saha-config.json
# config/.saha-config.json içinde tenant, branding ve vertical alanlarını doldur

# 3. Environment variables
cp .env.example .env
# .env içine Supabase ve Mapbox token'larını yaz

# 4. Bootstrap kontrol
npm run saha:bootstrap

# 5. Supabase'i hazırla (ilk kurulum)
supabase link --project-ref <your-ref>
supabase db push     # 0001_initial_schema.sql migration'ı uygulanır

# 6. Geliştirme sunucusu
npm run dev
```

---

## 📁 Yapı

```
saha-app/
├── .ai_context/           ← AI asistanlar için context (BURADAN BAŞLA)
├── verticals/             ← 13 sektör template JSON
├── src/
│   ├── core/              ← CRM-agnostik iş mantığı + adapter'lar + vertical loader
│   ├── features/          ← UI feature modülleri (Sprint 2+'ta dolar)
│   ├── components/        ← Reusable UI
│   ├── config/            ← Config loader + branding + env
│   └── styles/
├── supabase/migrations/   ← SQL şema
├── scripts/               ← Bootstrap CLI + validator'lar
├── config/                ← .saha-config.json
└── tests/
```

---

## 🤖 AI Asistanlar İçin

**ÖNEMLİ:** Bu projede çalışmadan önce `.ai_context/` dizinindeki dokümanları sırayla oku:

1. `00-master-prompt.md` — Proje kimliği, scope, prensipler
2. `01-decisions.md` — Kilitli kararlar (D-001 → D-017)
3. `02-architecture.md` — Mimari + folder structure
4. `03-database-schema.md` — DB şema açıklaması
5. `04-adapter-contract.md` — ICRMAdapter interface'i
6. `05-verticals.md` — Vertical Template System
7. `06-risks.md` — Risk register
8. `07-roadmap.md` — Sprint planı (8 hafta MVP)

**Çalışma kuralı:** Approval-gated — değişiklik yapmadan önce öneri sun, kullanıcı onayı bekle.

---

## 🛠️ Komutlar

```bash
npm run dev                    # Geliştirme sunucusu
npm run build                  # Production build
npm run typecheck              # TypeScript check
npm run lint                   # ESLint
npm run lint:fix               # ESLint + autofix
npm run format                 # Prettier
npm test                       # Vitest unit tests
npm run test:e2e               # Playwright E2E
npm run saha:bootstrap         # Tenant kurulum doğrulama
npm run saha:validate-verticals # Tüm vertical JSON'ları validate et
npm run check:duplicates       # Duplicate filename guard
```

---

## 🛠️ Stack

- **Frontend:** React 18 + TypeScript + Vite + Tailwind + TanStack Query + Mapbox GL
- **Backend:** Supabase (PostgreSQL + PostGIS + Auth + Edge Functions)
- **Offline:** Workbox + Dexie.js + Background Sync
- **External:** Mapbox (rota+harita), Google Places (müşteri keşfi)
- **Deploy:** Cloudflare Pages

Detay: `.ai_context/02-architecture.md`

---

## 🏷️ Sektör Template'leri (Vertical System)

`.saha-config.json` içinde `vertical.extends` değeri ile seçilir:

| ID | Sektör |
|---|---|
| `dental` | Diş Hekimliği |
| `pharmacy` | Eczane |
| `optician` | Optisyen |
| `veterinary` | Veteriner |
| `medical_supply` | Medikal Cihaz/Malzeme |
| `cafe_restaurant` | HORECA |
| `mini_market` | FMCG/Bakkal |
| `cosmetics_beauty` | Kozmetik/Güzellik |
| `automotive_parts` | Oto Yedek Parça |
| `construction_materials` | İnşaat Malzemeleri |
| `industrial_supply` | Sanayi/MRO |
| `agriculture_feed` | Tarım/Yem/Zirai |
| `generic` | Genel |

Yeni sektör eklemek için: `verticals/<id>.json` dosyası yarat, kod değişikliği gerekmez.

Detay: `.ai_context/05-verticals.md`

---

## 📝 Lisans & Telif

Bu proje Parla Diş Deposu için geliştirilmektedir. SaaS lisansı modeli henüz belirlenmemiştir.
