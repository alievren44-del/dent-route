# START HERE — NAV (dent-route / saha) Oturum Başlangıcı

> Bu repoda çalışmaya başlayan her ajan **önce bunu okur**. ~1 sayfa. Amaç: doğru sırada bağlam
> yükle, körlemesine kod yazma, önce değerlendir–sonra uygula.

---

## Okuma Sırası (atlanamaz)

1. **`.claude/CLAUDE.md`** — Engineering OS anayasası. Öncelik kuralı, çalışma döngüsü, roller,
   bu projeye özel kısıtlar (ortak DB, push=onay, native serbest). Kurallar buradan gelir.
2. **PROJECT_CONTEXT** — Proje bağlamı: `README.md`, `docs/`, `dentroute_prompts.md`,
   `eksik_analiz_raporu.md`, `.claude/RISK_REGISTER.md`. Ne yapıldı, ne eksik, hangi risk açık.
3. **Repo'nun kendisi (repository-facts = en yüksek otorite)** — sırayla:
   - `package.json` (name=`saha-app`, "Field sales automation PWA — vertical-agnostic, white-label"),
     `vite.config.ts` (path-alias'lar: `@core @features @components @lib @config @verticals`).
   - `src/main.tsx` — boot sırası (ssoCapture → config/branding → StatusBar → QueryClient/persist →
     `initSyncQueue` → OTA `otaCheck('nav')` → render).
   - `src/router.tsx` — ~50 rota, `ProtectedRoute`/`AppShell`, RBAC (requireRole/requirePermission).
   - `src/core/adapters/factory.ts` — CRM adapter tek-oluşturma noktası (Supabase vs custom_rest).
   - `src/core/offline/{db.ts,syncQueue.ts}` — offline-first (Dexie + kuyruk).
   - `capacitor.config.ts`, `wrangler.jsonc`, `.env.production`, `supabase/functions/*`,
     `supabase/migrations*` — deploy + backend + şema gerçeği.
4. **Eksik dokümanı tamamla** — Okurken bir FACT keşfedip dokümanlarda yoksa/yanlışsa,
   **düzelt ve `.claude/`'a geri yaz** (Doc Lead rolü). Bilgiyi oturumla birlikte kaybetme.
5. **ÖNCE değerlendirme sun → SONRA onay al → SONRA uygula.**
   Doğrudan kod yazmaya dalma. Kısa bir plan ver: ne, neden, hangi dosyalar, etki-alanı, risk,
   geri-alma. Kullanıcı onaylayınca uygula.

---

## Bu Repoda İlk Bilmen Gerekenler (30 saniyelik model)

- **Ne bu?** Saha satış / klinik-keşif CRM PWA. Vertical-agnostic, white-label (13 sektör şablonu
  `verticals/*.json`). Web (Cloudflare) + Android (Capacitor + OTA) tek kod tabanı.
- **Mimari** — Feature-sliced: `src/core/*` (yatay altyapı) + `src/features/*` (17 dikey ekran).
  CRM erişimi **yalnızca adapter** üzerinden.
- **Veri** — TanStack Query + offline-first (Dexie + syncQueue). Statik lookup'lar persist,
  **finansal/volatile listeler bilinçli persist DIŞI**.
- **Backend** — Supabase Edge Functions (Deno), `rranpzicmhgfupgabgbi` — **web+parla ile ORTAK proje**.
- **Kritik kısıt** — Ortak DB: RLS/rol/şema dokunuşu üç uygulamayı etkiler. `push=onay`.
  `webContentsDebuggingEnabled` teslim öncesi kapat.

---

## Başlamadan Kontrol Listesi

- [ ] CLAUDE.md okundu, öncelik kuralı içselleştirildi (facts > docs > prompt).
- [ ] Görev hangi katmanı etkiliyor? (core / feature / adapter / native / deploy / DB)
- [ ] Ortak-DB veya RLS/rol dokunuşu var mı? Varsa ekstra dikkat + onay.
- [ ] FACT vs VARSAYIM ayrımı netleştirildi (görmediğimi uydurmuyorum).
- [ ] Değerlendirme sunuldu, onay alındı, geri-alma planı hazır.

> Şüphe halinde: **dur, sor, değerlendirme sun.** Yanlış varsayımla ilerlemek, sormaktan pahalıdır.
