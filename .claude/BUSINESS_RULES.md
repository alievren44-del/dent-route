# NAV (dent-route / saha) — İş Kuralları

> Saha satış otomasyonu PWA'sı (`saha-app`, "Field sales automation PWA — vertical-agnostic, white-label SaaS-ready"). Klinik keşfi + CRM + sipariş + fatura/cari + numune yönetimi.
>
> **Kaynak:** Bu doküman koddan **çıkarımla** yazıldı. Her kural, dayandığı dosya/satırla etiketlidir. Koddan kesin okunmayan kurallar **VARSAYIM** olarak işaretlidir. Kanıtı görülmeyen hiçbir iş-kuralı uydurulmamıştır.
>
> **Kritik altyapı gerçeği:** WEB + Parla mobil + NAV **aynı Supabase projesini** paylaşır (`rranpzicmhgfupgabgbi`). Bir RLS/rol hatası üç uygulamayı birden etkiler. NAV tabloları `saha_` prefiksli; ortak tablolar (`profiles`, `orders`, `order_items`, `products`) paylaşımlıdır.

---

## 1. Kimlik Doğrulama (Auth)

### 1.1 Oturum kaynakları
| # | Kural | Kaynak |
|---|-------|--------|
| A1 | Auth backend = paylaşımlı Parla Supabase (anon/publishable key, web-only). | `.env.production`, `types.ts` |
| A2 | İki giriş yolu: (a) `/login` e-posta+şifre, (b) **SSO hand-off** — Parla e-ticaret rep-login'i `#sso=base64{a,r}` hash'i ile yönlendirir. | `ssoCapture.ts`, `authStore.initialize` |
| A3 | SSO hash React mount'tan **ÖNCE** yakalanır ve URL'den hemen temizlenir (token history'de kalmasın; BrowserRouter redirect'i hash'i silmesin). | `ssoCapture.ts:11-19` |
| A4 | Supabase session localStorage'da tutulur (`storageKey: saha-app-auth`). Zustand store yalnız runtime cache + profil tutar. | `authStore.ts:1-7` |

### 1.2 Oturum doğrulama ve offline davranışı
| # | Kural | Kaynak |
|---|-------|--------|
| A5 | Boot'ta `validateSession()` server-side çalışır. **401 (geçersiz/silinmiş session)** → otomatik `signOut` + "Oturum sona erdi" hatası. | `authStore.ts:94-114` |
| A6 | `validateSession()` **offline (Failed to fetch)** dönerse → çıkış YAPILMAZ; persisted session + cache'lenmiş profil ile devam edilir. | `authStore.ts:97-101` |
| A7 | Profil offline cache TTL = **24 saat**. Daha eski cache geçersiz sayılır → deaktive/düşürülmüş bir temsilci uzun süre offline erişemez. | `authStore.ts:42-71` |
| A8 | `signOut` profil cache'ini (`saha-profile-cache`) siler. | `authStore.ts:167-176` |

### 1.3 Rol eşleme (Parla → Saha)
Parla `user_role` enum'u karışıktır; NAV yalnız aşağıdakileri tanır (`mapParlaToSahaRole`, `types.ts:58-71`):

| Parla rolü (case-insensitive) | Saha rolü | Sonuç |
|---|---|---|
| `REP` / `SALES_REP` | `sales_rep` | Saha temsilcisi erişimi |
| `ADMIN` | `admin` | Tam erişim |
| `MANAGER` | `admin` | Saha `manager` rolü YOK → admin'e yükseltilir (onay zinciri çalışsın diye) |
| Diğer (`DOCTOR`, `ASSISTANT`, `PENDING`, `GUEST`, `WAREHOUSE`, `EDITOR`, boş) | `null` | **Giriş engellenir** (UI oturumu yok sayar) |

- **A9:** Rol karşılaştırmaları her yerde case-insensitive (`.trim().toUpperCase()`). Yakın zamanda kök rol-casing bug'ı düzeltilmiştir (kırılgan alan). — `approvalRules.ts`, `types.ts`

### 1.4 KVKK onay kapısı
| # | Kural | Kaynak |
|---|-------|--------|
| A10 | Kimliği doğrulanmış ama `kvkkAcceptedAt` boş kullanıcı **her korumalı rotadan** `/onboarding/kvkk`'ya yönlendirilir. | `ProtectedRoute.tsx:37-39` |
| A11 | KVKK kabulü profile yazılır (`acceptKvkk` → `refreshProfile`). Versiyon takibi (`kvkkVersion`) yapılır. | `authStore.ts:178-184` |

---

## 2. Yetkilendirme / Rol Kapıları (RBAC)

### 2.1 ProtectedRoute mantığı (sıralı, `ProtectedRoute.tsx`)
1. `loading` → "Yükleniyor…" (oturum çözülene kadar hiçbir yönlendirme yapılmaz).
2. `!isAuthenticated` → `/login` (geldiği yol `state.from`'da saklanır).
3. `!kvkkAccepted` → `/onboarding/kvkk`.
4. `requireRole` verildiyse: `sahaRole === requireRole` **VEYA** (`requireRole === 'sales_rep'` iken admin de geçer). Değilse "Erişim engellendi".
5. `requirePermission` verildiyse: **admin her zaman geçer**; değilse `has_permission(user_id, code)` RPC'si çağrılır. `null` iken "Yetki kontrol ediliyor…", `false` iken "Erişim engellendi".

- **R1:** Admin, `sales_rep` gerektiren tüm rotaları da görebilir (üst-küme erişim). — `ProtectedRoute.tsx:42`
- **R2:** İki kapı (`requireRole` + `requirePermission`) birlikte verilirse **ikisi de** sağlanmalıdır. — `ProtectedRoute.tsx:11-16`

### 2.2 Rota → yetki eşlemesi (router.tsx)
| Rota | Kapı | Kaynak |
|---|---|---|
| `/orders/new` | `requireRole="sales_rep"` (admin dahil) | router.tsx |
| `/orders/approval` | `requireRole="admin"` | router.tsx |
| `/invoicing/*` (cari, fatura, ödeme, çek-senet, aging) | `requirePermission="saha:invoicing:access"` | Discovery-facts + router.tsx |
| `/admin/*` (dashboard, users, broadcast, audit-logs, stock, bi …) | `requireRole="admin"` | router.tsx |
| `/` | `/takvim`'e yönlendirir (açılış) | router.tsx:84 |

- **R3:** `has_permission` RPC hata verirse izin **reddedilir** (fail-closed). — `usePermissions.ts:40-44`
- **R4 (VARSAYIM):** `saha:invoicing:access` dışındaki permission-kodlarının tam listesi koddan tek noktadan doğrulanamadı; RBAC Parla'nın `permissions`/`role_permissions` tablolarına dayanır. — `usePermissions.ts:1-7`

---

## 3. Sipariş & Sepet Akışı

### 3.1 Sepet (client-side, `OrderFormPage.tsx`)
| # | Kural | Kaynak |
|---|-------|--------|
| O1 | Müşteri kaynağı iki dünyadan seçilebilir: `saha_clinics` (keşif/prospect, ~3116 klinik) veya `profiles` (legacy). Arama min 2 karakter. | OrderFormPage.tsx:138-163 |
| O2 | Ürün arama min 2 karakter, debounce 300ms, `adapter.searchProducts`. | OrderFormPage.tsx:166-170 |
| O3 | Aynı ürün tekrar eklenirse miktar +1 birleşir; miktar 0'a düşerse satır silinir. | addToCart/updateQty |
| O4 | Toplamlar (`subtotal`/`KDV`/`grandTotal`) **client'ta gösterim için** `adapter.quoteOrder` ile hesaplanır; nihai fiyat sunucuda yeniden hesaplanır (bkz. O8). | OrderFormPage.tsx:182-186 |
| O5 | Sepet **şablon** olarak kaydedilebilir (`saha_order_templates`, `onConflict: rep_id,name`). Rep kendi şablonlarını, admin hepsini görür (RLS). | OrderFormPage.tsx:206-242 |

### 3.2 Onay eşiği (client kararı — hangi sipariş onaya düşer)
`needsApproval(grandTotal, role)` — `approvalRules.ts`. Eşikler **KDV dahil genel toplam (TL)** üzerinden:

| Rol | Oto-onay eşiği | Anlamı |
|---|---|---|
| `USER` | 0 | Her sipariş onay ister |
| `REP` / `SALES_REP` | ∞ (limitsiz) | **Rep siparişleri onaya düşmez** — anında `pending` (2026-06-19 saha kararı) |
| `MANAGER` | 50.000 TL | 50k'ya kadar kendi-onay |
| `ADMIN` | ∞ | Limit yok |

- **O6:** Onay eşiğini aşan sipariş `status = 'approval_pending'` olarak **doğrudan** oluşturulur (eski "önce pending INSERT, sonra UPDATE" race'i kaldırıldı). Aşmayan sipariş `status = 'pending'`. — `SupabaseCRMAdapter.ts:654-656`
- **O7:** Bir üst onaycı `nextApproverRole`: USER/REP → MANAGER, MANAGER → ADMIN, ADMIN → yok. — `approvalRules.ts:52-59`

### 3.3 Sipariş oluşturma (`adapter.createOrder`, sunucu tarafı hakikat)
| # | Kural | Kaynak |
|---|-------|--------|
| O8 | **Fiyatlar client snapshot'ına GÜVENİLMEZ.** `v_saha_products`'tan `sale_price ?? base_price` çekilir; `tax_rate` NULL ise **%10** varsayılan (dental standart). KDV satır bazında hesaplanır, 2 ondalığa yuvarlanır. | SupabaseCRMAdapter.ts:553-607 |
| O9 | `unitPriceOverride` verilmişse DB fiyatı yerine o kullanılır (şablondan/manuel). | createOrder:594 |
| O10 | **Idempotency:** `idempotencyKey` ile mevcut sipariş varsa yeni insert yapılmaz, var olan döner. `orders.idempotency_key` kolonu + client uuid. | createOrder:541-551 |
| O11 | Müşteri `saha_clinics`'te ise → `saha_get_or_create_cari_for_clinic` RPC ile **cari find-or-create**; sipariş `clinic_id` + `cari_id`'ye bağlanır, `user_id = null`. Değilse legacy `user_id`. | createOrder:609-635 |
| O12 | `order_number` NOT NULL: `SAH-{timestamp}-{rand8}` üretilir (eşzamanlı çakışmayı rastgele sonek engeller); DB trigger'ı varsa override eder. | createOrder:637-645 |
| O13 | `sales_rep_id = auth.getUser().id` (siparişi giren temsilci). | createOrder:538-539 |

### 3.4 Sipariş onaylama (`adapter.approveOrder`)
| # | Kural | Kaynak |
|---|-------|--------|
| O14 | Onay **client-side kontrol ile YAPILMAZ**; server-side `approve_order_if_authorized` (SECURITY DEFINER) RPC'si çağrılır. Eskiden rep kendi büyük siparişini REST ile onaylayabiliyordu (#70). | SupabaseCRMAdapter.ts:932-949 |
| O15 | RPC eşikleri (onay YETKİSİ, 3.2'deki oluşturma eşiğinden AYRI): **REP ≤ 5.000 TL, MANAGER ≤ 50.000 TL, ADMIN sınırsız**. | approveOrder docstring:937 |
| O16 | RPC hata kodları UI'a taşınır: `over_approval_limit:*` → FORBIDDEN (limit aşımı), `not_authorized` → FORBIDDEN (yetki yok), diğer → UNKNOWN. | approveOrder:951-970 |
| O17 | Onay başarılıysa RPC `status='approved'` + `approved_at` yazar; `trg_order_status_change` trigger'ı **stok + order-to-cash** akışını otomatik tetikler. | approveOrder docstring:938-939 |

> **⚠️ İnce nokta (VARSAYIM/dikkat):** Oluşturma eşiği (REP=∞ → onaya düşmez) ile onaylama eşiği (REP ≤ 5.000) arasında kavramsal fark vardır. Bir rep normalde siparişi anında `pending` yapar (onaya hiç düşmez). Ancak `approval_pending` bir sipariş rep'e düşerse, rep onu ancak ≤ 5.000 TL ise onaylayabilir. Bu ikisinin birlikte üreteceği uç durumlar test edilmelidir (bkz. TEST_MATRIX O-serisi).

### 3.5 Sipariş durumları (`orderStatus.ts` — tek kaynak)
`draft` (Taslak) · `pending` (Beklemede) · `approval_pending` (Onay Bekliyor) · `approved`/`confirmed` (Onaylandı) · `rejected` (Reddedildi) · `shipped` (Kargoda) · `delivered` (Teslim Edildi) · `cancelled` (İptal). Bilinmeyen değer → ham etiket + gri.

---

## 4. Ödeme / Tahsilat (Invoicing)

> **NOT:** NAV'da "ödeme" = **cari tahsilat kaydı** (nakit/havale/çek/senet/kart). Online ödeme geçidi (PayTR/İyzico) NAV'da **YOKTUR** — o web'e aittir. Tüm invoicing rotaları `saha:invoicing:access` izniyle korunur.

| # | Kural | Kaynak |
|---|-------|--------|
| P1 | Tahsilat bir cari (`saha_cariler`) seçilerek girilir; `saha_faturalar` bakiyeli faturalar listelenir. | PaymentFormPage.tsx:98-137 |
| P2 | Ödeme tipleri: **nakit, havale, çek, senet, kart** (`payment_type`). | PaymentFormPage.tsx:525 |
| P3 | Ödeme `saha_odemeler` tablosuna yazılır; fatura(lar)a **dağıtım (allocation)** yapılır (FIFO-oto veya manuel). | PaymentFormPage.tsx:251-294 |
| P4 | **Dağıtım kısıtı:** dağıtılan toplam = ödeme tutarı olmalı (`|sum - tutar| ≤ 0.01`). Aksi halde kayıt reddedilir. | PaymentFormPage.tsx:270-276 |
| P5 | Kaydet butonu `tutar ≤ 0` veya dağıtım uyuşmazlığında disable. | PaymentFormPage.tsx:638 |
| P6 (VARSAYIM) | Fatura bakiye kapanışı DB trigger ile yapılır (kod yorumu: "trigger ile kapatır"); tetiklenme kesin olarak edge/SQL tarafında doğrulanmalı. | PaymentFormPage.tsx:270 |
| P7 | Ek invoicing yüzeyleri: cari listesi/detay, fatura oluştur/detay, çek-senet listesi, **aging (yaşlandırma)** raporu, stok defteri. | router.tsx:54-64 |

---

## 5. Ziyaret / Check-in Akışı

| # | Kural | Kaynak |
|---|-------|--------|
| V1 | Check-in GPS doğrulamalıdır. Rep konumu ile klinik koordinatı arası **Haversine** mesafe hesaplanır. | CheckInPage.tsx:9-25, 183-188 |
| V2 | Mesafe kademeleri: **<50m** yeşil "hedeftesiniz" · **<200m** yeşil "çok yakın" · **<2000m** sarı uyarı "uzaktasınız, devam edebilirsiniz" (izinli) · **≥2000m** kırmızı → check-in **engellenir**. | CheckInPage.tsx:54-88 |
| V3 | Klinik koordinatı YOKSA mesafe doğrulanamaz → kullanıcı **onay kutusunu** işaretleyerek geçebilir (`needsOverride`). | CheckInPage.tsx:59-67, 388-410 |
| V4 | Rep konumu henüz gelmediyse buton disable ("Konum bekleniyor…"). Konum izni reddedilir/kullanılamazsa hata banner'ı. | CheckInPage.tsx:56-58, 416-419 |
| V5 | Check-in kaydı `saha_visits`'e `status='in_progress'` + konum + hassasiyet + mesafe + `idempotency_key` yazılır; sonra `/visits/{id}` ziyaret formuna geçilir. | CheckInPage.tsx:237-271 |
| V6 | Offline/ağ hatası → check-in **kuyruğa** (`visit.create`) alınır, `/history`'ye yönlendirilir; gerçek visit_id bağlantı gelince oluşur. | CheckInPage.tsx:251-321 |

---

## 6. Numune (Sample) Kötüye-Kullanım Kuralları

`validateCanGiveSample` (`core/sampling/policies.ts`) — bir numune satırı verilmeden önce sıralı kontrol:

| # | Kural | Kaynak |
|---|-------|--------|
| S1 | **Kara liste (blacklist):** hesap `saha_blacklist`'te ise → derhal reddedilir, başka kontrol yapılmaz. | policies.ts:77-84 |
| S2 | **Politika çözümü:** DB override (`saha_sample_policies`) > vertical `.json` kategori politikası. Politika bulunamaz ve vertical politikası aktifse `no_policy` uyarısı. | policies.ts:32-95 |
| S3 | **Cooldown:** son `cooldownDays` gün içinde aynı hesaba numune verilmişse → reddedilir. | policies.ts:99-111 |
| S4 | **Yıllık maksimum:** son 365 günde `maxPerAccountYearly` sayısına ulaşıldıysa → reddedilir. | policies.ts:113-124 |
| S5 | **Bütçe:** tahmini satır maliyeti kalan bütçeyi aşarsa → `budget_exceeded` (admin onayı gerekir). | policies.ts:127-138 |
| S6 | Ek motorlar (referans): `hunter-detection` (avcı/suistimal şiddet sınıflaması), `quotas`, `roi`; admin tarafı `SampleBudget`/`RegionAssignment` + edge fn `sample-roi-compute`. | core/sampling/*, Discovery-facts |

---

## 7. Offline-First & Senkronizasyon

### 7.1 Sync kuyruğu (Dexie `saha-offline` DB, `syncQueue.ts`)
| # | Kural | Kaynak |
|---|-------|--------|
| Y1 | Kuyruğa alınabilen op tipleri: `sample.create`, `visit.create`, `visit.update`, `order.create`, `route.complete`, `reminder.create`. | db.ts:5-12 |
| Y2 | Her op'un `idempotencyKey`'i vardır. `enqueueOp` aynı key ile tamamlanmamış kayıt varsa **tekrar eklemez** (dedup). | syncQueue.ts:44-69 |
| Y3 | `processQueue`: her op `pending → syncing → completed`. Hata olursa `retryCount+1`; **retryCount ≥ 3 → `failed`** (terminal), aksi halde tekrar `pending`. | syncQueue.ts:101-122 |
| Y4 | **Açılışta yalnız `pending` flush edilir. `failed` op'lar OTOMATİK retry EDİLMEZ** — kullanıcı "Tekrar Dene"ye basana kadar terminal kalır (sonsuz-döngü/bozuk-insert yükünü önler). | syncQueue.ts:219-226, 79-88 |
| Y5 | Kuyruk tetikleyicileri: `online` event, Service Worker `saha-sync-flush` postMessage'ı (Background Sync tag `saha-sync-queue`), enqueue anında SyncManager register. SyncManager yoksa (iOS Safari) online-event fallback. | syncQueue.ts:16-30, 199-226 |
| Y6 | Rep, düzeltilemez bir `failed` op'u UI'dan **manuel silebilir** (`removeOp`). | syncQueue.ts:90-99 |

### 7.2 Replay idempotency (executeOp)
| # | Kural | Kaynak |
|---|-------|--------|
| Y7 | `visit.create` replay'i **upsert `onConflict: idempotency_key, ignoreDuplicates`** ile yapılır → çift-insert sessizce atlanır, yanlış "failed" olmaz. | syncQueue.ts:132-141 |
| Y8 | `order.create` replay'i **ham insert değil, `adapter.createOrder` üzerinden** yapılır → fiyatlar DB'den yeniden hesaplanır, `order_items` üretilir, approval-status doğru set edilir; idempotency_key duplicate'i adapter içinde engeller. | syncQueue.ts:154-176 |
| Y9 (VARSAYIM) | `sync_queue` (greenfield) tablosu ve `saha_reminders` gibi bazı tablolar tip-üretimi dışında; `reminder.create` untyped client ile insert eder. Greenfield şema henüz canlıya tümüyle deploy edilmemiş olabilir. | syncQueue.ts:187-195, Discovery-facts |

### 7.3 React Query persist (localStorage)
| # | Kural | Kaynak |
|---|-------|--------|
| Y10 | `networkMode: 'offlineFirst'`, `staleTime: 0`, `refetchOnMount: 'always'`, `gcTime: 24h`. Yalnız `retryable` hatalar 3 kez retry edilir. | main.tsx:49-69 |
| Y11 | **Yalnız statik lookup query'ler persist edilir** (allow-list): `calendar-reps`, `calendar-clinic-names`, `calendar-assigner-names`, `calendar-assignable-reps`, `nearby-clinic-counts`, `assigned-routes`, `discovery`. | main.tsx:39-47, 98 |
| Y12 | **Volatile finansal listeler (cari/fatura/sipariş/bakiye) BİLİNÇLİ persist EDİLMEZ** — bayat finansal veri gösterilmez. Persist buster `v0.2.0` eski aşırı-persist cache'leri düşürür. | main.tsx:93, Discovery-facts |

---

## 8. Bildirim (Notification) Akışı

| # | Kural | Kaynak |
|---|-------|--------|
| N1 | Bildirimler `saha_notifications` tablosundan okunur (şema: `user_id` + `type` + `title` + `body` + `payload jsonb`). NAV feed'i bu tablodan besler. | OrderFormPage.tsx:361-368 |
| N2 | **Sipariş onay fan-out:** `requiresApproval` sipariş oluşunca, onaycı rollere (`nextApproverRole ?? ADMIN` + `ADMIN`) sahip `profiles` sorgulanır; **her alıcı için ayrı `user_id`'li satır** insert edilir (`type='order_approval'`). | OrderFormPage.tsx:358-411 |
| N3 | Rol eşleşmesi hem UPPER hem lower varyantla yapılır (`profiles.role` canlıda lowercase; aksi halde `.in()` 0 eşleşir, bildirim gitmez). | OrderFormPage.tsx:376-380 |
| N4 | Fan-out **best-effort**: alıcı yoksa/insert hata verirse sipariş yine de oluşur; sadece `console.warn`. | OrderFormPage.tsx:385-414 |
| N5 | INSERT policy `saha_notifications_admin_insert` (`saha_is_rep_or_admin()`) ile korunur. | OrderFormPage.tsx:368 |
| N6 | Admin toplu duyuru: `/admin/broadcast` (`AdminBroadcastPage`). Native push/local-notification Capacitor eklentileriyle. | router.tsx, Discovery-facts |
| N7 (VARSAYIM) | Push token kaydı / cihaz-hedefleme detayı bu incelemede doğrulanmadı; Capacitor Push/Local Notifications eklentileri kuruludur. | Discovery-facts |

---

## 9. Beyaz-Etiket / Vertical & CRM Adapter

| # | Kural | Kaynak |
|---|-------|--------|
| W1 | Uygulama **vertical-agnostic**: 13 sektör şablonu (`verticals/*.json` — dental, pharmacy, veterinary, optician, cosmetics, medical/industrial supply, automotive, cafe, mini_market, agriculture, construction, generic). Aktif dikey build-time bake edilir (`.saha-config.json` + extends). | Discovery-facts |
| W2 | UI etiketleri vertical'dan gelir (ör. `vertical.labels.customer.singular` — "klinik"/"eczane"/…). | CheckInPage.tsx:118 |
| W3 | **CRM adapter tek fabrika:** `createCRMAdapter(crm, deps)` → `crm.type` = `supabase` (builtin `SupabaseCRMAdapter`) VEYA `custom_rest` (`CustomRESTAdapter`, white-label). Exhaustive never-check; başka yerde adapter constructor'ı çağrılmaz. | factory.ts:20-40 |
| W4 (VARSAYIM) | Canlı kurulum `supabase` adapter'ı + `saha_clinics` şemasını kullanır; greenfield generic şema (accounts/products) white-label hedefi için hazır ama prod paritesi doğrulanmalı. | Discovery-facts, adapter |

---

## 10. Dağıtım & Güvenlik Notları (iş kuralına etki eden)

| # | Kural | Kaynak |
|---|-------|--------|
| D1 | İki hedef: **Web** → Cloudflare Workers (`dent-route`, `saha.parladisdeposu.com`) + **Native** → Capacitor Android (`com.parla.saha`, "Parla CRM"). | wrangler.jsonc, Discovery-facts |
| D2 | Web-bundle güncellemeleri **OTA** (self-host Capgo, `autoUpdate:false`, `otaCheck('nav')`); native/plugin değişimi APK gerektirir. | Discovery-facts |
| D3 | Backend = Supabase **Edge Functions** (Deno): admin-create-user, clinic-scan v1/v2/v3, batch-scan, google-places/directions, mapbox-directions/optimize, osm-search, enum-neighborhoods, doktor-takvimi-scrape, sample-roi-compute. (`.cjs` yalnız yerel scriptler.) | Discovery-facts |
| D4 (RİSK) | `capacitor.config.ts` `webContentsDebuggingEnabled: true` — canlıda kapatılmalı (ADB ile localStorage token okunabilir; DEVICE-001). | Discovery-facts/risks |
| D5 (RİSK) | Migration deploy job `ON_ERROR_STOP` kapalı/best-effort → bozuk migration sessizce atlanabilir, CI yeşil kalır (şema-drift gizli). | Discovery-facts/risks |

---

### Belgelenmemiş / doğrulanamayan alanlar (uydurulmadı)
- Sipariş `rejected`/`shipped`/`delivered` durum geçişlerinin **kim tarafından** tetiklendiği (rep mi, admin mi, warehouse mi) koddan tek noktadan doğrulanamadı — status enum'u mevcut, geçiş yetkisi VARSAYIM.
- Numune ROI/quota eşiklerinin somut sayısal değerleri vertical `.json` + `saha_sample_policies` DB'sine bağlı (koda gömülü sabit değil).
- Sentry/hata-izleme NAV'da kurulu mu belirsiz (kod görülmedi).
