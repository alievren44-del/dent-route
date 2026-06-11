# DentRoute (saha-app) — CRM/ERP Test, Bug & Geliştirme Planı

Tarih: 2026-06-07
Repo: `C:\Users\PC\Desktop\navigasyon` (pkg `saha-app`) — saha satış CRM, Capacitor Android.
Backend: Supabase (e-ticaret `parladisdeposu.com` ile paylaşımlı). Web kaynak: `C:\Users\PC\Desktop\web sitesi`.

---

## BÖLÜM A — Telefonda raporlanan 6 bug (kök neden + fix)

### Bug 1 — İlçe otomatik mod: 1. 12'lik rota bitince 2. 12'ye geçememe
**Kök neden:** Düz `MAX_BASKET = 12` kesme (truncation), batch/sayfa kavramı yok. 13+ klinikler kalıcı siliniyor.
- `src/features/routes/store/routeBasketStore.ts:14` → `MAX_BASKET = 12` (dolunca `add()` reddediyor).
- `src/features/routes/pages/DistrictAutoRoutePage.tsx:226` → `routeState.ordered.slice(0, MAX_BASKET)` — 13+ atılıyor; `sendToBasket` önce `basket.clear()` yapıyor (satır 224) → 2. batch imkânsız.
- `src/features/routes/pages/RoutePlannerPage.tsx:116/212` → tekrar `slice(0,12)` / `slice(0, DRIVING_MAX_STOPS=11)`.

**Fix:** İlçe sıralı listesinin tamamını "pending district queue" store'da tut; batch cursor (`batchStart`) ekle. Aktif rota bitince "Sonraki 12" → `slice(batchStart, batchStart+12)` ile sepeti yeniden doldur. (Orta iş — yeni state + buton.)

### Bug 2 — Rotadan klinik silememe
**Kök neden:** Aktif rota görünümünde remove-stop handler/buton yok; `saha_routes.account_ids` oluşturulduktan sonra hiç güncellenmiyor.
- `src/features/routes/pages/ActiveRoutePage.tsx:533-601` → stop satırında sadece "Ara" + "Not Yaz" var, sil yok.
- `routeBasketStore.remove()` (store:74) sadece localStorage sepetine etki ediyor, aktif rotaya bağlı değil.

**Fix:** Her stop'a "Kaldır" butonu + handler: `supabase.from('saha_routes').update({ account_ids: newIds }).eq('id', route.id)` → `['active-route', id]` invalidate. Silinen stop `currentStopIndex`'ten önceyse index'i ayarla. (Küçük iş.)

### Bug 3 — Cari klinik ekleyememe
**Kök neden:** Migration timestamp sıralama hatası. `sales_rep_id` kolonu tablodan önce ALTER ediliyor → kolon hiç oluşmuyor → INSERT `PGRST204 column does not exist` ile patlıyor.
- INSERT payload: `src/features/invoicing/pages/CariListPage.tsx:494` `sales_rep_id`.
- Kolon ekleyen: `supabase/migrations/20260528000009_saha_cari_sales_rep.sql:10` (May 28).
- Tablo oluşturan: `supabase/migrations/20260603000001_saha_invoicing.sql:53` (June 3). Lexicografik sıra → ALTER önce çalışıp "relation does not exist" alıyor (`IF NOT EXISTS` tabloyu değil kolonu koruyor).

**Fix (anında hotfix):** Canlı DB'de çalıştır:
```sql
ALTER TABLE public.saha_cariler ADD COLUMN IF NOT EXISTS sales_rep_id uuid
  REFERENCES public.profiles(id) ON DELETE SET NULL;
```
**Kalıcı:** migration'ı `20260603000003_...` olarak yeniden adlandır veya ALTER'i `20260603000001` içine taşı. (Küçük iş.)

### Bug 4 — Hekim kartına not ekleyememe
**Kök neden:** Özellik hiç yok. `CustomerDetailPage.tsx` sadece overview/visits/samples tab'ları (191-194); not formu/butonu/mutasyonu yok. `saha_account_notes`/`saha_clinic_notes` tablosu yok. Tek not yolu visit-scoped (`saha_visits.notes`).
**Fix:** Yeni tablo `saha_account_notes (id, account_id, rep_id, body, created_at)` + RLS (`rep_id=auth.uid() OR role IN ('ADMIN','MANAGER')`). `CustomerDetailPage`'e "Notlar" tab + ekle-formu; opsiyonel `ClinicCard` hızlı not. (Orta iş — tablo + UI.)

### Bug 5 — Kliniklerden rotaya ekleme (eksik/gizli)
**Kök neden:** Inline "Ekle" butonu mevcut müşterilerde gizleniyor.
- `src/features/discovery/components/ClinicCard.tsx:77` → `showAdd = !isExistingCustomer && typeof onAdd === 'function'`.
- `src/features/customers/pages/CustomerListPage.tsx:743` → her satıra `isExistingCustomer` (hep true) geçiliyor → Klinikler listesinde "Ekle" hiç görünmüyor (sadece gizli "Çoklu Seçim" yolu var).

**Fix:** `ClinicCard.tsx:77` → `showAdd = typeof onAdd === 'function'` (existing-customer rozetini add gate'inden ayır). Data yolu (`row.id`) zaten çalışıyor. (Küçük iş.)

### Bug 6 — Numune verme: ürün adları gelmiyor
**Kök neden:** `products` tablosunda olmayan 2 kolon SELECT ediliyor → PostgREST 400 → tüm sorgu patlıyor → dropdown boş.
- `src/features/sampling/components/SampleFormMobile.tsx:339` → `.select('id, name, unit_cost_tl, category_key')`. `unit_cost_tl` ve `category_key` `products`'ta YOK (onlar `saha_sample_lines`/`saha_sample_policies` kolonları).
- Doğru kolonlar: `id, name, base_price, sale_price, category_id, main_image` (bkz `SupabaseCRMAdapter.ts:564`).

**Fix:** SELECT'i `id, name, sale_price, base_price, category_id` yap; `ProductRow` tipini ve fiyat/kategori map'ini güncelle (628-639). En temiz: direkt `supabase.from('products')` yerine `SupabaseCRMAdapter.searchProducts()` kullan. (Küçük iş.)

**Bug özet sıra (kolay→zor):** 6, 3, 5, 2 → 4 → 1.

---

## BÖLÜM B — Mevcut sistem haritası (ne var / ne eksik)

### CRM (var, olgun)
Discovery (Google Places saha tara), Routes (rota planlayıcı, 2-opt, koridor, ilçe-oto, aktif/atanmış), Visits (GPS check-in, ziyaret formu, timeline), Sampling (numune form/list, hunter detection, ROI), Orders (sipariş + onay akışı), Customers (liste/detay), Rep-ops (tahsilat, görev, günlük not), Notifications, Map (Mapbox), Admin (scan job, CSV/XLSX import, bölge atama, heatmap, kullanıcılar).

### ERP (kısmi/eksik)
| Yetenek | Durum |
|---|---|
| Cari/AR defteri | **Var** — saha_cariler, faturalar, ödemeler, çek/senet, kredi limiti |
| Fatura/e-Fatura | **Kısmi** — iç fatura+PDF var; **e-Fatura GİB STUB** (mali mühür/XAdES/entegratör yok) |
| Tahsilat/ödeme | **Var** (nakit/çek/havale/kart) |
| Sipariş→Fatura→Stok (order-to-cash) | **Kopuk** — sipariş cari/faturaya otomatik işlemiyor; kampanya/iskonto motoru yok, %20 KDV sabit |
| Stok/envanter | **YOK** — stock sadece okunuyor, hareket/rezervasyon/düşüm yok |
| Muhasebe/GL | **YOK** — sadece AR alt-defteri |
| Raporlama/BI | **Kısmi** — admin dashboard + heatmap + ROI; konsolide finans BI yok |
| Satınalma/tedarikçi | **YOK** (sadece satış tarafı) |

### Teknik borç
- Adapter pattern bypass: 56 dosyada 158 direkt `supabase.from()` çağrısı → kontratsız, test edilemez veri katmanı.
- `CustomRESTAdapter` skeleton (Logo/Mikro ERP yolu için, henüz çalışmıyor).
- Offline/sync zayıf: write-only outbox, 4 op, pull-sync/conflict yok.
- `core/geolocation`, `core/storage`, `core/sync` boş (.gitkeep).
- QR placeholder (Google Charts URL).

---

## BÖLÜM C — Referans uygulamalar (kıyas)

**Saha satış / SFA:** Repsly, SPOTIO, Outfield, Badger Maps (rota optimizasyon), Map My Customers.
**Türkiye saha + ERP entegre:** Logo Mobil Satış, Mikro Jump Saha, Netsis Saha, Paraşüt (ön muhasebe/e-fatura), Nebim V3.
**E-Fatura entegratör:** Foriba/Sovos, Mükellef, EDM, Uyumsoft, İzibiz, Paraşüt API.

**DentRoute'ta eksik olan referans-standart özellikler:**
1. Rota optimizasyon batch/çoklu gün (Badger/Repsly) — *Bug 1 bunun parçası*.
2. Müşteri 360 kart: not/aktivite zaman çizelgesi, dosya ekleri (Repsly/SPOTIO) — *Bug 4*.
3. Stok görünürlüğü + sipariş anında stok düşümü (Logo/Mikro).
4. Order-to-cash zinciri: sipariş→irsaliye→fatura→tahsilat→cari (her ERP).
5. Gerçek e-Fatura/e-Arşiv (entegratör).
6. Hedef/kota & performans paneli (Repsly KPI).
7. Offline-first tam senkron (saha şart).

---

## BÖLÜM D — Aşamalı yol haritası

### Sprint 0 — Bug fix + stabilizasyon (1 hafta) ← ŞİMDİ
6 bug (Bölüm A). Cari kolon hotfix DB'de. Telefon regresyon testi.

### Sprint 1 — CRM tamamlama (2 hafta)
- Müşteri notları (Bug 4 tablo) + aktivite timeline birleştir.
- Rota batch/çoklu gün (Bug 1 tam çözüm) + rotadan sil (Bug 2).
- Adapter'a `listCustomers/getCustomer/createCustomer/updateCustomer` ekle, direkt çağrıları kademeli adapter'a taşı.
- Offline pull-sync + read cache (saha kritik).

### Sprint 2 — ERP order-to-cash (3 hafta)
- Sipariş→fatura→cari otomatik posting (server-side total + KDV/iskonto doğrulama).
- Kampanya/fiyat listesi motoru (web backend'le paylaş).
- Stok modülü: stock_movements tablosu, sipariş onayında düşüm/rezervasyon.

### Sprint 3 — e-Fatura + entegrasyon (2-3 hafta)
- Entegratör seç (Paraşüt/Mükellef/İzibiz) → gerçek e-Fatura/e-Arşiv (mali mühür).
- `CustomRESTAdapter` ile Logo/Mikro köprü (opsiyonel).

### Sprint 4 — BI + KPI (1-2 hafta)
- Konsolide satış/finans dashboard, rep hedef-kota takibi, tahsilat yaşlandırma (aging) raporu (kısmen var).

---

## BÖLÜM E — Test planı (regresyon checklist)
- [ ] İlçe-oto: 24+ klinikli ilçe → batch 1 bitir → batch 2 gelmeli.
- [ ] Aktif rotadan stop sil → liste + DB güncellenmeli.
- [ ] Cari ekle → kayıt başarılı (kolon hotfix sonrası).
- [ ] Müşteri/hekim kartına not ekle → kalıcı.
- [ ] Klinikler listesinde her kartta "Rotaya Ekle" görünür.
- [ ] Numune formu ürün arama → adlar + fiyat geliyor.
- [ ] Offline aç → ziyaret/numune/sipariş → online olunca senkron.
