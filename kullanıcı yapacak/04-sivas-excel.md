# 04 — Sivas Excel Yükleme

Önceki sohbette ürettiğin `Sivas_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx` (134 kayıt) sistemde DB'ye nasıl yüklenir.

## Önkoşul

PROMPT-2 hazır olmalı:
- `src/features/admin/pages/CsvImportPage.tsx` XLSX desteği eklenmiş
- `scripts/import-sivas-legacy.ts` mevcut
- `data-legacy/` klasörü repo kökünde

## Yol A — Web UI (önerilen)

1. Excel dosyanı bilgisayardan bul (örn: Desktop/Sivas_GENELI...)
2. `npm run dev` → login → admin hesabıyla giriş
3. http://localhost:5173/admin/clinics
4. "Dosya Seç" → Excel'i seç (XLSX kabul edilir)
5. Sheet listesi gelecek: **"Ana liste"** + **"KAMU+Hastane"** seç
6. Kolon eşleştirme:
   - `Klinik` → `name`
   - `Adres` → `address`
   - `Telefon` → `phone`
   - `Lat` → `lat`
   - `Lng` → `lng`
   - `Mahalle` → `neighborhood`
7. Önizleme (ilk 5 satır) doğru görünüyorsa → "İçe Aktar"
8. Progress bar bittikten sonra DiscoveryPage Sivas merkezde 50+ klinik göstermeli

## Yol B — CLI

```bash
# 1. data-legacy/ klasörü oluştur (repo kökünde)
mkdir data-legacy

# 2. Excel'i taşı/kopyala
copy "C:\Users\PC\Desktop\Sivas_GENELI_Birlesik_Dis_Hekimi_Rotasi_v3.xlsx" data-legacy\

# 3. Script çalıştır
npm run saha:import-sivas
```

Script kademe kademe loglar:
```
[1/134] "Diş Hekimi Ahmet" — yüklendi
[2/134] "Polikliniği Y" — yüklendi
[3/134] SKIP: koordinat yok
...
```

## Doğrulama

```sql
-- Supabase SQL Editor
SELECT count(*) FROM saha_clinics WHERE source = 'legacy_import_sivas';
-- 130+ beklenir (eksik koordinatlılar düşülmüş olabilir)
```

Veya UI'da:
- `/clinics` (PROMPT-11) → arama "Sivas" → liste dolu
- `/clinics/discover` → Sivas merkez koordinata teleport → klinikler görünür
