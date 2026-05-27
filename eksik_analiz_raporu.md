# DentRoute (saha-app) — Detaylı Repo İnceleme Raporu

**Tarih:** 26 Mayıs 2026
**Repo:** github.com/alievren44-del/dent-route
**Commit sayısı:** 2 (henüz başlangıçta)
**Toplam dosya:** 163 (1.9 MB)

---

## 1. GENEL DURUM ÖZETİ

### ✅ Yapılmış (sağlam temel)

| Alan | Durum | Not |
|---|---|---|
| Proje iskelet (React+TS+Vite+Tailwind) | ✅ Tam | Modern, sağlam |
| .ai_context dokümanları (00-08) | ✅ Tam | Kararlar, mimari, roadmap detaylı |
| Supabase entegrasyonu | ✅ Tam | 6 migration var |
| Mapbox GL entegrasyonu | ✅ Tam | mapbox-optimize Edge Function var |
| Auth + KVKK | ✅ Tam | LoginPage, KvkkConsentPage |
| 13 sektör vertical sistemi | ✅ Tam | dental.json + 12 sektör daha |
| Türkiye il/ilçe master | ⚠️ Kısmi | 81 il VAR, 531 ilçe (planda 973 hedeflenmişti) |
| Adapter pattern (CRM-agnostic) | ✅ Tam | ICRMAdapter, SupabaseCRMAdapter, CustomRESTAdapter |
| Edge Functions | ✅ Tam | clinic-scan, google-places-search, mapbox-optimize, sample-roi-compute |
| Offline (Dexie + Workbox) | 🟡 Yarı | core/offline VAR, feature entegrasyonu eksik |
| Capacitor (Android APK) | ✅ Tam | capacitor.config.ts hazır |
| CI/CD (Cloudflare Pages) | ✅ Tam | Production: dent-route-saha.pages.dev |

### 🟡 Kısmen yapılmış / placeholder

| Sayfa | Yol | Durum |
|---|---|---|
| MapPage | `/` | ✅ Var (Sprint 2) |
| DiscoveryPage (Çevremdeki) | `/clinics/discover` | ✅ Var ama eksikler var |
| RoutePlannerPage | `/routes/plan` | ✅ Var ama eksikler var |
| ActiveRoutePage | `/routes/active/:id` | ✅ Var |
| SamplesPage (Numune) | `/samples` | ✅ Var (5 sekme) |
| OrderFormPage | `/orders/new` | ✅ Var |
| Admin Dashboard | `/admin/dashboard` | ✅ Var |
| Admin Heatmap | `/admin/heatmap` | ✅ Var |
| Admin ClinicScan | `/admin/clinic-scan` | ✅ Var |
| Admin CSV Import | `/admin/clinics` | ✅ Var |
| Admin Regions | `/admin/regions` | ✅ Var |
| CustomerDetailPage | `/clinics/:id` | ✅ Var |
| Notifications | `/notifications` | ✅ Var |
| **Müşteri Listesi** | `/clinics` | ❌ PLACEHOLDER |
| **Check-in** | `/visits/check-in/:id` | ❌ PLACEHOLDER (Sprint 4) |
| **Ziyaret Formu** | `/visits/:id` | ❌ PLACEHOLDER (Sprint 4) |
| **Geçmiş** | `/history` | ❌ PLACEHOLDER |
| **Admin Users** | `/admin/users` | ❌ PLACEHOLDER |

### ❌ Hiç yapılmamış (planda da yok veya çok eksik)

- **Sprint 4 — Ziyaretler/Check-in modülü** (en kritik eksik!)
- **Cari + fatura yönetimi** (hiç yok)
- **Çek/senet** (hiç yok)
- **Ürün katalog + lot/SKT** (kısmi — Order var ama katalog yok)
- **WhatsApp Cloud API** (sadece `wa.me` link var, gerçek API yok)
- **Gemini AI ile veri temizleme** (hiç yok)
- **DoktorTakvimi scraping** (hiç yok — sadece Google Places)
- **OSM Overpass** (hiç yok)

---

## 2. GÖRSELLERDEKİ SORUNLARIN GERÇEK NEDENLERİ

### Sorun 1: "Telefon/WhatsApp butonu çalışmıyor"
**SEN YANLIŞ ANLAMIŞSIN — KOD DOĞRU!**

`ClinicCard.tsx` kodunu inceledim, butonlar **DOĞRU yazılmış:**
```tsx
<a href={`tel:${phone}`} ...>Ara</a>
<a href={waHref} target="_blank" ...>WhatsApp</a>
```

Eğer çalışmıyorsa nedeni:
- O klinik kaydında telefon numarası boş (DB'de null)
- Bilgisayardan açıyorsan tel: linki çalışmaz, sadece telefonda çalışır
- Disabled state'inde olabilir (görselden anlaşılmıyor)

### Sorun 2: "Rota oluşturma çalışmıyor"
**KISMEN DOĞRU — Eksik bağlantı var**

- RoutePlannerPage **mantığı tam çalışıyor** (Mapbox Optimize Edge Function + twoOpt algoritması)
- Sepete ekleme `?ids=` URL parametresi ile geliyor
- **AMA:** DiscoveryPage'deki "Ekle" butonu sadece `console.log()` yapıyor! TODO yorumu var: *"Sprint 2.5: createCustomer flow"*
- Yani Klinikler sayfasından Rota sepetine **klinik aktaramıyorsun**

### Sorun 3: "Hekim sayısı çok az (5km'de 4 klinik)"
**EN ÖNEMLİ TESPİT BURADA**

DiscoveryPage'in başında şu yorum var:
> *"Live Google çağrısı YOK — klinikler admin tarafından `clinic-scan` ile önceden eklenir."*

Yani sistem **gerçek zamanlı Google'a sormuyor**, sadece DB'de olanları gösteriyor. Sen Ankara Eryaman'da iken sadece **DB'ne daha önce yüklenmiş 4 klinik var**.

**ÇÖZÜM:** Admin paneline (`/admin/clinic-scan`) gir → İl: Ankara, İlçe: Etimesgut → "Diş Hekimi" check'le → "Tara" → 50-100 klinik DB'ne yüklenir → Sonra Klinikler sayfasında 5km'de 30+ gözükür.

### Sorun 4: "Yanlış kategoriler (güzellik salonu, ortopedi)"
**KOD EKSİKLİĞİ — Filtre yok!**

`clinic-scan` Edge Function'ı (388 satır) inceledim. Google Places'tan dönen sonuçlarda:
- ✅ Mesafe filtresi var
- ✅ Duplicate (place_id) filtresi var
- ❌ **Kategori filtresi YOK!**

Google `types: ['dentist']` sorgusuna bazen `'doctor'`, `'health'`, hatta `'beauty_salon'` döndürebiliyor. Bunları temizleyen kod yok. Bu yüzden:
- "Erg. Funda Demir" (görselindeki) muhtemelen "Erg." OCR hatası veya yanlış kategori
- "Prakter" diş hekimi adı değil — muhtemelen güzellik salonu/spa

### Sorun 5: "Telefona rota gönderme yok"
**KOD EKSİKLİĞİ — Export yok**

RoutePlannerPage:
- ✅ Mapbox optimize çalışıyor
- ✅ Polyline çiziyor
- ❌ Google Maps deep link YOK (`https://www.google.com/maps/dir/...`)
- ❌ QR kod YOK (core/qr/ klasörü var ama route'a entegre değil)
- ❌ Capacitor Share API entegrasyonu YOK

---

## 3. PLAN (dentroute_prompts.md) vs GERÇEK KARŞILAŞTIRMASI

| Plan (PROMPT) | Stack'te karşılığı | Durum |
|---|---|---|
| 1: Proje iskelet | React+TS+Vite | ✅ Daha modern |
| 2: Türkiye master | tr-locations/ | ⚠️ 531 ilçe (973 hedef yarısı) |
| 3: Veri kaynakları (OSM+DT+Google) | Edge Functions (sadece Google) | 🟡 1/3 kaynak |
| 4: Gemini temizleme | YOK | ❌ |
| 5: Job sistemi | TanStack Query | ✅ Farklı yaklaşım |
| 5: Rota TSP | features/routes/two-opt.ts | ✅ |
| 5: Excel üretimi | YOK | ❌ |
| 6: CLI komut seti | YOK (web-only) | ❌ Native değil |
| 7: Streamlit | React/TS | ✅ Daha modern |
| 8: Auth + rol | auth/ + permissions | ✅ |
| 8: Bölge atama | admin/RegionAssignmentPage | ✅ |
| 9: Cari + fatura + E-Fatura | YOK | ❌ |
| 9: Çek/senet | YOK | ❌ |
| 10: Katalog + lot/SKT | YOK (sadece Order) | ❌ |
| 11: Sipariş + onay akışı | OrderFormPage var, onay akışı yok | 🟡 |
| 12: WhatsApp + KVKK | KVKK var, WhatsApp wa.me link | 🟡 |
| 13: Supabase | ✅ | ✅ |
| 14: Numune + avcılar | SamplesPage (5 tab) | ✅ Tam |
| 15: Mobil PWA | Workbox + Capacitor | ✅ Daha güçlü |
| 16: Deploy | Cloudflare Pages | ✅ |
| 17: Sivas import | YOK | ❌ |

---

## 4. EN ÖNEMLİ 10 EKSİK (öncelik sırası)

### KRİTİK — Görseldeki sorunlar
1. **Klinik kategori filtreleme** — clinic-scan Edge Function'a "diş içermeyen" sonuçları temizleme ekle
2. **DiscoveryPage "Rotaya ekle" butonu** — Şu an "Ekle" sadece console.log, gerçek "müşteri yarat + rota sepetine at" flow lazım
3. **Rota dışa aktarma** — Google Maps URL + QR + Capacitor Share entegrasyonu
4. **Klinik telefon dolu olanlar için backfill** — Eski kayıtlarda telefon yok, yeni clinic-scan'de Google Places phone alanı çekilmeli

### YÜKSEK — Sprint 4 (Ziyaretler) yapılmamış
5. **Check-in sayfası** (GPS damgalı, tek dokunuş)
6. **Ziyaret Formu** (outcome, foto, notlar)
7. **Ziyaret geçmişi** (per-customer)

### ORTA — Mevcut işlevsellik iyileştirme
8. **Müşteri Listesi sayfası** (`/clinics` placeholder)
9. **Geçmiş sayfası** (`/history` placeholder)
10. **Admin Users** (kullanıcı yönetimi yok)

### DÜŞÜK — Sonra eklenebilir
- WhatsApp Cloud API (gerçek mesajlaşma — şimdilik wa.me yeter)
- E-Fatura (faz 2)
- Çek/senet (faz 2)
- Lot/SKT (katalog büyürse)
- Cari/fatura yönetimi (büyük modül)
- Gemini AI temizleme (clinic-scan filtresi yeterli olabilir)

---

## 5. SİVAS VERİSİNİ NE YAPMALI

Önceki sohbette ürettiğin `Sivas_GENELI_v3.xlsx` (134 kayıt) bu yeni mimaride **şuna karşılık geliyor:**

- DB tablosu: `saha_clinics` (PostGIS noktası ile)
- Yükleme yolu: `/admin/clinics` (CsvImportPage) veya scripts ile

**Yapılacak:**
- CsvImportPage'i incelemem lazım — Excel mi alıyor, CSV mi
- Sivas Excel'i CSV'ye çevir
- Admin paneline yükle

---

## 6. SONUÇ — Bu Repo'nun Durumu

**İyi haberler:**
- Mimari **çok sağlam ve modern**. Aslında benim planımdan daha iyi.
- White-label SaaS yapısı — gelecekte başka müşterilere satmak için ideal
- Sprint 1-3 büyük ölçüde tamamlanmış
- Sprint 7 (admin) büyük ölçüde tamamlanmış
- Numune modülü plan dışı ama eklenmiş

**Endişe verici:**
- Sprint 4 (Ziyaretler/Check-in) tamamen eksik — bu **B2B saha satışın özü**
- Cari/Fatura yönetimi tamamen yok — Parla için kritik
- DiscoveryPage'den rotaya akış kopuk

**Senin yapman gerekenler:**
1. Admin paneline gir → ClinicScan ile her ilçeyi tara (Sivas zaten manuel taradık, bunu CSV import et)
2. Filtre eksiği için Claude Code'a düzeltme prompt'u ver
3. Sprint 4 (Check-in/Ziyaret) için yeni prompt seti hazırla
4. Cari yönetimi için ayrı modül planla
