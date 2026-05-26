# 🔒 Decision Lock — Saha App v1.0

> Bu dosyadaki kararlar **kilitlidir**. Değiştirilmesi için kullanıcının açık talimatı (örn: "X kararını revize edelim") gerekir.
> Tarih: 2026-05-20

---

## D-001 · Hedef Kullanıcı
**Karar:** Parla Diş Deposu saha satış ekibi (birincil), ileride white-label SaaS olarak dental + benzeri B2B saha satışı yapan firmalar.
**Gerekçe:** Parla'nın aktif ihtiyacı + SaaS pazarlama potansiyeli.

## D-002 · Platform
**Karar:** Web/PWA, **sadece Android** (iOS MVP'de yok).
**Gerekçe:** iOS Safari'nin Background Sync API, PWA quirks, tile cache lisans sorunları MVP'yi geciktirir. Android Chrome tek hedef olunca test matrisi 3x küçülür, offline mod tam çalışır.
**Geri dönüş:** iOS gerekirse Faz 3'te ele alınabilir.

## D-003 · Mevcut Projelerle İlişki
**Karar:** Bağımsız proje olarak başla; ileride Parla Diş Deposu ile entegrasyon (adapter üzerinden).
**Gerekçe:** Bağımlılık olmadan başlamak hız sağlar.

## D-004 · Klinik Veri Kaynağı
**Karar:** Hibrit — built-in CRM (Supabase) **ve** Google Places API ile yeni klinik keşfi. Excel/CSV manuel import da desteklenir.
**Gerekçe:** Mevcut müşteri verisi import edilirken yeni keşif için Google Places en zengin TR POI verisini sağlar.

## D-005 · Harita & Rota Servisi
**Karar:** Hibrit stack
- **Google Places API:** klinik keşfi + autocomplete (düşük hacim)
- **Mapbox GL JS + Optimization API + Directions API:** harita render, çoklu durak optimize, trafikli rota (yüksek hacim)

**Gerekçe:** Google'ın TR POI verisi en iyisi (keşif için), Mapbox'un Optimization API'si TSP problemi için dedike (rota için), tier 0 maliyet hedefi.

## D-006 · Kullanıcı / Yetki Yapısı
**Karar:** Ekip + admin + rol bazlı yetki. Roller: `sales_rep`, `manager`, `admin`.
- `sales_rep`: sadece kendine atanmış kliniklere erişir
- `manager`: kendi bölgesindeki tüm verileri görür
- `admin`: tüm sisteme erişir

**Gerekçe:** Saha satış otomasyonunun standart yetki hiyerarşisi.

## D-007 · MVP Scope
**Karar:** 13 özellik (tümü Faz 1'de). Detay: `00-master-prompt.md` Bölüm 5.
**Gerekçe:** Kullanıcı kapsamı genişletti, scope creep'i bilinçli kabul edildi.

## D-008 · Tenant Modeli
**Karar:** Her firma kendi deployment'ı (single-tenant per deployment).
- Kendi Supabase projesi
- Kendi domain'i (örn: `parla-saha.parladisdeposu.com`)

**Gerekçe:** Multi-tenant'ta RLS hatası → veri sızıntısı riski. MVP'de izolasyon güvenliği > maliyet verimliliği.
**İleride:** Multi-tenant Faz 4'te değerlendirilir.

## D-009 · Adapter Stratejisi
**Karar:** MVP'de iki adapter
1. **Built-in (Supabase native)** — varsayılan, ERP'siz çalışır
2. **Custom REST Adapter** — config-driven HTTP client, herhangi bir REST API'ye bağlanır

**Faz 2+:** Logo, Mikro, Netsis adapter'ları **talep oluşunca** yazılır (spekülatif değil).
**Gerekçe:** YAGNI prensibi. Built-in + Custom REST kombinasyonu ~%80 pazarı kapsar, ek 5 hafta yatırımdan kaçınılır.

## D-010 · Branding / White-Label
**Karar:** Config-driven minimum scope.
**Kapsanan:** `name`, `logo`, `primaryColor`, `accentColor`
**Kapsanmayan:** Font ailesi, dark mode varyantı, custom layout, custom illustration

**Gerekçe:** %90 white-label algısı için %10 efor. Tailwind CSS variables ile runtime renkler. Sonradan büyütülebilir mimari.

## D-011 · Trafik Verisi Kaynağı
**Karar:** Mapbox Directions API (`annotations=duration,congestion`).
**Gerekçe:** D-005 ile tutarlı. Google'a göre daha ucuz, Mapbox tier'ında ücretsiz.

## D-012 · Offline Stratejisi
**Karar:**
- Workbox (Service Worker) ile app shell + statik asset cache
- Dexie.js (IndexedDB) ile data persistence
- TanStack Query persistedQueryClient
- Background Sync API (Android Chrome) ile offline mutations queue → online'da otomatik push
- Mapbox tile cache: MapTiler offline maps SDK ($25/ay) lisans uyumlu çözüm

**Gerekçe:** iOS olmadığı için Background Sync güvenilir. Tile cache'in lisans gri alanından çıkmak için MapTiler tercih edildi.

## D-013 · Yakıt/km Hesaplama
**Karar:** Mapbox Directions'ın döndürdüğü rota mesafesi baz alınır (gerçek GPS değil).
- `yakıt_litre = mesafe_km × (kullanıcı_tüketim / 100)`
- Kullanıcı `avg_fuel_consumption` profilinde ayarlar (default 7 L/100km)
- Fiyat manuel ayar (kullanıcı günlük litre fiyatı girer)

**Gerekçe:** GPS drift, tüneller, kapalı otopark hatalı veri verir. Rota mesafesi deterministik.

## D-014 · KVKK Uyumu
**Karar:**
- İlk login'de aydınlatma metni + açık rıza zorunlu
- GPS takip yalnızca aktif rota süresince
- Veri saklama: ziyaret 2 yıl, GPS log 90 gün, foto 1 yıl
- Veri silme talebi için admin paneli aksiyon

**Gerekçe:** TR yasal zorunluluk + saha çalışanlarının haklarına saygı.

## D-015 · API Güvenliği
**Karar:** Tüm üçüncü taraf API çağrıları (Mapbox, Google) Supabase Edge Function proxy üzerinden.
- API key'ler client'a sızmaz
- Per-user rate limit (örn: 100 optimize req/gün/kullanıcı)
- Günlük usage alert eşiği aşılırsa admin email

**Gerekçe:** API key sızıntısı = fatura patlaması. Proxy hem güvenlik hem maliyet kontrol.

## D-016 · Vertical Template System
**Karar:** App sektör-agnostik tasarlanır. Her deployment kendi sektör şablonunu seçer.
- `verticals/` dizininde JSON template'lar
- `.saha-config.json`'da `vertical.extends: "<id>"` ile seçim
- `vertical.overrides` ile özelleştirme
- v1.0'da 13 hazır şablon ship edilir

**v1.0 şablon listesi:** `dental`, `pharmacy`, `optician`, `veterinary`, `medical_supply`, `cafe_restaurant`, `mini_market`, `cosmetics_beauty`, `automotive_parts`, `construction_materials`, `industrial_supply`, `agriculture_feed`, `generic`

**Şema etkileri:**
- `accounts.type` CHECK constraint kaldırıldı (vertical-defined)
- `visits.outcome` CHECK constraint kaldırıldı (vertical-defined)
- `accounts.custom_fields JSONB` eklendi
- `visits.custom_fields JSONB` eklendi
- Validation application layer'da yapılır (vertical template ile)

**Gerekçe:** SaaS satılabilirlik için omurga. Yeni sektör eklemek kod değişikliği değil, template eklemek olur. Detay: `05-verticals.md`.

## D-017 · Bonus Özellikler (Faz 2'ye)
**Karar:** Rakip analizinde keşfedilen 3 özellik Faz 2 roadmap'ine alınır:
1. **Lasso Selection** (Badger Maps esinli): Haritada parmakla daire çiz, içindeki müşterileri seç → rota oluştur
2. **Demographic Overlays**: Gelir/nüfus yoğunluk haritası (TÜİK verisi ile bölge analiz)
3. **Photo Compliance Audit** (Repsly esinli): Ziyarette zorunlu/yapılandırılmış foto akışı; bazı sektörlerde (ilaç, kozmetik) yasal compliance

**Faz:** 2 (MVP sonrası, 3-4. ay)
**Gerekçe:** Yüksek değer ama MVP scope'una sığmıyor. Compliance özelliği bazı sektörlerin satış kritik gereksinimi.

---

## Yeniden Açılabilir Kararlar (Reopen Triggers)

Aşağıdaki durumlarda ilgili karar yeniden değerlendirilir:

- **D-002 (iOS yok):** Üç ay sonra Parla'nın saha ekibinde iPhone kullanan ≥30% varsa
- **D-008 (Tenant):** Aktif paying customer sayısı ≥ 5 olunca multi-tenant ROI hesaplanır
- **D-009 (Adapter):** Logo/Mikro müşterisi pipeline'a girince ilgili adapter yazılır
- **D-013 (Yakıt):** Kullanıcılardan ölçüm doğruluğu şikayeti gelirse alternatif hesaplama
