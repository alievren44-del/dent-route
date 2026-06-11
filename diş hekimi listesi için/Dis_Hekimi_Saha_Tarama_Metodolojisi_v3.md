# Diş Hekimi & Klinik Saha Tarama Metodolojisi v3
## 5-Katmanlı Genişletilmiş Kapsama (Hedef: %95-99 il geneli coverage)

Bu doküman, **Ankara'da v2 ile doğrulanmış** çekirdek metodolojinin üzerine **5 ek katman** ekleyerek %80-90 olan kapsama oranını **%95-99'a çıkarır**. Yeni sohbette başlangıçta Claude'a verildiğinde, kullanıcı düzeltmesine gerek kalmadan il geneli derin tarama yapması hedeflenir.

**v2 → v3 farkı özet:**

| Versiyon | Kapsama | Veri kaynağı | Token maliyeti |
|---|---|---|---|
| v2 (mevcut) | %80-90 | Sadece places_search | 1x |
| **v3 (bu doküman)** | **%95-99** | places_search + grid + DoktorTakvimi + uzmanlık + yorum extract + TDB | 6-8x |

---

## 0. KULLANICIDAN ALINACAK GİRDİLER

1. **İl adı**
2. **Başlangıç/bitiş koordinatı** (lat, lng)
3. **Hangi ilçeler taranacak?** (boş bırakılırsa tüm büyük + orta ilçeler)
4. **B2B bağlamı** (temsilci, ürünler — CRM sütunları için)
5. **Özel kısıtlar** (vefat hekim listesi, ek hariç tutmalar)
6. **YENİ:** Coverage hedefi — `standart` (v2, %85), `genişletilmiş` (3 katman, %92), `tam` (5 katman, %98)

Kullanıcı seçim yapmazsa **default: tam v3** çalıştır.

---

## 1. AMAÇ ve ÇIKTI

**Çıktı dosyaları:**
- Tek ilçe: `{Ilce}_Dis_Hekimi_Rotasi_v3.xlsx` (3 sayfa, 15 sütun — "Kaynak" sütunu eklendi)
- Birleşik: `{IL}_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx` (17 sütun)

**Yeni sütun:** "Kaynak" — `places / grid / dt / spec / yorum-extract / tdb` (hangi katmandan geldi)

---

## 2. İLÇE TESPİT ve BOYUT SINIFLAMASI

(v2 ile aynı — değişiklik yok)

| Sınıf | Tahmin | Bölme |
|---|---|---|
| Çok büyük | 200+ | 4 parça (A/B/C/D) |
| Büyük | 80-150 | 2 batch |
| Orta | 30-80 | 1-2 batch |
| Küçük | <30 | 1 batch |

---

## 3. KATMAN 1 (TEMEL): places_search Sorgu Stratejisi

### 3.1 Çekirdek 8 sorgu (v2'den korunur)

```
1. "diş hekimi muayenehanesi {Ilce} merkez {Il}"
2. "Dt. diş doktoru {Mahalle1} {Ilce} ara sokak"        ← KİLİT (bireysel hekim)
3. "diş kliniği {Mahalle2} {Mahalle3} {Ilce}"
4. "diş hekimi {Mahalle4} {Ilce} Cumhuriyet Caddesi"
5. "diş hekimi {Mahalle5} {Mahalle6} {Ilce}"
6. "ağız diş sağlığı polikliniği {Ilce}"
7. "diş hekimi {Ilce} {Tarihi/Anahtar Cadde}"
8. "diş hekimi 7/24 nöbetçi {Ilce}"
```

`places_search` parametreleri:
```python
places_search(
    location_bias_lat=<ilçe_merkez_lat>,
    location_bias_lng=<ilçe_merkez_lng>,
    location_bias_radius=6000-9000,
    queries=[{"query": "...", "max_results": 8-10} for ...]
)
```

**Çıktı:** Çekirdek aday havuzu (her klinike `source: "places"` ekle)

---

## 4. KATMAN 2 (YENİ - v3): Coğrafi Grid Taraması

**Amaç:** location_bias merkez ağırlıklı olduğu için kenar mahallelerde eksik kalır. İlçeyi grid'e bölüp her grid noktasından ayrı bias = her köşede tam coverage.

### 4.1 Grid oluşturma

1. İlçenin bounding box'ını belirle (kuzey-güney-doğu-batı sınırları).
2. **1.5 km × 1.5 km grid** oluştur (Türkiye'de 1.5km = ~0.0135° enlem, ~0.0175° boylam).
3. Her grid hücresinin merkez koordinatını al.
4. İlçe sınırı içinde kalan grid noktalarını filtrele (sadece o ilçe).

**Tipik grid sayısı:**
- Küçük ilçe (≤15 km²): 6-10 nokta
- Orta ilçe (15-50 km²): 12-25 nokta
- Büyük ilçe (50-150 km²): 25-60 nokta (parça başına 8-15)

### 4.2 Grid bazlı sorgu (her grid noktası için 2 sorgu)

```python
for grid_lat, grid_lng in grid_points:
    places_search(
        location_bias_lat=grid_lat,
        location_bias_lng=grid_lng,
        location_bias_radius=900,   # dar yarıçap — sadece o grid'i kapsar
        queries=[
            {"query": f"diş hekimi", "max_results": 6},
            {"query": f"Dt. diş muayenehanesi ara sokak", "max_results": 6},
        ]
    )
```

**Token verimi:** Grid noktası başına 2 sorgu yeterli (özelleştirilmiş genel ifade + bireysel hekim). Tüm grid bittikten sonra Katman 1 ile birleşmiş self-dedup.

### 4.3 Grid kodu şablonu

```python
def make_grid(north, south, east, west, spacing_km=1.5):
    """İlçe bounding box'ından grid noktaları üret."""
    lat_step = spacing_km / 111.0          # 1° enlem ≈ 111 km
    lng_step = spacing_km / (111.0 * math.cos(math.radians((north+south)/2)))
    pts = []
    lat = south
    while lat <= north:
        lng = west
        while lng <= east:
            pts.append((round(lat, 5), round(lng, 5)))
            lng += lng_step
        lat += lat_step
    return pts

# Örnek (Çankaya-Batı bounding box):
grid = make_grid(north=39.910, south=39.830, east=32.730, west=32.640)
# ~32 grid noktası
```

**Çıktı:** Kenar mahalle klinikleri (`source: "grid"`)

**Beklenen artış:** Mevcut listenin %15-25'i kadar yeni klinik.

---

## 5. KATMAN 3 (YENİ - v3): Uzmanlık-Bazlı Sorgular

**Amaç:** Uzmanlar genelde "Uzm. Dr. Dt." prefix'i kullanır ve farklı sorgularla yakalanır. Genel "diş hekimi" sorgusunda çıkmazlar veya sondan sıralı çıkar.

### 5.1 Standart 7 uzmanlık sorgusu (her ilçe için ek 7 sorgu)

```python
uzmanlik_sorgulari = [
    "ortodonti uzmanı {Ilce}",                          # Tel/braket
    "pedodonti çocuk diş hekimi {Ilce}",                # Çocuk dişçileri
    "endodonti kanal tedavisi uzmanı {Ilce}",           # Kanal tedavisi
    "çene cerrahisi uzmanı {Ilce}",                     # Maxillofacial
    "periodontoloji diş eti uzmanı {Ilce}",             # Diş eti
    "protetik diş tedavisi uzmanı {Ilce}",              # Protez
    "implantoloji uzmanı diş hekimi {Ilce}",            # İmplant
]
```

Her sorguda `max_results: 6-8`. Toplam 7 ek sorgu = 1 batch içinde rahat çalışır.

### 5.2 Uzmanlık etiketleme

Her klinik adında bu anahtar kelimeler varsa otomatik etiket:

| Anahtar | Etiket |
|---|---|
| "ortodonti", "ortodontist" | "UZMAN (Ortodonti)" |
| "pedodonti", "çocuk diş" | "UZMAN (Pedodonti)" |
| "endodonti", "kanal tedavisi" | "UZMAN (Endodonti)" |
| "çene cerrah", "maxillofacial", "oral & maxillo" | "UZMAN (Çene Cer.)" |
| "periodontoloji" | "UZMAN (Periodontoloji)" |
| "protetik" | "UZMAN (Protez)" |
| "implantoloji", "implant" | "UZMAN (İmplant)" (zayıf sinyal, dikkat) |

Uzman etiketli klinikler sarı vurgu alır.

**Çıktı:** Uzmanlık havuzu (`source: "spec"`)

**Beklenen artış:** %5-10 ek klinik, ama bunların B2B değeri **yüksek** (uzman = yüksek hacimli kullanıcı).

---

## 6. KATMAN 4 (YENİ - v3): Doktor Takvimi Cross-Reference

**Amaç:** doktortakvimi.com Türkiye'deki en kapsamlı diş hekimi randevu platformu. Google Maps'te kaydı olmayan ama orada profili olan **50-200 hekim** çıkar.

### 6.1 URL yapısı

```
https://www.doktortakvimi.com/dis-hekimi/<il-slug>/<ilce-slug>
https://www.doktortakvimi.com/dis-hekimi/<il-slug>/<ilce-slug>?sayfa=2
```

Slug kuralı: Türkçe karaktersiz, küçük harf, boşluklar tire (örn: "ankara/cankaya", "izmir/karsiyaka").

### 6.2 Çekme yöntemi

```python
import re
sayfa = 1
hekimler_dt = []
while True:
    url = f"https://www.doktortakvimi.com/dis-hekimi/{il_slug}/{ilce_slug}?sayfa={sayfa}"
    html = web_fetch(url)
    # Hekim kartları için regex (sitenin HTML yapısına göre):
    kartlar = re.findall(r'<article[^>]*class="[^"]*doctor-card[^"]*"[^>]*>(.*?)</article>',
                        html, re.DOTALL)
    if not kartlar:
        break
    for kart in kartlar:
        ad = re.search(r'<h\d[^>]*>(.*?)</h\d>', kart)
        adres = re.search(r'class="[^"]*address[^"]*"[^>]*>(.*?)<', kart)
        uzmanlik = re.search(r'class="[^"]*spec[^"]*"[^>]*>(.*?)<', kart)
        hekimler_dt.append({
            "name": clean_html(ad.group(1)) if ad else "",
            "address": clean_html(adres.group(1)) if adres else "",
            "specialty": clean_html(uzmanlik.group(1)) if uzmanlik else "",
            "source": "dt",
        })
    sayfa += 1
    if sayfa > 30:  # güvenlik: max 30 sayfa
        break
```

**NOT:** Sitenin gerçek HTML yapısı zaman içinde değişebilir. Claude `web_fetch` ile bir sayfa çekip HTML yapısını inceleyip regex'i ona göre kalibre etmeli. **Sabit selector kullanma, dinamik incele.**

### 6.3 Cross-enrichment (Doktor Takvimi → places_search)

Doktor Takvimi'nden gelen kayıtlarda **lat/lng yok**. Bunları rota planına dahil etmek için:

1. Her DT kaydı için isim + adres + ilçe ile `places_search` ile reverse lookup yap:
```python
places_search(queries=[{
    "query": f"{hekim_adi} diş {ilce}",
    "max_results": 3
}])
```
2. En yakın isim+adres eşleşmesi → lat/lng + telefonu al → DT kaydını enrich et.
3. Eşleşme yoksa (Google'da yok) → ilçe merkezine yakın bir tahmini lat/lng ata, "Notlar" sütununa "Konum tahmini — telefon doğrulanmalı" ekle.

**Çıktı:** Doktor Takvimi havuzu (`source: "dt"`)

**Beklenen artış:** %10-20 ek klinik (Google'da olmayan hekimler).

---

## 7. KATMAN 5 (YENİ - v3): Yorum İçi Hekim İsmi Çıkarma

**Amaç:** Bir polikliniğin yorumlarında hastalar genelde tedavi eden hekimin ismini anar: *"Dr. Mehmet Bey çok ilgili"*. Bu hekimler genelde:
- Aynı poliklinikte çalışan asistan/genç hekim → çoğu zaman kendi muayenesini açmaya başlamış (Google'da yeni kayıt)
- Önceden poliklinikten ayrılmış kendi muayenesini açmış

### 7.1 Regex deseni (Türkçe diş hekimi unvanları)

```python
import re

UNVAN_REGEX = re.compile(
    r'(?:^|\s)(?:Uzm\.?\s+)?(?:Prof\.?\s+)?(?:Doç\.?\s+)?(?:Dr\.?\s+)?(?:Dt\.?|Diş Hekimi|hekim|hocam|hoca|teacher|doctor)\.?\s+'
    r'([A-ZÇĞIİÖŞÜ][a-zçğıiöşü]+(?:\s+[A-ZÇĞIİÖŞÜ][a-zçğıiöşü]+){1,3})',
    re.UNICODE
)

# Her klinik için tüm yorumlardaki isimleri çıkar:
all_names = set()
for klinik in places_results:
    for yorum in klinik.get("reviews", []):
        for match in UNVAN_REGEX.finditer(yorum):
            isim = match.group(1).strip()
            # Türkçe normalize edip dedup et
            if 2 <= len(isim.split()) <= 4:    # 2-4 kelimeli ad-soyad
                all_names.add(isim)
```

### 7.2 İsim filtresi (false positive eleme)

Yorumlarda ayrıca hasta isimleri, akraba isimleri vb. geçer. Şu kuralları uygula:

- **Tut:** Unvan + 2-3 kelime ad-soyad (Dr/Dt/Uzm/Prof/Doç prefix'i ile)
- **At:** Sadece tek ad ("Mehmet Bey çok iyiydi")
- **At:** Çok kısa (2 harf altı) ad parçaları
- **At:** Bilinen yer/marka isimleri ("Ankara", "Acıbadem")

### 7.3 Her bulunan isim için places_search reverse lookup

```python
yeni_hekimler = []
for isim in all_names:
    sonuc = places_search(queries=[{
        "query": f"{isim} diş hekimi {ilce}",
        "max_results": 3
    }])
    if sonuc and check_match(sonuc, isim, ilce):
        yeni_hekimler.append({...source: "yorum-extract"})
```

**Önemli:** Her isim aynı sorgu olmasın — token israfı. Önce dedup yap (aynı isim birden çok yorumda).

**Çıktı:** Yorum çıkarımı havuzu (`source: "yorum-extract"`)

**Beklenen artış:** %3-8 ek klinik (genelde bağımsız çalışmaya başlamış genç hekimler).

---

## 8. KATMAN 6 (YENİ - v3): TDB / İl Diş Hekimleri Odası

**Amaç:** Türk Diş Hekimleri Birliği'nin il odalarında **resmi üye listeleri** var. Bu liste %100 kapsayıcıdır — il sınırlarında ruhsatlı her hekim oradadır.

### 8.1 İl odası web siteleri

| İl | URL kalıbı |
|---|---|
| Ankara | https://www.ado.org.tr (Ankara Diş Hekimleri Odası) |
| İstanbul | https://www.ido.org.tr (İstanbul Diş Hekimleri Odası) |
| İzmir | https://www.izmirdiso.org.tr |
| Bursa | https://www.bdo.org.tr |
| Diğer | Google: "{il} diş hekimleri odası üye listesi" |

### 8.2 Çekme stratejisi

Sitelerin yapısı **standart değil**. Üç olası senaryo:

**Senaryo A — Genel HTML liste:**
```python
html = web_fetch("https://www.ado.org.tr/uye-listesi")
# Tablo satırlarını parse et: ad, ünvan, ilçe, telefon, adres
satirlar = re.findall(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL)
# Her satırdan veri çıkar
```

**Senaryo B — PDF listesi:**
Bazı odalar üye listesini PDF olarak yayınlar. `web_fetch` ile PDF URL'i al, sonra **pdf-reading skill** ile içeriği oku.

**Senaryo C — Arama formu (search-only):**
Bazı sitelerde sadece arama formu var, tam liste yok. Bu durumda her ilçe için ayrı arama yap (`?ilce=X` URL parametresi ile).

### 8.3 TDB kayıt enrichment

TDB kaydı genelde **isim + ilçe + telefon** içerir; **lat/lng yoktur, bazen adres bile yetersizdir**. Bunları rota'ya katmak için Katman 4'teki cross-enrichment yöntemi (places_search reverse lookup) uygulanır.

Eşleşme bulunamazsa:
- Telefon TDB'den alınır.
- Adres "İlçe Merkezi" olarak işaretlenir.
- Lat/lng ilçe merkezine yerleştirilir.
- Notlar: **"TDB kaydı — adres doğrulanmalı, telefonla ulaş"**.
- Kaynak: `source: "tdb-unverified"` (rota'ya katılmaz ama listede kalır)

### 8.4 TDB özel değeri

Eğer TDB araması mümkünse, **mevcut tüm havuzları cross-validation** için kullanılır:
- TDB'de olup diğer havuzlarda olmayan kayıtlar = "yeni keşif"
- TDB'de olup diğer havuzlarda olan kayıtlar = doğrulanmış
- TDB'de olmayan kayıtlar = muhtemelen başka ilçeden taşmış / hatalı

**Çıktı:** TDB havuzu (`source: "tdb"` veya `"tdb-unverified"`)

**Beklenen artış:** %5-15 ek klinik (Google + DT'de olmayan, klasik muayene odası tipi).

---

## 9. CROSS-ENRICHMENT ve KAYNAK BİRLEŞTİRME

Tüm 5 katman çalıştıktan sonra havuzlar birleştirilir. **Aynı klinik birden fazla kaynakta** olabilir — bu durumda en zengin kaydı tutup eksik alanları diğer kaynaklardan tamamla.

### 9.1 Birleştirme öncelik sırası

| Alan | Birincil kaynak | İkincil | Üçüncül |
|---|---|---|---|
| lat/lng | places | grid (places) | tahmin (ilçe merkezi) |
| Yorum sayısı | places | grid | 0 |
| Puan | places | grid | - |
| Telefon | places | TDB | DT |
| Adres | places | DT | TDB |
| Uzmanlık | spec | DT | yorum-extract |
| Hekim ismi | places (klinik adı) | yorum-extract | DT |

### 9.2 Dedup mantığı (genişletilmiş)

```python
def merge_records(records):
    """Aynı kliniğin birden fazla kaynaktan gelen kayıtlarını birleştir."""
    # 1. norm(name)[:16] + hav(lat,lng) < 0.12 km veya
    # 2. norm(name)[:16] + adres içinde aynı sokak/cadde
    # 3. telefon eşleşmesi (normalize: sadece rakam, son 10 hane)
    ...
    # Birleşik kayıt: kaynak listesi tutulur
    merged["sources"] = ["places", "dt", "tdb"]   # virgülle ayrı
    merged["confidence"] = len(merged["sources"]) / 5
```

### 9.3 Güven skoru (confidence)

Bir klinik **kaç kaynaktan doğrulandı** ölçütü:

| Kaynak sayısı | Güven |
|---|---|
| 5/5 (tüm katmanlar) | %100 — kesin doğrulanmış |
| 3-4/5 | %85 — güçlü |
| 2/5 | %65 — orta |
| 1/5 (sadece bir kaynak) | %40 — düşük, yine de listele |

**Düşük güvenli kayıtlar** Excel'de **soluk gri** ile işaretlenir (vurgu yok).

---

## 10. DIŞLAMA KURALLARI (v2'den korunur)

| Tip | Karar |
|---|---|
| Başka ilçe adresli | HARİÇ (adres metnine bak) |
| ASM (Aile Sağlık Merkezi) | HARİÇ |
| Veteriner | HARİÇ |
| Turistik mekanlar | HARİÇ |
| Üniversite Tıp Fak/Anabilim Dalı | HARİÇ |
| Üniversite **Diş Hekimliği** Fak. | KAMU sayfasına ekle |
| Devlet ADSM/ADSP | KAMU sayfasına ekle |
| Vefat eden hekim | HARİÇ |
| Aynı poliklinik içi mükerrer hekim kaydı | Polikliniği tut, hekimleri sil |
| İl dışı kayıt | HARİÇ |
| **YENİ — düşük güven + sıfır kaynak doğrulama** | Listele ama gri vurgu, "doğrulanmalı" notu |

---

## 11. EXCEL ÇIKTI YAPISI (v3 - 15 sütun)

| # | Sütun | Genişlik | v2'den fark |
|---|---|---|---|
| 1 | Sıra | 6 | - |
| 2 | Klinik Adı | 42-44 | - |
| 3 | Mahalle | 20 | - |
| 4 | Adres | 44-46 | - |
| 5 | Telefon | 18 | - |
| 6 | Yorum Sayısı | 11 | - |
| 7 | Puan | 7 | - |
| 8 | Tip/Özellik | 28 | Uzmanlık etiketleri (Ortodonti, Pedodonti vb.) |
| 9 | **Kaynak** | 18 | **YENİ:** "places, dt, tdb" virgülle ayrı |
| 10 | **Güven** | 8 | **YENİ:** %100/%85/%65/%40 |
| 11 | Ziyaret Tarihi | 14 | - |
| 12 | Temsilci | 14 | - |
| 13 | Görüşülen Hekim | 18 | - |
| 14 | Durum | 14 | - |
| 15 | Notlar | 26 | "Konum tahmini — doğrulanmalı" gibi |

### 11.1 Renkler (genişletildi)

```
Header: 1F4E78 mavi, beyaz bold
MEGA lead (turuncu FFD966): 500y+ veya tip içinde "MEGA"
HOT lead (sarı FFF2CC): 150y+, "UZMAN", "HOT", "NÖBET", "24H"
YENİ — Düşük güven (gri D9D9D9): 1 kaynak veya konum tahmini
YENİ — Uzman (açık mavi DDEBF7): Tip "UZMAN ({alan})" içeriyor
```

### 11.2 Birleşik global dosya (17 sütun)

Mevcut 15 sütuna ek:
- 1. sütun: Global Sıra
- 2. sütun: İlçe
- 11. sütun: Eve Kuş Uçuşu (km)
- freeze_panes: **D2** (Global Sıra + İlçe + Klinik Adı sabit)

---

## 12. BUILD SCRIPT ŞABLONU v3

Aşağıdaki şablon her ilçe için kullanılır. **5 katman ayrı modül olarak** organize edilir:

```python
"""<ILCE> v3 - 5 KATMANLI DERİN TARAMA
K1: places_search (8 sorgu)
K2: Grid taraması (~12-30 nokta × 2 sorgu)
K3: Uzmanlık sorguları (7 sorgu)
K4: Doktor Takvimi cross-reference
K5: Yorum içi hekim ismi extraction
K6: TDB üye listesi cross-validation
"""
import math, re, json
from collections import defaultdict
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HOME_LAT, HOME_LNG = <BASLANGIC_LAT>, <BASLANGIC_LNG>
ILCE_BBOX = {"north": ..., "south": ..., "east": ..., "west": ...}

# K1: places_search çekirdek (Claude tarafından doldurulur)
k1_aday = [...]  # source: "places"

# K2: Grid taraması (Claude tarafından doldurulur)
k2_aday = [...]  # source: "grid"

# K3: Uzmanlık sorguları
k3_aday = [...]  # source: "spec"

# K4: Doktor Takvimi
k4_aday = [...]  # source: "dt"

# K5: Yorum extraction
k5_aday = [...]  # source: "yorum-extract"

# K6: TDB
k6_aday = [...]  # source: "tdb"

def norm(s):
    s = (s or "").lower()
    for a, b in [("ç","c"),("ğ","g"),("ı","i"),("ö","o"),("ş","s"),("ü","u")]:
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", s)

def hav(a, b, c, d):
    R = 6371
    p1, p2 = math.radians(a), math.radians(c)
    x = math.sin(math.radians(c-a)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(math.radians(d-b)/2)**2
    return 2*R*math.asin(math.sqrt(x))

def norm_phone(p):
    return re.sub(r'\D', '', p or "")[-10:]

# === Cross-source birleştirme ===
all_raw = k1_aday + k2_aday + k3_aday + k4_aday + k5_aday + k6_aday
merged = []
buckets = []

for r in all_raw:
    n = norm(r["name"])[:16]
    ph = norm_phone(r.get("phone", ""))
    matched = None
    for b in buckets:
        # Aynı klinik mi? İsim + konum (lat/lng varsa) VEYA telefon eşleşmesi
        same_loc = (r.get("lat") and b.get("lat") and
                    hav(r["lat"], r["lng"], b["lat"], b["lng"]) < 0.12)
        same_phone = ph and ph == b.get("_phone")
        name_match = n == b["_norm"] or (len(n) > 6 and (n in b["_norm"] or b["_norm"] in n))
        if (name_match and same_loc) or (name_match and same_phone) or same_phone:
            matched = b
            break
    if matched:
        # En zengin kaydı tut, eksik alanları doldur
        for key in ["lat", "lng", "address", "phone", "reviews", "rating", "type", "neighborhood", "hours"]:
            if not matched.get(key) and r.get(key):
                matched[key] = r[key]
        matched["_sources"].add(r["source"])
    else:
        nr = dict(r)
        nr["_norm"] = n
        nr["_phone"] = ph
        nr["_sources"] = {r["source"]}
        buckets.append(nr)

# Güven skoru hesapla
for b in buckets:
    src_count = len(b["_sources"])
    if src_count >= 5: b["confidence"] = 100
    elif src_count >= 3: b["confidence"] = 85
    elif src_count >= 2: b["confidence"] = 65
    else: b["confidence"] = 40
    b["sources_str"] = ", ".join(sorted(b["_sources"]))

# Konum eksik olanları ilçe merkezine yerleştir + uyarı
ilce_merkez_lat = (ILCE_BBOX["north"] + ILCE_BBOX["south"]) / 2
ilce_merkez_lng = (ILCE_BBOX["east"]  + ILCE_BBOX["west"])  / 2
for b in buckets:
    if not b.get("lat"):
        b["lat"] = ilce_merkez_lat
        b["lng"] = ilce_merkez_lng
        b["notlar"] = "Konum tahmini — doğrulanmalı"

clinics = [b for b in buckets if b.get("type", "").startswith("Özel") or "type" not in b]
kamu = [b for b in buckets if b.get("type", "").startswith("KAMU")]

# NN-TSP rota (v2 ile aynı)
def nn(pts, sa, so):
    rem = list(range(len(pts)))
    rt, t = [], 0.0
    cl, cn = sa, so
    while rem:
        bi = min(rem, key=lambda i: hav(cl, cn, pts[i]["lat"], pts[i]["lng"]))
        t += hav(cl, cn, pts[bi]["lat"], pts[bi]["lng"])
        rt.append(bi); cl, cn = pts[bi]["lat"], pts[bi]["lng"]; rem.remove(bi)
    t += hav(cl, cn, sa, so)
    return rt, t

order, total = nn(clinics, HOME_LAT, HOME_LNG)
ordered = [clinics[i] for i in order]

# === Excel ===
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "<Ilce> v3"
H = ["Sıra","Klinik Adı","Mahalle","Adres","Telefon","Yorum Sayısı","Puan",
     "Tip/Özellik","Kaynak","Güven","Ziyaret Tarihi","Temsilci","Görüşülen Hekim","Durum","Notlar"]

hf  = Font(bold=True, color="FFFFFF", size=11)
hfl = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
ha  = Alignment(horizontal="center", vertical="center", wrap_text=True)
bd  = Border(*[Side(style="thin", color="999999")]*4)
hot = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
meg = PatternFill(start_color="FFD966", end_color="FFD966", fill_type="solid")
gri = PatternFill(start_color="D9D9D9", end_color="D9D9D9", fill_type="solid")
spc = PatternFill(start_color="DDEBF7", end_color="DDEBF7", fill_type="solid")

for c, h in enumerate(H, 1):
    x = ws.cell(row=1, column=c, value=h)
    x.font, x.fill, x.alignment, x.border = hf, hfl, ha, bd
ws.row_dimensions[1].height = 38

for i, cl in enumerate(ordered, 1):
    rv = cl.get("reviews") or 0
    tp = cl.get("type", "")
    conf = cl.get("confidence", 40)
    im   = "MEGA" in tp.upper()
    iuzm = "UZMAN" in tp.upper()
    ih   = rv >= 150 or any(k in tp.upper() for k in ["HOT LEAD","NÖBET","24H","7/24"])
    idog = conf < 50 or cl.get("notlar", "").startswith("Konum tahmini")
    rs   = f"{cl['rating']}" if cl.get("rating") is not None else "-"
    row = [i, cl["name"], cl.get("neighborhood",""), cl.get("address",""), cl.get("phone",""),
           rv, rs, tp, cl.get("sources_str",""), f"%{conf}",
           "", "", "", "", cl.get("notlar","")]
    for c, v in enumerate(row, 1):
        x = ws.cell(row=i+1, column=c, value=v)
        x.border = bd
        x.alignment = Alignment(vertical="center", wrap_text=True)
        # Renk önceliği: MEGA > Uzman > HOT > Düşük güven
        if im:    x.fill = meg
        elif iuzm: x.fill = spc
        elif ih:   x.fill = hot
        elif idog: x.fill = gri

for i, w in enumerate([6,42,20,44,18,11,7,28,18,8,14,14,18,14,26], 1):
    ws.column_dimensions[get_column_letter(i)].width = w
ws.freeze_panes = "A2"

# KAMU sheet + Özet sheet (v2 ile aynı yapı, source/confidence eklenmiş)
# ...

out = "/mnt/user-data/outputs/<Ilce>_Dis_Hekimi_Rotasi_v3.xlsx"
wb.save(out)
print(f"K1 places: {len(k1_aday)} | K2 grid: {len(k2_aday)} | K3 spec: {len(k3_aday)}")
print(f"K4 dt: {len(k4_aday)} | K5 yorum: {len(k5_aday)} | K6 tdb: {len(k6_aday)}")
print(f"BIRLEŞIK DEDUP SONRASI: {len(clinics)} özel | {len(kamu)} KAMU | {total:.1f} km")
```

---

## 13. ÇALIŞMA AKIŞI v3 (Claude için checklist)

```
[ ] 1. Kullanıcıdan: il, başlangıç koordinatı, ilçeler, coverage hedefi
[ ] 2. İl odası web sitesini bul ve TDB üye listesi erişilebilir mi tespit et
    (TDB erişilemezse K6'yı atla, kullanıcıyı bilgilendir)

[ ] 3. Her ilçe için sırayla:
    [ ] İlçe sınır bounding box'ını belirle
    [ ] K1 (places çekirdek): 8 sorgu çalıştır, sonuçları topla
    [ ] K2 (grid): bounding box'tan grid noktaları üret, her noktadan 2 sorgu
    [ ] K3 (uzmanlık): 7 uzmanlık sorgusu
    [ ] K4 (DT): doktortakvimi.com ilçe sayfasını sayfalama ile çek
          - Bulunan her hekim için places_search reverse lookup ile enrichment
    [ ] K5 (yorum extract): K1+K2'de topladığın klinik yorumlarından unvanlı isim regex
          - Her benzersiz isim için places_search reverse lookup
    [ ] K6 (TDB): il odası sitesinden ilçe üyeleri çek (mümkünse)
          - Telefon/adres mevcut ama lat/lng yoksa places ile enrichment
    [ ] Dışlama kuralları uygula (sınır/ASM/veteriner/üniversite)
    [ ] Cross-source merge + güven skoru hesapla
    [ ] build_<ilce>_v3.py oluştur ve çalıştır
    [ ] Excel'i kontrol: kaynak dağılımı, güven skoru, anomali
    [ ] present_files ile teslim, kısa özet (TR, kaynak başına klinik sayısı)

[ ] 4. Tüm ilçeler bitince: birleşik global v3 dosyası
[ ] 5. Genel özet:
     - Toplam klinik (kaynak başına)
     - Coverage tahmini
     - Düşük güvenli + doğrulama gereken kayıt sayısı
     - Toplam tur mesafesi
```

---

## 14. KATMAN SIRASI ve ZAMAN YÖNETİMİ

5 katmanın hepsi her ilçe için tek seferde değil, **batch'lenmiş paralel sırada** çalıştırılır:

**Faz 1 — Hızlı toplama (places-only):**
- Tüm ilçeler için K1 + K2 + K3 sırayla → "geniş havuz" oluşur.
- Bu noktada zaten %92 coverage var, MVP teslim edilebilir.

**Faz 2 — Cross-reference enrichment:**
- K4 (DT) ve K5 (yorum extract) sırayla işlenir.
- Her yeni kayıt için places_search reverse lookup ile lat/lng/telefon zenginleştir.
- Yeni keşifler önceki Faz 1 listesine eklenir, dedup yenilenir.

**Faz 3 — Doğrulama (TDB):**
- K6 mümkünse: tüm il için tek seferde TDB listesi çek.
- Cross-validation: TDB'de olanları işaretle, olmayanları "doğrulanmalı" notuyla bırak.
- TDB'de olup diğer havuzlarda olmayan kayıtlar = "yeni keşif" → places ile enrich.

**Token verimliliği için:**
- Faz 1 her ilçe için yapıldıktan **sonra** kullanıcıya ara teslim verilebilir.
- Faz 2-3 isteğe bağlı (kullanıcı "tam coverage istiyorum" derse).

---

## 15. KALİTE METRİKLERİ v3

İlçe başına kontrol edilmesi gerekenler:

- [ ] Toplam klinik = K1 sayısının **en az 1.3 katı** (artmadıysa Faz 2-3 işe yaramamış demek)
- [ ] Kaynak dağılımı: places %60-70, grid %15-25, dt %10-20, spec/yorum/tdb her biri %3-10
- [ ] Düşük güvenli kayıt (%40) oranı **%20'yi geçmemeli** — geçerse cross-enrichment yetersiz
- [ ] "Konum tahmini" notlu kayıtlar tüm listenin **%5'inden az** olmalı
- [ ] Her kayıtın **en az 2 kaynaktan** geldiği oran %60+ olmalı (yüksek güven baskın)

---

## 16. YENİ İL İÇİN ÖRNEK BAŞLANGIÇ PROMPT'U (v3)

```
[Bu dokümanın tamamını ekle, sonra:]

İl: İzmir
Başlangıç noktası: 38.4192, 27.1287 (Konak/Alsancak)
Taranacak ilçeler: Konak, Karşıyaka, Bornova, Buca, Bayraklı, Çiğli, Karabağlar,
  Gaziemir, Balçova, Narlıdere, Güzelbahçe (büyük 11 ilçe)
B2B bağlamı: [Parla Diş Deposu / Ökodent burs / Fanta canal files /
  Ökodent Biowhiten / Clear One ağız duşu]
Kısıt: Vefat hekim listesi yok. ASM/veteriner/üniversite eğitim kayıtları
  yine standart hariç. Üniversite Diş Hekimliği Fakülteleri KAMU sayfasında.
Coverage hedefi: **TAM v3** (5 katman, %98 coverage)
TDB sitesi: https://www.izmirdiso.org.tr (var ise üye listesi çek)

Onay-kapılı workflow: "Devam et" dediğimde sıradaki ilçeye geç, soru sorma.
"Dur" diyene kadar her ilçeyi bitir → Faz 1 teslim et → Faz 2-3 ekle → sonrakine geç.
Tüm ilçeler bitince birleşik global dosya oluştur.

Başla.
```

---

## 17. ANKARA v2 → v3 KARŞILAŞTIRMA TABLOSU (Beklenti)

| İlçe | v2 toplam | v3 beklentisi (~%95) | Artış oranı |
|---|---|---|---|
| Çankaya-A | 101 | 130-145 | +30-45% |
| Çankaya-B | 110 | 140-155 | +30-40% |
| Çankaya-C | 148 | 185-205 | +25-40% |
| Çankaya-D | 62 | 80-95 | +30-50% |
| Etimesgut | 108 | 135-155 | +25-45% |
| Yenimahalle | 127 | 165-185 | +30-45% |
| Sincan | 81 | 105-125 | +30-55% |
| Keçiören | 67 | 90-110 | +35-65% |
| Mamak | 35 | 50-65 | +45-85% |
| Altındağ | 25 | 38-50 | +50-100% |
| Gölbaşı | 16 | 22-30 | +40-90% |
| Pursaklar | 22 | 30-40 | +35-80% |
| Kahramankazan | 8 | 12-18 | +50-125% |
| **TOPLAM** | **909** | **~1.180-1.380** | **+30-50%** |

Artış oranı küçük ilçelerde daha yüksek çünkü v2'de doygunluk daha çabuk geliyordu. Büyük ilçelerde v2 zaten iyi coverage'da.

---

## 18. RİSK ve LİMİT

| Risk | Etki | Mitigasyon |
|---|---|---|
| Doktor Takvimi HTML yapı değişikliği | K4 çıktısı boş | Claude `web_fetch` ile bir kez yapı kontrol etmeli, regex'i kalibre etmeli |
| TDB sitesi erişim yok / üye listesi gizli | K6 atlanır | Kullanıcıyı bilgilendir, K1-K5 ile devam (%92 coverage hedefi) |
| Token limiti aşılır | İl bütünü tek sohbette bitmez | Faz 1'i tüm ilçeler için bitir, Faz 2-3 ayrı sohbette |
| Reverse lookup yanlış eşleşme | Yanlış lat/lng atanır | Çoklu eşleşme stratejisi: isim+telefon+adres içinde en az 2 alan eşleşmeli |
| Düşük güvenli kayıt çokluğu | Kullanıcı şüphelenir | Gri renk + "doğrulanmalı" notu açıkça gösterir, kullanıcı isterse atabilir |

---

## 19. SON NOT

v3 metodolojisi **mevcut Ankara v2 listesinin üstüne uygulanabilir** — yani Ankara için sıfırdan başlamadan sadece K2-K6'yı çalıştırıp v2 listesine ek klinikler eklenebilir. Bu **incremental v3** olarak teslim edilir.

Yeni il için baştan v3 uygulanır. Tüm katmanların çalışması yaklaşık **6-8 sohbet turu** alır (büyük illerde 10+).

**Coverage limiti:** Hiçbir yöntem %100 ulaşmaz — yeni açılan klinikler, hiçbir dijital iz bırakmayan klasik muayeneler, yarı zamanlı hekimler vb. her zaman bir kısım kaçacaktır. **%98 v3 ile pratik üst limittir.**
