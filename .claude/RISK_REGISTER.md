# RISK REGISTER — NAV (dent-route / saha)

> Kaynak: discovery-facts (kod kanıtı) + doğrudan repo okuması. Her risk: **Olasılık × Etki → Azaltma**.
> Etiketler: **FACT** (kodda görüldü) / **VARSAYIM** (doğrulanmadı). Öncelik = Olasılık × Etki.

Şiddet skalası: Düşük / Orta / Yüksek / Kritik.

---

## A. GÜVENLİK

| # | Risk | Olasılık | Etki | Azaltma |
|---|------|----------|------|---------|
| S1 | **`capacitor.config.ts` `webContentsDebuggingEnabled:true`** (FACT, yorumda "test bitince false"). Release'de açık kalırsa ADB/USB ile WebView debug → localStorage token okunur. | Orta | **Kritik** | Release gate'ine ekle (RELEASE_CHECKLIST §1). Teslim öncesi `false`. Build script'inde native-release'de zorla kapat. **TESLİM-BLOCKER.** |
| S2 | **`.env.production` repoda commitli** — canlı anon key + Mapbox public token gömülü (CI'da da hardcoded). (FACT) Anon "client-safe" ama Mapbox token URL-restrict değilse abuse. | Yüksek | Orta | Mapbox token'a URL/referrer restriction uygula + kullanım alarmı. Buraya asla secret/service_role ekleme. Rotasyon planı. |
| S3 | **Ortak Supabase projesi** (`rranpzicmhgfupgabgbi`) web+parla+NAV üçü ortak (FACT). RLS/rol hatası tüm ekosistemi kırar; rol-casing yakın zamanda düzeltilmiş = kırılgan alan. | Orta | **Kritik** | Her RLS/rol/şema dokunuşunda §2 gate. `saha_` prefix + idempotent. Değişikliği üç uygulama açısından değerlendir, onay al. Case-insensitive rol koru. |
| S4 | Server-only key'lerin (`MAPBOX_SECRET_TOKEN`, `GOOGLE_PLACES_API_KEY`) yanlışlıkla client'a sızması. | Düşük | Yüksek | Bu key'ler yalnız edge function env'inde; `.env.example` uyarısı korunur. Kod review'da grep. |

---

## B. CI / DEPLOY

| # | Risk | Olasılık | Etki | Azaltma |
|---|------|----------|------|---------|
| D1 | **`deploy-migrations` job `ON_ERROR_STOP` KAPALI + best-effort** (FACT, yorumda kabul). Bozuk migration sessizce atlanır, **CI yeşil kalır** → şema-drift gizli. | Yüksek | Yüksek | "CI yeşil ≠ migration uygulandı" kuralı. Her migration'ı Supabase'de manuel/MCP ile teyit (`list_migrations`/tablo kontrolü). Kritik migration'lar için ayrı doğrulama adımı. |
| D2 | **`saha:check-migrations` continue-on-error + lint non-blocking (max-warnings 25)** (FACT) → kalite gate'leri gevşek, regresyon kaçar. | Orta | Orta | Yeni warning ekleme; kritik dosyalarda lint'i lokal zorunlu tut. Migration check çıktısını gerçekten oku. |
| D3 | **İki deploy hedefi + OTA** — web (Cloudflare) ile native/OTA bundle sürüm uyumsuzluğu; OTA yanlış bundle iterse canlı cihazlar bozulur. | Orta | Yüksek | §5 OTA gate: yalnız web-bundle değişiminde OTA, native değişimde APK. Yayın sonrası cihaz doğrulaması + geri-alma bundle hazır. |
| D4 | Service worker / query-persist cache bayatlaması (buster `v0.2.0`) — format değişince kullanıcı eski veri görür. | Orta | Orta | Şema/format değişiminde persist buster bump. `_headers` sw.js no-cache korunur. |

---

## C. TEKNİK BORÇ

| # | Risk | Olasılık | Etki | Azaltma |
|---|------|----------|------|---------|
| T1 | **Repo kirli** (FACT): `saha-app.zip`, `.adb-screen.png`, `.adb-ui.xml`, `data-legacy/`, `__wt_diff.txt`, çift `vite.config` (.ts+.js+.d.ts derlenmiş), commitli `dist/`, derlenmiş `.js/.d.ts` script kopyaları. Build artefaktları versiyonlanmış. | Yüksek | Düşük→Orta | `.gitignore` sıkılaştır; artefaktları git'ten çıkar (izole commit, onayla). Yanlış dosya import edilme riskini azaltır, repo boyutunu düşürür. |
| T2 | **clinic-scan edge fn v1/v2/v3 paralel** (FACT) → ölü-kod, hangisi canlı belirsiz, yanlış sürüm çağrılabilir. | Orta | Orta | Aktif sürümü tespit et (router/çağrı noktası), ölüleri işaretle/kaldır (onayla). Tek kaynak. |
| T3 | **İki şema dünyası**: greenfield (`accounts/products` generic) vs canlı (`saha_clinics`). Adapter canlıya bağlı. **VARSAYIM: greenfield deploy edilmedi (white-label hedefi).** Parite doğrulanmadı. | Orta | Yüksek | Greenfield ile prod parite doğrulanana kadar white-label "hazır" deme. `sync_queue` tablosunun canlı varlığını teyit et (VARSAYIM). |
| T4 | **`router.tsx` ~580 satır tek dosya, ~50 rota** `ProtectedRoute>AppShell` boilerplate tekrarı (FACT) → bakım maliyeti, kopyala-yapıştır RBAC hatası. | Orta | Orta | Rota tanımını data-driven tabloya çıkarma (izole refactor, testli). RBAC gate'lerini merkezileştir. |
| T5 | **Persist allow-list yanlış kullanımı** — finansal/volatile listeler (cari/fatura/order/bakiye) bilinçli persist DIŞI (FACT); yanlışlıkla eklenirse bayat finansal veri gösterilir. | Düşük | Yüksek | `PERSIST_ALLOW_PREFIXES`'e finansal query ekleme. Review'da kontrol. |

---

## D. GÖZLEMLENEBİLİRLİK / DOĞRULAMA (VARSAYIM ağırlıklı)

| # | Risk | Olasılık | Etki | Azaltma |
|---|------|----------|------|---------|
| O1 | **NAV'da hata izleme (Sentry) kurulu mu belirsiz** (VARSAYIM; MEMORY'de web/backend Sentry var, NAV kodu görülmedi). Kuruluysa görünürlük yok → prod hatalar sessiz. | Orta | Yüksek | NAV'da Sentry varlığını **doğrula**. Yoksa kur (frontend + edge fn) veya "izleme yok" riskini açıkça belirt. |
| O2 | **Test kapsamı gerçek durumu ölçülmedi** (VARSAYIM; vitest/playwright config var, geçme oranı/kapsam bilinmiyor). | Orta | Orta | Yayın öncesi testleri gerçekten çalıştır, geçme oranını gör. Kritik akışlara (adapter, RBAC, offline senkron) test ekle. |
| O3 | **Offline-first veri kaybı** — `syncQueue` çakışma/tekrar/sıra hatası (VARSAYIM: iç mantık doğrulanmadı). Kötü ağda sipariş/ziyaret kaybı. | Orta | Yüksek | syncQueue idempotency + çakışma stratejisini kod-review + testle doğrula. `sync_queue` tablo şeması teyit. |
| O4 | **Numune suistimal motoru (core/sampling: hunter-detection/quotas/roi)** yanlış-pozitif/negatif → yanlış bloke veya bütçe sızıntısı (VARSAYIM: iç mantık doğrulanmadı). | Düşük | Orta | Policy/quota eşiklerini gerçek veriyle doğrula; `sample-roi-compute` edge fn çıktısını izle. |

---

## Öncelik Özeti (ilk ele alınacaklar)

1. **S1** (webContentsDebuggingEnabled) — teslim-blocker, tek satır, yüksek etki.
2. **S3 / D1** — ortak DB + sessiz migration drift; her DB dokunuşunda disiplin.
3. **O1** — NAV Sentry durumunu netleştir (görünürlük).
4. **S2** — Mapbox token restriction + .env.production hijyeni.
5. **T3** — greenfield/prod parite (white-label iddiasından önce).
