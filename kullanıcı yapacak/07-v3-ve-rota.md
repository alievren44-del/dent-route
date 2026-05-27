# 07 — clinic-scan-v3 (Akıllı Tarama) + ScanRoutePlanner (Rota)

PROMPT-16 sonrası yeni motor + rota planlayıcı.

## clinic-scan-v3 — Akıllı Tarama Motoru

Mevcut v1 (hızlı, basit) ve v2 (grid + keyword) yanına 3. motor eklendi.

### Farklar

| Özellik | v1 | v2 | **v3 (yeni)** |
|---------|-----|-----|---------------|
| Grid noktası | 1 | 9-13 | tier-based 5-49 (MEGA = 49 exhaustive) |
| Sorgu çeşitliliği | 1 type | 1 type + 0-4 keyword | 8 hedefli text + 7 uzmanlık + 2 nearby × grid |
| Mahalle bazlı sorgu | Hayır | Hayır | **Evet** (OSM Overpass enum) |
| KAMU segment | Hayır | Hayır | **Evet** (ADSM/devlet hastanesi ayrı) |
| DoktorTakvimi | Hayır | Hayır | **Evet** (opsiyonel source='all') |
| Türkçe-aware dedup | Hayır | Hayır | **Evet** (150m haversine + ASCII fold) |
| Tahmini maliyet/ilçe | $0.5 | $3-12 | $3-8 (standard) / $8-15 (exhaustive) |

### Kullanım

`/admin/clinic-scan` → Motor: **v3** (default).

3 yoğunluk:
- **standard**: tier/2 grid (örn MEGA → 17). Hızlı, çoğu ilçe için yeterli.
- **deep**: tier tam (MEGA → 35). Pilot iller için.
- **exhaustive**: tier × 1.4 + DoktorTakvimi (MEGA → 49). Sadece kritik iller.

Source:
- **all** (önerilen): Google + OSM + DoktorTakvimi
- google: sadece Google Places
- osm: sadece OpenStreetMap
- doktor_takvimi: sadece DoktorTakvimi scrape (test için)

### Yeni sayfalar

- `/admin/route-planner` — tarama sonrası rota planlayıcı (NN-TSP + 2-opt + Excel export)

### DoktorTakvimi notu

DoktorTakvimi.com'un HTML yapısı zamanla değişebilir. Eğer "no_cards_found" hatası tekrar görürsen Claude'a haber ver — selector güncellemesi yapılır.

## ScanRoutePlanner — Rota Planlayıcı

Tarama bittikten sonra seçili kliniklerden optimize tur Excel'i.

### Trigger yolları

1. **DistrictClinicsDialog** → Mevcut Veritabanı satıra tıkla → klinikleri seç → "Rotaya Çevir"
2. **ScanPreviewDialog** → tarama bitti → "X kaydedildi" toast → "Rota planla?" eylem butonu

### Akış

1. Başlangıç noktası seç:
   - GPS Konumum (geolocation izni)
   - Profilime kayıtlı ev/depo (`profiles.home_lat/lng` — henüz migration yok, sonra eklenecek)
   - Manuel — haritaya tıkla
2. "Optimize Et" — NN greedy + 2-opt local algoritması (50 nokta için ~5sn)
3. Sonuç:
   - Harita: numaralı markerler + polyline
   - Tablo: sıra, klinik, kümülatif km, telefon
   - Stats: toplam km / dk
4. İşlem:
   - **Excel İndir** — 14 sütun + renk kodu (500+ yorum turuncu, 150+ sarı). 2 sheet: Klinikler + KAMU.
   - **Rotayı Sakla** — `saha_routes` tablosuna, `/routes/active/<id>` ile başlat

### Strateji önerisi

- ≤ 12 durak: ileride Mapbox Optimize entegrasyonu (kalite + trafik) — şimdilik local
- 13-50: local NN+2-opt yeterli
- > 50: local NN+2-opt sampled iterations

### Kısıt

- `saha_clinics.clinic_segment` kolonu Phase 2 ile eklendi — KAMU segment ayrımı çalışır.
- `profiles.home_lat/lng` HENÜZ MIGRATION YOK. Eklemek için ayrı PROMPT gerek; şimdilik GPS / manuel kullanılır.
- Excel cell styling SheetJS Community Edition ile sınırlı — eski LibreOffice (<7.x) render eksik olabilir; Excel/Google Sheets'te tam çalışır.
