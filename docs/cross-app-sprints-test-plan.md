# Cross-App Sprint G/I/J/H/K — Test Planı

Durum: ✅ doğrulandı · 🔄 cihaz E2E · ⏳ deploy sonrası.
Kimlikler: admin `alievren_44@hotmail.com.tr` / `7063AliEvren.` · rep `saha_push_test@parla.local` / `Test1234!`.
Birim test: `npm run test` (175 test, +5 order-status). Migration write-verify: impersonation-rollback.

## Sprint G — saha-zincir P0
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| G1.1 | ActiveRoute "Durağı Tamamla" | saha_visits completed-kayıt (route_id, outcome=route_stop) | 🔄 cihaz · ✅ kolon/CHECK doğrulandı |
| G1.2 | Aynı durağı 2× tamamla | idempotency_key (route_stop_<rid>_<aid>_<repId>) → tek kayıt | ✅ kod |
| G2.1 | Koordinatsız klinik check-in | "GPS yok" override checkbox → check-in yapılır | 🔄 cihaz |
| G2.2 | ≥2km gerçek-uzak klinik | Bloklu (korundu) | ✅ kod |
| G3.1 | Numune kaydı | toast (alert YOK — mobil bloke biter) | 🔄 cihaz |
| G3.2 | Quota null | "Bütçe tanımlanmamış" (yanıltıcı "0 TL" yok) | ✅ kod |
| G4.1 | Admin sipariş onayla | plasiyere bell+push (order_approval) | 🔄 cihaz |
| G4.2 | Admin sipariş reddet | plasiyere bell+push (red sebebi) | 🔄 cihaz |

## Sprint I — güvenlik (DB-verified)
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| I1.1 | Non-admin kendi role='admin' UPDATE | **BLOKLANDI** (trg_prevent_role_self_escalation) | ✅ DB-verified |
| I1.2 | Admin başkasının rolünü değiştir | İzin (profiles_admin_update, saha_is_admin) | ✅ policy |
| I1.3 | MANAGER rol değiştir | RED (saha_is_admin sadece ADMIN) | ✅ policy |
| I2.1 | authenticated audit-log DELETE | revoke → yapamaz (append-only) | ✅ grant-revoke |
| I3.1 | HeatmapPage | son 90 gün + limit 10000 (timeout yok) | ✅ kod |
| I3.2 | BIDashboard | profiles rep-rol filtreli | ✅ kod |

## Sprint J — bildirim unifikasyonu
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| J2.1 | Cron-hatırlatma due olur | push (notifications) **+ bell (saha_notifications)** | ✅ migration |
| J3.1 | NotificationsPage bildirime tıkla | payload.route → /takvim?reminder navigate | 🔄 cihaz |
| J1 | rep_collections↔saha_odemeler | **ERTELENDİ** — mimari/veri-modeli kararı (user) | ⏸️ |

## Sprint H — admin canlı görünürlük
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| H1.1 | Dashboard "Canlı Aktivite" | bugünkü ziyaretler (rep+klinik+saat+outcome), 60s refetch | 🔄 cihaz |
| H1.2 | Plasiyer satırı tıkla | /admin/rep-kpi?rep=id drill-down (a11y) | 🔄 cihaz |
| H2.1 | Admin broadcast gönder | hedef rep'lere bell+push, "N kişiye gönderildi" | ✅ DB-verified (admin sent=5) · 🔄 UI |
| H2.2 | Non-admin broadcast RPC | RED (saha_is_admin guard) | ✅ policy |

## Sprint K — UX/a11y
| # | Senaryo | Beklenen | Durum |
|---|---------|----------|-------|
| K1.1 | orderStatusMeta | tek-kaynak label/renk (delivered→"Teslim Edildi") | ✅ unit-test (5) |
| K2.1 | RouteCard | klavye/SR erişilir (role/tabIndex/aria-pressed/Enter-Space) | ✅ kod |
| K2.2 | VisitCard foto | tıkla→yeni-sekme lightbox | 🔄 cihaz |
| K2.3 | NotificationBell popup | Escape kapat + focus + aria-live + role=dialog | 🔄 cihaz |
| K2.4 | Header Çıkış / OfflineBanner Kaldır | min 44px (WCAG 2.5.5) | ✅ kod |

## Migration özeti (hepsi MCP-canlı + repo-file)
- 20260614000007 security_hardening (self-escalation trigger + admin policy + audit revoke) — verified
- 20260614000008 dispatch_bell_dualwrite (cron→bell) — applied
- 20260614000009 admin_broadcast (RPC) — verified (admin sent=5)

## Çalıştırma
- Birim: `npm run test` → 175 yeşil.
- Cihaz E2E: `tests/device/` CDP harness; clean prod build (`npm run build:native` + cap sync + gradle + adb install -r + pm clear).
- Migration: impersonation `begin; set local role authenticated; set jwt sub; ... ; rollback;`.
