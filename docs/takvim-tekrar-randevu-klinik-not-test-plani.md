# Takvim "Tekrar Randevu" + Klinik Not Görünürlüğü — Plasiyer Test Planı (2026-06-15)

Cihaz: Samsung S24 Ultra (SM-S928B, R5CX80AG9BF), kablolu, CDP harness.
Plasiyer: `saha_push_test@parla.local` / `Test1234!` (rep `2651109c`).
Gerçek veri: Sıla Sucuka kliniği `31ecf2fc` (görüşme notu var), dekan randevusu `ae066779` (account_id NULL, tamamlandı+not).

## Düzeltilen iki eksik
- **Flow 1:** Tamamlanan/açık randevu kartının detayında **"Tekrar Randevu"** butonu yoktu → eklendi. Tıkla → "Takvime Ekle" modalı klinik+tür+başlık **ön-dolu** açılır, plasiyer yalnız yeni tarih-saat seçer.
- **Flow 2:** Klinik detay → "Zaman Çizelgesi" sekmesi `saha_reminders` sorgulamıyordu → tamamlanan randevu notları (`completion_note`) artık klinik geçmişinde görünür.

## 10 Senaryo (plasiyer gözünden)

| # | Senaryo | Adımlar | Beklenen | Sonuç |
|---|---------|---------|----------|-------|
| 1 | Sıla Sucuka notu klinik geçmişinde | /clinics → Sıla Sucuka → Zaman Çizelgesi | "gorusme gerceklesti hekim elindeki frezleri…" notu + "Görüşüldü" görünür | ⏳ |
| 2 | Detayda "Tekrar Randevu" butonu | /takvim → tamamlanan dekan randevusuna dokun | Detay sheet'te "Tekrar Randevu" butonu var | ⏳ |
| 3 | Tekrar Randevu ön-dolu + kaydet | "Tekrar Randevu" → tarih=haftaya Pzt 20:00 → Takvime Ekle | Başlık/klinik ön-dolu; yeni açık randevu takvimde 22 Haz 20:00 | ⏳ |
| 4 | Açık randevuda da çalışır | açık bir randevuya dokun → Detay | "Tekrar Randevu" butonu açık kayıtta da var + çalışır | ⏳ |
| 5 | account_id NULL randevu | dekan (kliniksiz) → Tekrar Randevu | Modal klinik boş açılır, akış kırılmaz, kaydedilir | ⏳ |
| 6 | Tamamlanmış kart not/sonuç (regression) | Sıla tanıtım tamamlanmış kayda dokun | Detayda sonuç "Görüşüldü" + not görünür, "Geri al" var | ⏳ |
| 7 | Klinik geçmişi birleşik akış | Sıla → Zaman Çizelgesi | randevu + ziyaret + numune + not ters-kronolojik tek akış | ⏳ |
| 8 | Notsuz tamamlanmış reminder gizli | Sıla geçmişi | "tanisma" (notsuz/sonuçsuz) timeline'da GÖRÜNMEZ | ⏳ |
| 9 | Boş "+ Ekle" (regression) | /takvim → Ekle | Modal tamamen BOŞ açılır (ön-dolu yok) | ⏳ |
| 10 | Detay aksiyonları (regression) | bir randevu → Detay | Ertele/Rotaya Ekle/Tamamla/Geri Al bozulmamış | ⏳ |

## Yöntem
1. RLS veri-yolu impersonation ile doğrulandı (Flow1 insert + Flow2 select rep=2651109c) — prod kirletilmedi (rollback).
2. APK: `build:native` → `cap sync android` → `gradlew assembleDebug` → `adb install -r` → `pm clear` + relaunch → login.
3. CDP: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` → Playwright connectOverCDP.
</content>
</invoke>
