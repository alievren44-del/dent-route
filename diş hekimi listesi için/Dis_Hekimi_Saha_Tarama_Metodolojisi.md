# Diş Hekimi & Klinik Saha Tarama Metodolojisi (B2B CRM Listesi)
## Yeniden Kullanılabilir Çalışma Notu — Yeni İl İçin Tek-Prompt Kullanım

Bu doküman, **Ankara için 13 ilçeye uygulanmış ve doğrulanmış** bir tarama metodolojisini yeni iller için yeniden kullanılabilir hale getirir. Yeni sohbette başlangıçta Claude'a verildiğinde, kullanıcı düzeltmesine gerek kalmadan aynı kalitede liste üretmesi hedeflenir.

**Üretilen çıktı (Ankara'da kanıtlanmış):** 909 özel klinik + 27 KAMU/ADSM, 13 ilçe, tek global Nearest-Neighbor rota, ~520 km tur mesafesi, sıfır yanlış-ilçe kaydı.

---

## 0. KULLANICIDAN ALINACAK GİRDİLER (Yeni il için 5 soru yeter)

Claude bu 5 bilgi olmadan çalışmaya başlamamalı (ilki kritik):

1. **İl adı** (ör: İstanbul, İzmir, Bursa)
2. **Başlangıç/bitiş koordinatı** (kullanıcı evi/depo) — lat, lng (Google Maps'ten alınır)
3. **Hangi ilçeler taranacak?** (boş bırakılırsa: ildeki tüm büyük + orta ilçeler)
4. **B2B bağlamı** (opsiyonel — temsilci kim, hangi ürünler) — CRM sütunları için
5. **Özel kısıtlar** (vefat eden hekim listesi, hariç tutulacaklar, vb.)

---

## 1. AMAÇ ve ÇIKTI TANIMI

**Amaç:** Bir saha temsilcisinin tek dosya ile (a) hangi klinikleri ziyaret edeceğini, (b) hangi sırayla gideceğini (yakıt + zaman tasarrufu), (c) hangilerinin yüksek potansiyel olduğunu görmesi.

**Her ilçe için Excel (.xlsx) dosyası:**
- Sheet 1: Özel Klinikler (14 sütunlu CRM tablosu, NN-TSP rota sıralı)
- Sheet 2: KAMU Hastane & ADSM (varsa)
- Sheet 3: Özet & Rota Bilgisi

**Tüm il için birleşik Excel:** `{IL}_GENELI_Birlesik_Dis_Hekimi_Rotasi_v2.xlsx` — 3 sayfa, **16 sütun** (Global Sıra + İlçe ekstra), tek global rota.

**Dosya adı konvansiyonu:**
- Tek ilçe: `{Ilce}_Dis_Hekimi_Rotasi_v2.xlsx`  (Türkçe karaktersiz: Cankaya, Kecioren, Golbasi...)
- Çok parçalı büyük ilçe: `{Ilce}_A_Bati_..._v2.xlsx`, `{Ilce}_B_..._v2.xlsx` vb.
- Birleşik: `{IL}_GENELI_Birlesik_Dis_Hekimi_Rotasi_v2.xlsx`

---

## 2. İLÇE TESPİT ve SINIFLANDIRMA

### Adım 2.1 — İlçeleri belirle
- Web search veya genel bilgiyle ilin ilçelerini listele.
- Nüfus + ticari yoğunluğa göre sınıflandır. Diş klinik yoğunluğu **şehir merkezine yakın yoğun ilçelerde** en yüksektir.

### Adım 2.2 — Boyut sınıflaması (klinik sayısı tahmini)
| Sınıf | Tahmin | Batch sayısı | Bölme |
|---|---|---|---|
| **Çok büyük** | 200+ klinik | 4 alt dosya (A/B/C/D) | Coğrafi olarak böl (Batı/Doğu, Çekirdek/Çevre) |
| **Büyük** | 80-150 klinik | 2 batch | Tek dosya, 2 ayrı tarama turu |
| **Orta** | 30-80 klinik | 1-2 batch | Tek dosya |
| **Küçük** | <30 klinik | 1 batch | Tek dosya |

**Ankara örneği:**
- Çankaya → 4 parçaya bölündü (Batı/Çukurambar-Balgat/Merkez/Güney), 421 klinik
- Yenimahalle, Keçiören → 2 batch
- Mamak, Etimesgut, Sincan, Altındağ → 2 batch
- Gölbaşı, Pursaklar → 1 batch (orta)
- Kahramankazan → 1 batch (küçük, 8 klinik)

### Adım 2.3 — Çok büyük ilçe bölmesi (Çankaya örneği)
| Parça | Coğrafi bölge | Mahalleler |
|---|---|---|
| A | Batı | Çayyolu, Ümitköy, Yaşamkent, Beytepe, Konutkent, Alacaatlı |
| B | Çukurambar-Balgat | Çukurambar, Mustafa Kemal, Balgat, Söğütözü, Öveçler |
| C | Merkez | Kızılay, Bahçelievler, Maltepe, Kavaklıdere, GOP, Çankaya |
| D | Güney | Oran, Dikmen, Ayrancı, Aşağı/Yukarı Ayrancı |

**Yeni il için:** Kullanıcının evine yakınlık + mahalle yoğunluğuna göre benzer bölme yap.

---

## 3. ARAMA TEKNİĞİ — `places_search` Sorgu Stratejisi

### 3.1 Çekirdek prensip: ÇOK SORGU + ÇOK BIAS
Tek bir genel sorgu ("diş hekimi {İlçe}") asla yeterli değil. Aynı bölgeyi **6-10 farklı sorgu varyasyonu** ile tarayıp dedup yapmak gerekir. Her sorgu farklı bir alt-segmenti yakalar.

### 3.2 Kanıtlanmış sorgu seti (her ilçe için bu 6-8 sorgu çalıştırılır)

Aşağıdaki sorgu varyasyonları **birlikte kullanıldığında** Ankara'da tek başına genel sorgudan **3-4 kat daha fazla** klinik buldurdu:

```
1. "diş hekimi muayenehanesi {Ilce} merkez {Il}"
   → Genel + merkezi yakalar

2. "Dt. diş doktoru {Mahalle1} {Ilce} ara sokak"
   → KİLİT SORGU: "Dt." prefix'i + "ara sokak" anahtar kelimesi
     bireysel/küçük muayeneları yakalar (asla atlamaması gerekenler!)

3. "diş kliniği {Mahalle2} {Mahalle3} {Ilce}"
   → Belirli mahalle çiftleri ile coğrafi bias

4. "diş hekimi {Mahalle4} {Ilce} Cumhuriyet Caddesi"
   → Ana cadde + iş hanı odaklı (büyük poliklinikler)

5. "diş hekimi {Mahalle5} {Mahalle6} {Ilce}"
   → İkinci mahalle çifti (farklı bölge)

6. "ağız diş sağlığı polikliniği {Ilce}"
   → Formal "ADSP/ADSM" terminolojisi
     (zincir/poliklinik kayıtları için kritik)

7. "diş hekimi {Ilce} {Tarihi/Anahtar Cadde}"
   → Lokasyon-spesifik landmark

8. "diş hekimi 7/24 nöbetçi {Ilce}"  [opsiyonel]
   → Gece açık klinikler için ek değer (büyük hacim genelde)
```

### 3.3 `places_search` parametreleri

```python
places_search(
    location_bias_lat=<ilçe_merkez_lat>,
    location_bias_lng=<ilçe_merkez_lng>,
    location_bias_radius=6000-9000,  # büyük ilçe 9000, küçük 5000
    queries=[
        {"query": "...", "max_results": 8 veya 10},  # 6 sorgu = 1 batch
        ...
    ]
)
```

**Önemli:** `location_bias` koordinatı ilçenin gerçek merkezine yakın olmalı. Yanlış bias = yanlış ilçe sonuçları çıkar.

### 3.4 Batch stratejisi (büyük ilçeler için)

**Batch 1:** Çekirdek/ticari merkez mahalleler (en yoğun bölge, 6 sorgu)
**Batch 2:** Çevre mahalleler + uzak bölgeler (6 sorgu, farklı bias koordinatı)

Her batch sonrası sonuçları toplayıp dedup yap. İkinci batch'te yeni klinik geliş oranı %25'in altına düştüyse doygunluk sayılır — ama "v2 derin tarama" yaklaşımında bu **limit YOKtur** (aşağıya bak).

### 3.5 "v2 Derin Tarama" Yaklaşımı (KRİTİK İNOVASYON)

**Sorun:** Standart yaklaşımda doygunluk limiti olduğu için ara sokaktaki bireysel hekimler (örn. "Dt. Aykut Girgin" gibi) listeden düşüyordu — yorum sayısı düşük olsa da B2B için kritik müşteriler.

**Çözüm v2 yaklaşımı:**
1. Doygunluk limitini KALDIR — sonuçlar tekrar etse de devam et.
2. Sorgu varyasyonlarına "Dt.", "ara sokak", "muayenehanesi" gibi bireysel hekim sinyali ver.
3. Aday listesini olabildiğince geniş tut, dedup sonradan yapılır.
4. Yorum sayısı 0-50 arası klinikleri **atma** — küçük ama aktif hekimler değerli.

**Sonuç:** Ankara'da v1'e göre ortalama %10-25 ek klinik tespiti.

---

## 4. DIŞLAMA (EXCLUSION) KURALLARI — KRİTİK

Listeye yanlış kayıt girmemesi için bu kurallar **her klinik için kontrol edilir**:

### 4.1 İlçe sınırı titizliği
- `places_search` location_bias'a rağmen başka ilçeden sonuç döner.
- **Her sonucun `address` alanını kontrol et:** Adres içinde başka ilçe ismi (ör. "...Çankaya/Ankara") geçiyorsa → HARİÇ.
- Sınır mahallelerde Google Maps bazen yanlış ilçe etiketi koyar; **adres metni esas alınır**.
- Ankara örneği: "İncek" mahallesi Gölbaşı + Çankaya sınırında; Gölbaşı taramasında Çankaya/Alacaatlı adresliler hariç tutuldu.

### 4.2 Diş dışı kayıtlar
| Tip | Karar |
|---|---|
| Aile Sağlık Merkezi (ASM) | HARİÇ — diş hizmeti yok, genel aile hekimliği |
| Veteriner kliniği | HARİÇ |
| Turistik mekanlar (ör: Hamamönü) | HARİÇ |
| Üniversite (genel Tıp Fakültesi, Anabilim Dalları) | HARİÇ |
| **Üniversite Diş Hekimliği Fakültesi** | KAMU sayfasına ekle (merkezi tedarik potansiyeli) |
| Devlet Diş Hastanesi / ADSM / ADSP (KAMU) | KAMU sayfasına ekle, özel listeden HARİÇ |
| Eczane, optisyen, lab. | HARİÇ |

### 4.3 İl/şehir dışı kayıtlar
Bazen aynı isimli klinik başka şehirde çıkar. `address` alanında il adı kontrol et. **Aynı şehir dışı = HARİÇ.**

### 4.4 Vefat eden hekimler
- Kullanıcı varsa baştan bildirir; ayrıca yorumlarda "rahmetli", "merhum" geçen kayıtları HARİÇ.

### 4.5 Aynı poliklinik içi mükerrer bireysel hekim kayıtları
- Bir poliklinik adresinde aynı binadan birden çok "hekim" kaydı çıkabilir (örn: Alyadent ADSP + Dt. M.E.Şahin + Dt. A.Akgöz, hepsi aynı adres ve telefon).
- **Yöntem:** Aynı adres + aynı/benzer telefon = aynı poliklinik. Polikliniği ana kayıt olarak tut, bireysel hekimleri sil (CRM açısından temsilci poliklinikte hepsini görür). İstisna: bağımsız çalışan ünlü uzman ise koruyabilir.

---

## 5. DEDUP (Tekrar Eleme) — 3 Katmanlı

### 5.1 Türkçe normalize
```python
def norm(s):
    s = s.lower()
    for a, b in [("ç","c"),("ğ","g"),("ı","i"),("ö","o"),("ş","s"),("ü","u")]:
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", s)
```

### 5.2 Haversine konum mesafesi
```python
def hav(a, b, c, d):  # km
    R = 6371
    p1, p2 = math.radians(a), math.radians(c)
    x = math.sin(math.radians(c-a)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(math.radians(d-b)/2)**2
    return 2*R*math.asin(math.sqrt(x))
```

### 5.3 Dedup eşikleri (Ankara'da kalibre edildi)

| Katman | İsim eşleşmesi | Konum eşiği | Açıklama |
|---|---|---|---|
| **Self-dedup** (aynı ilçe içi mükerrerler) | norm[:14] eşit/içerme | < 0.18-0.20 km | Aynı klinik birden çok sorguda çıkmış |
| **Cross-batch dedup** | norm[:14] | < 0.15 km | v1+v2 aday listelerini birleştirirken |
| **Global dedup** (ilçeler arası sınır) | norm[:16] | < 0.12 km | Birleşik dosyada |

Dar konum eşikleri (0.12 km) yanlış pozitifi azaltır; geniş eşikler (0.20 km) plaza içi farklı hekimleri elemez.

---

## 6. ROTA OPTİMİZASYONU — Nearest-Neighbor Greedy TSP

**Amaç:** Saha temsilcisinin minimum yol gitmesi (= minimum zaman + yakıt).

**Yöntem:** Greedy NN — başlangıç noktasından her adımda en yakın ziyaret edilmemiş kliniğe git. Optimal değildir ama hızlı ve pratik; gerçek yol mesafesi yerine kuş uçuşu (haversine) kullanır.

```python
def nn(pts, start_lat, start_lng):
    rem = list(range(len(pts)))
    route, total = [], 0.0
    cur_lat, cur_lng = start_lat, start_lng
    while rem:
        bi = min(rem, key=lambda i: hav(cur_lat, cur_lng, pts[i]["lat"], pts[i]["lng"]))
        total += hav(cur_lat, cur_lng, pts[bi]["lat"], pts[bi]["lng"])
        route.append(bi)
        cur_lat, cur_lng = pts[bi]["lat"], pts[bi]["lng"]
        rem.remove(bi)
    total += hav(cur_lat, cur_lng, start_lat, start_lng)  # eve dönüş
    return route, total
```

**Çıktı:** Sıralı index listesi + toplam tur mesafesi.

---

## 7. EXCEL ÇIKTI YAPISI

### 7.1 Sheet 1 — Özel Klinikler (14 sütun)

| # | Sütun | Genişlik | Açıklama |
|---|---|---|---|
| 1 | Sıra | 6 | NN-TSP rota sırası |
| 2 | Klinik Adı | 44-46 | |
| 3 | Mahalle | 20-22 | |
| 4 | Adres | 46-48 | |
| 5 | Telefon | 18 | |
| 6 | Yorum Sayısı | 12 | Potansiyel göstergesi |
| 7 | Puan | 7-8 | |
| 8 | Tip/Özellik | 26-30 | "Özel - MEGA LEAD", "Özel - UZMAN", "Özel (Nöbetçi 24h)" vs. |
| 9 | Ziyaret Tarihi | 14 | Boş (CRM doldurma) |
| 10 | Temsilci | 14 | Boş |
| 11 | Görüşülen Hekim | 18 | Boş |
| 12 | Durum | 14 | Boş |
| 13 | Sipariş | 12 | Boş |
| 14 | Notlar | 24-26 | Boş |

### 7.2 Sheet 2 — KAMU Hastane & ADSM (varsa, 10 sütun)
Sıra / Kurum Adı / Mahalle / Adres / Telefon / Yorum / Puan / Tip / Ziyaret / Notlar

### 7.3 Sheet 3 — Özet & Rota Bilgisi
- Toplam klinik sayısı (ham aday + dedup sonrası)
- Toplam NN-TSP mesafe
- En yüksek potansiyelli leadler (yorum sayısı sıralı top 5-8)
- Yöntem açıklaması (1-2 paragraf)
- Renk açıklaması
- Hariç tutulan kayıtların kısa listesi (hangi ilçe/tip)

### 7.4 Renkler ve stiller
```
Header: PatternFill "1F4E78" (koyu mavi), Font beyaz bold 11pt
Hot lead (sarı): PatternFill "FFF2CC"
  → 150 yorum+ VEYA tip içinde "UZMAN", "HOT LEAD", "NÖBET", "24H", "7/24"
Mega lead (turuncu): PatternFill "FFD966"
  → tip içinde "MEGA"
Border: thin, "999999"
Alignment: wrap_text=True, vertical="center"
Freeze: A2 (tek ilçe) veya C2 (birleşik — ilçe sütunu sabit kalsın)
```

**Sınıflandırma kuralı (otomatik tip atama):**
| Yorum sayısı | Etiket |
|---|---|
| 500+ | "Özel - MEGA LEAD" (turuncu) |
| 200-499 | "Özel - HOT LEAD" (sarı) |
| 150-199 | sarı vurgu, ek etiket yoksa düz "Özel" |
| 0-149 | düz "Özel" (beyaz) |

Ek etiketler: "UZMAN (Pedodonti)", "UZMAN (Ortodonti)", "UZMAN (Çene Cer.)", "Nöbetçi 24h", "Nöbetçi gece"

**Küçük ilçelerde MEGA eşiği düşürülebilir** (örn. 250-300y+) — ilçedeki en yoğun klinikleri vurgulamak için.

---

## 8. BUILD SCRIPT ŞABLONU (kopya-yapıştır)

Aşağıdaki şablon her ilçe için kullanılır. Sadece `aday` (klinikler) ve `kamu` (varsa) listeleri değiştirilir.

```python
"""<ILCE> v2 - SIFIRDAN DERİN TARAMA
Batch 1 + Batch 2 (gerekirse). Sınır ilçesi sonuçları HARİÇ. ASM/veteriner HARİÇ.
"""
import math, re
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

HOME_LAT, HOME_LNG = <BASLANGIC_LAT>, <BASLANGIC_LNG>

aday = [
    {"name": "...", "lat": ..., "lng": ..., "neighborhood": "...",
     "address": "...", "phone": "...", "rating": ..., "reviews": ...,
     "type": "Özel - HOT LEAD", "hours": "Pzt-Cmt 9-19", "source": "v2 derin B1"},
    # ... her klinik için aynı yapı
]

kamu = [
    {"name": "<Ilce> Ağız ve Diş Sağlığı Merkezi (ADSM)", "lat": ..., "lng": ...,
     "neighborhood": "...", "address": "...", "phone": "...",
     "rating": ..., "reviews": ..., "type": "KAMU/Sağlık Bakanlığı ADSM"},
]

def norm(s):
    s = s.lower()
    for a, b in [("ç","c"),("ğ","g"),("ı","i"),("ö","o"),("ş","s"),("ü","u")]:
        s = s.replace(a, b)
    return re.sub(r"[^a-z0-9]", "", s)

def hav(a, b, c, d):
    R = 6371
    p1, p2 = math.radians(a), math.radians(c)
    x = math.sin(math.radians(c-a)/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(math.radians(d-b)/2)**2
    return 2*R*math.asin(math.sqrt(x))

# Self-dedup
clinics = []
seen = []
for a in aday:
    an = norm(a["name"])[:14]
    if not any((an == k or an in k or k in an) and hav(a["lat"], a["lng"], la, lo) < 0.18
               for k, la, lo in seen):
        clinics.append(a)
        seen.append((an, a["lat"], a["lng"]))

def nn(p, sa, so):
    rem = list(range(len(p)))
    rt, t = [], 0.0
    cl, cn = sa, so
    while rem:
        bi = min(rem, key=lambda i: hav(cl, cn, p[i]["lat"], p[i]["lng"]))
        t += hav(cl, cn, p[bi]["lat"], p[bi]["lng"])
        rt.append(bi); cl, cn = p[bi]["lat"], p[bi]["lng"]; rem.remove(bi)
    t += hav(cl, cn, sa, so)
    return rt, t

order, total = nn(clinics, HOME_LAT, HOME_LNG)
ordered = [clinics[i] for i in order]

# Excel kurulumu
wb = openpyxl.Workbook()
ws = wb.active
ws.title = "<Ilce> v2 - Özel Klinikler"
H = ["Sıra","Klinik Adı","Mahalle","Adres","Telefon","Yorum Sayısı","Puan",
     "Tip/Özellik","Ziyaret Tarihi","Temsilci","Görüşülen Hekim","Durum","Sipariş","Notlar"]
hf  = Font(bold=True, color="FFFFFF", size=11)
hfl = PatternFill(start_color="1F4E78", end_color="1F4E78", fill_type="solid")
ha  = Alignment(horizontal="center", vertical="center", wrap_text=True)
bd  = Border(*[Side(style="thin", color="999999")]*4)
hot = PatternFill(start_color="FFF2CC", end_color="FFF2CC", fill_type="solid")
meg = PatternFill(start_color="FFD966", end_color="FFD966", fill_type="solid")

for c, h in enumerate(H, 1):
    x = ws.cell(row=1, column=c, value=h)
    x.font, x.fill, x.alignment, x.border = hf, hfl, ha, bd
ws.row_dimensions[1].height = 36

for i, cl in enumerate(ordered, 1):
    rv = cl.get("reviews") or 0
    tp = cl.get("type", "")
    im = "MEGA" in tp.upper()
    ih = rv >= 150 or any(k in tp.upper() for k in ["UZMAN","HOT LEAD","NÖBET","24H","7/24"])
    rs = f"{cl['rating']}" if cl.get("rating") is not None else "-"
    row = [i, cl["name"], cl.get("neighborhood",""), cl["address"], cl["phone"],
           rv, rs, tp, "", "", "", "", "", ""]
    for c, v in enumerate(row, 1):
        x = ws.cell(row=i+1, column=c, value=v)
        x.border = bd
        x.alignment = Alignment(vertical="center", wrap_text=True)
        if im:    x.fill = meg
        elif ih:  x.fill = hot

for i, w in enumerate([6,44,22,46,18,12,8,30,14,14,18,14,12,26], 1):
    ws.column_dimensions[get_column_letter(i)].width = w
ws.freeze_panes = "A2"

# (KAMU sheet ve Özet sheet benzer şekilde eklenir - örnek için Ankara dosyalarına bakın)

out = "/mnt/user-data/outputs/<Ilce>_Dis_Hekimi_Rotasi_v2.xlsx"
wb.save(out)
print(f"Yazıldı: {out}")
print(f"aday: {len(aday)} | dedup sonrası: {len(clinics)} | KAMU: {len(kamu)} | {total:.1f} km")
```

---

## 9. BİRLEŞİK GLOBAL DOSYA (Son Adım)

Tüm ilçe scriptleri çalıştıktan sonra hepsini tek dosyada birleştir:

**Yöntem:** Her `build_<ilce>_v2.py` scriptini `runpy.run_path()` ile izole çalıştır, `clinics` ve `kamu` değişkenlerini topla. Her klinik dict'ine "ilce" alanı ekle. Cross-ilçe dedup (norm[:16] + hav<0.12 km) uygula. Eryaman/ev merkezli tek global NN-TSP.

**Birleşik Excel farkları:**
- 16 sütun (Global Sıra + İlçe + ... + Eve Kuş Uçuşu km)
- freeze_panes = "C2" (Global Sıra + İlçe sabit kalır)
- Özet sheet'inde ilçe dağılımı tablosu

---

## 10. ÇALIŞMA AKIŞI ÖZETİ (Claude için checklist)

```
[ ] 1. Kullanıcıdan: il, başlangıç lat/lng, ilçe listesi (varsa), kısıtlar
[ ] 2. İlçeleri büyüklüğe göre sınıflandır (4-büyük/2-batch/1-batch)
[ ] 3. Her ilçe için:
    [ ] places_search → 6-8 sorgu varyasyonu, doğru location_bias
    [ ] Büyük ilçe ise Batch 2: çevre mahalleler, farklı bias
    [ ] Sonuçları topla (JSON)
    [ ] Dışlama kuralları uygula (sınır/ASM/veteriner/üniversite/turistik)
    [ ] Manuel filtre: her klinik için ilçe sınırı + isim kontrolü
    [ ] build_<ilce>_v2.py oluştur (yukarıdaki şablon)
    [ ] Çalıştır → Excel kontrol
    [ ] present_files ile teslim
    [ ] Kısa özet (TR, lead-with-answer, mobil-kısa)
[ ] 4. Tüm ilçeler bitince: birleşik global dosya oluştur (runpy ile)
[ ] 5. present_files ile birleşik dosyayı da teslim
[ ] 6. Genel özet: toplam klinik, toplam km, en güçlü leadler
```

---

## 11. PRATİK İPUÇLARI ve ÇIKARILAN DERSLER

### 11.1 Yorum sayısı > Puan
- 4.0 puan + 200 yorum >> 5.0 puan + 2 yorum (B2B değeri açısından).
- Tip etiketi yorum sayısına göre verilir (puan ikincil).

### 11.2 Telefon formatı
- "0312 ..." veya "0532 ..." Türkçe format korunur.
- Boş ise "" bırak, "-" koyma (sıralama için).

### 11.3 Saat bilgileri
- "Pzt-Cmt 9-19" formatı standart.
- 7/24 / Hergün 24h klinikleri ayrı etiketle ("Nöbetçi 24h") — sarı vurgu.

### 11.4 İlçe sınırlarında özen
Sınır mahallelerde Claude'un manuel kontrol yapması ŞART. Yanlış ilçeye giren her kayıt CRM kalitesini düşürür. Bir kayıtta tereddüt varsa adres metnini esas al.

### 11.5 places_search rate-limit ve token verimi
- Bir batch'te 6-8 sorgu yeterli; daha fazlası genelde tekrar üretir.
- Büyük ilçelerde 2 batch'i farklı location_bias ile çalıştır (çekirdek + çevre).
- Sonuçları **immediately** kaydet (JSON özeti); konuşma uzadıkça unutmamak için.

### 11.6 Konuşma akışı (UX)
- Her ilçeyi bitir → present_files → kısa özet (3-5 satır) → bir sonraki ilçeye geç.
- Onay-kapılı workflow: "Sıradaki ilçeyle devam et" komutu verildikten sonra her ilçe için ayrı onay sorma.
- Mobil app: uzun postamble verme, present_files'tan sonra direkt sonraki adıma geç.

### 11.7 Build script çalıştırma
- Önce `create_file` ile script'i `/home/claude/build_<ilce>_v2.py`'ye yaz.
- `python build_<ilce>_v2.py` ile çalıştır.
- Çıktıyı (`/mnt/user-data/outputs/<Ilce>_Dis_Hekimi_Rotasi_v2.xlsx`) `present_files` ile sun.

---

## 12. YENİ İL İÇİN ÖRNEK BAŞLANGIÇ PROMPT'U

Kullanıcının yeni sohbette Claude'a yapıştıracağı şablon mesaj:

```
[Bu dokümanı tam olarak ekle, sonra:]

İl: İzmir
Başlangıç noktası (evim/depo): 38.4192, 27.1287 (Konak)
Taranacak ilçeler: Konak, Karşıyaka, Bornova, Buca, Bayraklı, Çiğli, Karabağlar,
  Gaziemir, Balçova, Narlıdere, Güzelbahçe (büyük 11 ilçe)
B2B bağlamı: [Parla Diş Deposu / Ökodent burs / Fanta canal files /
  Ökodent Biowhiten / Clear One ağız duşu]
Kısıt: Vefat hekim listesi yok. ASM/veteriner/üniversite eğitim kayıtları
  yine standart hariç. Üniversite Diş Hekimliği Fakülteleri KAMU sayfasında.

Onay-kapılı workflow: "Devam et" dediğimde sıradaki ilçeye geç, soru sorma.
"Dur" diyene kadar her ilçeyi bitir → teslim et → sonrakine geç.
Tüm ilçeler bitince birleşik global dosya oluştur.

Başla.
```

---

## 13. KALİTE METRİKLERİ (Çıktıyı Doğrulama)

Yeni ilçe bittiğinde Claude şu kontrolleri yapmalı:

- [ ] Klinik sayısı: ilçe büyüklüğüne uygun mu? (büyük 80+, orta 30-80, küçük <30 beklenir)
- [ ] MEGA/HOT lead var mı? Sıfırsa tarama yetersiz olabilir; ek batch yap.
- [ ] Yanlış ilçe sonucu var mı? Adres sütununu hızlı gözden geçir.
- [ ] KAMU/ADSM tespit edildi mi? (her ilçenin en az 1 ADSM'i vardır)
- [ ] NN-TSP toplam mesafe makul mü? (ilçe içi <80 km, çok ilçe büyük tur 400-600 km)
- [ ] Sarı/turuncu renk dağılımı dengeli mi? (genelde %15-30 vurgulu olmalı)

---

## 14. EK: ANKARA UYGULAMA SONUÇLARI (Referans / Benchmark)

| İlçe | Özel Klinik | KAMU | NN-TSP (km) | Batch |
|---|---|---|---|---|
| Çankaya-A Batı | 101 | 9 | 72.6 | v1+derin |
| Çankaya-B Çukurambar/Balgat | 110 | 2 | 56.4 | v1+derin |
| Çankaya-C Merkez | 148 | 1 | 70.4 | v1+derin |
| Çankaya-D Güney | 62 | 2 | 61.3 | v1+derin |
| Etimesgut | 108 | 3 | 99.4 | v1+derin |
| Yenimahalle | 127 | 0 | 78.4 | v1+derin |
| Sincan | 81 | 3 | 55.4 | v1+derin |
| Keçiören | 67 | 0 | 67.4 | sıfırdan 2 batch |
| Mamak | 35 | 1 | 76.6 | sıfırdan 2 batch |
| Altındağ | 25 | 3 | 60.8 | sıfırdan 1 batch |
| Gölbaşı | 16 | 1 | 58.8 | sıfırdan 1 batch |
| Pursaklar | 22 | 2 | 54.9 | sıfırdan 1 batch |
| Kahramankazan | 8 | 1 | 56.3 | sıfırdan 1 batch |
| **BİRLEŞİK** | **909** | **27** | **519.7 (tur)** | global NN-TSP |

---

## 15. SON NOT — Düzeltme Gerektirebilecek Noktalar

Yeni ilde yine de aşağıdaki kararları kullanıcı onayına sunmak yararlı olabilir (gerek değilse Claude default'ta yapar):

1. **Çok büyük ilçe bölme şeması** — yeni ilde Çankaya'nın 4 parça karşılığı varsa onay al.
2. **MEGA eşiği** — küçük illerde 500y+ az olabilir; 300y+ önerilebilir.
3. **Birleşik dosya yapılsın mı?** — kullanıcı tek tek ilçe dosyaları yeterli olabilir.
4. **Özel bir cadde / iş hanı** taraması istenirse manuel ekle.

Bunun dışında doküman, **kullanıcı düzeltmesi gerektirmeden** çalışacak şekilde tasarlanmıştır.
