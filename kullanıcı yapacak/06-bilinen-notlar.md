# 06 — Bilinen Notlar (Plan vs Repo farkları)

Claude planı uygularken karşılaştığı **küçük tutarsızlıkları** burada listeler. Bunlar engelleyici değil, ama bilmen iyi olur.

## 1. Repo adı

Plan: "github.com/alievren44-del/dent-route"
Gerçek: working directory `C:\Users\PC\Desktop\navigasyon`, memory'de repo `alievren44-del/navigasyon` (henüz push edilmedi).

**Aksiyon:** Plan'da geçen `dent-route` adı → bizde `navigasyon`. Path/komut'larda kullanılan göreceli yollar zaten doğru, sadece git remote'u repository adınla eşleştir.

## 2. `rep_visits` zaten var, `saha_visits` ekleniyor

Mevcut migration `supabase/migrations/20260525000001_saha_extension.sql` Parla'nın `rep_visits` tablosuna `check_in_location` + `custom_fields` + `photos` kolonları ekliyor.

Plan PROMPT-8 ise **yeni** `saha_visits` tablosu öneriyor.

**Karar:** Plan'a sadık kalındı, `saha_visits` ayrı yazıldı (memory `shared_db_policy.md` saha_* prefix kuralı için temiz). Ama Parla canlı'da `rep_visits` zaten kullanılıyor olabilir — **yöneticiyle konuş**:
- A) İki tablo paralel — Saha modülü `saha_visits`, Parla web `rep_visits` (bağımsız)
- B) View ile birleştir — `saha_visits` aslında `rep_visits`'in tipli kopyası

Karar verilene kadar Saha rep saha'da check-in ederse veri `saha_visits`'e gider, Parla web'de görünmez. Eski Parla görüleri eski tabloda kalır.

## 3. Bölge plakaları (PROMPT-6)

PROMPT-6'da `PROVINCES_BY_REGION` hardcoded. Bazı il-bölge atamaları tartışmalı (Düzce, Kırklareli vs). Resmi TÜİK bölge sınıflaması ile farklı olabilir.

**Aksiyon gerekmez** — sonra düzeltilir. Bölge taraması başlatınca yanlış il çıkarsa söyle.

## 4. 973 ilçe hedefi (memory + plan)

Memory `parla_supabase_project.md` 81 il / **531 ilçe** var diyor. Plan **973 ilçe** hedef diyor.

**Aksiyon:** PROMPT-6'da `tr-data.ts` veri kaynağı — Claude şu an mevcut `src/data/tr-locations/` içeriğini kullanacak. 973'e tamamlamak ayrı bir iş, gerekirse istenince ek prompt.

## 5. Profile rolleri

Plan `'sales_rep' | 'manager' | 'admin'` kullanıyor.
Parla canlı'da `user_role` enum büyük harfli: `'REP', 'ADMIN', 'DOCTOR'` vb.

Claude RLS politikalarını **büyük harfli** olarak yazdı (mevcut Parla enum'a uymak için). Plan kod örnekleri küçük harfli — uyarlandı.

**Aksiyon gerekmez** — ama eğer yeni proje (Parla DB değil) açtıysan, `user_role` enum'u önce oluşturman lazım.

## 6. Storage bucket `visit-photos`

Migration içine `INSERT INTO storage.buckets` koyuldu (PROMPT-8). Bu hem Cloud hem Local'de çalışır. Eğer migration deploy edilmediyse Dashboard → Storage → New bucket → `visit-photos` (public: NO) elle açılabilir.

## 7. WhatsApp Cloud API

Plan'da düşük öncelik, şimdilik `wa.me` deep link kullanılıyor (mevcut ClinicCard.tsx zaten doğru). Gerçek Cloud API gerekirse ek prompt.

## 8. Gemini AI temizleme

PROMPT-3 (clinic-scan filtresi) yeterli görüldü. Gemini eklemesi şimdilik yapılmadı.

## 9. Cloudflare Pages env vars

`.env` dosyası git'e commit edilmez (gitignore). Cloudflare Pages Production env vars Dashboard'dan ayrı girilir:
- Sadece `VITE_*` prefixli olanlar
- `SUPABASE_SERVICE_ROLE_KEY` ve `MAPBOX_SECRET_TOKEN` Pages'a girmez (build-time leak)

## 10. Capacitor Android

`@capacitor/share` ve `@capacitor/preferences` zaten kurulu. Android Studio kurulumu sende, build için `npm run cap:android`.

iOS desteği için Mac + Xcode gerekir, şu an Windows üzerindesin → atlandı.
