# KNOWN_ISSUES — NAV (dent-route / saha)

> Kod incelemesinden **doğrulanmış (CONFIRMED)** bulgular. Severity sırasına göre.
> Her madde: dosya:satır · mekanizma · senaryo · önerilen düzeltme.
> Çürütülen/belirsiz iddialar bu dosyaya alınmadı (bkz. not, en altta).

**Özet:** 4 HIGH · 5 MEDIUM · 2 LOW.
En riskli iki küme: (a) **Numune (sampling) bütçe/kota kontrolü** — client-side, atomik değil, delinebilir. (b) **Offline senkron kuyruğu** — sessiz veri kaybı + çift kayıt.

---

## 🔴 HIGH

### H1 — Bütçe aşan numune kaydı kalıcı olur, kota güncellenmez (telafi silme yok)
- **Dosya:** `src/features/sampling/components/SampleFormMobile.tsx:510-558`
- **Mekanizma:** `handleSubmit` üç AYRI (her biri auto-commit) supabase çağrısı yapar: (1) `saha_samples` INSERT (L510-515), (2) `saha_sample_lines` INSERT (L531), sonra (3) `saha_increment_sample_spent` RPC (L537). RPC `budget_exceeded` fırlatınca yalnız kendi transaction'ı geri döner; ilk iki INSERT zaten commit edilmiştir. Hata dalı (L545-549) sadece `setSubmitError` + `return` yapar, kaydedilmiş sample/line satırlarını **SİLMEZ**. Şema açıkça `spent_tl` uygulama tarafında (trigger-free) güncellenir diyor (`20260527000001_saha_sampling.sql:115`), yani telafi eden DB trigger'ı da yok.
- **Senaryo:** Kalan bütçe 100 TL, rep 500 TL'lik numune girer → sample+lines kaydedilir, RPC reddeder, `spent_tl` artmaz → bedava ürün klinikte kalır ama harcama olarak sayılmaz. Bütçe muhasebesi bozulur. Generic kota hatası dalı (L550-557) de aynı: "zaten kaydedilmiş kaydı bloklama" yorumuyla return eder.
- **Fix:** Kota kontrolünü INSERT ÖNCESİNE al (RPC ilk adım olsun) VEYA tek bir `SECURITY DEFINER` RPC içinde sample+line+spent'i atomik yaz. `budget_exceeded` durumunda hiçbir satır kalmamalı.

### H2 — Boş birim maliyet numune kotasını hiç düşmez (izlenmeyen bedava numune)
- **Dosya:** `src/features/sampling/components/SampleFormMobile.tsx:535`
- **Mekanizma:** Kota RPC'si yalnız `if (totalCost > 0)` iken çağrılır (L535). `unitCostTl` opsiyonel/boş bırakılabilir (input L832-846, boşta `undefined`). `totalCost = Σ (unitCostTl ?? 0)*qty` (L357-359) → boşta 0. Bütçe validasyonu (`policies.ts:128`) `estimatedLineCostTl(=0) > remaining` = false → hiç tetiklenmez. `canSubmit` (L425-434) birim maliyeti zorunlu tutmaz.
- **Senaryo:** Rep birim maliyet alanını boş bırakır → `totalCost=0` → RPC hiç çağrılmaz → `spent_tl` artmaz, uyarı çıkmaz → sınırsız "bedava" numune kaydı açılabilir, numune suistimali kontrolü delinir.
- **Fix:** `unit_cost_tl`'yi zorunlu kıl VEYA ürün/varyant fiyatından sunucu tarafında maliyet türet. Kota RPC'sini `totalCost`'a bakmadan her kayıtta çağır.

### H3 — Anti-hunter cooldown & yıllık-max kontrolleri sabit boş dizi yüzünden devre dışı
- **Dosya:** `src/features/sampling/components/SampleFormMobile.tsx:378`
- **Mekanizma:** `validateCanGiveSample`'a `previousSamplesThisAccount: []` sabit boş dizi geçilir (L378, "TODO Sprint 5.5+" yorumu). `policies.ts` cooldown (L101-111, `.find()` → `undefined`) ve `maxPerAccountYearly` (L114-124, `.filter().length` → `0`, `0 >= limit` = false) bu diziyi kullandığı için pozitif eşiklerde **HİÇ** tetiklenmez. Sadece blacklist (L78) ve budget (L128) çalışır.
- **Senaryo:** Aynı klinik dün numune almış olsa da cooldown engeli yok; yıllık limit 2 olsa da geçer. Numune-avcısı klinikler formdan sınırsız numune alabilir; hunter-detection sadece geriye dönük rapor, önleyici değil.
- **Fix:** Kliniğin son 1 yıllık numunelerini RPC ile çekip `previousSamplesThisAccount`'a besle. İdeali: cooldown/max kontrolünü sunucu tarafında (RLS/RPC) zorunlu yap.

### H4 — Offline kuyruk op'ları "syncing" durumunda kalıcı takılır — kurtarma yok (sessiz veri kaybı)
- **Dosya:** `src/core/offline/syncQueue.ts:102-109`
- **Mekanizma:** `processQueue` op'u `syncing` işaretler (L107) → `executeOp` (ağ, L108) → `completed` (L109). Bu iki adım arasında uygulama/sekme kapanır veya native süreç öldürülürse op kalıcı `syncing`'de kalır. `listPending` yalnız `status='pending'` okur (L72); `initSyncQueue` yalnız pending'i flush eder. Tüm src'de `syncing` için hiçbir reaper/kurtarma yok. `enqueueOp` dedup'ı (L50-56) yalnız yeniden-enqueue'de devreye girer; bir kez yapılan op tekrar enqueue edilmez.
- **Senaryo:** Rep offline check-in/sipariş/numune yapar, sync sırasında tünel/uygulama-kapanışı → kayıt kalıcı olarak kuyrukta gömülü kalır, sunucuya hiç ulaşmaz. Sessiz veri kaybı.
- **Fix:** Açılışta belirli yaştan eski `syncing` op'ları `pending`'e geri al (idempotency çift-insert'i korur) VEYA `listPending`'e `syncing`'i de dahil et.

---

## 🟠 MEDIUM

### M1 — processQueue eşzamanlılık kilidi yok — paralel flush idempotent-olmayan insert'i çift çalıştırır
- **Dosya:** `src/core/offline/syncQueue.ts:101`
- **Mekanizma:** `processQueue` dört noktadan tetiklenir: online event (L205), SW `saha-sync-flush` mesajı (L214), init (L224), `retryFailed` (L86). In-flight/mutex guard yok; fonksiyonun ilk await'i `listPending()` (L102) olduğundan iki eşzamanlı çağrı AYNI pending op'ları alır, ikisi de `executeOp` çağırır. `visit.create` (upsert onConflict) ve `order.create` (idempotency_key) korumalı; ama `reminder.create` (L190) düz `.insert`, unique/idempotency constraint yok → iki satır eklenir. (`sample.create` L128 de düz insert ama şu an canlı enqueue çağrısı yok; `reminder.create` canlı yol — `CalendarPage.tsx:1731`.)
- **Senaryo:** Bağlantı dönerken SW mesajı + online event çakışır → çift hatırlatma kaydı.
- **Fix:** Modül-seviyesi `isRunning` (Promise) kilidi ekle; çalışan flush varken ikinciyi zincirle. Ayrıca `sample`/`reminder` için `idempotency_key` + unique index.

### M2 — createOrder atomik değil — order_items insert patlarsa kalemsiz "hayalet" sipariş kalır
- **Dosya:** `src/core/adapters/builtin/SupabaseCRMAdapter.ts:646-689`
- **Mekanizma:** `orders` satırı INSERT (L646-665, status pending/approval_pending, subtotal/vat/total dolu), ardından ayrı çağrıyla `order_items` INSERT (L683). Tek transaction/RPC değil. `itemsErr` olursa `AdapterError` fırlatılır (L684-689) ama önce oluşturulan `orders` satırı **geri alınmaz** (`.delete()` yok).
- **Senaryo:** RLS/geçici ağ nedeniyle `order_items` patlarsa DB'de 0 kalemli ama tutarları dolu sipariş kalır → onay listesinde görünür (`getListOrders`/`getOrder` L421/482 boş items ile listeler), rapor tutarları şişer.
- **Fix:** Sipariş+kalemleri tek RPC/transaction içinde oluştur VEYA `itemsErr`'de oluşturulan `orders` satırını sil (best-effort rollback).

### M3 — usePermissionCached her render'da has_permission RPC'sini tekrar tetikler (kararsız `perms` bağımlılığı)
- **Dosya:** `src/core/auth/usePermissions.ts:88`
- **Mekanizma:** `usePermissions()` her çağrıda YENİ nesne döndürür (L49-57). `usePermissionCached` effect deps'i `[code, perms]` (L88); `perms` kimliği her render değiştiğinden effect her render'da yeniden çalışır ve non-admin auth kullanıcıda `getTypedClient().rpc('has_permission', ...)` (L36-39) canlı ağ çağrısı yapar. "Cached" adına rağmen effect'i gate'leyen bir cache yok.
- **Senaryo:** `requirePermission`'lı korumalı rota (ör. invoicing) her yeniden-render'da `has_permission` ağ çağrısı → gereksiz Supabase egress ve yetki-kontrol gecikmesi. (Doğruluk kırılmaz.)
- **Fix:** Effect deps'i stabil primitivelere indir: `[code, perms.hasPermission]` (zaten `useCallback([userId,isAdmin])` ile memoize).

### M4 — CustomRESTAdapter fetch çağrılarında timeout/AbortController yok — native'de süresiz asılabilir
- **Dosya:** `src/core/adapters/custom-rest/CustomRESTAdapter.ts:204`
- **Mekanizma:** `request()` (L204) ve `testConnection()` (L47) ham fetch kullanır, `signal`/timeout yok. `errors.ts`'te kullanılmayan `TIMEOUT` varyantı var ama uygulanmamış. Capacitor/Android WebView'de fetch'in default timeout'u yoktur.
- **Senaryo:** White-label müşterinin REST endpoint'i TCP'yi açık tutup yanıt vermezse promise asla settle olmaz → çağıran React Query/mutation süresiz asılır, spinner sonsuza döner, retry devreye girmez. `config.crm.type=custom_rest` seçildiğinde tüm veri katmanı buna bağlı (default değil).
- **Fix:** `AbortController` + `setTimeout` (~15sn); timeout'ta `AdapterError('NETWORK_ERROR', retryable:true)`.

### M5 — Fatura kalanını aşan fazla ödeme doğrulanmaz → negatif kalan
- **Dosya:** `src/features/invoicing/pages/PaymentFormPage.tsx:274`
- **Mekanizma:** Submit guard (L638) yalnız `!cariId`, `tutar<=0`, `allocMismatch`'i kontrol eder; `allocMismatch` (L192) sadece `length>=2` iken toplam==tutar'a bakar. Satır-başına "tahsis ≤ fatura kalanı" doğrulaması HİÇ yok. Tek-fatura yolu (L249-266) tutarı `f.kalan` ile karşılaştırmaz; manuel dağıtım serbest sayı (L468-476); FIFO-auto fazlayı son faturaya yığar. DB'de de koruma yok: `update_fatura_odenen()` (migration `20260603000002:123-134`) `odenen=SUM(tutar)` cap'siz; `kalan` GENERATED, CHECK yok (`20260603000001:106`).
- **Senaryo:** Kalanı 100 TL faturaya 500 TL yazılır → `odenen>toplam`, `kalan` negatif, status `odendi`'ye döner, aging/hatırlatma sorguları `kalan>0` filtresiyle (migration `20260614000003:64`) bu faturayı sessizce dışlar → cari bakiye/aging bozulur.
- **Fix:** Her tahsisi ilgili faturanın kalanıyla, toplamı seçili kalanların toplamıyla sınırla. Fazla ödeme için ayrı "avans" akışı.

---

## 🟢 LOW

### L1 — Sipariş toplamları ham/yarı-yuvarlanmış float ile yazılıyor — invoiceCalc round2 ile tutarsız
- **Dosya:** `src/core/adapters/builtin/SupabaseCRMAdapter.ts:590-607`
- **Mekanizma:** `createOrder`'da `subtotal` ham float toplamı, hiç yuvarlanmaz (L590,596); `vatTotal` satır-satır birikip yalnız EN SONDA bir kez `Math.round(*100)/100` (L597,606); `grandTotal = subtotal + vatTotal` (L607) yuvarlanmaz. Bunlar `orders.subtotal/vat_amount/total/total_amount`'a yazılır (L657-660). `invoiceCalc.ts` ise her satırı `round2` ile (sum-of-rounds) yuvarlar (L49-61,67-85). İki yol farklı yuvarlama disiplini (round-of-sum vs sum-of-rounds) → kuruş bazında sapma; ayrıca float artefaktı (ör. `0.30000000000000004`) payload'a girer.
- **Senaryo:** Aynı ürünler için sipariş toplamı ile fatura toplamı kuruş bazında farklılaşabilir.
- **Fix:** Sipariş tarafında da satır-başına `round2` uygula (invoiceCalc ile aynı) veya `decimal.js`; `grandTotal`'ı da yuvarla.

### L2 — Çek/senet + tahsilat atomik değil — orphan çek/senet riski
- **Dosya:** `src/features/invoicing/pages/PaymentFormPage.tsx:223-296`
- **Mekanizma:** yöntem cek/senet iken önce `saha_cek_senetler` INSERT (L223-238, durum `portfoyde`), sonra `auth.getUser()` (L242) ve `saha_odemeler` INSERT (L250/294). Transaction/RPC yok. İkinci insert (RLS `created_by` reddi/ağ) patlarsa `onError` (L309-311) yalnız `setError` yapar; oluşturulan çek/senet satırını silen telafi yok.
- **Senaryo:** Bir ödemeye bağlı olmayan yetim `portfoyde` çek/senet satırı DB'de birikir → çek-senet listesi/raporu şişer. (Veri bozulmaz, elle temizlenebilir.)
- **Fix:** Çek/senet + ödeme kayıtlarını tek RPC/transaction'da oluştur VEYA ödeme hatasında oluşturulan `cek_senet` satırını sil.

---

## Not — kapsam dışı bırakılan iddia
- *"Numune bütçe kontrolü satır-başına (client) → kümülatif aşım"* iddiası **belirsiz/çürütüldü**: client-side gözlemler doğru (UI çok-satırlı over-budget submit'e izin verir) ama iddia edilen zarar (bütçenin gerçekten aşılması) **gerçekleşmez** — `handleSubmit` RPC'ye kümülatif `totalCost` geçer ve `saha_increment_sample_spent` (migration `20260612:50-72`) satırı kilitleyip atomik `budget_exceeded` fırlatır. Gerçek zarar zaten **H1**'de (INSERT'lerin geri alınmaması) yakalanmıştır. Bu yüzden ayrı bulgu olarak listelenmedi.
