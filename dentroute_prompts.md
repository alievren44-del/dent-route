# DentRoute — Claude Code Prompt Seti

**Diş hekimi B2B saha satış + CRM + sipariş + numune yönetimi uygulaması**

Türkiye geneli, ekip destekli, mobil uyumlu, ücretsiz veya düşük maliyetli altyapı.

## Kullanım talimatı

1. Promptları **sırayla** Claude Code'a yapıştır. Her biri öncekinin üzerine inşa edilir.
2. Bir prompt bitmeden diğerine geçme. Claude Code "tamam" deyince devam et.
3. Her promptun sonundaki **doğrulama** adımını çalıştır, çalışıyorsa bir sonrakine geç.
4. Sorun çıkarsa Claude Code'a "şu hatayı veriyor, düzelt" diye yaz.

## Genel kurallar (Claude Code'a tüm promptlarda hatırla)

- Tüm kod Türkçe yorumlu
- Type hints zorunlu (`from typing import ...`)
- Her dosya çalışır halde, yarım bırakılmaz
- Logging: Hardcoded `print` kullanma, her zaman `logger.info/error` kullan
- Hata yönetimi: try/except blokları boş bırakılmaz, ya logla ya re-raise et
- Dosyalar 500 satırı geçerse modülere ayır

## API anahtarları (önceden hazırla)

1. **Gemini API** (zorunlu, ücretsiz): ai.google.dev → "Get API key"
2. **Supabase** (önerilen, ücretsiz): supabase.com → New project, URL + anon key al
3. **Google Maps API** (opsiyonel): console.cloud.google.com → Places API etkinleştir
4. **WhatsApp Cloud API** (opsiyonel): developers.facebook.com → Business App
5. **Meta Cloudflare Workers** (webhook için, ücretsiz): cloudflare.com

---

# PROMPT 1 — Proje iskeleti + log/hata altyapısı

````
DentRoute adında bir Python projesi oluştur. Türkiye geneli diş hekimi B2B saha satış + CRM uygulaması.

Mimari kararlar:
- Python 3.11+
- Streamlit (web arayüzü)
- SQLite + opsiyonel Supabase (Postgres)
- SQLAlchemy ORM + Alembic migration
- Type hints zorunlu
- Loguru ile loglama (print kullanma)
- Çekirdek + modüler yapı (sources/, crm/, katalog/, vs.)

Klasör yapısı:
```
dentroute/
├── pyproject.toml
├── README.md
├── .env.example
├── .gitignore
├── config.yaml
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/
├── data/
│   ├── master/
│   ├── cache/
│   └── logs/
├── outputs/
│   ├── excel/
│   ├── pdf/
│   └── maps/
├── src/
│   ├── __init__.py
│   ├── config.py
│   ├── logging_config.py
│   ├── errors.py
│   ├── db.py
│   ├── geo.py
│   └── classifier.py
├── ui/
│   └── streamlit_app.py
├── cli/
│   └── main.py
├── scripts/
│   └── init_db.py
└── tests/
    ├── conftest.py
    └── test_smoke.py
```

Dosya içerikleri:

1. pyproject.toml:
   - Proje meta (name, version, description, author)
   - dependencies: openpyxl, requests, beautifulsoup4, pyyaml, python-dotenv,
     google-generativeai, streamlit, sqlalchemy, alembic, click, folium, pandas,
     loguru, pytest, pytest-cov, ruff, mypy, reportlab, bcrypt, supabase
   - tool.ruff config (line length 100)
   - tool.mypy config (strict)
   - tool.pytest config

2. .env.example: GEMINI_API_KEY, GOOGLE_MAPS_API_KEY, SUPABASE_URL, SUPABASE_KEY,
   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, DB_MODE (sqlite|supabase)

3. config.yaml:
   - app: name, version
   - home: lat, lng (varsayılan Ankara: 39.9208, 32.8541)
   - tarama: default_source (ucretsiz|google), cache_days (90), max_concurrent (1)
   - excel: output_dir
   - logging: level (INFO), file_rotation (10 MB)

4. src/logging_config.py:
   - Loguru kurulumu
   - Hem console hem file logging
   - data/logs/dentroute.log, 10 MB rotation, 30 gün retention
   - JSON format opsiyonu (production için)
   - Tüm modüllerden `from src.logging_config import logger` ile kullanılır

5. src/errors.py — özel exception class'ları:
   - DentRouteError (base)
   - APIError (Gemini, Google, OSM, DT için)
   - RateLimitError
   - ValidationError
   - NotConfiguredError (API key yok)
   - DataQualityError (Gemini bozuk yanıt)
   - PermissionError (rol bazlı yetkilendirme)

6. src/config.py:
   - Pydantic BaseSettings ile config.yaml + .env merge
   - Singleton pattern: `from src.config import config`
   - Type-safe erişim: config.tarama.default_source

7. src/db.py:
   - SQLAlchemy engine + session factory
   - DB_MODE env'e göre SQLite veya Supabase Postgres
   - Bağlantı havuzu
   - Context manager: `with get_session() as session: ...`
   - Tüm modeller `src/models/` altında ayrı dosyalarda (henüz boş)

8. alembic.ini + alembic/env.py:
   - SQLAlchemy modellerini otomatik algıla
   - `alembic revision --autogenerate -m "..."` çalışsın
   - `alembic upgrade head` ile uygula

9. scripts/init_db.py:
   - İlk kurulum: alembic upgrade head
   - Master verileri yükle (tr_iller.json, tr_ilceler.json — PROMPT 6'da gelir)
   - Varsayılan admin kullanıcı oluştur (PROMPT 8'de aktif)

10. tests/conftest.py:
    - pytest fixture'ları: temp DB, mock API, sample data
    - Her test öncesi DB sıfırlanır

11. tests/test_smoke.py:
    - Config yüklenebilir mi?
    - DB bağlanabilir mi?
    - Logger çalışıyor mu?
    - Bu testler `pytest` ile geçmeli

12. README.md:
    - Proje açıklaması
    - Kurulum: git clone, pip install, .env doldur, scripts/init_db.py
    - Geliştirme: ruff check, mypy, pytest
    - Streamlit çalıştırma: streamlit run ui/streamlit_app.py
    - CLI: python -m cli.main --help

13. .gitignore: .env, *.db, __pycache__, data/cache, data/logs, outputs, .pytest_cache

Doğrulama adımı:
- `pip install -e .`
- `pytest tests/test_smoke.py` → tüm testler geçmeli
- `python -c "from src.config import config; print(config.app.name)"` → "DentRoute"
- `python -c "from src.logging_config import logger; logger.info('test')"` → log dosyasında görünmeli
````

---

# PROMPT 2 — Türkiye master verisi (sabit JSON)

````
DentRoute için Türkiye il/ilçe master verisini hazırla. **Veri promptun içinde hardcoded** olmalı, dış kaynaktan indirme yok.

1. data/master/tr_iller.json oluştur — 81 il:

```json
[
  {"plaka": 1, "ad": "Adana", "slug": "adana", "lat": 37.0, "lng": 35.32, "nufus": 2274106, "bolge": "Akdeniz"},
  {"plaka": 2, "ad": "Adıyaman", "slug": "adiyaman", "lat": 37.76, "lng": 38.28, "nufus": 632148, "bolge": "Güneydoğu Anadolu"},
  ...
  {"plaka": 81, "ad": "Düzce", "slug": "duzce", "lat": 40.84, "lng": 31.16, "nufus": 405131, "bolge": "Karadeniz"}
]
```

**Tüm 81 ili tam koordinat ve TÜİK 2023 nüfusla doldur.** Bölge sınıflandırması:
- Marmara: 11 il (İstanbul, Bursa, Kocaeli, Tekirdağ, Balıkesir, Çanakkale, Edirne, Kırklareli, Sakarya, Yalova, Bilecik)
- Ege: 8 il (İzmir, Aydın, Manisa, Denizli, Muğla, Afyonkarahisar, Kütahya, Uşak)
- Akdeniz: 8 il (Antalya, Adana, Mersin, Hatay, Kahramanmaraş, Burdur, Isparta, Osmaniye)
- İç Anadolu: 13 il (Ankara, Konya, Kayseri, Eskişehir, Sivas, Yozgat, Aksaray, Çankırı, Kırıkkale, Kırşehir, Nevşehir, Niğde, Karaman)
- Karadeniz: 18 il (Samsun, Trabzon, Ordu, Giresun, Rize, Artvin, Düzce, Bolu, Kastamonu, Sinop, Zonguldak, Bartın, Karabük, Çorum, Tokat, Amasya, Gümüşhane, Bayburt)
- Doğu Anadolu: 14 il (Erzurum, Van, Malatya, Elazığ, Erzincan, Bingöl, Ağrı, Iğdır, Kars, Ardahan, Tunceli, Bitlis, Muş, Hakkari)
- Güneydoğu Anadolu: 9 il (Gaziantep, Şanlıurfa, Diyarbakır, Mardin, Batman, Siirt, Şırnak, Kilis, Adıyaman)

2. data/master/tr_ilceler.json — ~973 ilçe. Her ilçe için:
```json
{"il_plaka": 1, "il_ad": "Adana", "ad": "Seyhan", "slug": "seyhan", "lat": 37.0, "lng": 35.32, "nufus_2023": 805160}
```

**ÖNEMLİ:** Tüm 973 ilçeyi hardcoded olarak yaz. Büyük şehirler özellikle önemli:
- İstanbul (39 ilçe): Adalar, Arnavutköy, Ataşehir, Avcılar, Bağcılar, Bahçelievler, Bakırköy, Başakşehir, Bayrampaşa, Beşiktaş, Beykoz, Beylikdüzü, Beyoğlu, Büyükçekmece, Çatalca, Çekmeköy, Esenler, Esenyurt, Eyüpsultan, Fatih, Gaziosmanpaşa, Güngören, Kadıköy, Kağıthane, Kartal, Küçükçekmece, Maltepe, Pendik, Sancaktepe, Sarıyer, Silivri, Sultanbeyli, Sultangazi, Şile, Şişli, Tuzla, Ümraniye, Üsküdar, Zeytinburnu
- Ankara (25 ilçe): Akyurt, Altındağ, Ayaş, Bala, Beypazarı, Çamlıdere, Çankaya, Çubuk, Elmadağ, Etimesgut, Evren, Gölbaşı, Güdül, Haymana, Kahramankazan, Kalecik, Keçiören, Kızılcahamam, Mamak, Nallıhan, Polatlı, Pursaklar, Sincan, Şereflikoçhisar, Yenimahalle
- İzmir (30 ilçe): Aliağa, Balçova, Bayındır, Bayraklı, Bergama, Beydağ, Bornova, Buca, Çeşme, Çiğli, Dikili, Foça, Gaziemir, Güzelbahçe, Karabağlar, Karaburun, Karşıyaka, Kemalpaşa, Kınık, Kiraz, Konak, Menderes, Menemen, Narlıdere, Ödemiş, Seferihisar, Selçuk, Tire, Torbalı, Urla

Sivas zaten önceki sohbette test edildi, 17 ilçesi: Akıncılar, Altınyayla, Divriği, Doğanşar, Gemerek, Gölova, Gürün, Hafik, İmranlı, Kangal, Koyulhisar, Merkez, Suşehri, Şarkışla, Ulaş, Yıldızeli, Zara.

Veriyi olabildiğince doğru ver. Nüfusu bilinmiyorsa "0" yaz, sonradan güncellenir.

3. data/master/dt_slug_eslestirme.json — DoktorTakvimi'nde farklı yazılan slug'lar:
```json
{
  "afyonkarahisar": "afyon",
  "kahramanmaras": "kahramanmaras",
  "sanlıurfa": "sanliurfa",
  "afyonkarahisar/sandikli": "afyon/sandikli",
  ...
}
```
En az 30 bilinen istisna ekle. Bilmiyorsan Türkçe karakter dönüşümü varsayılan (ç→c, ğ→g, ı→i, ö→o, ş→s, ü→u).

4. src/geo.py:
   - load_provinces() -> list[dict]
   - load_districts(province: str) -> list[dict]
   - get_province(plaka_or_name) -> dict | None
   - get_district(province: str, district: str) -> dict | None
   - search_provinces(query: str) -> list[dict] — Türkçe karakter duyarsız fuzzy match
   - search_districts(query: str, province: str | None = None) -> list[dict]
   - slugify(text: str) -> str — Türkçe karakter dönüşümü
   - dt_slug(province: str, district: str | None = None) -> str — eşleştirme tablosunu kullan
   - get_district_bbox(province: str, district: str, radius_km: int = 5) -> dict — bounding box

5. src/classifier.py:
   - classify_district(nufus: int) -> DistrictClass (Pydantic model)
     * sinif: "MEGA" | "Büyük" | "Orta" | "Küçük" | "ÇokKüçük"
     * min_batch: int
     * beklenen_min: int, beklenen_max: int
     * grid_nokta_sayisi: int
   - Eşikler:
     * MEGA: 500k+, 16 batch, 150-400, 35 grid
     * Büyük: 200-500k, 8 batch, 80-180, 25 grid
     * Orta: 80-200k, 5 batch, 30-80, 15 grid
     * Küçük: 20-80k, 3 batch, 10-30, 8 grid
     * ÇokKüçük: <20k, 2 batch, 0-12, 5 grid

6. tests/test_geo.py:
   - Tüm 81 il yükleniyor mu?
   - İstanbul'un 39 ilçesi var mı?
   - search_provinces("ist") → "İstanbul" döndürüyor mu?
   - slugify("Şişli") → "sisli"?
   - dt_slug("Afyonkarahisar") → "afyon"?

7. tests/test_classifier.py:
   - 2274106 nüfus → "MEGA"
   - 100000 → "Orta"
   - 5000 → "ÇokKüçük"

Doğrulama:
- `pytest tests/test_geo.py tests/test_classifier.py` → tüm testler geçmeli
- `python -c "from src.geo import load_provinces; print(len(load_provinces()))"` → 81
- `python -c "from src.geo import load_districts; print(len(load_districts('İstanbul')))"` → 39
````

---

# PROMPT 3 — OSM kapsama testi + veri kaynakları

````
DentRoute için veri kaynakları modülleri. Önce **OSM Türkiye kapsama testi** yap, sonra modülleri yaz.

ADIM 1: OSM Türkiye kapsama testi

scripts/test_osm_coverage.py oluştur:
- 10 farklı büyüklükte ilçeyi test et:
  * MEGA: İstanbul Kadıköy, Ankara Çankaya, İzmir Konak
  * Büyük: Bursa Nilüfer, Antalya Muratpaşa, Konya Selçuklu
  * Orta: Sivas Merkez, Trabzon Ortahisar, Eskişehir Tepebaşı
  * Küçük: Erzincan Merkez, Bingöl Merkez
- Her ilçe için Overpass API sorgu at, dental kayıt sayısını yazdır
- Çıktı: data/logs/osm_coverage_test.json
- Format: {"İstanbul/Kadıköy": 42, "Sivas/Merkez": 8, ...}

Bu test sonucu kullanıcıya göster, sonra modülleri yaz. Sonuç:
- Ortalama %30+ kapsama varsa OSM kullanılabilir
- Daha az ise DT ve Google ağırlıklı strateji benimsenir

ADIM 2: Veri kaynak modülleri

1. src/sources/base.py:
   - BaseSource abstract class:
     * fetch(province, district, **kwargs) -> list[ClinicDict]
     * get_cache_key(province, district) -> str
     * cache_age_days property
   - ClinicDict TypedDict: name, address, lat, lng, phone, rating, reviews, source, raw_data

2. src/sources/cache.py:
   - JSON cache yöneticisi: data/cache/{source}_{province}_{district}.json
   - get(key) -> dict | None (90 günden eski ise None)
   - set(key, data)
   - invalidate(key)
   - invalidate_all(source=None)
   - TTL ayarlanabilir (config'den)

3. src/sources/osm.py:
   - Overpass API endpoint: https://overpass-api.de/api/interpreter
   - Sorgu stratejisi:
     a) İlçe area'sı + healthcare=dentist VE amenity=dentist
     b) Koordinat etrafında radius (around: 5000m)
   - Rate limit: 3 saniye bekleme (Overpass nazik politika)
   - Retry: 3 deneme, exponential backoff (1s, 2s, 4s)
   - RateLimitError fırlat (429 dönerse)
   - User-Agent: "DentRoute/1.0 (dental sales tool; contact@example.com)"
   - robots.txt: Overpass'in robots.txt'i yok, sorun değil

4. src/sources/doktortakvimi.py:
   - URL pattern: https://www.doktortakvimi.com/dis-hekimi/{il-slug}/{ilce-slug}/{sayfa}
   - robots.txt kontrolü: /robots.txt indir, /dis-hekimi crawl yasak mı?
     * Eğer yasaksa: log uyarısı ver, kullanıcıya soru sor (manuel devam et?)
     * Çoğu durumda izin verilir
   - HTML parsing (BeautifulSoup):
     * Sayfa 1-5 dene
     * Her hekim için: ad, unvan (Dr/Dt/Uzm.Dt/Doç./Prof.), adres, kurum adı,
       harita koordinatı (Google Maps embed src'inden çıkar)
     * Hekim profil link'inden detay (isteğe bağlı)
   - User-Agent rotation: 5 farklı tarayıcı UA arasında değiştir
   - Rate limit: 2 saniye
   - 30 günlük cache
   - Hata durumunda boş liste döndür, log yaz

5. src/sources/google.py:
   - Google Places API (text_search + nearby_search)
   - Konfigüre değilse NotConfiguredError fırlat
   - Sorgular: "diş hekimi {ilce}", "diş kliniği {ilce}", "diş polikliniği {ilce}",
     "ortodontist {ilce}", "ağız ve diş sağlığı {ilce}"
   - place_details ÇAĞIRMA (pahalı), text_search yeterli
   - next_page_token ile pagination (max 60/sorgu)
   - Türkiye'de "doctor" kategorisinde de diş hekimi gelebilir, filtrele:
     * name veya types içinde "dent" geçenler kabul
   - Budget guard: tek tarama içinde max 30 API çağrısı, aşılırsa hata
   - 90 günlük cache

6. src/sources/__init__.py:
   - fetch_from_all_sources(province, district, mode="ucretsiz", force_refresh=False)
     -> list[ClinicDict]
   - mode'lar:
     * "ucretsiz": OSM + DT
     * "google": Google + DT (OSM'i atla)
     * "full": Hepsi
   - Paralel değil seri (rate limit için)
   - Her kaynak ayrı try/except (biri çökerse diğerleri devam)
   - source alanına virgülle birleştir: "osm,dt" gibi

7. tests/test_sources.py:
   - Mock Overpass response → normalize doğru mu
   - Mock DT HTML → hekim çıkarma doğru mu
   - Cache TTL testi
   - Rate limit testi (mock sleep)

8. CLI komutu ekle: `dentroute test-kaynak --il İstanbul --ilce Kadıköy`
   - Tüm kaynakları test eder, sonuçları yazdırır
   - "OSM: 25 sonuç, DT: 42 sonuç, Google: 78 sonuç"

Doğrulama:
- `python scripts/test_osm_coverage.py` çalışmalı, sonuç dosyası üretmeli
- `dentroute test-kaynak --il Sivas --ilce Merkez` → en az bir kaynaktan veri gelmeli
- `pytest tests/test_sources.py` geçmeli
````

---

# PROMPT 4 — Gemini ile temizleme + veri kalite kontrolü

````
DentRoute için Gemini ile veri temizleme + anomali tespiti modülü.

1. src/enrich/gemini_client.py:
   - Gemini API client (google-generativeai)
   - Model: "gemini-2.0-flash-exp" (ücretsiz katman)
   - Token kullanım izleme:
     * Her çağrı sonrası token sayısını logla
     * Günlük toplam tut (data/logs/gemini_usage.json)
     * 1500 çağrı/gün limitine yaklaşılınca uyar
     * Limit aşılınca DataQualityError fırlat
   - Retry stratejisi: rate limit hatası alınca exponential backoff (5s, 15s, 60s)
   - JSON mode zorla: response_mime_type="application/json"
   - Hatalı JSON dönerse: parse et, başarısızsa fallback'a düş

2. src/enrich/clean.py:
   - clean_and_merge(raw_clinics: list[ClinicDict], district_info: dict) -> list[CleanedClinic]
   - 50'lik batch'ler halinde gönder (token tasarrufu)
   - Görevler:
     a) Duplike tespit ve birleştirme:
        - Aynı isim+adres (Levenshtein distance < 5)
        - Aynı koordinat (50m yakın)
        - Aynı telefon numarası
        - source field'ları virgülle birleştir
     b) İsim normalize:
        - "Dr.", "Doktor", "Diş Hekimi", "Dt.", "Uzm. Dt." → standart
        - Türkçe karakter koru
        - Tüm büyük harf yerine title case
     c) Tip tespiti:
        - Devlet kurumu: "Devlet Hastanesi", "ADSM", "Üniversite Diş", "Aile Sağlığı"
        - Özel poliklinik: ad içinde "poliklinik" geçer veya 2+ hekim aynı adreste
        - Özel muayene: tek hekim
        - Hastane diş bölümü
     d) Poliklinik içi hekimleri parent_clinic'e bağla:
        - Aynı adres + farklı isim → biri "ana" (en yüksek yorum), diğerleri içi
     e) Uzmanlık tespiti:
        - "Ortodontist", "Pedodonti", "Ağız ve Çene Cerrahisi", "Protez", "İmplantoloji",
          "Endodonti", "Periodontoloji", "Restoratif"
        - İsim veya açıklamadan parse et

3. src/enrich/quality_control.py — VERİ KALİTE KONTROLÜ:
   - validate_clinic(clinic: dict) -> list[Issue]
     * Issue türleri: "missing_required", "invalid_phone", "suspicious_name",
       "duplicate", "coordinate_out_of_district", "hallucinated"
   - detect_hallucinations(clinics: list, raw_clinics: list) -> list:
     * Gemini'nin uydurma kayıt eklemesi tespiti
     * Çıktıda olup ham veride OLMAYAN kayıt → flag
     * Bu kayıtlar otomatik düşürülür, log yazılır
   - detect_anomalies(clinics: list) -> list:
     * Veteriner, eczane, kafe gibi yanlış kategori kayıtları
     * İsim içinde "diş" geçmeyen kayıtlar → review için işaretle
     * Koordinatı ilçenin bbox'ı dışında olanlar
   - manual_review_queue.json: review bekleyenler buraya yazılır

4. src/enrich/confidence.py:
   - compute_confidence(clinic: dict) -> int (40-100)
   - Kaynak sayısı:
     * 4+ kaynak: +60
     * 3 kaynak: +45
     * 2 kaynak: +25
     * 1 kaynak: +10
   - Veri tamlığı:
     * Telefon var: +10
     * Adres tam (no, sokak, mahalle): +10
     * Yorum sayısı > 5: +10
     * Rating var: +5
     * Koordinat doğrulanmış: +5

5. src/enrich/changes.py:
   - detect_changes(province, district, since_date) -> ChangeReport:
     * yeni: önceki taramada olmayan
     * kapanan: önceki taramada olup şimdi gelmeyen (24+ saat önce taranmış)
     * degisen: telefon/adres değişmiş
     * fiyat/rating değişmiş

6. tests/test_enrich.py:
   - Mock Gemini response → temizleme doğru mu
   - Duplike birleştirme testi (3 kaydı 1'e indirme)
   - Hallucination tespiti testi
   - Confidence hesaplama testi

7. CLI: `dentroute temizle --il Sivas --ilce Merkez [--review-mode]`
   - DB'deki ham kayıtları al, Gemini'ye gönder, temiz versiyonu döndür
   - --review-mode: manuel doğrulama akışı (her flag'li kaydı sor)

Doğrulama:
- pytest tests/test_enrich.py geçmeli
- Sivas Merkez örneği: 100 ham kayıt → ~80 temiz kayıt (duplike birleştirilmiş)
- Hallucination testinde Gemini'nin uydurması yakalanmalı
````

---

# PROMPT 5 — Job sistemi + rota + Excel + raporlar

````
DentRoute için arka plan job yönetimi, rota planlama, Excel üretimi ve raporlar.

1. src/jobs/manager.py — Job persistance:
   - SQLAlchemy ile jobs tablosu:
     ```sql
     jobs(id, type, status, params_json, result_json, error,
          progress_pct, current_step, started_at, completed_at, user_id)
     ```
   - status: pending, running, completed, failed, cancelled
   - Streamlit kapanırsa devam etmesi için: ayrı bir python process'i background'da
   - Çözüm: APScheduler BackgroundScheduler kullan
     * `scheduler.add_job(run_tarama, args=[...], id="tarama_X")`
     * Job state DB'ye yazılır, kullanıcı sayfa yenileyince son durum görünür
   - JobManager class:
     * submit(job_type, params) -> job_id
     * get_status(job_id) -> Job
     * cancel(job_id)
     * list_active() -> list[Job]
   - Streamlit polling: st.empty() + auto-refresh ile her 2 sn durum güncelle

2. src/jobs/tarama_job.py:
   - run_tarama(province, district, source_mode, user_id, force_refresh=False):
     * tarama_gecmisi'ne pending kaydı at
     * Kaynaklardan veri çek (her adımda progress %)
     * Gemini ile temizle (progress %50)
     * Veri kalite kontrol (progress %70)
     * DB'ye merge et (progress %90)
     * tarama_gecmisi'ni completed olarak güncelle
     * Sonuçları result_json'a yaz
   - run_tarama_il(province, user_id): tüm ilçeleri sırayla tara
   - Hata durumunda status="failed", error yazılır
   - Aynı anda max 1 tarama (DB lock + scheduler queue)

3. src/route/tsp.py:
   - haversine(lat1, lng1, lat2, lng2) -> km
   - nearest_neighbor_tsp(clinics: list, start: tuple) -> (sirali, toplam_km)
   - **Geliştirme**: 2-opt iyileştirme (NN sonrası rotayı kısalt)
   - filter_clinics(province, district, **filters):
     * ziyaret_durumu, min_yorum, uzmanlik, son_ziyaret_gun, durum (sicak/soguk)
   - google_maps_route_url(clinics, start, end=None):
     * Tek URL max 10 waypoint
     * 10+ varsa parçalara böl, liste döndür
   - apple_maps_url, yandex_maps_url alternatifleri

4. src/route/folium_map.py:
   - create_map(clinics, start, output_path) -> str (HTML path)
   - Marker renkleri:
     * Yeşil: ziyaret edildi, sıcak
     * Sarı: tekrar zamanı geldi
     * Kırmızı: bekleyen
     * Gri: kapalı/red
     * Mavi: KAMU
   - Popup: klinik adı, tel, son ziyaret, durum
   - Cluster (çok marker varsa)
   - Eve/ofise yıldız marker

5. src/excel/builder.py:
   - create_excel(province, district, output_path, user_id=None):
     * 3 sayfa: Ana liste, KAMU+Hastane, Özet
     * Sütunlar: Sıra, Klinik, Mahalle, Adres, Telefon, Yorum, Puan, Tip,
       Uzmanlık, Kaynak, Güven, Son Ziyaret, Durum, Sonraki Tarih, Notlar
     * Renk kodları: MEGA (sarı), UZMAN (mavi), HOT (açık sarı), düşük güven (gri),
       Ziyaret edildi (yeşil), Bekleyen (kırmızı)
     * Conditional formatting Excel formülleriyle
     * Otomatik filtre, dondurulmuş üst satır
   - create_excel_genel(province, output_path):
     * Tüm il toplu, her ilçe ayrı sayfa
     * Özet sayfası: ilçe başına klinik/ziyaret sayıları
   - create_excel_ziyaret_geçmisi(user_id, baslangic, bitis):
     * Temsilci başına ziyaret raporu

6. src/reports/completion.py:
   - generate_completion_report(province, district) -> dict:
     * v3.1 A.3 formatı (önceki sohbetlerden referans)
     * Beklenen aralık vs bulunan karşılaştırması
     * Kaynak başına klinik sayısı
     * Güven dağılımı
     * %50 altındaysa "EK ÇALIŞMA GEREKLİ" uyarısı + öneriler
   - generate_il_ozeti(province) -> dict:
     * Tüm ilçeler tablo halinde
     * Hangi ilçe taranmış / taranmamış
     * Son tarama tarihleri

7. src/reports/change.py:
   - generate_change_report(province, district, since_days=90) -> dict:
     * yeni klinikler
     * muhtemel kapananlar
     * telefon/adres değişenler
     * temsilci aksiyonu için liste

8. tests/test_jobs.py, test_route.py, test_excel.py — temel testler

Doğrulama:
- `dentroute tara --il Sivas --ilce Merkez` çalışıp Excel üretmeli
- Excel açıldığında 3 sayfa olmalı, renk kodları doğru
- Tamamlama raporu konsola yazdırılmalı
- Folium HTML harita açılmalı
````

---

# PROMPT 6 — CLI tam komut seti

````
DentRoute için kapsamlı CLI (cli/main.py, click ile):

Komutlar:

GENEL:
- `dentroute --version`
- `dentroute --help`
- `dentroute istatistik` — DB özeti

İLÇE/İL:
- `dentroute il-listesi` — 81 ili plaka ile listele
- `dentroute ilce-listesi --il İstanbul` — ilçeler + nüfus + sınıf
- `dentroute il-ozeti --il Sivas` — il geneli durum

TARAMA:
- `dentroute test-kaynak --il X --ilce Y` — kaynak testi (PROMPT 3)
- `dentroute tara --il X --ilce Y [--kaynak ucretsiz|google] [--yenile]`
- `dentroute tara-il --il X [--otomatik]` — il'in tüm ilçeleri (uzun sürer, uyarı)
- `dentroute temizle --il X --ilce Y [--review-mode]`
- `dentroute karsilastir --il X --ilce Y --gun 90`

KLİNİK:
- `dentroute liste --il X [--ilce Y] [--bekleyen|--ziyaret-edilen|--sicak]`
- `dentroute klinik-detay --id 123`
- `dentroute klinik-guncelle --id 123 --telefon X --notlar Y`

ZİYARET:
- `dentroute ziyaret --klinik-id 5 --tarih 2026-05-26 --hekim "Dt. X" --durum sicak --not "..."`
- `dentroute ziyaretlerim [--son 30]` — kendi ziyaretlerin

ROTA:
- `dentroute rota --il X --ilce Y [--from lat,lng] [--filtre bekleyen]`
- `dentroute rota-export --il X --ilce Y --format excel|pdf|html`

EXCEL/PDF:
- `dentroute excel --il X [--ilce Y]`
- `dentroute pdf --il X --ilce Y`

İÇE/DIŞA AKTAR:
- `dentroute import --xlsx eski.xlsx --il X`
- `dentroute export --format json|sql --output path`
- `dentroute import-sivas` — özel komut, önceki sohbetteki Sivas verisini içeri al

VERİTABANI:
- `dentroute db-yedek` — manuel yedek al
- `dentroute db-geri-yukle --dosya backup.zip`
- `dentroute db-migrate` — alembic upgrade head

KULLANICI (PROMPT 8 sonrası):
- `dentroute kullanici-ekle --email X --rol Y`
- `dentroute kullanici-listesi`
- `dentroute bolge-ata --kullanici X --il Y`

Her komutta:
- --help detaylı
- Progress bar (rich library ile)
- Renkli output (success yeşil, error kırmızı)
- --json çıktısı (otomasyon için)

Doğrulama:
- Tüm komutlar `--help` ile çalışmalı
- `dentroute istatistik` boş DB için bile çalışmalı
- `dentroute import-sivas` mevcut Excel'i içe almalı
````

---

# PROMPT 7 — Streamlit ana arayüz + session yönetimi

````
DentRoute için Streamlit web arayüzü. Session state ve cache stratejisi netleştirilmiş.

1. ui/streamlit_app.py — Ana giriş noktası:
   - Page config: title "DentRoute", icon 🦷, layout "wide" (desktop), "centered" (mobile)
   - Login kontrolü (PROMPT 8'de gelecek, şimdilik placeholder)
   - Sidebar: navigation, kullanıcı bilgisi, çıkış
   - Mobile detection: st.session_state.is_mobile = (viewport width < 768)

2. ui/state.py — Session state yönetimi:
   - init_session_state() — uygulama başlangıcında çağrılır
   - State değişkenleri:
     * user (current user)
     * selected_province, selected_district
     * active_job_id (devam eden tarama)
     * filter_state (klinik filtreleri)
     * cart (sipariş sepeti)
   - State persistance: kritik state'leri URL query params'a yaz (sayfa yenilenince kaybolmasın)

3. ui/cache.py — Cache stratejisi:
   - @st.cache_data(ttl=300) — değişmeyen veriler (il/ilçe listesi)
   - @st.cache_resource — DB session, connection
   - Cache invalidation:
     * Tarama bittikten sonra `st.cache_data.clear()` çağrılır
     * Kullanıcı manual "Yenile" butonuna basınca da
   - cached_clinic_list(province, district) — 5 dk cache
   - cached_province_stats(province) — 1 saat cache

4. ui/components/ — yeniden kullanılabilir bileşenler:
   - clinic_card.py: klinik kartı (mobile/desktop responsive)
   - filter_bar.py: filtre çubuğu
   - status_badge.py: durum rozeti (renkli)
   - progress_indicator.py: job progress
   - confirmation_dialog.py: silme/iptal onay

5. ui/pages/1_🦷_Klinikler.py:
   - Sol panel: il/ilçe seçici, kaynak (radio: ucretsiz/google), "Tara" butonu
   - Mevcut durum: "DB'de X klinik, son tarama Y gün önce"
   - Tarama butonu → job submit → progress bar (auto-refresh)
   - Sonuç tablosu: pandas DataFrame as st.data_editor
     * Inline durum güncelleme (selectbox)
     * Telefon ara butonu (tel: link)
     * Klinik detay paneli (expander)
   - Filtreler: durum, uzmanlık, min yorum, arama

6. ui/pages/2_🗺️_Harita.py:
   - Folium harita gömme (streamlit-folium)
   - Filtre çubuğu: aynı ana sayfa
   - Eve/ofise göre rota çizimi opsiyonu

7. ui/pages/3_🚗_Rota.py:
   - Mevcut klinikler için TSP rota
   - "Bekleyen klinikleri sırala" butonu
   - Sıralı liste + tahmini süre
   - "Google Maps'te Aç" butonu (URL kopyala)
   - Excel/PDF export butonları

8. ui/pages/4_✏️_Ziyaret.py:
   - Yeni ziyaret formu
   - Geçmiş ziyaretler tablosu (kendi)
   - Filtreler: tarih, durum

9. ui/pages/9_📈_Raporlar.py:
   - Tamamlama raporu (markdown render)
   - Fark raporu (90 gün)
   - İl özet
   - Excel indir butonları

10. ui/pages/99_⚙️_Ayarlar.py:
    - Ev/ofis koordinatı düzenle
    - Tema (dark/light)
    - Bildirim ayarları
    - DB yedek/geri yükle
    - API anahtar durumu

Mobile optimizasyonları:
- st.columns yerine alt alta yığma (mobile detect ile)
- Büyük butonlar (height=50px+)
- Az tıklama (form'lar kısa)
- Tablolar yerine kart görünüm (mobile'da)

Doğrulama:
- `streamlit run ui/streamlit_app.py` çalışmalı
- Tüm sayfalar açılmalı (login yoksa placeholder)
- Job submit ve progress bar çalışmalı
- Mobile responsive test (browser dev tools)
````

---

# PROMPT 8 — Ekip + auth + rol yönetimi

````
DentRoute'a çoklu kullanıcı + rol + bölge yönetimi.

1. src/auth/users.py:
   - User SQLAlchemy modeli:
     ```sql
     kullanicilar(id, email UNIQUE, ad, soyad, telefon, rol, aktif, 
                  sifre_hash, son_giris, created_at)
     ```
   - rol enum: admin, satis_yoneticisi, saha_temsilcisi, depo, muhasebe
   - bcrypt ile şifre hash
   - Functions:
     * create_user(email, ad, soyad, sifre, rol)
     * authenticate(email, sifre) -> User | None
     * change_password(user_id, old, new)
     * reset_password_token(email) -> token (email gönderme placeholder)
     * verify_reset_token(token) -> User | None

2. src/auth/session.py:
   - Streamlit session'da login state
   - login(user) → session.user set
   - logout()
   - get_current_user() -> User | None
   - require_login() — decorator, sayfa başında çağrılır
   - require_role(*roles) — decorator, yetkisizler reddedilir

3. src/auth/permissions.py — Rol izin matrisi:
   ```python
   PERMISSIONS = {
       "admin": ["*"],  # her şey
       "satis_yoneticisi": [
           "klinik.read", "klinik.write", 
           "ziyaret.read", "ziyaret.write",
           "cari.*", "siparis.*", "rapor.*"
       ],
       "saha_temsilcisi": [
           "klinik.read", "klinik.write_own_region",
           "ziyaret.read_own", "ziyaret.write_own",
           "katalog.read", "siparis.create",
           "numune.create", "numune.read_own"
       ],
       "depo": ["katalog.*", "siparis.update_status", "stok.*"],
       "muhasebe": ["cari.*", "fatura.*", "odeme.*", "rapor.read"]
   }
   ```
   - has_permission(user, action) -> bool

4. src/auth/regions.py:
   - BolgeAtama model:
     ```sql
     bolge_atamalari(id, kullanici_id, il, ilce, primary BOOLEAN)
     ```
   - assign_region(user_id, il, ilce=None, primary=False)
   - remove_region(user_id, il, ilce=None)
   - get_user_regions(user_id) -> list[dict]
   - get_clinics_for_user(user_id, **filters):
     * Admin → tüm klinikler
     * Diğerleri → sadece atanan bölgedeki klinikler
   - get_users_for_region(il, ilce=None) -> list[User]

5. ui/pages/0_🔐_Giris.py:
   - Login formu (email + şifre)
   - "Şifremi Unuttum" linki → reset token üret, kullanıcıya göster
     (gerçek mail göndermek için PROMPT 12'de geliştir)
   - "İlk kurulum" akışı: hiç kullanıcı yoksa admin oluştur

6. ui/pages/8_👥_Ekip.py (sadece admin görebilir):
   - Kullanıcı listesi (ad, mail, rol, aktif durumu, son giriş)
   - Yeni kullanıcı ekle (email, ad, rol → token oluştur, paylaş)
   - Rol değiştir
   - Bölge atama matrisi:
     * Tablo: kullanıcı x il (checkbox grid)
     * Detay: il seçince ilçeleri göster
   - Kullanıcıyı pasif yap / sil (soft delete)

7. Mevcut tüm modüllere yetki kontrolü ekle:
   - Ziyaret oluştururken: get_clinics_for_user filtresi
   - Klinik güncellerken: write_own_region kontrolü
   - Sipariş silmek: sadece admin

8. CLI'a kullanıcı komutları:
   - `dentroute kullanici-ekle --email X --ad Y --rol saha_temsilcisi`
   - `dentroute kullanici-sifre-sifirla --email X` → token
   - `dentroute bolge-ata --kullanici-id 5 --il İstanbul --ilce Kadıköy`

9. İlk kurulum scripti güncelle:
   - scripts/init_db.py'ye ekle:
     * Hiç admin yoksa konsoldan ad/email/şifre iste
     * Admin oluştur
     * Default config'ler ekle

10. tests/test_auth.py:
    - Şifre hash + verify
    - Login başarılı/başarısız
    - Yetki kontrolü
    - Bölge atama

Doğrulama:
- İlk kurulumda admin oluşmalı
- Login çalışmalı
- Saha temsilcisi bölgesi dışı klinik görememeli
- Admin tümünü görmeli
````

---

# PROMPT 9 — Cari + E-Fatura kancası + çek/senet

````
DentRoute'a cari yönetimi + Türkiye vergi mevzuatı uyumlu fatura altyapısı.

1. src/crm/cariler.py:
   - Cari modeli:
     ```sql
     cariler(id, klinik_id UNIQUE, cari_kodu UNIQUE, ad, vergi_no, vergi_dairesi,
             fatura_adresi, fatura_il, fatura_ilce, posta_kodu,
             iban, banka_adi,
             odeme_vadesi_gun DEFAULT 30, kredi_limiti DEFAULT 0,
             bakiye COMPUTED, durum,
             notlar, created_at)
     ```
   - Cari kodu otomatik: CR-2026-00001 (yıl + sıra)
   - validate_vergi_no(vkn) -> bool (TC kimlik no algoritması veya VKN)
   - hesapla_bakiye(cari_id) -> dict {borç, alacak, net}

2. src/crm/faturalar.py:
   - Fatura modeli:
     ```sql
     faturalar(id, cari_id, fatura_no UNIQUE, tip (satis|iade), tarih, vade_tarihi,
               kdv_orani, ara_toplam, kdv_tutari, toplam,
               odenen DEFAULT 0, kalan COMPUTED,
               durum (taslak|gonderildi|odendi|iptal),
               e_fatura_uuid, e_fatura_durum (yok|hazir|gonderildi|kabul|red),
               aciklama, created_at)
     ```
   - Fatura kalemi:
     ```sql
     fatura_kalemleri(id, fatura_id, urun_id, miktar, birim, birim_fiyat,
                      iskonto_orani, iskonto_tutari, kdv_orani, toplam,
                      lot_no, son_kullanma)
     ```
   - Fatura no otomatik (firma seri: 2026000001)
   - generate_pdf(fatura_id) -> bytes (reportlab)
   - iade_fatura_olustur(orig_fatura_id, kalemler) -> yeni fatura

3. src/crm/e_fatura.py — E-Fatura/E-Arşiv STUB (gerçek entegrasyon sonra):
   - Türkiye'de zorunlu eşik:
     * Brüt satış 3M TL üstü → E-Fatura zorunlu
     * 500 TL üstü fatura → kişiye E-Arşiv
   - GİB entegrasyonu için arayüz:
     * generate_ubl_xml(fatura) -> bytes (UBL-TR 2.1 format)
     * send_to_gib(fatura) -> placeholder (raise NotImplementedError)
     * check_status(fatura) -> placeholder
   - 3. parti entegratörler için adapter pattern:
     * Logo, Mikro, eFinans, QNB EFinans
     * Sonradan kolayca eklenebilsin
   - Şimdilik: fatura UBL XML olarak diske kaydet, manuel yükleme

4. src/crm/cek_senet.py:
   - Çek/Senet modeli:
     ```sql
     cek_senetler(id, cari_id, tip (cek|senet), durum (portfoyde|tahsile_verildi|tahsil_edildi|karsiliksiz|iade),
                  cek_no, banka_adi, sube, kesidedence, kesidedence_il,
                  vade_tarihi, kesidedence_tarihi, tutar,
                  alindi_tarihi, lehtar, notlar)
     ```
   - vade_yaklasanlar() -> 7 gün içinde vadesi gelecekler
   - tahsile_ver(cek_id, banka, tarih)
   - tahsil_oldu(cek_id, tarih)
   - karsiliksiz_isaretle(cek_id, tarih, sebep) — protesto süreci

5. src/crm/odeme_takip.py:
   - Ödeme modeli:
     ```sql
     odemeler(id, cari_id, fatura_id, tarih, tutar, yontem (nakit|havale|cek|senet|kart|acik),
              cek_senet_id, dekont_no, aciklama, created_at)
     ```
   - kaydet_odeme(cari_id, fatura_id, tutar, yontem, ...)
   - Cariye otomatik bakiye düşür
   - Faturayı "odendi" durumuna geçir (kalan 0 ise)

6. ui/pages/4_💰_Cariler.py:
   - Sekme 1: Cari Listesi
     * Filtre: bakiyeli, vadesi geçen, durumu (aktif/pasif)
     * Tablo: ad, kod, vergi no, bakiye, kredi limit, son işlem
   - Sekme 2: Cari Detay (seçilen carinin)
     * Üst bilgi: bakiye, vade durumu
     * Sekmeler: faturalar, ödemeler, çek/senet, ekstre
   - Sekme 3: Yeni Fatura (form)
   - Sekme 4: Yeni Ödeme (form)
   - Sekme 5: Çek/Senet Yönetimi
     * Portföyde, tahsile verilen, vadesi yaklaşan
   - Sekme 6: Vade Takibi
     * Vadesi geçenler (kırmızı)
     * Yaklaşanlar (sarı)
     * "Hatırlatma gönder" butonu (WhatsApp şablon)

7. PDF üretimi (reportlab):
   - Fatura PDF şablonu (firma logosu, kalemler, KDV, toplam, vade)
   - Ekstre PDF (cari hesap dökümü)
   - Çek/Senet bordro

8. tests/test_crm.py:
   - Cari oluşturma
   - Fatura + ödeme flow
   - Bakiye hesaplama
   - Çek vade kontrolü

Doğrulama:
- Klinikten cari oluşturma çalışmalı
- Fatura kesip ödeme kaydedince bakiye düşmeli
- E-Fatura XML üretilebilmeli (stub)
- Çek vade hatırlatması çalışmalı
````

---

# PROMPT 10 — Ürün katalog + lot/SKT + çoklu birim

````
DentRoute'a ürün katalog modülü. Medikal sektör için kritik özellikler: lot/seri no, son kullanma tarihi, çoklu birim.

1. src/katalog/kategoriler.py:
   - Kategori modeli (ağaç yapı):
     ```sql
     kategoriler(id, ad, parent_id, slug, sira, aciklama, ikon, aktif)
     ```
   - Örnek hiyerarşi:
     * Restoratif
       * Kompozitler
       * Adezivler
       * Cam İonomer
     * Endodonti
       * Kanal Eğeleri
       * Kanal Macunları
     * İmplantoloji
       * İmplantlar (Straumann, Nobel, vb. alt)
       * İyileşme Başlıkları
     * Ortodonti
     * Cerrahi
     * Sarf (Eldiven, Maske, vb.)
   - get_tree() -> nested dict
   - move_category(id, new_parent)

2. src/katalog/birim.py — Çoklu birim ve dönüşüm:
   - Birim modeli:
     ```sql
     birimler(id, kod, ad)  -- adet, paket, kutu, koli, gr, ml, kg, L
     birim_donusumler(id, kaynak_birim_id, hedef_birim_id, urun_id NULLABLE, carpan)
     ```
   - Örnek:
     * 1 paket = 50 adet (eldiven)
     * 1 koli = 12 kutu (kompozit)
     * Ürün bazlı özelleştirme: aynı ürünün paketlenmesi farklıysa
   - convert(miktar, kaynak_birim, hedef_birim, urun_id=None) -> float

3. src/katalog/urunler.py:
   - Ürün modeli:
     ```sql
     urunler(id, kod UNIQUE, ad, kategori_id, marka, model,
             ana_birim_id, satis_birim_id,
             kdv_orani DEFAULT 0.20,
             liste_fiyati, iskonto_oran DEFAULT 0,
             foto_url, aciklama,
             lot_takipli BOOLEAN DEFAULT FALSE,
             skt_takipli BOOLEAN DEFAULT FALSE,
             min_stok DEFAULT 0,
             aktif, created_at)
     ```
   - Stok takibi (lot bazlı):
     ```sql
     stok_lotlari(id, urun_id, lot_no, miktar, birim_id,
                  uretim_tarihi, son_kullanma, durum (aktif|tukendi|geri_cagrildi),
                  raf_yeri, satin_alma_fiyati, tedarikci, created_at)
     ```
   - stok_hareketleri:
     ```sql
     stok_hareketleri(id, urun_id, lot_id, tip (giris|cikis|transfer|sayim|fire),
                      miktar, birim_id, kaynak (siparis|numune|sayim|el), kaynak_id,
                      kullanici_id, aciklama, tarih)
     ```

4. src/katalog/skt_takip.py:
   - SKT yaklaşanlar: 90 / 60 / 30 / 15 gün uyarı seviyeleri
   - get_yaklasan_skt(gun=90) -> list[lot]
   - get_suresi_dolmus() -> list[lot]
   - blocked_lots(): SKT'si dolmuş olanlar satışa kapatılır
   - rapor: aylık SKT zararı (yazılan fire)

5. src/katalog/lot_takip.py:
   - lot_hareketi(lot_id) -> giriş, satış, fire, mevcut
   - geri_cagirma(lot_no, sebep) -> tüm satışları listele
   - lot_traceability_report(lot_no) -> hangi cariye gitti

6. src/katalog/fiyat_listesi.py:
   - Fiyat listeleri:
     ```sql
     fiyat_listeleri(id, ad, tip (genel|cari_grubu|cari_ozel|kampanya),
                     baslangic, bitis, aktif)
     fiyat_liste_kalemleri(id, fiyat_liste_id, urun_id, fiyat, iskonto)
     ```
   - Cari atamaları:
     ```sql
     cari_fiyat_listeleri(cari_id, fiyat_liste_id, oncelik)
     ```
   - get_fiyat(urun_id, cari_id, tarih=today) -> float
     * Sıra: kampanya > özel > grup > genel
   - toplu_fiyat_guncelle(fiyat_liste_id, yuzde) - hepsini %X artır/azalt

7. ui/pages/5_📦_Katalog.py:
   - Sol: kategori ağacı (genişletilebilir)
   - Sağ: ürün grid (kart: foto, ad, fiyat, stok, lot sayısı, SKT uyarısı)
   - Filtreler: marka, fiyat aralığı, stok durumu (var/yok/az), kategori
   - Üst banner uyarıları:
     * "X üründe SKT yaklaşıyor"
     * "Y ürün min stok altında"
     * "Z lot bloke"
   - Ürün detay modal:
     * Genel bilgi
     * Lot listesi (her lotun stok, SKT)
     * Fiyat geçmişi
     * Stok hareketleri
     * Foto yükleme/galeri
   - Yeni ürün formu
   - "Toplu Excel İmport" (ürün katalogu güncelleme)
   - "Katalog PDF" (müşteriye e-mail)

8. ui/pages/5b_📅_SKT_Takip.py:
   - SKT yaklaşanlar tablosu (90/60/30 gün)
   - Toplu indirim önerisi (eski SKT'leri kampanyaya at)
   - Fire kaydı

9. tests/test_katalog.py:
   - Kategori ağaç
   - Birim dönüşüm
   - Stok hareketi
   - Lot/SKT
   - Fiyat hesaplama

Doğrulama:
- Kategori ağacı oluşturma
- Ürün ekleme, lot ile stok girişi
- SKT yaklaşanlar listesi
- Cari özel fiyat çalışmalı
````

---

# PROMPT 11 — Sipariş + teklif + onay akışı + kısmi teslimat

````
DentRoute'a teklif/sipariş yönetimi. Onay akışı ve kısmi teslimat dahil.

1. src/siparis/teklifler.py:
   - Teklif modeli:
     ```sql
     teklifler(id, teklif_no, klinik_id, cari_id, temsilci_id,
               tarih, gecerlilik_tarihi,
               durum (taslak|gonderildi|kabul|red|sureli|donduruldu),
               ara_toplam, iskonto, kdv, toplam,
               odeme_kosulu, teslimat_yeri, notlar,
               donusen_siparis_id, created_at)
     teklif_kalemleri(id, teklif_id, urun_id, miktar, birim_id, birim_fiyat,
                      iskonto_orani, kdv_orani, toplam)
     ```
   - Teklif → sipariş dönüştürme (1 tıkla)
   - PDF üretimi (firma logosu, kalem detayı, KDV, vade, geçerlilik)
   - WhatsApp ile teklif gönderme (PDF link)

2. src/siparis/onay_akisi.py — Büyük sipariş onay süreci:
   - Onay kuralları (config'den):
     * Saha temsilcisi: max 5000 TL sipariş
     * Satış müdürü onayı gerekir: 5000-50000 TL
     * Genel müdür onayı: 50000 TL üstü
     * Vade > 60 gün: ekstra onay
     * Cari kredi limiti aşılıyorsa: muhasebe onayı
   - Workflow:
     * Sipariş oluşturulur → durum: "onay_bekliyor"
     * Yetki sahibi bildirim alır (Streamlit + WhatsApp)
     * Onaylar veya reddeder
     * Onay sonrası "hazırlanıyor"a geçer
   - Onay history:
     ```sql
     siparis_onaylari(id, siparis_id, onay_seviyesi, onaylayan_user_id,
                      durum (bekliyor|onayli|red), tarih, notlar)
     ```

3. src/siparis/siparisler.py:
   - Sipariş modeli:
     ```sql
     siparisler(id, siparis_no, klinik_id, cari_id, temsilci_id,
                kaynak (teklif|sahada|telefon|web), kaynak_id,
                tarih, durum (onay_bekliyor|hazirlaniyor|kargolandi|teslim|iptal|kismi_teslim),
                ara_toplam, iskonto, kdv, toplam,
                odeme_kosulu, vade_gun,
                teslimat_yeri, teslimat_iletisim,
                kargo_firmasi, kargo_no, kargo_takip_link,
                teslim_tarihi, fatura_id,
                notlar, created_at)
     siparis_kalemleri(id, siparis_id, urun_id, miktar, miktar_teslim_edilen,
                       birim_id, birim_fiyat, iskonto_orani, kdv_orani, toplam,
                       lot_no, notlar)
     ```
   - Kısmi teslimat:
     * Sipariş 10 kalem, 7 kalem geldi
     * miktar_teslim_edilen güncellenir
     * Tüm kalemler dolduysa durum "teslim", değilse "kismi_teslim"
   - Stok otomatik düş (onaylı siparişte)
   - Fatura otomatik oluştur (teslim sonrası, opsiyonel)

4. src/siparis/kargo.py:
   - Kargo entegrasyonları (stub):
     * Yurtiçi Kargo
     * MNG Kargo
     * Aras Kargo
     * UPS Türkiye
   - get_takip_link(firma, kargo_no) -> URL
   - check_status(firma, kargo_no) -> placeholder (API entegrasyonu sonra)
   - bildir(siparis_id) — kargo no kaydedildikten sonra müşteriye WA mesaj

5. ui/pages/6_🛒_Siparisler.py:
   - Sekme 1: Teklifler
     * Liste (durum filtreli)
     * Yeni teklif sihirbazı:
       1. Klinik seç
       2. Ürün ekle (arama + miktar + iskonto)
       3. Ödeme koşulu
       4. Önizleme + gönder
   - Sekme 2: Siparişler — Kanban görünüm
     * Sütunlar: Onay Bekliyor / Hazırlanıyor / Kargo / Teslim / İptal
     * Drag-drop ile durum değiştir (yetkili kişi)
   - Sekme 3: Sipariş Detay
     * Kalemler tablosu (kısmi teslim güncelleme)
     * Onay tarihçesi
     * Kargo bilgisi
     * Fatura linki
     * Müşteri iletişim butonları
   - Sekme 4: Yeni Sipariş Sihirbazı (sahada hızlı)
     * Aynı teklif gibi ama direkt sipariş
     * Limit aşılıyorsa otomatik onay bekleyen olur

6. Saha modu (mobile):
   - "Hızlı Sipariş" — ziyaret esnasında:
     * Klinik otomatik (rotadan)
     * Ürün tarayıcı (foto+ad)
     * Miktar gir, iskonto
     * Toplam hesapla
     * Müşteriye göster, onaylat (imza)
     * SMS/WA ile özet gönder

7. Raporlar:
   - Aylık satış (ürün, temsilci, bölge, kategori)
   - En çok satan
   - Sepet ortalaması
   - İptal oranı
   - Teslimat süresi
   - Onay bekleme süresi

8. tests/test_siparis.py

Doğrulama:
- Teklif → sipariş dönüşümü
- Onay akışı (limit aşılınca onay bekliyor olmalı)
- Kısmi teslimat
- Stok düşüşü
- PDF üretimi
````

---

# PROMPT 12 — WhatsApp + KVKK + bildirim sistemi

````
DentRoute'a WhatsApp Cloud API + KVKK uyumlu mesajlaşma.

ÖNEMLİ: Meta WhatsApp Business Cloud API kurulumu README'ye detaylı yazılmalı.

Kurulum adımları (README):
1. developers.facebook.com → Yeni app oluştur (Business türü)
2. WhatsApp Business Platform ekle
3. Phone Number Ekle (test no veya production)
4. System User token al (uzun ömürlü)
5. Webhook URL kur — Cloudflare Workers ücretsiz (Streamlit Cloud webhook'u uygun değil)
6. Webhook verify token belirle, Meta panelinde kaydet
7. Şablonlar Meta panelinden onaya gönderilir (24-72 saat)

1. src/iletisim/whatsapp.py:
   - Meta WhatsApp Cloud API client
   - send_text(telefon, icerik) — sadece 24 saat içinde mesajlaşma penceresi açıksa
   - send_template(telefon, sablon_adi, parametreler, dil="tr") — şablon mesaj
   - send_media(telefon, url, tip (image|document|video))
   - mark_as_read(message_id)
   - get_business_profile() — kontrol için

2. src/iletisim/webhook.py:
   - Webhook handler (Cloudflare Workers'a deploy edilecek ayrı script)
   - Gelen mesajları DB'ye yaz: wp_mesajlar tablosu
   - Streamlit'e push (websocket veya polling)

3. src/iletisim/sablonlar.py:
   - WhatsApp Template modeli:
     ```sql
     wp_sablonlar(id, ad, kategori (MARKETING|UTILITY|AUTHENTICATION),
                  dil, icerik, parametreler_json, durum (taslak|onay_bekliyor|onayli|red),
                  meta_template_name, kullanim_sayisi, created_at)
     ```
   - Önerilen şablonlar (hazır gelecek):
     * "ziyaret_hatirlatma" (UTILITY)
     * "siparis_onay" (UTILITY) 
     * "kargo_bildirim" (UTILITY)
     * "fatura_hatirlatma" (UTILITY)
     * "vade_uyari" (UTILITY)
     * "numune_geri_bildirim" (UTILITY)
     * "kampanya_duyuru" (MARKETING)
     * "yeni_urun" (MARKETING)
   - Şablon değişken inject

4. src/iletisim/kvkk.py — KVKK ONAY YÖNETİMİ:
   - Onay modeli:
     ```sql
     kvkk_onaylari(id, klinik_id, kullanici_id_alan (hangi temsilci aldı), 
                   onay_tarihi, onay_metni_versiyon, 
                   kategoriler (pazarlama|servis|fatura),
                   imza_url, ip_adresi,
                   gecerlilik_baslangic, gecerlilik_bitis,
                   iptal_tarihi, iptal_sebebi)
     ```
   - Onay metni versiyonları (data/master/kvkk_metinleri.json)
   - WhatsApp mesaj göndermeden ÖNCE otomatik onay kontrolü
   - Onay olmayanlara MARKETING tipi mesaj gönderilemez
   - UTILITY tipi (sipariş bilgilendirme vb.) onay gerektirmez
   - Onay süresi: 2 yıl, sonra yenilenmeli
   - Onay iptal etme akışı (klinik isterse)
   - KVKK ihlal raporu (yıllık)

5. src/iletisim/bildirim.py — Birleşik bildirim sistemi:
   - Bildirim kanalları: whatsapp, email, sms, in_app
   - send_notification(kullanici_id, tip, icerik, kanallar=None):
     * Kullanıcı tercihine göre kanalları seç
     * Sıralı dene: in_app → email → whatsapp
   - in_app bildirimler (Streamlit'te bell ikonu)
   - email: SMTP placeholder (sonra entegrasyon)
   - sms: Türk Telekom/Vodafone/Turkcell BIP API (sonra)

6. src/iletisim/log.py:
   - Tüm mesajlar wp_mesajlar tablosunda
   - Klinik bazlı timeline
   - Okundu/iletildi/cevaplı durumu
   - KVKK için 5 yıl saklama

7. ui/pages/7_💬_Mesajlasma.py:
   - Sekme 1: Mesaj Gönder
     * Alıcı seç (klinik veya cari grubu)
     * Şablon seç (sadece onayı olanlar)
     * KVKK kontrolü otomatik (onay yoksa uyarı)
     * Ön izleme + gönder
   - Sekme 2: Toplu Gönderim
     * Filtre: il/ilçe, son ziyaret tarihi, durum
     * Hedef sayısı göster
     * Maliyet uyarısı (1000 üstü ücretli)
     * KVKK uyumlu olmayan alıcıları çıkar
   - Sekme 3: Gelen Mesajlar
     * Konuşma listesi (WhatsApp tarzı)
     * Hızlı cevap
     * Klinik kartına git linki
   - Sekme 4: Şablonlar
     * Liste (durum: onay bekleyen, onaylı, red)
     * Yeni şablon → Meta onayına gönder (24-72 saat uyarısı)
   - Sekme 5: KVKK Onayları
     * Hangi klinik onay verdi/vermedi
     * Onay süresi yaklaşan listesi
     * Yenileme talep gönder
   - Sekme 6: Maliyet Takibi
     * Aylık mesaj sayısı (1000 ücretsiz)
     * Konuşma bazlı pricing (Meta yeni model)
     * Bütçe sınırı (aşılırsa otomatik dur)

8. Otomatik bildirim kuralları (background scheduler):
   - Sipariş kabul → "siparis_onay" gönder
   - Kargo no eklendi → "kargo_bildirim"
   - Fatura vadesi 7 gün önce → "vade_uyari"
   - Numune teslimat sonrası 14 gün → "numune_geri_bildirim"
   - Ziyaret randevusu 1 gün önce → "ziyaret_hatirlatma"

9. tests/test_iletisim.py + test_kvkk.py

Doğrulama:
- Webhook setup README'de açıklanmalı
- Şablon oluşturma + Meta onaya gönderme (manuel)
- KVKK onay alma akışı (form imzala)
- Test mesaj gönderme (test no'ya)
- Bütçe limiti aşılma simülasyonu
````

---

# PROMPT 13 — DB paketleme + Supabase + yedek

````
DentRoute için kalıcı veri yönetimi: SQLite ↔ Supabase, yedek, versiyonlama.

1. src/db/migration.py — Alembic migration:
   - alembic init + tüm model değişiklikleri için migration
   - Otomatik migration: model değişince `alembic revision --autogenerate`
   - Versiyon zinciri korunmalı
   - Production'da otomatik upgrade: scripts/init_db.py içinde

2. src/db/supabase_adapter.py:
   - DB_MODE env'e göre:
     * "sqlite": SQLAlchemy + sqlite:///data/dentroute.db
     * "supabase": SQLAlchemy + postgresql://supabase_url
   - Bağlantı havuzu (Supabase için max 10 connection)
   - Connection retry
   - RLS (Row Level Security) policy'leri Supabase'te otomatik kur:
     * Saha temsilcisi sadece kendi bölgesini görsün
     * Admin tümünü
   - Bandwidth monitoring (Supabase ücretsiz 5GB/ay)

3. scripts/migrate_to_supabase.py:
   - Tek seferlik SQLite → Supabase taşıma
   - Adımlar:
     1. Supabase'te schema oluştur (alembic upgrade)
     2. SQLite'tan veriyi oku
     3. Tablo tablo Supabase'e yaz (batch insert)
     4. Sequence'leri sync et (id'ler çakışmasın)
     5. Doğrulama: kayıt sayıları eşleşmeli
   - Progress bar (büyük tablolar için)
   - Hata durumunda rollback

4. src/db/backup.py:
   - export_full_db(output_path) -> JSON dump
     * Tüm tablolar
     * Versiyon bilgisi (alembic head)
     * Timestamp
   - import_full_db(input_path, merge_strategy="upsert"):
     * upsert: ID çakışmasında güncelle
     * skip: çakışanları atla
     * replace: çakışanları sil ve ekle
   - export_partial(tables=None, filters=None):
     * Sadece belirli tablolar
     * Filtre ile (örn. sadece İstanbul verisi)
   - Compress: zipfile ile sıkıştır (~%80 boyut tasarruf)

5. src/db/snapshot.py — Türkiye master DB release:
   - create_release_snapshot(version, include_data=True):
     * Sadece klinik/cari master verisini al
     * Kişisel veri çıkar (ziyaret notları, mesajlar, KVKK)
     * Zip dosyası: dentroute_master_v1.0.0_20260626.zip
     * Manifest JSON: kayıt sayıları, kapsanan iller
   - load_from_snapshot(zip_path, merge=True):
     * Yeni kullanıcı GitHub Releases'tan indirir
     * Mevcut DB'ye merge eder veya sıfırdan yükler

6. src/db/sync.py — Offline-first için:
   - Lokal SQLite cache + Supabase merkezi
   - Değişiklikleri kuyruğa al (offline çalışıyorsa)
   - Online olunca push (last-write-wins veya merge)
   - Conflict resolution (manuel onay gerekirse)

7. Otomatik yedek (background scheduler):
   - Her gün 03:00 otomatik backup
   - data/backups/dentroute_YYYYMMDD_HHmm.zip
   - Son 30 yedek tutulur, eskiler silinir
   - Disk doluluk kontrolü
   - Streamlit'te "Son yedek: 2 saat önce" göstergesi

8. ui/pages/99_⚙️_Ayarlar.py'a ekle:
   - Sekme "Yedek/Geri Yükle":
     * "Şimdi Yedek Al" butonu → ZIP indir
     * "Geri Yükle" → dosya yükle, onay al, yükle
     * Yedek geçmişi tablo
     * Otomatik yedek ayarları (saat, retention)
   - Sekme "DB Mode":
     * Mevcut mod (SQLite/Supabase)
     * "Supabase'e Taşı" sihirbazı (uyarılar dahil)
   - Sekme "İçe/Dışa Aktar":
     * Excel export (PROMPT 5)
     * JSON export/import
     * Türkiye master release indir/yükle

9. CLI:
   - `dentroute db-yedek` — manuel yedek
   - `dentroute db-yedek-listele`
   - `dentroute db-geri-yukle --dosya backup.zip`
   - `dentroute db-snapshot-olustur --versiyon 1.0.0`
   - `dentroute db-snapshot-yukle --dosya release.zip`
   - `dentroute db-supabase-tasi` — sihirbaz
   - `dentroute db-migrate` — alembic upgrade head

10. tests/test_db_backup.py

Doğrulama:
- Migration sistemi çalışmalı (model değiştir, autogenerate, upgrade)
- Yedek al, sil, geri yükle döngüsü çalışmalı
- Supabase taşıma testi (test projesi)
- Bandwidth monitoring
````

---

# PROMPT 14 — Numune takibi + numune avcıları

````
DentRoute'a numune takip modülü. Saha satışın en kritik metriği.

1. src/numune/numuneler.py:
   - Model (PROMPT 15'teki şemayı kullan, eksik alanları ekle)
   - create_numune(klinik_id, temsilci_id, teslim_tarihi, kalemler, ...):
     * Politika kontrolü (politikalar.py)
     * Kota kontrolü (kotalar.py)
     * Stok düş (numune lot'undan)
     * Takip tarihi otomatik (varsayılan +14 gün, ürün bazlı özelleştirilebilir)
     * Foto + imza zorunlu
     * KVKK onay metni (numune teslim beyanı)
   - update_durum(numune_id, yeni_durum, notlar=None, siparis_id=None):
     * Durum makinesi: verildi → denendi → donusturuldu/red/kayip/iade
     * Sadece geçerli geçişler
     * Loglama (kim ne zaman değiştirdi)
   - get_bekleyen_numuneler(temsilci_id=None) — takip tarihi geçmiş, hala 'verildi'

2. src/numune/kotalar.py:
   - Aylık temsilci kotası
   - set_kota(temsilci_id, ay, butce_tl)
   - get_kalan_butce(temsilci_id, ay=None)
   - kota_kullanim_grafigi(temsilci_id, ay_sayisi=12)
   - admin: tüm temsilcilerin özeti
   - Kota aşılırsa numune oluşturma engellensin (admin override ile geçilebilir)

3. src/numune/politikalar.py:
   - Ürün/kategori bazlı politika:
     * klinik_basina_max (yıllık)
     * bekleme_suresi_gun (aynı kliniğe tekrar verme)
     * min_donusum_orani (bu altında ise uyarı)
   - Varsayılan politikalar (data/master/numune_politikalari.json):
     * Kompozit/Adeziv: 2/yıl, 180 gün bekleme, %30 hedef
     * İmplant: 1/yıl, 365 gün, %40 hedef
     * Ortodonti braket: 3/yıl, 90 gün, %20
     * Sarf: sınırsız, hedef yok (ilişki için)
   - validate_numune_verilebilir(urun_id, klinik_id) -> (bool, sebep)

4. src/numune/avcilar.py — NUMUNE AVCISI TESPİTİ:
   - get_numune_avcilari(yil=None) -> list[Klinik]:
     * Son 6 ayda 3+ numune alıp 0 sipariş veren
     * Eşik değerleri admin ayarlanabilir (config'den)
   - kara_listeye_al(klinik_id, sebep, sure_ay=12):
     * Bu kliniğe numune verilmesi engellenir
     * Süre dolunca otomatik kaldırılır
   - Uyarı seviyeleri:
     * "Dikkat": 2 numune, 0 sipariş
     * "Riskli": 3 numune, 0 sipariş
     * "Kara liste": 4+ numune, 0 sipariş

5. src/numune/roi.py:
   - aylik_numune_roi(yil, ay) -> dict:
     {toplam_adet, toplam_maliyet, donusum_orani,
      uretilen_siparis_geliri, roi_yuzdesi,
      en_basarili_urun_listesi, en_kotu_urun_listesi,
      temsilci_performans}
   - urun_bazli_roi(urun_id, baslangic, bitis):
     * Bu üründen kaç numune dağıtıldı, ne kadar maliyet
     * Kaçı dönüştü, toplam sipariş geliri
     * ROI = (gelir - maliyet) / maliyet × 100
   - cari_bazli_roi(cari_id, yil):
     * Bu cariye ne kadar numune verildi, ne kadar sipariş geldi

6. ui/pages/10_🎁_Numune.py:
   - Üst banner:
     * "Bekleyen takip: X numune" (kırmızı badge)
     * "Bu ay kullanılan bütçe: X/Y TL" (progress bar)
     * "Bu ay dönüşüm oranı: %X" (yeşil/kırmızı)

   - Sekme 1: Yeni Numune (mobile-friendly):
     * Klinik seçici (autocomplete) - sahada GPS'ten
     * Teslim tarihi (varsayılan bugün)
     * Teslim alan kişi
     * Ürün ekleme (kart bazlı):
       - Ürün ara/seç
       - Miktar
       - Otomatik maliyet
     * Toplam maliyet özeti (kalan kota karşı)
     * Politika kontrolü uyarıları
     * Foto çek (zorunlu)
     * İmza pad (streamlit-drawable-canvas)
     * KVKK onay metni + kabul
     * Takip tarihi (özelleştirilebilir)
     * Notlar

   - Sekme 2: Aktif Numuneler:
     * Tablo: klinik, ürün(ler), tarih, geçen gün, durum, temsilci
     * Filtreler: durum, temsilci, tarih, bölge
     * Renk kodları:
       - Yeşil: takip tarihinden önce
       - Sarı: 3 gün içinde takip
       - Kırmızı: takip tarihi geçti
     * Tek tıkla durum güncelleme
     * "Sipariş Oluştur" butonu → otomatik 'donusturuldu'

   - Sekme 3: Numune Avcıları (Dikkat!):
     * Klinik listesi: kuralı geçenler
     * "Kara Listeye Al" butonu (süre seçimi)
     * "Son Uyarı Gönder" (WhatsApp şablon)
     * Geçmiş analizi

   - Sekme 4: Raporlar:
     * Aylık dönüşüm grafiği (line chart - plotly)
     * Ürün bazlı ROI tablosu
     * Temsilci karşılaştırma
     * Bölge ısı haritası
     * Excel/PDF indir

   - Sekme 5: Politika & Kota (admin):
     * Ürün/kategori politika tanımları
     * Temsilci aylık kota
     * Toplu kota atama
     * Varsayılan politika sıfırla

7. Otomatik bildirimler (jobs.py'a ekle):
   - Her gün 09:00: takip tarihi gelen numuneler → temsilciye in-app + WhatsApp özet
   - Her pazartesi: numune avcıları raporu → yönetici email
   - Ay sonu: aylık numune raporu PDF → otomatik gönder

8. WhatsApp şablonları (PROMPT 12'ye ekle):
   - "numune_geri_bildirim": "Merhaba {hekim}, geçen hafta size verdiğimiz {urun} numunesini denediniz mi? Geri bildirimleriniz değerli."
   - "numune_son_uyari": "{klinik_adi}, KVKK uyarınca bilgilendirme: stok yönetimimiz için kullanılmayan numuneleri iade alabiliriz."

9. Excel import:
   - Mevcut numune kayıtları için şablon
   - scripts/import_numuneler.py

10. tests/test_numune.py

Doğrulama:
- Yeni numune oluşturma (politika kontrolü, kota kontrolü, foto, imza)
- Durum geçişleri (verildi → denendi → donusturuldu)
- Numune avcısı tespiti
- ROI hesaplama
- Aylık rapor PDF üretimi
````

---

# PROMPT 15 — Mobil PWA + offline + QR

````
DentRoute'u sahada mobilden ideal kullanılabilir hale getir.

1. Streamlit PWA dönüşümü:
   - ui/static/manifest.json:
     ```json
     {
       "name": "DentRoute",
       "short_name": "DentRoute",
       "start_url": "/",
       "display": "standalone",
       "background_color": "#1F4E78",
       "theme_color": "#1F4E78",
       "icons": [
         {"src": "icon-192.png", "sizes": "192x192", "type": "image/png"},
         {"src": "icon-512.png", "sizes": "512x512", "type": "image/png"}
       ],
       "orientation": "portrait",
       "scope": "/"
     }
     ```
   - ui/static/sw.js (service worker):
     * Static assets cache (CSS, JS)
     * Offline fallback sayfası
     * API çağrılarını online'a göre route et
   - ui/static/icon-192.png, icon-512.png (logo)
   - Streamlit'te custom head injection (st.markdown unsafe_allow_html ile manifest link)

2. ui/components/mobile_detector.py:
   - User-Agent kontrolü
   - Viewport width detection
   - is_mobile() -> bool
   - is_tablet() -> bool
   - Session state'e kaydet

3. ui/pages/0_🏠_Saha.py — Saha modu ana sayfa (mobile-first):
   - Tek ekran üzerinde:
     * GPS konumun (otomatik)
     * "Yakındaki Klinikler" (2km radius)
     * "Bugünkü Rotam" (haftalık plana göre)
     * "Bekleyen Numune Takipleri" (X adet)
     * "Vadesi Yaklaşan Faturalar"
     * Hızlı butonlar:
       - 🦷 Klinik Listesi
       - 🚗 Rota
       - ✏️ Ziyaret Ekle
       - 🛒 Sipariş Al
       - 🎁 Numune Ver
       - 💬 WhatsApp

4. GPS entegrasyonu:
   - streamlit-geolocation veya custom JS component
   - get_current_location() -> (lat, lng) | None
   - Tarayıcı izin akışı
   - Konum hatası durumunda manuel giriş fallback

5. Offline mode:
   - Lokal IndexedDB cache (browser)
   - Streamlit'te DB read önce cache'e bakar
   - Yazma işlemleri queue'da bekler
   - Online olunca senkronize et
   - Streamlit-aggrid veya custom JS ile yönetim
   - Çevrim dışı banner: "Çevrim dışısınız, son senkron 5 dk önce"

6. Voice input (Web Speech API):
   - Ziyaret notları, sipariş notları için
   - streamlit_extras veya custom component
   - Türkçe dil desteği (lang="tr-TR")
   - Konuşma → metne çevir
   - Onay sonrası kaydet

7. Photo capture:
   - st.camera_input ile foto çek
   - Boyut optimize (max 1MB)
   - Klinik bazlı galeri
   - Numune teslim, sipariş etiketi, vitrin fotosu vb.
   - Storage:
     * Yerel: data/photos/{klinik_id}/
     * Supabase Storage (online ise)

8. QR kod:
   - Her klinik için QR üret:
     * QR içeriği: dentroute://klinik/{id} veya https://app.dentroute.com/klinik/{id}
   - generate_qr(klinik_id) -> PNG bytes
   - PDF: tüm klinikler için QR etiket sayfası (matbaa için)
   - QR okuma:
     * st.camera_input + pyzbar
     * Veya browser native QR scanner
   - QR okutunca direkt klinik detay sayfası açılır

9. Hızlı sipariş (saha):
   - Tek sayfa, büyük butonlar
   - Klinik otomatik (rotadan veya GPS)
   - Ürün ara → büyük kart → miktar tıkla (+/-)
   - Toplam göster (büyük font)
   - Müşteriye telefonu uzat (imza)
   - Onayla → SMS/WA özet

10. Bildirimler:
    - Web Push API (sonraki versiyonlar, browser desteğine göre)
    - Şimdilik in-app:
      * Üst bar bell ikonu (badge sayı)
      * Tıklayınca son 20 bildirim
      * "Yeni sipariş onayı bekliyor", "Vadesi geçen fatura", vb.

11. Tema:
    - Light/dark switch (st.toggle)
    - Mobil yüksek kontrast modu
    - Büyük font modu (yaşlı kullanıcılar için)

12. Performans:
    - Lazy loading (sayfa scroll'da yükle)
    - Resimler için thumbnail
    - Streamlit cache agresif

13. ui/pages/_mobile_layout.py — Mobile özel layout:
    - Bottom navigation (5 ikon)
    - Üst bar: ad, bildirim, profil
    - İçerik scroll alanı

14. Test:
    - Browser dev tools mobile emulation
    - Lighthouse PWA skoru (target: 90+)
    - Slow 3G simülasyonu

15. Deploy notları (README):
    - HTTPS zorunlu (PWA için)
    - Streamlit Cloud ücretsiz tier yeterli (HTTPS dahil)
    - "Ana ekrana ekle" yönlendirmesi (Android Chrome, iOS Safari)

Doğrulama:
- Mobile browser'da uygulama açılmalı
- "Ana ekrana ekle" çalışmalı
- Offline'da basic veri okunabilmeli
- GPS izni alıp konum çalışmalı
- Foto çekme + kaydetme çalışmalı
- QR oluşturma + okuma çalışmalı
````

---

# PROMPT 16 — Deploy (Streamlit Cloud + Cloudflare Workers webhook)

````
DentRoute'u Streamlit Cloud'a deploy + WhatsApp webhook için Cloudflare Workers kur.

1. Streamlit Cloud deploy:
   
   .streamlit/config.toml:
   ```toml
   [theme]
   primaryColor = "#1F4E78"
   backgroundColor = "#FFFFFF"
   secondaryBackgroundColor = "#F0F2F6"
   textColor = "#262730"
   font = "sans serif"
   
   [browser]
   gatherUsageStats = false
   
   [server]
   maxUploadSize = 50
   ```

   .streamlit/secrets.toml.example:
   ```toml
   GEMINI_API_KEY = ""
   GOOGLE_MAPS_API_KEY = ""
   SUPABASE_URL = ""
   SUPABASE_KEY = ""
   WHATSAPP_TOKEN = ""
   WHATSAPP_PHONE_ID = ""
   WHATSAPP_VERIFY_TOKEN = ""
   ENV = "production"
   ```

2. README.md "Deploy" bölümü:
   
   ## Streamlit Cloud'a Deploy
   
   1. GitHub'a kodu push'la
   2. share.streamlit.io → "New app"
   3. Repo seç, branch=main, main file path=ui/streamlit_app.py
   4. "Advanced settings" → Python version 3.11
   5. Secrets bölümüne yukarıdaki TOML'u yapıştır, anahtarlarını doldur
   6. Deploy
   
   Uygulama https://your-app.streamlit.app adresinde açılır.
   
   ## Veritabanı Stratejisi (Streamlit Cloud)
   
   Streamlit Cloud ephemeral disk olduğu için iki seçenek:
   - Önerilen: Supabase ücretsiz katmana bağlan
   - Alternatif: Her başlangıçta lokal SQLite'ı GitHub'dan indir + dışa aktar buton

3. Cloudflare Workers webhook:

   webhook/worker.js (ayrı bir GitHub repo veya aynı repo /webhook klasörü):
   ```javascript
   export default {
     async fetch(request, env) {
       const url = new URL(request.url);
       
       // Webhook verification (GET)
       if (request.method === 'GET') {
         const mode = url.searchParams.get('hub.mode');
         const token = url.searchParams.get('hub.verify_token');
         const challenge = url.searchParams.get('hub.challenge');
         
         if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
           return new Response(challenge);
         }
         return new Response('Forbidden', { status: 403 });
       }
       
       // Incoming message (POST)
       if (request.method === 'POST') {
         const body = await request.json();
         
         // Forward to Streamlit backend (Supabase'e direkt yaz veya queue'ya)
         await env.DB.prepare(
           "INSERT INTO wp_incoming (payload, received_at) VALUES (?, ?)"
         ).bind(JSON.stringify(body), new Date().toISOString()).run();
         
         return new Response('OK');
       }
       
       return new Response('Method not allowed', { status: 405 });
     }
   };
   ```
   
   webhook/wrangler.toml:
   ```toml
   name = "dentroute-webhook"
   main = "worker.js"
   compatibility_date = "2025-01-01"
   
   [vars]
   VERIFY_TOKEN = "your_verify_token_here"
   
   [[d1_databases]]
   binding = "DB"
   database_name = "dentroute_webhook"
   database_id = "your_d1_id"
   ```

4. Webhook setup adımları (README):
   1. Cloudflare hesabı oluştur (ücretsiz)
   2. wrangler CLI kur: `npm i -g wrangler`
   3. `wrangler login`
   4. `wrangler deploy` → URL al (örn: https://dentroute-webhook.your-name.workers.dev)
   5. Meta WhatsApp panelinde webhook URL = bu URL, verify token = aynı
   6. Streamlit app'inden periyodik olarak Cloudflare D1'i poll et (her 30 sn)
      veya Supabase'e direkt yaz (worker'dan Supabase REST API çağrısı)

5. Dockerfile (alternatif self-host):
   ```dockerfile
   FROM python:3.11-slim
   WORKDIR /app
   COPY pyproject.toml ./
   RUN pip install -e .
   COPY . .
   EXPOSE 8501
   CMD ["streamlit", "run", "ui/streamlit_app.py", "--server.port=8501", "--server.address=0.0.0.0"]
   ```

6. .github/workflows/test.yml:
   ```yaml
   name: Tests
   on: [push, pull_request]
   jobs:
     test:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-python@v4
           with:
             python-version: '3.11'
         - run: pip install -e .[dev]
         - run: ruff check
         - run: mypy src/
         - run: pytest --cov=src tests/
   ```

7. .github/workflows/deploy.yml (opsiyonel):
   - main branch'e push'ta otomatik Streamlit Cloud deploy
   - veya manuel button

8. Production checklist (README):
   - [ ] Tüm secrets dolu
   - [ ] DB migration uygulandı (alembic upgrade head)
   - [ ] Admin kullanıcı oluşturuldu
   - [ ] Türkiye master verisi yüklendi
   - [ ] Test mesaj başarılı (WhatsApp)
   - [ ] Otomatik yedek aktif
   - [ ] Bildirim kuralları aktif
   - [ ] KVKK metni yüklendi
   - [ ] HTTPS sertifika geçerli (Streamlit Cloud otomatik)
   - [ ] Domain bağlandı (opsiyonel, Cloudflare DNS)

9. Monitoring (basit):
   - Streamlit Cloud'un kendi logging'i
   - Sentry entegrasyonu (opsiyonel, ücretsiz tier var)
   - Custom log: data/logs/error.log → periyodik kontrol

10. Backup (production):
    - Supabase otomatik daily backup (ücretsiz)
    - Ek olarak haftalık manuel JSON export
    - Yedekleri kullanıcı kendi cloud'una (Drive, Dropbox) yedeklemeli

Doğrulama:
- GitHub'a push → Streamlit Cloud otomatik deploy
- Uygulama https://*.streamlit.app açılmalı
- Webhook URL Meta'da kayıt edilebilmeli
- Test mesaj webhook'a düşmeli
- Tüm CI testleri geçmeli
````

---

# PROMPT 17 — Sivas verisini içe aktar + ilk demo

````
DentRoute kurulumu tamamlandı. Şimdi:

1. Önceki sohbetteki Sivas Excel verisini içe aktar
2. Demo verisi oluştur (test için)
3. Kullanıcıya ilk kullanım rehberi

1. scripts/import_sivas_legacy.py:
   - Sivas_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx'i oku
   - Her satır için:
     * Klinik kaydı oluştur (varsa atla)
     * KAMU sayfasından kamu kurumları
     * Mahalle, koordinat, telefon korunsun
     * Source: "legacy_import"
     * Confidence: 65 (zaten doğrulanmış kabul)
   - İmport sonrası özet:
     * Eklendi: X klinik
     * Atlandı: Y (zaten var)
     * Hata: Z
   - tarama_gecmisi tablosuna "Sivas legacy import" kaydı

2. scripts/seed_demo_data.py:
   - Test/demo verisi oluştur (production'da ÇALIŞTIRMA):
     * 3 örnek kullanıcı (admin, satis_yoneticisi, saha_temsilcisi)
     * 10 örnek ürün (kompozit, eldiven, vb.)
     * 3 örnek kategori
     * 5 örnek cari (Sivas'taki bazı kliniklerden)
     * 2 örnek teklif
     * 3 örnek sipariş (farklı durumlarda)
     * 5 örnek ziyaret kaydı
     * 2 örnek numune
   - "demo" flag'i ile işaretle (sonradan temizlenebilsin)
   - `dentroute demo-temizle` komutu ile silinebilsin

3. README.md "İlk Kullanım" bölümü ekle:
   
   ## İlk Kullanım Rehberi
   
   1. **Kurulum tamamlandı mı?**
      - `pytest` tüm testler geçiyor
      - `streamlit run ui/streamlit_app.py` çalışıyor
   
   2. **Admin kullanıcı oluştur:**
      - İlk açılışta otomatik soru: email, ad, şifre
      - Veya: `dentroute kullanici-ekle --email admin@x.com --rol admin`
   
   3. **Sivas verisini içe aktar (opsiyonel):**
      - `python scripts/import_sivas_legacy.py`
   
   4. **Demo verisi (opsiyonel):**
      - `python scripts/seed_demo_data.py`
   
   5. **İlk taramayı yap:**
      - Streamlit aç → Klinikler sayfası
      - İl: "Ankara", İlçe: "Çankaya" seç
      - "Tarama Başlat" → 5-10 dk bekle
      - Sonuçlar gelsin
   
   6. **Bir kliniği ziyaret et:**
      - Klinik listesinde bir kaydı seç
      - "Ziyaret Ekle" formunu doldur
      - Durum: "sıcak" işaretle
   
   7. **Sipariş oluştur:**
      - Sipariş sayfası → Yeni Sipariş
      - Klinik seç, ürün ekle, onayla
   
   8. **Rota planla:**
      - Rota sayfası → İl/ilçe seç, filtre: "bekleyen"
      - Google Maps URL al, telefondan aç
   
   9. **Mobil kullan:**
      - https://your-app.streamlit.app aç
      - "Ana Ekrana Ekle" (Chrome menü)
      - Sahada PWA olarak kullan

4. ui/pages/0_📚_Yardım.py:
   - İçindekiler:
     * Hızlı başlangıç (yukarıdaki adımlar)
     * Sık sorulan sorular
     * Klavye kısayolları
     * İletişim/destek
     * Video tutoriallar (placeholder linkler)
     * Sürüm notları
   - Yardımcı tooltips uygulamanın her yerinde

5. tests/test_integration.py — Uçtan uca test:
   - Kullanıcı oluştur
   - Klinik tara
   - Ziyaret ekle
   - Sipariş oluştur
   - Numune ver
   - Rapor al
   - Excel export

Doğrulama:
- Sivas import çalışmalı, eski Excel'deki ~130 kayıt DB'ye girmeli
- Demo verisi yüklenmeli, Streamlit'te görünmeli
- Yardım sayfası tüm linkleri çalışmalı
- Uçtan uca testler geçmeli
````

---

# Bonus — Geliştirme tavsiyeleri

## Modüllerin sıralı kurulumu (gerçek)

Bu promptları Claude Code'a verirken takvim:

**Hafta 1 — Çekirdek (1-7):**
- Gün 1: PROMPT 1 (proje iskelet)
- Gün 2: PROMPT 2 (Türkiye master)
- Gün 3: PROMPT 3 (kaynaklar, OSM test)
- Gün 4: PROMPT 4 (Gemini)
- Gün 5: PROMPT 5 (job, rota, Excel)
- Gün 6: PROMPT 6 (CLI)
- Gün 7: PROMPT 7 (Streamlit ana)

**Bu noktada çalışan bir tarama uygulaması var.** Test et:
- Sivas Merkez tara → eski sonuçla karşılaştır
- 5-10 ilçe daha tara, kapsama oranını gör

**Hafta 2 — CRM (8-12):**
- Gün 8-9: PROMPT 8 (ekip)
- Gün 10-11: PROMPT 9 (cari + fatura)
- Gün 12-13: PROMPT 10 (katalog)
- Gün 14: PROMPT 11 (sipariş)

**Hafta 3 — İletişim + numune (12, 14):**
- Gün 15-16: PROMPT 12 (WhatsApp + KVKK)
- Gün 17-18: PROMPT 14 (numune)

**Hafta 4 — Production (13, 15, 16, 17):**
- Gün 19: PROMPT 13 (DB + Supabase)
- Gün 20: PROMPT 15 (PWA)
- Gün 21: PROMPT 16 (deploy)
- Gün 22: PROMPT 17 (Sivas import + demo)

**Toplam ~22 gün** (akşamları 2-3 saat).

## Maliyet özet

| Aşama | Maliyet |
|---|---|
| API anahtarları | 0 ₺ |
| Geliştirme süresince | 0 ₺ (Claude Code Pro varsa) |
| 1 ay tarama (973 ilçe) | 0 ₺ (Google ücretsiz kredi içinde) |
| Sürekli kullanım (5 kişilik ekip) | 0-30 ₺/ay |
| Domain (opsiyonel) | 50-100 ₺/yıl |

## Önemli hatırlatmalar

1. **Her promptu çalıştırmadan önce** çevreni hazırla: API anahtarları, Git repo
2. **Her promptun sonundaki doğrulama** mutlaka çalışmalı, başarısızsa bir sonrakine geçme
3. **Test verisi oluştur**: 3-5 örnek klinik, 2-3 sipariş, 1-2 numune ile her özelliği dene
4. **Sürekli backup al**: özellikle DB schema değişikliklerinden önce
5. **KVKK'ya dikkat**: gerçek müşteri verisi kullanırken onay alınmalı
6. **WhatsApp şablonları**: Meta onay süresi 24-72 saat, planla
7. **Streamlit Cloud ücretsiz tier**: 1 app, 1 GB resource — proje büyürse upgrade

## Sorun çıkarsa

- Claude Code "hata aldım" derse: hata mesajını kopyala, "şu hatayı veriyor düzelt" de
- Performans yavaşsa: cache stratejisini gözden geçir
- DB lock sorunu: SQLite → Supabase'e geç
- Gemini rate limit: günde 1500 çağrı, taramayı geceye yay
- OSM kapsama düşük: Google Places'e geç (ücretsiz kredi var)

## Sonraki versiyonlarda eklenebilir

- E-mail bildirim (SMTP)
- 2FA (iki faktörlü doğrulama)
- Aktivite takvimi (Google Calendar sync)
- Dosya yönetimi (PDF, e-mail archive)
- Onboarding turu (intro.js)
- Çoklu dil (İngilizce, Arapça)
- AI destekli müşteri analizi (LTV, churn risk)
- Banka ekstresi otomatik okuma (PDF parse)
- E-Fatura tam entegrasyonu (GİB)
- Web push notification
- Native mobil app (Flutter, opsiyonel)
- Sales lead skor sistemi
- Otomatik sipariş tahmini (ML)
- Komisyon hesaplama (temsilci başına)

---

**Başarılar! Sorun çıkarsa adım adım yardımcı olurum.**
