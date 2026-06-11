# Diş Hekimi & Klinik Saha Tarama Metodolojisi v3.1
## DİSİPLİNLİ TAMAMLANMA SÜRÜMÜ — Yarıda Bırakma Yasak

**v3 → v3.1 ana değişiklikler:**
- "Doygunluk" kavramı **tamamen kaldırıldı**. Sabit minimum çalışma yapılır.
- Her ilçe için **zorunlu tamamlanma kriterleri** eklendi (nesnel sayısal).
- **Token/context disiplini** protokolü — yarıda bırakma yasak.
- **Tamamlama doğrulama checklist'i** her ilçe için zorunlu.
- **Yeni sohbet devam protokolü** netleştirildi.

Bu doküman v3 ile **tam uyumludur** — sadece disiplin katmanı eklenmiştir. v3'teki 5 katmanlı metodoloji (places + grid + uzmanlık + DoktorTakvimi + yorum + TDB) aynen geçerlidir.

---

# BÖLÜM A — DİSİPLİN PROTOKOLÜ (v3'e EK)

## A.1 TEMEL KURALLAR — ASLA İHLAL EDİLMEZ

1. **Bir ilçe yarıda bırakılıp diğerine GEÇİLEMEZ.** Başlanan ilçe %95 coverage hedefine ulaşana kadar bitirilir.
2. **"Doygunluk" gerekçesi YOK.** Yeni klinik gelmese de planlanan minimum batch sayısı tamamlanır.
3. **Token gerekçesi YOK.** Context dolmaya başlarsa o anki ilçe **bitirilir**, ardından yeni sohbet uyarısı verilir. Asla "az tarayıp atla" yapılmaz.
4. **Belirsiz miktarda çalışma YASAK.** Her adımda "kaç batch kaldı, kaç klinik bulundu, ne kadar yol gidildi" sayısal raporlanır.
5. **Kullanıcı manuel "yeter" demedikçe** her ilçenin minimum zorunlu işlemleri **mutlaka** yapılır.

---

## A.2 İLÇE BOYUTU ve ZORUNLU MİNİMUM ÇALIŞMA

**v2/v3'teki yumuşak "batch önerisi" kaldırıldı.** Aşağıdaki tablo **emredici minimum**:

| İlçe Sınıfı | Nüfus aralığı | Beklenen klinik | Zorunlu MİN çalışma |
|---|---|---|---|
| **MEGA** | 500k+ | 150-400 | 4 alt-parçaya BÖL, her parça için tam orta-ilçe çalışması yap |
| **Büyük** | 200k-500k | 80-180 | **K1: 8 batch (en az 48 sorgu)** + tam grid + K3 7 uzmanlık + K4 DT 5+ sayfa + K5 yorum extract + K6 TDB |
| **Orta** | 80k-200k | 30-80 | **K1: 5 batch (30 sorgu)** + tam grid + K3 7 uzmanlık + K4 DT 3+ sayfa + K5 + K6 |
| **Küçük** | 20k-80k | 10-30 | **K1: 3 batch (18 sorgu)** + grid (en az 8 nokta) + K3 + K4 DT 2 sayfa + K5 + K6 |
| **Çok küçük** | <20k | <12 | **K1: 2 batch (12 sorgu)** + grid (en az 5 nokta) + K3 + K6 |

**Önemli:** "Beklenen klinik" tahminin %50 altına düşersen **tarama eksik kabul edilir** → ek batch zorunlu.

### Örnek - Sivas Merkez (Büyük ilçe, ~370k):
- Beklenen klinik: 100-160
- Zorunlu: K1 8 batch (48+ sorgu) → ham havuz ~120-180 klinik
- Grid: Merkezin bbox'ından 25-35 nokta × 2 sorgu = 50-70 grid sorgusu
- Uzmanlık: 7 sorgu
- DT: doktortakvimi.com/dis-hekimi/sivas/merkez sayfaları (5+)
- Bunlar tamamlanmadan **diğer ilçeye geçiş YASAK**.

---

## A.3 PER-İLÇE TAMAMLAMA CHECKLIST (Zorunlu)

Her ilçe bitirildi denmeden önce Claude **bu listeyi açıkça kontrol etmeli** ve sonucu kullanıcıya bildirmeli:

```
İLÇE TAMAMLAMA RAPORU: [İlçe Adı]
============================================
[ ] K1 places minimum batch sayısı yapıldı mı?
    → Yapılan batch: X / Zorunlu: Y
[ ] K2 grid: tüm grid noktaları tarandı mı?
    → Tarandı: X / Toplam grid noktası: Y
[ ] K3 uzmanlık 7 sorgu yapıldı mı?
    → Yapılan: X / 7
[ ] K4 DT sayfaları çekildi mi?
    → Sayfa: X / Zorunlu min: Y
[ ] K5 yorum extract çalıştırıldı mı? (Faz 2)
    → Çıkarılan isim: X, reverse lookup: Y
[ ] K6 TDB cross-validation yapıldı mı? (mümkünse)
    → TDB erişimi: [VAR/YOK]
    → TDB'de bulunan kayıt: X
[ ] Toplam tespit edilen klinik: X
[ ] Beklenen aralık: Y-Z (nüfus tahminine göre)
[ ] X, beklenen aralığın içinde mi?  [EVET/HAYIR]
[ ] HAYIR ise → EK BATCH yapılacak

KAYNAK DAĞILIMI:
- places: X (%)
- grid: X (%)
- spec: X (%)
- dt: X (%)
- yorum: X (%)
- tdb: X (%)

GÜVEN SKORU DAĞILIMI:
- %100: X klinik
- %85: X klinik
- %65: X klinik
- %40: X klinik (gözden geçirilecek)

✅ İLÇE TAMAMLANDI / ❌ EK ÇALIŞMA GEREKLİ
```

**Bu raporu vermeden Claude bir sonraki ilçeye GEÇMEZ.**

---

## A.4 TOKEN/CONTEXT YÖNETİM PROTOKOLÜ

### A.4.1 Context kullanım eşikleri

Claude her ilçe BAŞLAMADAN önce bu kontrolü yapar:

| Context kullanımı | Eylem |
|---|---|
| %0-50 | Normal devam, sıradaki ilçeye geç |
| %50-65 | İçinde bulunduğun ilçeyi bitir, sonra kullanıcıyı uyar: "Yarı yoldayım, X ilçe kaldı" |
| %65-80 | İçinde bulunduğun ilçeyi bitir + **STOP**. Yeni sohbet uyarısı ver. Devam talimatı oluştur. |
| %80+ | İçinde bulunduğun ilçeyi mutlaka tamamla, **başka ilçe başlatma**. Devam dosyası teslim et. |

### A.4.2 ASLA yapılmaması gerekenler

❌ Bir ilçeyi yarıda bırakıp diğerine geçmek
❌ "Token tükeniyor, kısa keseyim" diye batch sayısını azaltmak
❌ Grid noktalarını atlama
❌ Uzmanlık sorgularını "vakit varsa yaparım" mantığıyla erteleme
❌ Tamamlama raporu vermeden ilerleme
❌ Context %50'yi geçtikten sonra yeni büyük ilçe başlatmak

### A.4.3 Doğru token-tükenme davranışı

Yanlış (Sivas'ta olan):
```
[Sivas Merkez Batch 3] → token azalıyor → küçük ilçeye geç → eksik liste
```

Doğru:
```
[Sivas Merkez Batch 5/8] → context %72 → "Merkez'i tamamlayıp duracağım,
   kalan 6 ilçe için yeni sohbet açman gerekecek"
→ Merkez'i 8 batch'le bitir → tamamlama raporu → present_files
→ Devam dosyası oluştur (aşağıda A.5)
→ Açık şekilde dur, kullanıcı yeni sohbet açar
```

---

## A.5 YENİ SOHBET DEVAM PROTOKOLÜ

Claude context limiti yaklaştığında **devam dosyası** oluşturur ve kullanıcıya verir:

### Devam Dosyası Yapısı

`{IL}_Devam_Talimati.md`:
```markdown
# {IL} Tarama Devam Talimatı

## Tamamlanan İlçeler (X / Y)
- [İlçe1]: 67 klinik, /mnt/.../[İlçe1]_v3.xlsx ✅
- [İlçe2]: 124 klinik, /mnt/.../[İlçe2]_v3.xlsx ✅
- ...

## SONRAKİ İLÇE: [İlçe Adı]
- Beklenen klinik: 80-120 (Orta-büyük ilçe)
- Mahalleler: [...]
- Bounding box: north=X, south=Y, east=Z, west=W
- TDB erişimi: VAR/YOK

## Kalan İlçeler (öncelik sırası)
1. [İlçe X] - beklenen N klinik
2. [İlçe Y] - beklenen N klinik
...

## Birleşik dosya henüz oluşturulmadı.
Tüm ilçeler bitince {IL}_GENELI_v3.xlsx üretilecek.

## Devam Komutu (yeni sohbette yapıştır):
```
[v3.1 metodoloji dokümanını yapıştır]

Bu il için tarama devam ediyor. Önceki sohbette tamamlanan ilçeler:
[liste]

Şimdi şu ilçeden devam et: [İlçe Adı]
Çıktıları /mnt/user-data/outputs/'a yaz.
Tüm kalan ilçeler bitince birleşik dosyayı oluştur.

Başla.
```

Kullanıcı bu dosyayı yeni sohbete yapıştırır → kaldığı yerden devam eder.

---

## A.6 BÜYÜK İL İÇİN OTURUMUN BAŞINDA PLANLAMA

Claude çalışmaya başlamadan önce **realistik bir plan** çıkartır:

### Plan şablonu (kullanıcıya açıkça gösterilir):

```
TARAMA PLANI: {IL}
========================
Toplam ilçe: X
- MEGA: X (4'er parçaya bölünecek)
- Büyük: X
- Orta: X
- Küçük: X
- Çok küçük: X

Toplam beklenen klinik: ~Y
Toplam beklenen batch sayısı: ~Z

Context tahmini:
- MEGA ilçe ≈ %20-30 context / ilçe
- Büyük ilçe ≈ %12-18 context / ilçe
- Orta ilçe ≈ %6-10 context / ilçe
- Küçük ilçe ≈ %3-5 context / ilçe

ÖNERİ:
- Eğer toplam tahmini context > %80 ise:
  → Birden fazla sohbete böl
  → Birinci sohbette en büyük X ilçe
  → İkinci sohbette kalan ilçeler
  → Üçüncü sohbette birleşik dosya

[Bu plan kullanıcı onayına sunulur, "evet devam" denirse başlar.]
```

**Önemli:** Plan onaylanmadan tarama başlamaz.

---

## A.7 İLÇE BOYUT TAHMİNİ (Tarama öncesi)

Sivas'ta yaşanan hatanın bir nedeni de "ilçe gerçekte ne kadar büyük?" bilgisinin tarama başlamadan netleşmemesi olabilir. Bu nedenle her ilçe için **bir ön araştırma sorgusu** yapılır:

```python
# Her ilçe için tarama BAŞLAMADAN ÖNCE:
web_search(f"{Ilce} {Il} nüfus diş hekimi sayısı")

# Veya basit places_search bir test sorgusu:
places_search(queries=[{"query": f"diş hekimi {Ilce} {Il}", "max_results": 10}])
# 10 sonuç hızlıca taşıyor mu? → büyük ilçe.
# 3-4 sonuç geliyor → orta-küçük.
# 0-2 sonuç → çok küçük (1 batch yeterli olabilir).
```

Buna göre **A.2 tablosundaki sınıfa karar verilir** ve doğru minimum çalışma yapılır.

---

## A.8 TAMAMLAMA YETERSİZLİĞİ DURUMU

Bir ilçenin tamamlama raporunda klinik sayısı beklenen aralığın **%50 altındaysa**:

1. Claude **otomatik olarak** ek batch'ler başlatır:
   - 2 ek mahalle-bazlı sorgu çifti
   - 5-10 ek grid noktası (önceden tarananların ARASINDAKİ noktalar — yoğunluk artırma)
   - DT sayfa sayısını artır (5 → 10)
2. Yeni tamamlama raporu verilir.
3. Hala %50 altındaysa: "Bu ilçede beklenenden %X az klinik bulundu. Olası nedenler:
   - İlçe gerçekten küçük (kullanıcı doğrulasın)
   - Mahalleler liste dışı kalmış (kullanıcı mahalle adı ekleyebilir mi?)
   - Google Maps coverage'ı düşük (TDB kritik — varsa erişim?)"
4. **Kullanıcı kararına bırak, ASLA sessizce kabul etme.**

---

# BÖLÜM B — v3 METODOLOJİSİ (DEĞİŞMEDİ)

Bölüm B'nin tamamı `Dis_Hekimi_Saha_Tarama_Metodolojisi_v3.md` ile **birebir aynıdır**. Aşağıdaki referansları kullan:

- v3 Bölüm 0: Girdiler
- v3 Bölüm 1: Çıktı tanımı
- v3 Bölüm 2: İlçe sınıflama → **A.2 ile DEĞİŞTİRİLDİ** (yumuşak öneri yerine emredici minimum)
- v3 Bölüm 3: Katman 1 (places_search 8 sorgu)
- v3 Bölüm 4: Katman 2 (grid) → grid tamamlanması ZORUNLU
- v3 Bölüm 5: Katman 3 (uzmanlık) → 7 sorgu ZORUNLU
- v3 Bölüm 6: Katman 4 (Doktor Takvimi) → minimum sayfa sayısı A.2'de
- v3 Bölüm 7: Katman 5 (yorum extract)
- v3 Bölüm 8: Katman 6 (TDB)
- v3 Bölüm 9: Cross-enrichment
- v3 Bölüm 10: Dışlama kuralları
- v3 Bölüm 11: Excel yapısı (15 sütun)
- v3 Bölüm 12: Build script şablonu

### v3'ten KALDIRILANLAR (yanıltıcı olduğu için)

❌ "Doygunluk testi" — tüm v3 dokümanında bu ifadeyi yok say.
❌ "Yeni klinik geliş oranı %25'in altına düştü" — yok say.
❌ "İkinci batch'te yeni klinik gelişi azaldıysa tarama yeterli" — yok say.

### v3'ten DEĞİŞTİRİLENLER

| v3'te şöyle | v3.1'de şöyle |
|---|---|
| "Büyük ilçeler 2 batch" | "Büyük ilçeler MİNİMUM 8 batch + tam grid + tam K3-K6" |
| "Doygunluk'a göre dur" | "A.2 tablosundaki minimum çalışma yapılana kadar dur YOK" |
| "Token verimliliği için Faz 2-3 isteğe bağlı" | "Faz 2-3 mutlaka yapılır, sadece tek sohbet yetmezse ikinci sohbete taşınır" |

---

# BÖLÜM C — KULLANICI İÇİN ÖZET

## Bu Sürümde Senin Garantilerin

1. **Bir ilçe yarıda bırakılmaz.** Claude ya tamamlar ya da "yeni sohbet aç" der.
2. **Her ilçe için tamamlama raporu** alırsın (klinik sayısı, kaynak dağılımı, beklenen aralığa uyumluluk).
3. **Beklenen aralığın %50 altındaysa** otomatik ek tarama yapılır.
4. **Tarama başlamadan plan** sunulur, onaylarsın.
5. **Context disiplini** — Claude proaktif olarak "büyük ilçeyi bitirip duruyorum" der, atlama yapmaz.

## Senin Yapacakların

1. Yeni sohbette **v3.1 + v3 ana dokümanı birlikte** yapıştır (v3.1 ekleme/düzeltme, v3 ana metot).
2. Plan onayı iste: Claude "%X context tahmin ediyorum, X sohbete bölmek mantıklı" derse onayla.
3. Her ilçe tamamlama raporunu kontrol et: "Beklenen 80-120 — bulunan 47" diyorsa devam etme onayı VERME, ek tarama iste.
4. Context %70'i geçince Claude'un "devam dosyası" oluşturmasını bekle, yeni sohbet aç.

---

## v3.1 ÖZEL BAŞLANGIÇ PROMPT'U (Sivas tipi hatayı engelleyen)

```
[v3 ve v3.1 dokümanlarını birlikte yapıştır, sonra:]

İl: Sivas
Başlangıç noktası: [lat, lng]
Taranacak ilçeler: Merkez, Şarkışla, Suşehri, Yıldızeli, Zara, Gemerek, ...
Coverage hedefi: TAM v3 (5 katman, %95+ coverage)

⚠️ KRİTİK DİSİPLİN KURALI:
- Herhangi bir ilçeyi yarıda BIRAKMA. Başladığın ilçeyi BİTİR.
- Token tükenirse o anki ilçeyi tamamla → devam dosyası oluştur → DUR.
- Her ilçe için A.3 tamamlama raporu ver, ben görmeden sonraki ilçeye geçme.
- v3.1 Bölüm A.2'deki minimum çalışma her ilçe için ZORUNLU.

İlk adım:
1. İlçeleri boyut sınıflarına ayır (A.2)
2. Context tahmini ve sohbet bölme önerisi sun (A.6)
3. Plan onayım sonrası başla.

Başla.
```

---

## SON NOT

v3.1 disiplin protokolü **opsiyonel değil**. Bu protokol uygulanmazsa Claude büyük ilçelerde yarıda bırakma riski taşır. Sivas tipi hatanın bir daha yaşanmaması için yeni sohbete bu dosya **mutlaka** eklenmeli.

Eğer kullanıcı "kısa tut, %85 yeter" derse o zaman A.2 tablosundaki minimum yarıya indirilebilir — ama **kullanıcı açıkça istemedikçe** tam coverage zorunludur.
