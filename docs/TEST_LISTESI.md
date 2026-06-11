# DentRoute — Tam Test Listesi (Sprint 0–4)

Telefon: kablo bağlı, debug APK kurulu. **ÖNCE** canlı DB SQL'lerini çalıştır (yoksa Sprint 2/4 kısımları çalışmaz):
1. `docs/HOTFIX_LIVE_DB.sql` (Sprint 0: cari kolon + notes) — zaten çalıştırıldıysa atla.
2. `docs/HOTFIX_LIVE_DB_SPRINT234.sql` (stock_movements + order-to-cash + rep_targets).
Doğru proje: `rranpzicmhgfupgabgbi` (SQL Editor sol üst proje adı kontrol).

Rol notu: BI/KPI/Stok/Yaşlandırma/Cari sayfaları **admin** rolü ister. Admin hesapla gir.

---

## SPRINT 0 — 6 bug

- [ ] **B1 İlçe oto rota batch:** 24+ klinikli ilçe seç → İlçe Otomatik Rota → sepete aktar → 1. 12'lik rotayı başlat/bitir → aktif rota ekranında **"Sonraki N kliniğe geç"** çıkıyor → bas → 2. grup sepete geliyor.
- [ ] **B2 Rotadan klinik sil:** Aktif rota → bir durakta **"Kaldır"** → onayla → durak listeden + DB'den gidiyor, ilerleme bozulmuyor.
- [ ] **B3 Cari ekle:** Cariler → Yeni Cari → ünvan vs gir → Kaydet → **başarılı** (önce "oluşturulamadı" veriyordu).
- [ ] **B4 Hekim/klinik notu:** Müşteri Listesi → bir klinik → **Notlar** sekmesi → not yaz → Ekle → kalıcı, listede görünüyor.
- [ ] **B5 Klinikten rotaya ekle:** Müşteri Listesi → her klinik kartında **"Ekle"** butonu görünüyor → bas → sepete ekleniyor ("Sepette" oluyor).
- [ ] **B6 Numune ürün adı:** Numune → yeni numune → ürün ara → **ürün adları + fiyat geliyor** (boş değil).

---

## SPRINT 1 — CRM tamamlama

- [ ] **Aktivite timeline:** Müşteri kartı → **Zaman Çizelgesi** sekmesi → not + ziyaret + numune **tek akışta, tarihe göre tersten** sıralı. (Sipariş kasıtlı yok.)
- [ ] **Adapter müşteri listesi:** GPS kapalıyken Müşteri Listesi yükleniyor (adapter fallback) — isim/telefon/adres doğru.
- [ ] **Offline okuma:** listeyi bir kez aç → uçak modu aç → uygulamayı kapat-aç → liste **cache'ten geliyor** (boş ekran değil). Uçağı kapat → tazeleniyor.

---

## SPRINT 2 — Order-to-cash + Stok

- [ ] **Sipariş→fatura→cari (ana akış):**
  1. Yeni Sipariş → müşteri seç → ürün ekle → kaydet (onay gerekiyorsa "onay bekliyor" olur).
  2. Onay Bekleyenler → siparişi **Onayla**.
  3. Cariler → o müşterinin carisi **otomatik oluşmuş** (yoksa) → cari detay → **fatura otomatik düşmüş** (tip satış, kalemler sipariş ürünleri, KDV satır bazlı).
  4. Cari bakiyesi faturanın kalan tutarı kadar artmış.
- [ ] **Çift-fatura yok:** aynı siparişi tekrar onaylama denenirse 2. fatura oluşmaz (idempotent).
- [ ] **KDV doğru:** quote/fatura KDV'si ürünün `tax_rate`'ine göre (sabit %20 değil, ürün farklıysa farklı).
- [ ] **Stok defteri:** Yönetici → **Stok Defteri** → sipariş onayı sonrası **stok hareketi (negatif, 'sale')** kaydı görünüyor. "Mevcut Stok" listesi okunuyor (düşük stok kırmızı). NOT: paylaşımlı web stoğu CRM'den düşürülmüyor — sadece ledger kaydı.

---

## SPRINT 3 — e-Fatura (İSKELET — canlı GİB YOK)

- [ ] **UBL üret + durum yaz:** Fatura detay → **E-Fatura XML** → XML iniyor + faturaya `efatura_durum='manual_generated'` + `efatura_uuid` yazılıyor (sayfa yenileyince durum görünür).
- [ ] **Config:** `config/.saha-config.json` einvoice.provider yoksa varsayılan 'manual' çalışıyor, hata vermiyor.
- ⚠️ **Canlı GİB gönderimi / mali mühür / entegratör (Paraşüt/İzibiz...) YOK** — dış ücretli hesap gerekir. Test edilemez (beklenen).

---

## SPRINT 4 — BI / KPI / Yaşlandırma (admin)

- [ ] **BI Panosu:** Yönetici → **BI Panosu** → 30/90 gün toggle → grafikler doluyor: sipariş trendi, plasiyer bazlı satış, ziyaret durumu pie, tahsilat trendi + stat kartlar (toplam satış/tahsilat/açık alacak/ziyaret).
- [ ] **Plasiyer KPI:** Yönetici → **Plasiyer KPI** → ay seç → her plasiyer için gerçekleşen vs hedef (ziyaret/sipariş TL/tahsilat) ilerleme çubukları. Admin **hedef gir** (rep+ay+hedefler) → kaydet → tablo güncelleniyor.
- [ ] **Alacak Yaşlandırma:** Sipariş & Fatura → **Alacak Yaşlandırma** → açık faturalar 0-30/31-60/61-90/90+ kovalarına bölünmüş, stat kartlar + grafik + cari bazlı tablo.

---

## Genel / regresyon

- [ ] App açılış, login, menü (NavDrawer) yeni girişler görünüyor (admin'de Stok/BI/KPI/Yaşlandırma).
- [ ] Mevcut akışlar bozulmamış: harita, çevredeki klinikler, ziyaret check-in, numune, sipariş, cari/fatura.
- [ ] Sorun çıkarsa: telefon kabloyla bağlıyken logcat alınabilir (`adb logcat`), bana hata mesajını ilet.
