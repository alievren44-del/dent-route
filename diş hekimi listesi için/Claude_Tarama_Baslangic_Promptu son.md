# CLAUDE — DİŞ HEKİMİ SAHA TARAMA BAŞLANGIÇ PROMPT'U (v5)
## Kullanım: Bu metni + `Dis_Hekimi_Saha_Tarama_Metodolojisi_v5.md` dosyasını birlikte yeni sohbete yapıştır.

---

## A. GÖREV

Bir ilin diş hekimi/klinik listesini saha temsilcisi için çıkar. Çıktı: **merkeze
uzaklığa göre sıralı, renkli, Google puanı + yorum sayısı + telefon dolu Excel.**
Amaç: **mümkün olan en çok kliniğe ulaşmak** + **gürültüsüz** liste.

Ekteki v5 metodolojisini uygula. Aşağıdaki kurallar v5'in ÜZERİNE bağlayıcıdır;
çelişki olursa bu kurallar geçerlidir.

---

## B. BENİM GİRDİLERİM (sen doldurmadan başlama — eksikse sor)

- **İl:** __________
- **Başlangıç/depo koordinatı (ev veya depo):** lat=______, lng=______
  (Bu olmadan "merkeze uzaklık" sıralaması yapılamaz — mutlaka iste.)
- **Taranacak ilçeler:** __________ (boş bırakırsam: tüm ilçeler)
- **Coverage hedefi:** tam (K0–K5) / genişletilmiş / standart  → seçmezsem **tam**
- **B2B bağlamı (opsiyonel):** temsilci/ürünler
- **Kısıtlar:** vefat hekim listesi, hariç tutulacaklar vb.

---

## C. SIFIR-TOLERANS KURALLAR (bu sohbette yapılan hataları engeller)

### C.1 RECALL — "çok klinik" için
1. **Sadece merkez-bias places (K1) ile YETİNME.** Tek merkezden tarama prestijli
   klinikleri getirir, yorumsuz/telefonsuz solo muayeneleri KAÇIRIR. Her büyük/orta
   ilçede **K2 GRID zorunludur** (1.2 km adım, dar yarıçap ~1100, her hücrede
   "diş hekimi" + "Dt. ara sokak").
2. **Doktor Takvimi'ni (K4) HER ZAMAN SON SAYFAYA KADAR tara.** `/dis-hekimi/{il}`,
   sonra `/2`, `/3`, … boş sayfaya kadar. **Tek sayfa = eksik tarama = hata.**
   DT, Google'da hiç olmayan muayene hekimlerini verir; bu listenin %20-30'u olabilir.
3. **Eski şehir / kenar mahalleleri ayrıca bias'la** (merkez penceresi dışında kalırlar).
4. places aracı sorgu başına ~10 sonuç verir, sayfalama yapmaz — bu yüzden recall'ı
   **grid + DT** ile sağla, tek sorguyu çok çalıştırmaya güvenme.

### C.2 PRECISION — "gürültüsüz" için
5. **Her kayıt gerçekten diş kliniği mi?** Google `types` alanında `dental_clinic` /
   `dentist` yoksa **dahil etme.** (Bu sohbette bir **parfüm dükkânı "Dr. Mars
   Kolonyaları"** yanlışlıkla listeye girmişti — bunu engelle.)
6. **DT'deki her hekimi AYRI KLİNİK SAYMA.** Bir hekim mevcut bir polikliniğin
   (ör. Deniz Dental, Mardent, Alfadent, ADSM, Devlet Hastanesi) çalışanıysa o klinik
   zaten listede → **mükerrer ekleme.** Yalnız **bağımsız kendi muayenehanesi** olanı ekle.
7. **3 anahtarlı dedup, sırayla:** (a) place_id eşit → kesin aynı, (b) telefon son 10
   hane eşit → aynı, (c) isim[:16] + konum <0.12 km → aynı. Aynı isim iki kez girmesin
   (bu sohbette "Klinik Nova" iki kez girmişti).
8. **Dışla:** başka ilçe/il adresli (adres metnine bak), ASM, veteriner, eczane,
   optisyen, lab, turistik mekan, genel Tıp Fakültesi.

### C.3 SINIFLANDIRMA
9. **KAMU'yu doğru ayır.** Devlet ADSM / Diş Hastanesi / Üniversite Diş Hek. Fak.
   → KAMU sayfası (özel listeden çıkar). Özel poliklinikleri KAMU sanma, ADSM'i özel
   sanma. (Bu sohbette ADSM'ler özel, özel klinikler KAMU diye yanlış etiketlenmişti.)

### C.4 GÜVEN SKORU
10. **Sıfır-yorumlu kaydı cezalandırma/atma.** Long-tail solo hekimler pazarın üçte
    biri ve B2B'de en bakir segment. İkili güven kullan: **Varlık%** (TDB'de 100,
    ≥2 bağımsız köken 80, tek köken 60) ve **Konum%** (gerçek lat/lng 100, tahmini 30).

### C.5 DİSİPLİN (yarıda bırakma)
11. **Bir ilçeyi yarıda bırakıp diğerine GEÇME.** Başladığın ilçeyi durma kriterine
    kadar bitir.
12. **Token/context dolmaya başlarsa:** o anki ilçeyi TAMAMLA → **devam dosyası**
    oluştur (tamamlanan ilçeler + sıradaki ilçe + kalanlar + yeni sohbet komutu) → DUR.
    "Token bitiyor, kısa keseyim / az tarayıp atlayayım" YAPMA.
13. **Her ilçe için tamamlama raporu ver, ben onaylamadan sonraki ilçeye geçme.**

---

## D. İZLEYECEĞİN ADIMLAR

1. **Planla (tarama ÖNCESİ):** `web_search "{il} ilçeleri"` ile **TÜM ilçeleri** çıkar (eksiksiz liste). İlçeleri boyuta göre sınıfla (nüfus için `web_search`),
   context tahmini yap, **"bu il X sohbete bölünmeli"** önerini sun. **Onayımı al.**
2. **K0 — TDB:** İl diş hekimleri odası üye listesi var mı? Varsa payda olarak çek.
   Yoksa belirt, coverage'ı "tahmini" işaretle.
3. **Her ilçe için sırayla:** K1 places (çok sorgu) → K2 grid → K3 uzmanlık →
   K4 Doktor Takvimi (SON SAYFAYA KADAR) → (tam hedefte K5 yorum-extract).
4. **Birleştir + temizle:** 3-anahtar dedup, dışlama, KAMU ayır, ikili güven, lead skoru.
5. **Çıktı Excel'i üret** (Bölüm E), `present_files` ile teslim.
6. **Tamamlama raporu** ver → onay → sonraki ilçe.
7. Tüm ilçeler bitince **birleşik il dosyası** + genel özet.

---

## E. ÇIKTI FORMATI (kesin)

**Sıralama:** başlangıç/depo koordinatına **kuş uçuşu uzaklığa göre artan** (en yakın üstte).

**Sayfa 1 — Özel Klinikler. Sütunlar:**
`Sıra · Merkeze Uzaklık (km) · İlçe · Klinik Adı · Mahalle · Adres · Telefon ·
Google Puanı · Yorum Sayısı · Tip/Özellik · Kaynak · Varlık% · Konum% · Lead ·
place_id · Ziyaret · Temsilci · Durum · Sipariş · Notlar`

**Renkler (önemli klinikler vurgulu):**
- 🟧 Turuncu: 150+ yorum (büyük illerde 300+) — MEGA LEAD
- 🟨 Sarı: 50–149 yorum — HOT LEAD
- 🟦 Mavi: UZMAN (ortodonti/çene cer./pedodonti…)
- 🟩 Yeşil: yalnız DT/Google-dışı kaynaktan (Google'da yok)
- 🟥 Kırmızı: gözden geçir (olası mükerrer/şüpheli)
- ⬜ Beyaz: standart/düşük yorum (long-tail — yine değerli)

**Sayfa 2 — KAMU/ADSM & Hastane.**
**Sayfa 3 — Açıklama:** renk lejantı, ilçe dağılımı, **temizlik logu** (çıkarılan
false-positive'ler, birleştirilen mükerrerler, KAMU/özel düzeltmeleri), kaynak dağılımı.

Telefon/puan/yorum **boş bırakılmaz** (varsa yazılır; DT-only'de telefon profilde →
"DT profilinde" notu). DT-only kayıtlara not: "Google'da yok; konum tahmini" + Konum %30.

---

## F. HER İLÇE TAMAMLAMA RAPORU (sonraki ilçeye geçmeden ver)

```
İLÇE: [ad]
K0 TDB: [VAR/YOK, N] | K1 places: X | K2 grid noktası: X | K3 uzmanlık: 7/7
K4 Doktor Takvimi: [sayfa 1..N TÜMÜ tarandı mı? E/H] → bulunan: X, yeni(Google'da yok): X
Benzersiz özel klinik: X | KAMU: X
Beklenen aralık: Y–Z | İçinde mi: [E/H] (H ise ek tarama)
Kaynak dağılımı: google %.. dt %.. tdb %..
Temizlik: çıkarılan false-positive: X | birleştirilen mükerrer: X
✅ TAMAMLANDI / ❌ EK ÇALIŞMA
```

---

## G. ASLA YAPMA (bu sohbette görülen somut hatalar)

- ❌ Sadece il merkezini / en büyük 2-3 ilçeyi tarayıp bitirme. **İLİN TÜM İLÇELERİ taranır** (önce `web_search "{il} ilçeleri"` ile listeyi çıkar). Küçük ilçede klinik yoksa bile "tarandı, özel yok" diye raporla.
- ❌ Sadece K1 ile bitirip "tarama tamam" deme (grid + DT yapmadan eksiktir).
- ❌ Doktor Takvimi'ni tek sayfayla bırakma — **son sayfaya kadar.**
- ❌ Diş kliniği olmayan işletmeyi (kolonya/kuaför/eczane) listeye koyma.
- ❌ DT'deki poliklinik çalışanını ayrı klinik sayıp listeyi şişirme.
- ❌ Aynı kliniği iki kez (mükerrer) bırakma.
- ❌ ADSM'i özel, özeli KAMU diye etiketleme.
- ❌ Token bitiyor diye ilçeyi yarıda bırakıp atlama — bitir, devam dosyası ver, dur.
- ❌ Sıfır-yorumlu solo hekimi "değersiz" diye eleme.
- ❌ Tamamlama raporu vermeden sonraki ilçeye geçme.
- ❌ Başlangıç koordinatı sormadan başlama.

---

## H. BAŞLAT

Önce **plan + context bölme önerisi** sun (Adım D.1). Ben "onayla, başla" deyince
ilk ilçeden başla. Büyük illerde tek sohbette bitmeyeceğini baştan söyle ve sohbet
bölme planı ver.

İl: __________
Başlangıç noktası: __________
Coverage: tam

Başla.
