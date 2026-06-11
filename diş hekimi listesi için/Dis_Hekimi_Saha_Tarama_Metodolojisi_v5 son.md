# Diş Hekimi & Klinik Saha Tarama Metodolojisi v5
## KESİN BİRLEŞİK SÜRÜM — v2 + v3 + v3.1 + v4 tek metotta

> Bu doküman tek başına çalışır. Önceki sürümlerin **işe yarayan parçalarını** alır,
> **yanlışlarını** atar. Mardin saha testiyle doğrulandı.

---

## 0. HANGİ SÜRÜM NEYİ DOĞRU YAPIYOR? (işbölümü)

Önemli kavrayış: **tek bir sürüm "en çok kliniğe ulaşan" değil.** Her biri farklı bir
işi doğru yapıyor; v5 dördünün doğru parçalarını birleştirir:

| Katman | Hangi sürümden | Görevi | Tek başına eksiği |
|---|---|---|---|
| **RECALL motoru** | v2 çoklu-sorgu + **v3 grid** + sayfalama | Çok kliniğe ulaşmak | Gürültü toplar, doğrulamaz |
| **PRECISION (ayıklama)** | **v4** dışlama + dedup + ikili güven | Az gürültü | Recall'ı artırmaz |
| **DİSİPLİN** | **v3.1** | İlçeyi yarıda bırakmama | Çıktıyı değiştirmez |
| **ÇIKTI formatı** | **v2/Ankara** kanıtlanmış tablo | Merkeze uzaklık sıralı, renkli, puan/yorum/telefon | — |

**Mardin testinin gösterdiği:** Recall'ı belirleyen **tarama motoru**dur, disiplin
veya çıktı katmanı değil. Yalnız v2-tipi merkez-bias (K1) ~74 klinik buldu; grid +
sayfalama uygulayan bir tarama ~117 buldu. **Aradaki ~40 klinik neredeyse tamamen
yorumsuz/telefonsuz tek-hekim muayeneleri** — yani grid'in yakalamak için var olduğu
uzun-kuyruk. Sonuç: **grid + sayfalama opsiyonel değil, zorunlu.**

---

## 1. RECALL MOTORU (çok kliniğe ulaşmak) — ZORUNLU

Sıra önemli. Her ilçe için:

### 1.0 İLÇE LİSTESİ — ÖNCE TÜM İLÇELERİ ÇIKAR (ZORUNLU, en sık yapılan hata)
**Tarama başlamadan** ilin **bütün** ilçeleri listelenir (`web_search "{il} ilçeleri"`).
Sadece 2-3 büyük merkezi (il merkezi + en kalabalık 1-2 ilçe) tarayıp bitirmek
**ciddi recall hatasıdır** — küçük ilçelerdeki muayenehaneler tamamen kaçar.
- **HER ilçe taranır.** Büyük/orta ilçe → tam katman (K1+grid+DT). Küçük ilçe →
  en az 1 hedefli sorgu (`"diş hekimi {ilçe} {il}"`) + DT il-geneli.
- Küçük ilçede özel klinik çıkmazsa bile **"tarandı, özel yok, sadece devlet
  hastanesi/ASM"** diye raporla — atlama, sessizce geçme.
- Örn. Ordu: Altınordu/Ünye/Fatsa yetmez; Perşembe, Gölköy, Korgan, Kumru,
  Gürgentepe, Aybastı, Akkuş, Ulubey, İkizce, Çaybaşı, Gülyalı, Mesudiye,
  Çamaş, Çatalpınar, Kabadüz, Kabataş da taranır. (Kumru'da 5.0/24'lük, Aybastı'da
  4.9/79'luk klinikler yalnız ilçe taramasıyla bulundu.)

### 1.1 K0 — TDB / Oda üye listesi (payda, varsa ÖNCE)
`web_search("{il} diş hekimleri odası üye listesi")` → liste varsa hedef sayı +
isim listesi belli olur; sonraki katmanlar *keşif* değil *zenginleştirme*ye döner.
Erişilemezse atla, coverage'ı "tahmini" işaretle.

### 1.2 K1 — places çoklu-sorgu (v2 çekirdeği)
8 sorgu, doğru merkez bias, `max_results` maksimum, **doygunluk limiti YOK**:
```
"diş hekimi muayenehanesi {Ilce} merkez {Il}"
"Dt. diş doktoru {Mahalle} {Ilce} ara sokak"      ← bireysel hekim
"diş kliniği {Mahalle2} {Mahalle3} {Ilce}"
"ağız diş sağlığı polikliniği {Ilce}"
"diş hekimi {Ilce} {ana cadde}"  + 3 mahalle varyasyonu
```

### 1.3 K2 — GRID (recall'ın #1 kaldıracı) — ZORUNLU
**Neden:** tek merkez bias prestij sıralaması döndürür; yorumsuz solo hekim hiç
yüzeye çıkmaz. Grid her hücrede o hekimi *yerel 1 numara* yapar.
- bbox'ı **1.2 km** adımla böl, her nokta için `location_bias_radius≈1100` (köşe boşluğu yok), 2 sorgu (`"diş hekimi"`, `"Dt. diş muayenehanesi ara sokak"`).
- **Eski şehir / kenar mahalleleri (ör. Mardin'de Savurkapı) ayrıca bias'la** — merkez penceresinin dışında kalırlar.

### 1.4 SAYFALAMA — recall'ın #2 kaldıracı
places sonucu tek sayfada ~10-20 ile sınırlıdır. Mümkünse **sayfalama ile 60'a kadar**
çek (next_page_token). Tek sorgu + sayfalama, çoğu zaman 6 cümle varyasyonundan fazla getirir.

### 1.5 K3 — Uzmanlık (7 sorgu)
v4'teki gibi; büyük/orta ilçede `tam` hedefte çalıştır.

### 1.6 K4 — Doktor Takvimi — **HER ZAMAN SON SAYFAYA KADAR** (ZORUNLU)
**Neden kritik:** Mardin testinde Google ~119'da doydu; ek klinikler yalnız
Google-DIŞI kaynaktan geldi. DT, Google Maps'te hiç kaydı olmayan muayene hekimlerini
listeler (ör. 21 yorumlu Hüseyin Yıldırım Google'da yoktu). Bu yüzden DT **opsiyonel
değil** ve **ilk sayfayla yetinilmez.**

**Kural:** DT mutlaka **son sayfaya kadar** taranır. Tek sayfa = eksik tarama.
```
sayfa = 1
while True:
    url = f"https://www.doktortakvimi.com/dis-hekimi/{il-slug}?page={sayfa}"
    html = web_fetch(url, text_content_token_limit=7000)   # tam sayfa için yüksek limit
    hekimler = parse(html)            # ad, uzmanlık, adres, görüş, lat/lng ("Harita" linki)
    if not hekimler: break            # boş sayfa = son
    yeni += [h for h in hekimler if h not in master]   # master'a karşı dedup
    sayfa += 1
    if sayfa > 40: break              # güvenlik tavanı
```
- DT sunucu-render'dır (SPA değil) → `web_fetch` çalışır; önce `web_search` ile URL'i
  doğrula, sonra `?page=N` ile ilerle.
- **Koordinat bedava:** her kartın "Harita" linki `?query=lat,lng` içerir → reverse-lookup'a
  gerek yok, doğrudan rotaya katılır.
- İl geneli `/dis-hekimi/{il}` sayfalanır; gerekirse ilçe sayfaları
  (`/dis-hekimi/{il}/{ilce}`) ayrıca taranır.
- Dedup: place_id yok → **isim + adres/telefon** ile Google havuzuna eşle; eşleşmezse
  `source:"dt"`, Varlık %60, not "Google'da yok".

### 1.7 K5 — yorumdan isim çıkarma
v4'teki gibi (büyük ilçe + `tam` hedef).

### 1.6 Durma kriteri (hibrit, v4)
**A)** TDB varsa: bulunan ≥ TDB %90. **B)** Yoksa: son 2 batch net-yeni < %5 **ve**
toplam ≥ beklenen alt sınır. Sabit minimum YOK.

---

## 2. PRECISION (az gürültü) — v4 ayıklama

Recall motoru gürültü de toplar (Mardin'de bir **parfüm dükkânı** "Dr. Mars Kolonyaları"
diş kliniği diye girmişti). Bu yüzden her kayıt şu süzgeçten geçer:

### 2.1 Dışlama
Başka ilçe/il adresli, ASM, veteriner, eczane/optisyen/lab, **diş-dışı işletme
(kolonya/kuaför vb.), turistik mekan, genel Tıp Fak.** → HARİÇ.
Üniversite **Diş Hek. Fak.** + Devlet **ADSM/Diş Hastanesi** → KAMU sayfası (özel listeden çıkar).

### 2.2 Dedup (3 anahtar, sırayla)
1. **place_id** eşit → kesin aynı (en güçlü anahtar).
2. **telefon** (son 10 hane) eşit → aynı.
3. **isim[:16] + konum < 0.12 km** → aynı.
Aynı koordinat farklı hekim (plaza) → otomatik birleştirme, **manuel kuyruk**.

### 2.3 İkili güven (v4)
- **Varlık%:** TDB'de 100 · ≥2 bağımsız köken 80-95 · tek köken 60. (places+grid aynı köken sayılır.)
- **Konum%:** gerçek lat/lng 100 · adresten 60 · ilçe merkezine atanmış 30 (gri + "doğrula").

---

## 3. DİSİPLİN (v3.1)
İlçe yarıda bırakılmaz; token dolarsa o ilçe bitirilir → devam dosyası → DUR.
Her ilçe için tamamlama raporu (kaç klinik, kaynak dağılımı, beklenen banda uyum).

---

## 4. ÇIKTI TABLOSU (v2/Ankara kanıtlanmış format)

**Sıralama: başlangıç/merkez noktasına KUŞ UÇUŞU uzaklığa göre artan** (en yakın en üstte).
İl geneli birleşikte tek global NN+2-opt rota da eklenebilir.

**Sütunlar:**
`Sıra · Merkeze Uzaklık (km) · İlçe · Klinik Adı · Mahalle · Adres · Telefon ·
Google Puanı · Yorum Sayısı · Tip/Özellik · Kaynak · Güven% · place_id ·
Ziyaret · Temsilci · Durum · Sipariş · Notlar`

**Renk (önemli klinikler vurgulu):**
| Renk | Kural |
|---|---|
| 🟧 Turuncu | MEGA LEAD — 150+ yorum (büyük illerde 300+) |
| 🟨 Sarı | HOT LEAD — 50-149 yorum |
| 🟦 Mavi | UZMAN (ortodonti / çene cer. / pedodonti …) |
| 🟥 Kırmızı | Gözden geçir — olası mükerrer / şüpheli |
| ⬜ Beyaz | Standart / düşük yorum (long-tail — yine değerli B2B) |

**Sayfalar:** (1) Özel klinikler — uzaklık sıralı renkli, (2) KAMU/ADSM & Hastane,
(3) Açıklama + renk lejantı + ilçe dağılımı + temizlik log.

---

## 5. KALİTE METRİKLERİ
- TDB varsa bulunan ⊇ %90; yoksa marjinal-getiri belgele.
- Toplam ≥ K1'in 1.3 katı (grid çalıştıysa).
- Konum güveni <50 oranı %15'i geçmesin.
- **Gürültü kontrolü:** her kayıt "gerçekten diş kliniği mi?" — Tip alanı "dental/dentist"
  içermeli; içermiyorsa manuel doğrula (kolonya/kuaför tuzağı).
- Yanlış-ilçe / il-dışı: sıfır hedef.

---

## 6. ÖZET — neden v5
- **Çok klinik:** grid + sayfalama (recall motoru) — v2-tek-bias'ın göremediği uzun kuyruğu yakalar.
- **Az gürültü:** v4 dışlama + 3-anahtar dedup + ikili güven — parfüm dükkânını, mükerreri eler.
- **Merkeze uzaklık sıralı + renkli + puan/yorum/telefon:** v2/Ankara kanıtlanmış tablo.
- **Yarıda kalmaz:** v3.1 disiplini.

İyi toplayıcı + iyi ayıklayıcı + disiplinli + kullanışlı çıktı = v5.

---

## KVKK / ToS
İsimli hekim verisi derlenir; kamuya açık iş kayıtları, amaçla sınırlı (KVKK md.4),
robots.txt/ToS'a saygı, yalnız meşru B2B iletişim (ETK izinleri ayrıca geçerli).
