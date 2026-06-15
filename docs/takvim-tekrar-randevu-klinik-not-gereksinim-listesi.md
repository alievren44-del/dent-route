# Takvim "Tekrar Randevu" + Klinik Not — Gereksinim Listesi & Test Sonuçları (2026-06-15)

Plasiyer saha kullanımı geri bildirimi → 2 eksik tespit → düzeltildi + 1 bitişik bug bulundu → düzeltildi.
Cihaz: S24 Ultra kablolu, plasiyer `saha_push_test@parla.local`. Gerçek veri ile test.

## ✅ Yapıldı + cihazda doğrulandı (bu oturum)

| Kod | İhtiyaç | Dosya | Test |
|-----|---------|-------|------|
| **F1** | Randevu detayında "Tekrar Randevu" butonu — klinik+tür+başlık ön-dolu modal, plasiyer yalnız yeni tarih seçer | ReminderDetailSheet.tsx + CalendarPage.tsx | S2/S3/S4 PASS |
| **F2** | Klinik seçince geçmiş görüşme notları görünür (saha_reminders.completion_note klinik zaman çizelgesinde) | CustomerActivityTimeline.tsx | S1/S6/S7/S8 PASS |
| **R4** | Klinik detay başlığı/telefonu — keşfedilmiş klinik (profil yok) için "Müşteri" yerine gerçek ad + Ara/WhatsApp | CustomerDetailPage.tsx | H1="Uzm.Dt. Sıla Sucuka Diş Kliniği", Ara+WA PASS |

**Gerçek sonuç:** dekan görüşmesi → haftaya Pazartesi 22 Haz 20:00 randevusu cihaz UI'ından oluşturuldu (saha_reminders `2f9929fa`).

## Test sonucu: 10/10 geçti
S1✅ S2✅ S3✅(prefill+save) S4✅ S5✅(*) S6✅ S7✅ S8✅ S9✅ S10✅
- (*) S5 harness "FAIL" gösterdi = **test betiği yanlış-pozitifi**: modal arkasındaki ajanda "Sıla Sucuka" metnini sızdırıyor (`body.includes` arka plan kartını yakalıyor). DB doğrulaması: dekan follow-up `account_id=NULL`, due 2026-06-22 20:00 TR — **doğru kaydedildi**. Gerçekte PASS.
- 0 console error.

## ✅ 2. DALGA — kalan gereksinimlerin HEPSİ yapıldı + cihazda doğrulandı (2026-06-15)

| Kod | Gereksinim | Dosya | Cihaz testi |
|-----|-----------|-------|-------------|
| **R1** | Kliniksiz randevuya "Klinik Bağla" (ReminderDetailSheet → LinkClinicModal → saha_reminders.account_id update) | ReminderDetailSheet.tsx + CalendarPage.tsx | LINK_BTN + toast PASS (temiz restart) + DB link doğrulandı |
| **R2** | Klinik "Özet" sekmesinde "Son Görüşme" kartı (en son done+completion_note) | CustomerDetailPage.tsx | PASS (kart + not) |
| **R6** | Klinik zaman çizelgesinde AÇIK/gelecek randevu ("Yaklaşan" rozeti) | CustomerActivityTimeline.tsx | N2 PASS (Yaklaşan + TEST-LINK göründü) |
| **R3** | "Tekrar Randevu" recurrence + kaynak notu taşır | CalendarPage.tsx (ReminderInitial.recurrence) | kod+mekanizma (title/clinic ile aynı kanıtlı yol) |
| **R5** | Follow-up → kaynak randevu bağı (`source_ref=followup:<id>`) + "Önceki görüşmenin devamı" rozeti | CalendarPage.tsx + ReminderDetailSheet.tsx | badge PASS + DB source_ref zinciri doğrulandı |

### 🔴 2. dalgada bulunan + düzeltilen bug (akıl yürütme)
- **Persisted react-query staleness:** CustomerActivityTimeline + lastReminder sorgularında `staleTime`/`refetchOnMount` yoktu → asyncStorage-persist + global staleTime → **yeni eklenen/bağlanan randevu UI'da görünmüyordu** (R6 ilk testte FAIL verdi, DB doluydu). FIX: ikisine `staleTime:0`+`refetchOnMount:'always'` (NAV kök-dersi tekrar — CalendarPage'de daha önce yaşanmıştı).

### Test yöntemi (2. dalga)
- RLS impersonation+rollback (R1 update / R6 open-select). Cihaz: trk2-test.mjs + trk3-iso.mjs.
- Harness dersi (tekrar): aynı reminder üzerinde art-arda test → app cache state contamination → yanlış FAIL. Temiz doğrulama için `pm clear` + full restart şart.
- Test verisi temizlendi (TEST-LINK + follow-up zinciri silindi; yalnız gerçek dekan Pzt-20:00 `2f9929fa` korundu).

### Artık tamamen tamamlanan (kalan yok)
Tüm R1–R6 + F1/F2/R4 done. İleride opsiyonel: kliniksiz randevular için "Genel Randevular" toplu görünümü (R1'in geniş hali).

## Yöntem notu (sonraki oturum)
- RLS veri-yolu impersonation+rollback ile prod kirletmeden doğrulandı (Flow1 insert / Flow2 select, rep 2651109c).
- Harness S5 yanlış-pozitif: modal-içi metin kontrolünde `page.locator('[role=dialog]')` scope'u kullan, `body.innerText` değil.
- Bu 3 düzeltme tek branch/PR olmalı (CalendarPage hot-file). Merge=user onayı. tsc 0 + build OK.
</content>
