# 05 — Test Akışı (her PROMPT sonrası doğrulama)

Plan **BÖLÜM 5** ile aynı, her PROMPT için doğrulama adımları kopyalandı + Claude'un kod yazımında bıraktığı eksikler eklendi.

## Genel pre-flight (her test öncesi)

```bash
npm run typecheck && npm run lint && npm test
```

Sıfır hata yoksa Claude'a "şu hatalar çıktı, düzelt" diyerek geri ver.

## PROMPT-1 — Admin Bootstrap

- [ ] `npm run saha:check-setup` → tüm satırlar ✓
- [ ] `npm run saha:create-admin` → admin oluşturulabildi
- [ ] Veya: http://localhost:5173 → "İlk Admin Kurulumu" linki sadece profiles boşsa görünür
- [ ] Admin login → /admin/dashboard erişimi var

## PROMPT-2 — Sivas XLSX import

- [ ] `/admin/clinics` sayfası XLSX kabul ediyor
- [ ] Sheet seçim dropdown geliyor
- [ ] Kolon eşleştirme önerisi otomatik (örn `Klinik` → `name`)
- [ ] Önizleme 5 satır tabloda
- [ ] "İçe Aktar" sonrası SQL: `SELECT count(*) FROM saha_clinics WHERE source = 'legacy_import_sivas'` → 130+
- [ ] CLI versiyonu: `npm run saha:import-sivas`

## PROMPT-3 — Kategori filtresi

- [ ] `npm test -- clinic-filters` → tüm testler geçer
- [ ] `npx supabase functions deploy clinic-scan`
- [ ] Yeni `/admin/clinic-scan` → Ankara/Etimesgut tarama
- [ ] Response'ta `filtered_out: N` görünüyor
- [ ] DiscoveryPage'de "Güzellik Salonu", "Ortopedi", "Eczane" kayıtları YOK

## PROMPT-4 — Sepet

- [ ] DiscoveryPage'de "Ekle" tıklayınca yeşil toast
- [ ] BottomNav'da Rota ikonu üzerinde kırmızı sayı badge
- [ ] Aynı klinik tekrar eklenince "zaten sepette"
- [ ] Sayfa yenilenince sepet kaybolmuyor (localStorage)
- [ ] Sepet 12'ye dolunca "Sepet dolu" mesajı
- [ ] RoutePlannerPage sepetten okuyor, ?ids= çalışmıyor

## PROMPT-5 — Rota Export

- [ ] RoutePlanner optimize sonrası 4 buton: Google Maps / QR / Paylaş / Kopyala
- [ ] "Google Maps" yeni tabda Maps açıyor + rota gösteriyor
- [ ] "QR Kod" modal → telefonla taranabilir
- [ ] "Paylaş" — Android: native share sheet, Web: navigator.share fallback
- [ ] "Kopyala" → clipboard
- [ ] 10+ durakta birden fazla URL parçası uyarısı

## PROMPT-6 — Batch Scan

- [ ] `/admin/clinic-scan` 5 sekme: Tek İlçe / Tüm İl / Bölge / Türkiye / Aktif Job'lar
- [ ] "Tüm İl: Sivas" → 17 ilçe sırayla taranır
- [ ] Aktif Job'lar sekmesinde progress bar canlı güncellenir (5s refetch)
- [ ] Duraklat / Devam Et / İptal butonları çalışır
- [ ] Job tamamlanınca DiscoveryPage yeni klinikleri gösterir
- [ ] Realtime channel subscribe çalışıyor (Network → WS → supabase channel)

## PROMPT-7 — OSM

- [ ] `npx supabase functions deploy osm-search`
- [ ] ClinicScanPage'de "Kaynak: Google / OSM / Her ikisi" radio var
- [ ] "OSM" seçili → Google API çağrısı YOK (Network tab kontrol)
- [ ] "Her ikisi" → hem Google hem OSM çağrısı, dedup edilmiş tek liste
- [ ] saha_clinics.sources alanı `{google,osm}` olarak görünüyor

## PROMPT-8 — Check-in

- [ ] `/visits/check-in/<account-id>` müşteri adı + adres gösterir
- [ ] GPS izni iste → kabul → mesafe metre cinsinden gösterilir
- [ ] Mesafe ≤200m → yeşil banner
- [ ] Mesafe 200-2000m → sarı uyarı (tekrar tıklayınca geçer)
- [ ] Mesafe >2000m → kırmızı, check-in engellenir
- [ ] Başarılı check-in → /visits/{visit_id} yönlendir

## PROMPT-9 — Ziyaret Formu

- [ ] Outcome chip'leri dental için 5 adet
- [ ] Fotoğraf yükle + kategori seç (Vitrin/Raf/Fiyat Etiketi/Diğer)
- [ ] Resize çalışıyor (1600px max, dosya boyutu küçük)
- [ ] Supabase Storage `visit-photos` bucket'a yüklendi
- [ ] "Kaydet" → outcome'a göre yönlendirme:
  - "Sipariş alındı" → /orders/new?customer_id=
  - "Numune verildi" → /samples?tab=new&customer=
  - Diğer → /clinics/{id}

## PROMPT-10 — Ziyaret Geçmişi

- [ ] /history sekmeler: Bugün / Hafta / Ay / Tümü
- [ ] Outcome multi-select filtre
- [ ] Sayfa scroll'da infinite load
- [ ] Detay modal → tüm bilgi + foto lightbox
- [ ] CustomerDetailPage "Ziyaret Geçmişi" sekmesi timeline

## PROMPT-11 — Müşteri Listesi

- [ ] /clinics → tüm müşteriler listelendi
- [ ] Filtre paneli collapse + tüm filtreler çalışır
- [ ] URL'de query params yansır (?search=...&province=ankara)
- [ ] Çoklu seçim → "Seçilenleri Rotaya Ekle" max 12
- [ ] Excel export çalışıyor

## PROMPT-12 + 13 — Cari + Fatura + Ödeme + Çek

- [ ] /invoicing/cari → cari listesi
- [ ] Yeni cari → cari_kodu otomatik (CR-2026-00001)
- [ ] Fatura kes → kalemler + KDV + toplam otomatik
- [ ] PDF indirme çalışıyor
- [ ] UBL XML stub üretiliyor
- [ ] Ödeme kaydet → fatura.odenen otomatik update (trigger)
- [ ] Çek/senet portföyde görünüyor
- [ ] Vade 7 gün içindeyse bildirim oluştu (notifications tablosu)

## PROMPT-14 — Admin Users

- [ ] /admin/users → kullanıcı listesi
- [ ] "Yeni Kullanıcı" modal → admin-create-user Edge Function çağrısı
- [ ] Rol değiştirme çalışıyor
- [ ] Şifre sıfırla → magic link üretildi
- [ ] Bölge atama matrix çalışıyor

## PROMPT-15 — Order + Balance + Onay

- [ ] 5000 TL üstü sipariş → status='approval_pending'
- [ ] Manager /orders/approval sayfasında onaylayabilir
- [ ] Onay sonrası stock_movements trigger çalıştı
- [ ] CustomerDetailPage'de bakiye + kredi limit progress bar
- [ ] Bakiye = sum(faturalar.toplam - odenen)
