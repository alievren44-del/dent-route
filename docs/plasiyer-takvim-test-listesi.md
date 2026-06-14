# Plasiyer Takvim — Kapsamlı Test Listesi (Faz A–E)

Durum kolonu: ✅ doğrulandı · 🔄 bu turda çalıştırılıyor · ⏳ deploy sonrası canlı.
Test ortamı: S24 Ultra (R5CX80AG9BF), clean prod build, CDP harness `tests/device/`.
Kimlikler: admin `alievren_44@hotmail.com.tr` / `7063AliEvren.` (sonda nokta) · rep `saha_push_test@parla.local` / `Test1234!`.

## FAZ A — Tahsilat vade + deep-link (P0)
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| A1.1 | Vadesi 0-3 gün çek/senet (portföyde) + cari'nin sales_rep'i var → cron | rep takviminde 'tahsilat' randevusu, due=vade 09:00 | ✅ DB |
| A1.2 | Cron 2× çalışır | Aynı çek için tek reminder (source_ref idempotent) | ✅ DB |
| A1.3 | Fatura kalan>0 + vade yakın | 'tahsilat' reminder (fatura_no + kalan) | ✅ DB (mantık) |
| A1.4 | Cari'nin sales_rep_id NULL | Reminder ÜRETİLMEZ (atla) | ✅ kod |
| A1.5 | Ödenmiş/iptal fatura | Reminder yok | ✅ kod (durum filtre) |
| A1.6 | Tahsilat reminder rep takviminde görünür | Liste + push | 🔄 cihaz E2E |
| A2.1 | Bildirime tıkla (`/takvim?reminder=<id>`) | O randevuya scroll + 3.5s ring highlight | 🔄 cihaz |
| A2.2 | Geçersiz/silinmiş reminder id | Highlight yok, hata yok | ✅ kod (exists guard) |

## FAZ B — Telefon-ekle + offline + rota (P1)
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| B1.1 | Telefonsuz klinik randevusu → "Numara ekle" → kaydet | saha_clinics.phone güncellenir, Ara/WhatsApp belirir | 🔄 cihaz |
| B1.2 | Geçersiz numara (<7) | toast hata, kayıt yok | ✅ kod |
| B2.1 | Offline (uçak modu) randevu ekle | Kuyruğa alınır, "çevrimdışı" toast | 🔄 cihaz |
| B2.2 | Online dön → kuyruk flush | saha_reminders'a insert | 🔄 cihaz |
| B2.3 | Offline ekleme atama ise | Bildirim atlanır (sadece kuyruk) | ✅ kod |
| B3.1 | Randevu kartı "Rotaya Ekle" (konumlu klinik) | routeBasketStore'a eklenir, /routes/plan'da | 🔄 cihaz |
| B3.2 | Konumsuz (lat/lng null) klinik | "konum yok" hata | ✅ kod |
| B3.3 | Sepet dolu (12) / zaten ekli | İlgili uyarı | ✅ kod |

## FAZ C — Geciken + KPI + tekrarlayan (P2)
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| C1.1 | "Gecikti" filtre (due<now & open) | Sadece geciken open reminder'lar | ✅ smoke |
| C1.2 | Geciken reminder kartı | Kırmızı "Gecikti" rozeti (tüm görünümler) | ✅ kod |
| C2.1 | SalesHub "Bugün" kartı | Ziyaret/sipariş/tahsilat adet+tutar | 🔄 cihaz |
| C2.2 | Aylık hedef çubukları | Sipariş₺ + ziyaret + tahsilat₺ (hedef varsa) | ✅ kod |
| C3.1 | Tekrar=Haftalık randevu → tamamla | +7 gün yeni open occurrence | 🔄 cihaz |
| C3.2 | Tekrar=Aylık → tamamla | +1 ay yeni occurrence (assigned_by korunur) | 🔄 cihaz |
| C3.3 | Recurring tamamla → "Geri al" | Original açılır + child silinir (çift-aktif yok) | ✅ kod |

## FAZ D — Foto/ses eki (P2-14)
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| D1.1 | Randevuya foto ekle → kaydet | reminder-files'a upload + attachment satırı | 🔄 cihaz |
| D1.2 | Ses kaydet (MediaRecorder) → kaydet | audio upload + satır | 🔄 cihaz |
| D1.3 | AgendaCard ekleri göster | Foto thumbnail + audio player (signed url) | 🔄 cihaz |
| D1.4 | Rep kendi reminder'ına ek | İzin (RLS) | ✅ DB |
| D1.5 | Rep başkasının reminder'ına ek | RED (RLS) | ✅ DB |
| D1.6 | Kayıt sırasında modal kapat | Mikrofon stream durur (leak yok) | ✅ kod (unmount cleanup) |
| D1.7 | Offline'da ek | Atlanır + uyarı | ✅ kod |

## FAZ E — Admin atama + push (taşınan canlı doğrulama)
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| E.1 | Admin "+Ekle" "Kime: Eda" → kaydet | View otomatik Eda'ya geçer, kayıt görünür | ✅ cihaz |
| E.2 | Atama → hedef bell + push satırı | saha_notifications + notifications | ✅ DB |
| E.3 | send-push EF | POST 200 (FCM dispatch) | ✅ EF log |
| E.4 | **Fiziksel FCM cihaza gelir** | Bildirim tepsisinde görünür (dumpsys StatusBarNotification) | ✅ cihaz |
| E.5 | Bildirime tıkla | /takvim açılır (deep-link) | ✅ cihaz (MainActivity açıldı) |

## Güvenlik / RLS (write-verify impersonation)
- saha_reminders: rep kendi / admin tümü (SELECT/INSERT/UPDATE) ✅
- saha_reminder_attachments: rep-sahibi/admin, başkası RED ✅
- notifications INSERT service_role-only → client RPC (saha_notify_rep SECURITY DEFINER) ✅
- collection cron SECURITY DEFINER (rep eşleme cari.sales_rep_id) ✅
