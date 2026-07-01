# CTO_REVIEW — NAV (dent-route / saha: klinik keşif + CRM)

> Üst-düzey teknik değerlendirme. Yalnızca **doğrulanmış** bulgulara dayanır (detay: `KNOWN_ISSUES.md`).
> Kapsam: numune (sampling), offline senkron, sipariş/onay akışı, faturalama/tahsilat, yetkilendirme, adaptör katmanı.

---

## 1. Genel Değerlendirme

Uygulama olgun bir mimariye sahip: adaptör-tabanlı veri katmanı (builtin Supabase / custom REST), offline-first senkron kuyruğu, RLS + RPC ile sunucu tarafı iş kuralları, ve iş mantığının bir kısmı saf/test-edilebilir `policies` modüllerinde. Temel iskelet sağlam.

Ancak **para ve bütçe akan üç kritik yolda** (numune bütçesi, sipariş oluşturma, fatura tahsilatı) ortak bir kusur deseni var: **çok-adımlı yazma işlemleri client'ta ayrı ayrı (auto-commit) yapılıyor, atomiklik yok, ve hata dallarında telafi (compensating delete/rollback) eksik.** Bu, "yarı yazılmış" kayıtlar (yetim satır, kalemsiz sipariş, kotasız numune) üretiyor. İkinci ana tema: **iş kurallarının bir kısmı yalnızca client-side ve delinebilir durumda** (anti-hunter, birim maliyet, kümülatif bütçe UI).

---

## 2. Mimari — Güçlü / Zayıf

**Güçlü yanlar**
- Adaptör soyutlaması (builtin vs custom_rest) white-label esnekliği sağlıyor.
- Kritik bütçe kontrolü için `SECURITY DEFINER` + `SELECT ... FOR UPDATE` RPC (`saha_increment_sample_spent`) — doğru desen; kümülatif bütçe gerçekten server-side korunuyor.
- Offline kuyruk + service worker flush + idempotency (visit/order) mevcut.
- İş kurallarının saf fonksiyonlara (`core/sampling/policies.ts`, `invoiceCalc.ts`) ayrılması test edilebilirlik açısından iyi.

**Zayıf yanlar**
- **Atomiklik yokluğu sistemik:** İş-kritik çok-tablolu yazmalar (sample+lines+spent, order+items, cek_senet+odeme) transaction/RPC ile sarılmamış. Her hata dalı yarı-durum bırakabiliyor.
- **Client-side iş kuralı güveni:** Anti-hunter (cooldown/yıllık-max) ve birim-maliyet zorunluluğu yalnız formda; sunucu tarafı zorlama yok → atlatılabilir.
- **Offline kuyruk durum-makinesi eksik:** `syncing` için reaper yok; `processQueue` için mutex yok. Sessiz veri kaybı + çift kayıt ikilisi.
- **Yuvarlama disiplini iki başlı:** Sipariş tarafı float, fatura tarafı `round2` → cross-path kuruş sapması.

---

## 3. Release-Blocker'lar (yayın öncesi mutlaka)

Önce numune ve offline yolları — bunlar hem para hem veri kaybı riski taşıyor:

1. **H1** — Bütçe aşan numune kaydının geri alınmaması (kayıt var, harcama sayılmıyor). Bütçe muhasebesini bozar. → Atomik RPC.
2. **H2** — Boş birim maliyetle kotasız/izlenmeyen bedava numune. → Maliyet zorunlu/sunucu-türetimli + koşulsuz kota RPC.
3. **H3** — Anti-hunter kontrolleri sabit `[]` ile tamamen devre dışı. → Geçmiş numuneleri besle + sunucu zorlaması.
4. **H4** — Offline op'ların `syncing`'de kalıcı takılması = sessiz saha verisi kaybı. → Açılışta `syncing→pending` reaper.

**Yüksek öncelikli (blocker'a yakın):**
5. **M5** — Fazla ödeme → negatif kalan, aging/cari bozulması (finansal doğruluk).
6. **M2** — Kalemsiz hayalet sipariş (onay listesini/raporu kirletir).

---

## 4. Güvenlik / Bütünlük

- **En kritik açık: iş kurallarının client-side atlatılabilirliği.** Numune suistimali (hunter) kontrolü, birim-maliyet ve bütçe UI'ı yalnız formda zorlanıyor; kararlı bir kullanıcı/değiştirilmiş istemci bunları atlayabilir. Kalıcı çözüm: cooldown/yıllık-max/maliyet doğrulamalarını RLS + RPC'ye taşımak.
- **Finansal bütünlük:** DB seviyesinde `odenen`/`kalan` için CHECK constraint yok; fazla ödeme negatif kalan üretebiliyor (M5). CHECK constraint + tahsis-doğrulaması önerilir.
- **Yetim/hayalet kayıtlar** (H1, M2, L2): raporlama ve onay iş akışlarını kirletir; muhasebe mutabakatını zorlaştırır.
- Not: Numune kümülatif bütçesi server-side RPC ile gerçekten korunuyor (bu iyi haber) — sorun aşımın kendisi değil, aşım reddedildiğinde bırakılan yarı-kayıt.

---

## 5. Performans

- **M3** — `usePermissionCached` her render'da `has_permission` RPC'sini tekrar atıyor (kararsız `perms` bağımlılığı). `requirePermission`'lı rotalarda gereksiz Supabase egress. Düşük efor, kolay kazanç: deps'i stabil primitive'e indir.
- **M4** — `CustomRESTAdapter`'da timeout/AbortController yok; native'de sonsuz asılı spinner (custom_rest modunda tüm veri katmanı). Kullanıcı-algılanan performans/kararlılık riski.
- Egress maliyeti ve batarya (native) açısından M3 küçük ama yaygın; M4 nadir ama şiddetli.

---

## 6. En Riskli Modüller (öncelik sırası)

1. **`features/sampling` (SampleFormMobile + core/sampling/policies)** — H1, H2, H3. Para + kontrol atlatma yoğunlaşması. **En yüksek risk.**
2. **`core/offline/syncQueue`** — H4, M1. Sessiz veri kaybı + çift kayıt; sahada offline kullanım kritik.
3. **`features/invoicing/PaymentFormPage`** — M5, L2. Finansal doğruluk + yetim kayıt.
4. **`core/adapters/builtin/SupabaseCRMAdapter` (createOrder)** — M2, L1. Atomiklik + yuvarlama.
5. **`core/adapters/custom-rest` + `core/auth/usePermissions`** — M4, M3. White-label kararlılık + egress.

---

## 7. Teknik Borç (tema bazlı)

- **Atomiklik borcu:** 3 ayrı akışta (numune, sipariş, tahsilat) aynı "çok-adımlı client yazması, telafi yok" deseni. Ortak çözüm: iş-kritik yazmaları tek `SECURITY DEFINER` RPC/transaction'a taşıyan bir kalıp benimsemek.
- **Client→server kural taşıma borcu:** anti-hunter, birim-maliyet, tahsis-doğrulaması sunucuya inmeli.
- **Idempotency boşluğu:** `sample`/`reminder` için `idempotency_key` + unique index yok (order/visit'te var).
- **Yarım kalan işler:** `previousSamplesThisAccount: []` (TODO Sprint 5.5+), `errors.ts` içinde kullanılmayan `TIMEOUT` varyantı (tasarlanmış, uygulanmamış).
- **Yuvarlama standardizasyonu:** sipariş/fatura tek `round2` (veya decimal.js) disiplinine geçmeli.

---

## 8. Önerilen İş Sırası

**Faz A — Yayın-blocker (bu sprint):**
1. H4 — offline `syncing→pending` reaper (küçük, veri kaybını durdurur).
2. H1 + H2 — numune yazımını tek atomik RPC'ye taşı; maliyeti zorunlu/sunucu-türetimli yap, kota RPC'sini koşulsuz çağır.
3. H3 — anti-hunter geçmişini besle (RPC) + ideal olarak sunucu zorlaması.

**Faz B — Finansal doğruluk (takip sprint):**
4. M5 — tahsis ≤ fatura kalanı doğrulaması + DB CHECK constraint.
5. M2 — createOrder'ı atomik yap (RPC veya itemsErr rollback).
6. L2 — çek/senet + ödeme atomikliği.

**Faz C — Kararlılık & performans:**
7. M1 — processQueue mutex + sample/reminder idempotency index.
8. M4 — custom REST fetch timeout/AbortController.
9. M3 — usePermissionCached deps düzeltmesi.
10. L1 — sipariş/fatura yuvarlama birleştirmesi.

**İlke:** Faz A tamamen "veri kaybı + para + kontrol atlatma"ya odaklı; hiçbiri büyük refactor gerektirmiyor ama etki yüksek. Atomiklik çözümleri için tek bir RPC-kalıbı belirleyip üç akışta tekrar kullanmak, teknik borcu kalıcı azaltır.
