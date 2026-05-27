# 02 — API Key'leri + .env

## .env dosyası

```bash
cd C:\Users\PC\Desktop\navigasyon
cp .env.example .env
```

Sonra `.env` aç, aşağıdaki tablodaki gibi doldur:

| Değişken | Nerede alınır | Notlar |
|----------|---------------|--------|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL | `https://xxxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Aynı yer → `anon` key | Public, client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Aynı yer → `service_role` key | **SADECE** Edge Function + bootstrap script. Repo'ya commit etme |
| `VITE_MAPBOX_PUBLIC_TOKEN` | https://account.mapbox.com/access-tokens/ | `pk.` ile başlar. Default token kopyalanabilir |
| `MAPBOX_SECRET_TOKEN` | Aynı yer → Create token → "Optimization API:Read" scope | `sk.` ile başlar. Bir kez gösterilir, kaybedersen yenisini üret |
| `GOOGLE_PLACES_API_KEY` | https://console.cloud.google.com/apis/credentials | Aşağıda ayrıntı |
| `VITE_MAPTILER_KEY` | Opsiyonel — boş bırakılabilir | Offline tile için |

## Google Places API key — adım adım

1. Google Cloud Console → New project (örn: "dent-route-prod")
2. APIs & Services → Library → ara:
   - **Places API** → Enable
   - **Maps JavaScript API** → Enable (opsiyonel, sadece JS kullanılırsa)
3. APIs & Services → Credentials → "Create credentials" → API key
4. Oluşan key'i kopyala → `.env` içine `GOOGLE_PLACES_API_KEY=AIza...`
5. **ÖNEMLI — kısıtlama:** key'i seç → "Edit" →
   - Application restrictions: **HTTP referrers** (web siteleri) DEĞIL — Edge Function server-side çağırıyor, restriction "None" ya da "IP addresses" Supabase IP'leri için (Supabase'in egress IP listesi: https://supabase.com/docs/guides/platform/network-restrictions)
   - API restrictions: sadece "Places API" seç (diğerlerini kapat — ifşa olursa hasarı sınırlar)
6. **BÜTÇE ALARMI ZORUNLU:**
   - Billing → Budgets & alerts → Create budget
   - Limit: **$20/ay** (önerilen başlangıç)
   - Threshold alarmları: %50, %90, %100 → email bildir
   - Places API Nearby Search: ~$17 / 1000 sorgu. Bütçesiz tarama mali zarar verir.

## Edge Function secrets

`.env` Edge Function'lar tarafından OKUNMAZ — Supabase'in kendi secrets store'una yazılmalı:

```bash
npx supabase secrets set GOOGLE_PLACES_API_KEY="<senin_key>"
npx supabase secrets set MAPBOX_SECRET_TOKEN="<senin_secret>"
npx supabase secrets set ALLOWED_ORIGINS="http://localhost:5173,https://dent-route-saha.pages.dev"
```

(Production domain Cloudflare Pages'den geliyorsa onu da virgülle ekle.)

## Config dosyası

```bash
cp config/.saha-config.example.json config/.saha-config.json
```

`config/.saha-config.json` aç → düzenle:
- `tenant.name`: "Parla Diş Deposu"
- `tenant.vertical`: "dental"
- `branding.logoUrl`: (varsa) Parla logosu URL

Detaylar `config/README.md` içinde.

## Doğrulama

```bash
npm run saha:check-setup
```
(Bu komut Claude PROMPT-1 ile yazıldı; her şey yeşil olmalı.)

Eksik varsa script eksiğini söyler.
