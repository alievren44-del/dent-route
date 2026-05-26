# ⚠️ Risk Register — Saha App v1.0

> Bu dosya proje boyunca aktif tutulur. Yeni risk keşfedildiğinde eklenir, çözülünce status güncellenir.

---

## Format

| Alan | Açıklama |
|---|---|
| **ID** | R-XXX (kalıcı) |
| **Kategori** | 🔴 Kritik / 🟠 Yüksek / 🟡 Orta / 🟢 Düşük |
| **Olasılık (O)** | L (düşük) / M (orta) / H (yüksek) |
| **Etki (E)** | L / M / H |
| **Status** | 🔵 Açık / 🟢 Mitigated / ✅ Resolved / ⛔ Accepted |

---

## 🔴 KRİTİK RİSKLER

### R-001 · KVKK uyumsuzluğu cezası
- **O:** M · **E:** H · **Status:** 🟢 Mitigated · **Faz:** 1
- **Risk:** Saha çalışanı GPS takibi + müşteri PII verisi → KVKK ceza riski (5M+ TL)
- **Mitigation:**
  - İlk login'de aydınlatma metni + açık rıza zorunlu (D-014)
  - GPS sadece aktif rota süresince
  - Veri saklama süreleri config'te tanımlı (visits 2y, GPS 90d, foto 1y)
  - Veri silme talebi için admin paneli aksiyon
  - VERBİS kaydı (Parla için kontrol edilecek)
- **Sahip:** Ali (tenant başına hukuk metni)
- **Kontrol noktası:** İlk deployment öncesi metnin hukuki onayı

### R-002 · Mapbox/Google API fatura patlaması
- **O:** M · **E:** H · **Status:** 🟢 Mitigated · **Faz:** 1
- **Risk:** Mapbox sert harcama limiti yok. Bot/abuse veya buggy client → tek günde binlerce dolar fatura
- **Mitigation:**
  - Tüm dış API çağrıları Edge Function proxy üzerinden (D-015)
  - Per-user günlük rate limit (`config.external.mapbox.rateLimit`)
  - Günlük usage threshold aşılınca admin email alert
  - Mapbox dashboard'ta usage cap (manuel quota set)
  - Anomaly detection: 1 saatte 10x normal usage → alert
- **Sahip:** Ali (deploy sonrası ilk hafta monitoring)
- **Kontrol noktası:** İlk hafta sonu usage raporu

### R-003 · RLS politika açığı → veri sızıntısı
- **O:** L · **E:** H · **Status:** 🔵 Açık · **Faz:** 1
- **Risk:** RLS policy bug → bir sales_rep başka temsilcinin müşterilerini görür
- **Mitigation:**
  - Tüm tablolarda RLS zorunlu (migration politikası)
  - Integration test: her rol için "neyi göremem" testleri
  - PR review: RLS policy değişiklikleri zorunlu review
  - Per-tenant deployment (D-008) — bir tenant veri sızdırırsa diğeri etkilenmez
- **Sahip:** Ali + Claude Code
- **Kontrol noktası:** MVP launch öncesi pen-test benzeri RLS audit

---

## 🟠 YÜKSEK RİSKLER

### R-004 · Offline mod data conflict
- **O:** M · **E:** M · **Status:** 🟢 Mitigated · **Faz:** 1
- **Risk:** İki cihaz offline'da aynı müşteriye check-in → online olunca conflict
- **Mitigation:**
  - Last-write-wins for visits (her check-in ayrı kayıt)
  - `idempotency_key` ile çift yazımı engelle
  - `sync_queue` retry mantığı + `error_message` görünürlüğü
  - User'a "X kayıt henüz sync olmadı" badge
- **Sahip:** Claude Code (implementation)

### R-005 · Custom REST adapter schema mismatch
- **O:** H · **E:** M · **Status:** 🔵 Açık · **Faz:** 1
- **Risk:** Müşterinin REST API'si beklenen formatta dönmez → app çöker
- **Mitigation:**
  - Zod ile response validation (her endpoint için schema)
  - `AdapterError.SCHEMA_MISMATCH` ile clean error
  - Bootstrap'ta sample query → field mapping doğrulama
  - Capability `false` set edilirse UI ilgili özellik gizler
- **Sahip:** Claude Code (adapter implementation)

### R-006 · Parla CRM entegrasyonunda master data karmaşası
- **O:** H · **E:** M · **Status:** 🔵 Açık · **Faz:** 2
- **Risk:** Saha app klinik bilgisi düzeltti vs Parla'da farklı → sync conflict
- **Mitigation:**
  - **Karar:** Klinik bilgileri Parla'da master, saha app read-mostly mirror
  - Saha app sadece kendi alanlarını (visits, notes, routes) yazar
  - `accounts.external_id` Parla cari kodu, bizim ID değil master
  - Faz 2'de Parla adapter yazılınca netleşir
- **Sahip:** Ali (Parla DB şemasını paylaşma zamanı geldiğinde)

### R-007 · iOS desteği yokluğu — pazar daralması
- **O:** M · **E:** M · **Status:** ⛔ Accepted · **Faz:** 1
- **Risk:** Bazı saha ekipleri iPhone kullanır, Android-only sınırlandırma satış kaybı
- **Mitigation:**
  - **Kabul edildi** (D-002): MVP'de iOS yok, hız önceliği
  - Reopen trigger: Parla saha ekibinde iPhone kullanımı ≥30% → iOS Faz 3'e
  - Mimari iOS-uyumlu (PWA standartları), sonradan eklenebilir
- **Sahip:** Ali (3 ay sonra ekip telefon istatistiği)

### R-008 · Vertical mismatch — kullanıcı yanlış sektör seçer
- **O:** L · **E:** M · **Status:** 🔵 Açık · **Faz:** 1
- **Risk:** Deployment'ta `dental` seçildi sonra `pharmacy`ye geçilmek istenirse, mevcut `accounts.type` değerleri eski şablonun anahtarları → UI bozulur
- **Mitigation:**
  - Bootstrap script'i vertical değişikliğini tespit eder, uyarır
  - Manual migration kılavuzu: `accounts.type` map dönüşümü (dental.private_clinic → pharmacy.independent gibi)
  - Validator layer eski type değerlerini "Diğer" olarak gösterir (graceful degradation)
- **Sahip:** Claude Code (validator + bootstrap geliştirme)

---

## 🟡 ORTA RİSKLER

### R-009 · Yakıt/km hesaplama doğruluğu şikayetleri
- **O:** M · **E:** L · **Status:** 🟢 Mitigated · **Faz:** 1
- **Risk:** Tüketim ayarı yanlış → kullanıcı yakıt rakamlarına itimat etmez
- **Mitigation:**
  - Kullanıcı `avg_fuel_consumption` profilinde ayarlar (D-013)
  - Default 7 L/100km (TR ortalama)
  - "Bu hesaplama X litre/100km baz alınmıştır" tooltip
  - Manuel düzeltme imkanı (mileage_logs üzerinden edit)
- **Sahip:** UI/UX

### R-010 · Foto upload boyutu — storage maliyeti
- **O:** M · **E:** L · **Status:** 🔵 Açık · **Faz:** 1
- **Risk:** Her ziyarette 5MB+ fotoğraf → tenant başına aylık GB'lerce storage
- **Mitigation:**
  - Client-side resize (max 1600px width, JPEG quality 80)
  - Server-side validation: max 2MB
  - Supabase Storage lifecycle: 1 yıl sonra archive bucket'a taşı
  - Vertical config'te `photoCompliance.minPhotos` ile zorunlu sayı sınırlı
- **Sahip:** Claude Code (resize implementation)

### R-011 · Mapbox tile cache lisans ihlali
- **O:** L · **E:** M · **Status:** 🟢 Mitigated · **Faz:** 1
- **Risk:** Tile'ları IndexedDB'ye persist etmek Mapbox ToS'a aykırı (24 saatten uzun cache yasak)
- **Mitigation:**
  - **Karar (D-012):** Offline tile için MapTiler kullanılır ($25/ay), lisans temiz
  - Mapbox tiles sadece online runtime'da kullanılır
  - Active route başlangıcında MapTiler offline pack download (config-driven enable)
- **Sahip:** Ali (MapTiler hesap açma)

### R-012 · Background Sync API tarayıcı uyumluluğu
- **O:** L · **E:** M · **Status:** 🟢 Mitigated · **Faz:** 1
- **Risk:** Android Chrome dışı tarayıcı (Samsung Internet, Firefox Mobile) Background Sync desteklemiyor olabilir
- **Mitigation:**
  - Tek hedef Android Chrome 100+ (D-002 ile uyumlu)
  - Onboarding ekranında "Chrome kullanın" uyarısı
  - Feature detection: yoksa "manual sync" butonu göster
- **Sahip:** Claude Code

### R-013 · Bootstrap script'i otomatik migration uygularsa veri kaybı
- **O:** L · **E:** H · **Status:** 🔵 Açık · **Faz:** 1
- **Risk:** Mevcut DB'de tablolar varsa, `npm run saha:bootstrap` çift uygulanırsa DROP TABLE çağırırsa
- **Mitigation:**
  - **Asla DROP yok bootstrap'ta** — sadece CREATE IF NOT EXISTS + ALTER ADD COLUMN
  - Schema diff sonrası destructive değişiklikler **manuel onay** ister
  - Production'da `--dry-run` default, `--apply` zorunlu flag
  - Migration history `supabase_migrations` tablosunda
- **Sahip:** Claude Code (bootstrap script geliştirme)

---

## 🟢 DÜŞÜK RİSKLER

### R-014 · Cihaz çeşitliliği UI bozulması
- **O:** M · **E:** L · **Status:** 🔵 Açık · **Faz:** 1
- **Risk:** Eski Android (Android 8-9), küçük ekran cihazlarda layout bozulması
- **Mitigation:** Minimum desteklenen: Android 10+ Chrome 100+. Test cihazları en eski olarak Galaxy A20 benzeri.

### R-015 · WhatsApp deep-link format değişikliği
- **O:** L · **E:** L · **Status:** 🔵 Açık · **Faz:** 1
- **Risk:** WhatsApp `wa.me/<phone>` URL formatı değişirse
- **Mitigation:** Tek bir helper function'da soyutlanmış (`buildWhatsAppLink`), değişirse tek yerden update.

### R-016 · Tenant config drift
- **O:** L · **E:** L · **Status:** 🔵 Açık · **Faz:** 2
- **Risk:** Birden fazla deployment'a aynı config'i kopyalama hatası
- **Mitigation:** Config schema validation (Zod). Bootstrap eksik alan varsa hata fırlatır.

---

## 🆕 FAZ 2 RİSKLERİ (henüz aktif değil)

### R-017 · Lasso UX zorluğu (Faz 2)
- **O:** M · **E:** L · **Status:** 🔵 Açık · **Faz:** 2
- **Risk:** Mobil ekranda haritada parmakla daire çizmek hassas değil
- **Mitigation:** Polygon point sayısı limiti, "yakındaki 5 noktayı dahil et" snap özelliği

### R-018 · TÜİK demografik veri lisansı (Faz 2)
- **O:** M · **E:** M · **Status:** 🔵 Açık · **Faz:** 2
- **Risk:** TÜİK İBB veri açık ama ticari kullanım için lisans şartları belirsiz
- **Mitigation:** TÜİK ile hukuki temas, alternatif veri sağlayıcılar (Endeksa, vb.) araştırma

### R-019 · Photo compliance UX yükü (Faz 2)
- **O:** M · **E:** L · **Status:** 🔵 Açık · **Faz:** 2
- **Risk:** Eczane/kozmetikte zorunlu 3-5 foto, saha temsilcisi vakit kaybeder
- **Mitigation:** Kategori bazlı (rafa kondu, vitrin, fiyat etiketi) opsiyonel/zorunlu ayar tenant başına config

---

## Risk Yönetim Süreci

1. **Yeni risk keşfedildi:** İlgili faz başlangıcında bu dosyaya eklenir
2. **Risk gerçekleşti:** Status `🔴 Realized` olur, postmortem yazılır
3. **Mitigation uygulandı:** Status `🟢 Mitigated`, kanıtla (PR link, config diff)
4. **Risk kapandı:** Status `✅ Resolved`, sebep açıklanır
5. **Risk kabul edildi:** Status `⛔ Accepted`, gerekçe yazılır (örn: maliyet > değer)

**Aylık review:** Aktif riskler gözden geçirilir, gerçekleşme olasılığı/etkisi yeniden değerlendirilir.
