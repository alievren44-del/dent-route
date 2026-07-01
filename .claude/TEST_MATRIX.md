# NAV (dent-route / saha) — Test Matrisi

> Bu matris `saha-app`'in **gerçek akışlarına** özeldir (koddan türetildi — bkz. `BUSINESS_RULES.md`). Placeholder değildir. Sütunlar: **ID · Ön Koşul · Adımlar · Beklenen Sonuç · Kanıt/Referans**.
>
> **Test araçları:** Vitest 1.6 (birim — saf fonksiyonlar), Playwright 1.45 (E2E). Paylaşımlı Supabase (`rranpzicmhgfupgabgbi`) — E2E'de **RLS-güvenli test hesapları** kullanın; canlı cari/sipariş kirletmeyin (tercihen staging/branch DB).
>
> Etiketler: `@smoke` (her deploy) · `@regression` (sürüm öncesi) · `@e2e` (uçtan uca) · `@offline` · `@rbac` · `@unit`.

---

## A. Kimlik Doğrulama & Rol (`@rbac @smoke`)

| ID | Ön Koşul | Adımlar | Beklenen Sonuç | Referans |
|----|----------|---------|----------------|----------|
| AUTH-01 | Çıkış yapılmış | `/harita`'ya git | `/login`'e yönlendirilir, `state.from='/harita'` | ProtectedRoute:33-34 |
| AUTH-02 | REP hesabı, geçerli şifre | `/login`'de e-posta+şifre gir | Giriş başarılı, KVKK kabulü varsa `/takvim`'e düşer | authStore.signIn |
| AUTH-03 | Parla `DOCTOR` rolü hesabı | Giriş yap | Oturum kurulmaz / erişim engellenir (rol → `null`) | mapParlaToSahaRole:63-70 |
| AUTH-04 | Parla `MANAGER` rolü | Giriş yap → admin-only `/admin/dashboard`'a git | Manager admin'e map edilir, sayfa açılır | mapParlaToSahaRole:69, ProtectedRoute:42 |
| AUTH-05 | Web'de Parla rep-login | `#sso=base64{a,r}` hash'i ile NAV'a yönlen | Otomatik oturum kurulur; **URL'den hash anında temizlenir** (history'de token yok) | ssoCapture:11-19 |
| AUTH-06 | `kvkkAcceptedAt` boş kullanıcı | Herhangi korumalı rotaya git | `/onboarding/kvkk`'ya yönlendirilir | ProtectedRoute:37-39 |
| AUTH-07 | KVKK onay ekranı | "Kabul et"e bas | Profile yazılır, korumalı rotalar açılır | authStore.acceptKvkk |
| AUTH-08 | Giriş yapılmış, oturum sunucuda silinmiş | Uygulamayı yeniden aç (boot `validateSession`) | 401 → otomatik signOut + "Oturum sona erdi… tekrar giriş yapın" | authStore:94-114 |
| AUTH-09 | REP `saha:invoicing:access` izni YOK | `/invoicing/cari`'ye git | "Erişim engellendi" (has_permission=false, fail-closed) | ProtectedRoute:48-58, usePermissions:40 |
| AUTH-10 | Admin | `/invoicing/*` ve `/orders/approval`'a git | Tümü açılır (admin her izin/rolü geçer) | ProtectedRoute:42,48 |

---

## B. Sipariş & Sepet (`@e2e @regression`)

| ID | Ön Koşul | Adımlar | Beklenen Sonuç | Referans |
|----|----------|---------|----------------|----------|
| ORD-01 | REP girişli, online | `/orders/new`, klinik ara+seç, 2 ürün ekle | Sepet toplamı `quoteOrder`'dan gelir; KDV+genel toplam gösterilir | OrderFormPage:172-186 |
| ORD-02 | ORD-01 sepeti | Aynı ürünü tekrar ekle | Yeni satır açılmaz, miktar +1 birleşir | addToCart:244-265 |
| ORD-03 | Sepette 1 ürün miktar 1 | Eksi'ye bas | Satır sepetten kalkar (qty 0 → filtrele) | updateQty:267-276 |
| ORD-04 | REP, sepet toplam 999.999 TL | "Sipariş Oluştur"a bas | Onaya düşmez → `status='pending'`; buton etiketi "Sipariş Oluştur" | needsApproval REP=∞, adapter:656 |
| ORD-05 | `MANAGER` rolü, toplam 60.000 TL | Sepeti gönder | "Onaya Gönder"; sipariş `approval_pending`; ADMIN'e bildirim gider | needsApproval MANAGER=50k, OrderFormPage:358 |
| ORD-06 | ORD-05 sonrası, ADMIN girişli | Bildirimler feed'ini aç | `type='order_approval'` satırı ADMIN'in `user_id`'siyle görünür | OrderFormPage:394-405, N2 |
| ORD-07 | Sepet fiyatı client'ta elle manipüle edilmiş | Siparişi oluştur, DB'de `order_items.unit_price` kontrol | Fiyat **v_saha_products'tan yeniden** yazılır (client snapshot yok sayılır) | adapter:553-607 |
| ORD-08 | Aynı `idempotencyKey` ile 2. kez createOrder (çift-tık) | İki submit tetikle | Tek sipariş oluşur; 2. çağrı mevcut siparişi döner | adapter:541-551 |
| ORD-09 | Müşteri `saha_clinics` kaydı (cari yok) | Sipariş oluştur | `saha_get_or_create_cari_for_clinic` çağrılır; sipariş `clinic_id`+`cari_id`'ye bağlanır, `user_id=null` | adapter:609-635 |
| ORD-10 | Ürün `tax_rate` NULL | Sipariş oluştur | KDV %10 varsayılan uygulanır | adapter:575-576 |
| ORD-11 | Müşteri seçilmemiş / sepet boş | Gönder'e bas | Sırasıyla "Müşteri seçiniz" / "En az bir ürün ekleyiniz"; buton disable | OrderFormPage:289-298, 761 |
| ORD-12 | Sepet doluyken "Şablon Kaydet" | Ad ver, kaydet | `saha_order_templates` upsert (rep_id,name); şablon çip listesinde çıkar | OrderFormPage:206-242 |

---

## C. Sipariş Onay Yetkisi (`@rbac @regression`) — server-side kapı

| ID | Ön Koşul | Adımlar | Beklenen Sonuç | Referans |
|----|----------|---------|----------------|----------|
| APR-01 | REP, `approval_pending` sipariş 3.000 TL | REP `approveOrder` çağır | Başarılı (REP ≤ 5.000) → `status='approved'`, `approved_at` set | approveOrder RPC:937 |
| APR-02 | REP, `approval_pending` sipariş 8.000 TL | REP `approveOrder` çağır | RPC reddeder → `FORBIDDEN` "Onay limiti aşıldı" (over_approval_limit) | approveOrder:953-958 |
| APR-03 | MANAGER, sipariş 45.000 TL | Onayla | Başarılı (MANAGER ≤ 50.000) | approveOrder:937 |
| APR-04 | MANAGER, sipariş 70.000 TL | Onayla | `FORBIDDEN` limit aşımı | approveOrder:953 |
| APR-05 | ADMIN, sipariş 500.000 TL | Onayla | Başarılı (sınırsız) | approveOrder:937 |
| APR-06 | Yetkisiz rol / rolsüz kullanıcı | `approveOrder` çağır | `FORBIDDEN` "Onay yetkiniz yok" (not_authorized) | approveOrder:960-965 |
| APR-07 | Onay başarılı sipariş | DB tetikleyicisini gözle | `trg_order_status_change` stok + order-to-cash akışını tetikler | approveOrder:938-939 |
| APR-08 (edge) | REP kendi oluşturduğu >5.000 sipariş REST/adapter ile onaylamayı dener (#70 regresyonu) | Doğrudan UPDATE dene | RLS/RPC engeller — client-side onay yolu yok | approveOrder:934-936 |

---

## D. Ödeme / Tahsilat (`@e2e @regression`) — `saha:invoicing:access` gerekli

| ID | Ön Koşul | Adımlar | Beklenen Sonuç | Referans |
|----|----------|---------|----------------|----------|
| PAY-01 | İzinli kullanıcı, bakiyeli cari | `/invoicing/odeme/yeni?cari_id=X`, tutar+tip gir | Bakiyeli faturalar listelenir; ödeme tipi (nakit/havale/çek/senet/kart) seçilir | PaymentFormPage:98-137, 525 |
| PAY-02 | Ödeme tutarı 1.000 TL, tek faturaya 1.000 dağıt | Kaydet | `saha_odemeler` insert; buton aktif; başarı | PaymentFormPage:251-294 |
| PAY-03 | Tutar 1.000 TL, dağıtılan 800 TL | Kaydet dene | Hata "Dağıtılan tutar toplam tutara eşit olmalı"; buton disable | PaymentFormPage:270-276, 638 |
| PAY-04 | Tutar 0 veya negatif | Formu doldur | "Ödemeyi Kaydet" disable (`tutar ≤ 0`) | PaymentFormPage:638 |
| PAY-05 | Ödeme kaydından sonra | Cari detay/aging raporunu aç | Fatura bakiyesi trigger ile güncellenmiş (VARSAYIM — DB tarafı doğrula) | P6 |
| PAY-06 | Çok-faturaya FIFO-oto dağıtım | Tutarı faturalara otomatik dağıt | Toplam = tutar; her `saha_faturalar`'a doğru pay | PaymentFormPage:270 |

---

## E. Ziyaret / Check-in (`@e2e @offline`)

| ID | Ön Koşul | Adımlar | Beklenen Sonuç | Referans |
|----|----------|---------|----------------|----------|
| CHK-01 | Klinik koordinatlı, rep 30m uzakta | `/visits/check-in/:id`, konum ver | Yeşil "GPS doğrulandı"; check-in aktif | CheckInPage:70-72 |
| CHK-02 | Rep 1.500m uzakta | Check-in ekranı | Sarı "uzaktasınız, devam edebilirsiniz"; buton **aktif** | CheckInPage:76-82 |
| CHK-03 | Rep 3.000m uzakta | Check-in dene | Kırmızı "2 km uzakta — engellendi"; buton **disable** | CheckInPage:83-87, 475-483 |
| CHK-04 | Klinik koordinatı YOK | Check-in ekranı | "GPS kayıtlı değil"; onay kutusu işaretlenmeden buton disable, işaretleyince aktif | CheckInPage:59-67, 388-410 |
| CHK-05 | Konum izni reddedildi | Ekranı aç | Kırmızı hata banner; buton disable | CheckInPage:416-419, 481 |
| CHK-06 | Başarılı check-in (online) | Butona bas | `saha_visits` `status='in_progress'` insert; `/visits/{id}`'e geçer | CheckInPage:260-271 |
| CHK-07 `@offline` | Ağı kapat, check-in yap | Butona bas | `visit.create` kuyruğa; toast "bağlantı geldiğinde senkronize edilecek"; `/history`'ye geçer | CheckInPage:251-257 |
| CHK-08 `@offline` | CHK-07 sonrası ağı aç | Bekle / online event | Kuyruk flush; `saha_visits`'e upsert (onConflict idempotency, çift-insert yok) | syncQueue:132-141 |

---

## F. Offline & Sync (`@offline @regression`)

| ID | Ön Koşul | Adımlar | Beklenen Sonuç | Referans |
|----|----------|---------|----------------|----------|
| SYN-01 | Online sipariş oluştur, ortada ağ kesilir (fetch hata) | Submit | Ağ hatası algılanır → `order.create` kuyruğa; toast "kaydedildi, bağlantı gelince gönderilecek" | OrderFormPage:421-440 |
| SYN-02 | Offline sipariş kuyruğa alınmış, ağ döndü | `online` event | `processQueue` → op `syncing→completed`; sipariş DB'de, fiyat DB'den yeniden hesaplı | syncQueue:154-176 |
| SYN-03 | Bir op 3 kez başarısız | Sync tekrar dene | 3. denemeden sonra `status='failed'` (terminal), banner kırmızı | syncQueue:113-118 |
| SYN-04 | `failed` op var, uygulamayı kapat-aç | Yeniden başlat | Failed op **otomatik retry EDİLMEZ**; sadece `pending` flush olur | syncQueue:219-226, Y4 |
| SYN-05 | `failed` op, kullanıcı "Tekrar Dene" | `retryFailed` çağır | `failed→pending` (retryCount:0), kuyruk tetiklenir | syncQueue:79-88 |
| SYN-06 | Aynı `idempotencyKey` op enqueue 2×  | İki kez enqueue | Tek kayıt (tamamlanmamış varsa tekrar eklenmez) | syncQueue:51-56 |
| SYN-07 | Düzeltilemez `failed` op | UI'dan sil (`removeOp`) | Kuyruktan kalıcı silinir | syncQueue:96-99 |
| SYN-08 | Chrome (SyncManager var) vs iOS Safari (yok) | Offline enqueue → online | İkisinde de flush olur (SW sync veya online-event fallback) | syncQueue:16-30, 199-217 |

---

## G. React Query Persist & Offline Okuma (`@offline @smoke`)

| ID | Ön Koşul | Adımlar | Beklenen Sonuç | Referans |
|----|----------|---------|----------------|----------|
| PST-01 | Online iken takvim/discovery gezildi | Ağı kapat, uygulamayı yeniden aç | `calendar-*`, `discovery`, `assigned-routes`, `nearby-clinic-counts` cache'ten servis edilir | main.tsx:39-47 |
| PST-02 | Online iken cari/fatura/sipariş listesi gezildi | Ağı kapat, aç | Bu **finansal listeler persist EDİLMEZ** — bayat veri gösterilmez (yeniden fetch dener) | Y12, main.tsx:98 |
| PST-03 | Eski cache formatı (buster < v0.2.0) | Uygulamayı aç | Eski aşırı-persist cache düşürülür | main.tsx:93 |
| PST-04 | Offline, boot | Uygulamayı aç | `validateSession` offline → cache'lenmiş profil ile devam, logout yok | authStore:97-101 |
| PST-05 | Profil cache 24 saatten eski, offline | Aç | Cache geçersiz → profil `null` (deaktive rep uzun offline erişemez) | authStore:58-71 |

---

## H. Numune Politikası (`@unit @regression`) — `validateCanGiveSample`

| ID | Girdi | Beklenen Sonuç | Referans |
|----|-------|----------------|----------|
| SMP-01 | `isBlacklisted=true` | `{ok:false, code:'blacklisted'}`, başka kontrol yok | policies.ts:77-84 |
| SMP-02 | Politika yok + vertical policy enabled | `no_policy` uyarısı (ama ok tek başına düşmez) | policies.ts:89-95 |
| SMP-03 | Son `cooldownDays` içinde numune verilmiş | `{ok:false, code:'cooldown'}` | policies.ts:99-111 |
| SMP-04 | Yıllık sayı ≥ `maxPerAccountYearly` | `{ok:false, code:'max_reached'}` | policies.ts:113-124 |
| SMP-05 | `estimatedLineCostTl > remainingBudgetTl` | `{ok:false, code:'budget_exceeded'}` (admin onayı) | policies.ts:127-138 |
| SMP-06 | DB override + vertical policy ikisi var | Override öncelikli çözülür | policies.ts:39-53 |
| SMP-07 | Tüm kurallar geçer | `{ok:true, issues:[]}` | policies.ts:97-140 |

---

## I. Smoke (`@smoke`) — her deploy sonrası hızlı geçiş

| ID | Adım | Beklenen |
|----|------|----------|
| SMK-01 | Uygulama Cloudflare'de açılır (`saha.parladisdeposu.com`) | Beyaz ekran yok; `/` → `/takvim` yönlenir |
| SMK-02 | REP giriş yap | Takvim/harita yüklenir |
| SMK-03 | `/harita` Mapbox render | Harita + klinik pin'leri görünür (token geçerli) |
| SMK-04 | `/saha/tara` yarıçap tarama | `saha_search_nearby_clinics` sonuç döner |
| SMK-05 | `/orders/new` sepet+quote | Toplam hesaplanır, submit çalışır |
| SMK-06 | Bildirimler sekmesi | `saha_notifications` feed yüklenir |
| SMK-07 | Native APK açılışı (`com.parla.saha`) | Crash yok; OTA `otaCheck('nav')` çalışır |
| SMK-08 | Konsol hata taraması (Playwright) | Kritik JS hatası yok |

---

## J. Regresyon Odakları (`@regression`) — bilinen kırılgan alanlar

| ID | Senaryo | Beklenen | Neden riskli |
|----|---------|----------|--------------|
| REG-01 | `profiles.role` lowercase iken onay bildirimi fan-out | Bildirim MANAGER/ADMIN'e ulaşır (upper+lower `.in()`) | Rol-casing kök bug'ı yeni düzeltildi (N3) |
| REG-02 | Rep >5.000 kendi siparişini onaylamayı dener | Engellenir (#70 regresyon guard'ı) | Eskiden client-side onaylanabiliyordu |
| REG-03 | Sipariş oluşturma race — çift submit / eş-zamanlı order_number | Tek sipariş, UNIQUE ihlali yok (idempotency + rand sonek) | adapter:637-645 |
| REG-04 | Onay gereken sipariş asla `pending` görünmemeli | Doğrudan `approval_pending` insert (ara UPDATE race'i yok) | adapter:654-656 |
| REG-05 | Offline `order.create` replay ham insert olmamalı | Adapter üzerinden — fiyat recompute + order_items üretilir | syncQueue:154-176 |
| REG-06 | Vertical değişince müşteri etiketi doğru | UI "klinik/eczane/…" vertical'dan gelir | CheckInPage:118 |
| REG-07 | `webContentsDebuggingEnabled` prod'da kapalı olmalı | ADB ile token okunamaz (DEVICE-001) | capacitor.config risk |

---

### Test verisi & ortam notları
- **Paylaşımlı DB uyarısı:** E2E siparişleri gerçek `orders`/`saha_notifications` yazar (web+parla+NAV ortak). İzole test hesabı + temizleme (teardown) veya Supabase branch DB kullanın.
- **Rol matrisi için** en az 4 test hesabı gerekir: `REP`, `MANAGER`, `ADMIN`, ve invoicing-izinli-REP.
- **Geolocation E2E:** Playwright `context.grantPermissions(['geolocation'])` + `setGeolocation` ile CHK kademelerini deterministik test edin.
- **Offline E2E:** Playwright `context.setOffline(true)` + service worker; SYN/CHK-07/08 için `online` event'i simüle edin.
- **Doğrulama disiplini:** UI runtime davranışı esastır (statik grep değil); Cloudflare/OTA propagasyonu bazen gecikir.
