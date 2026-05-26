# Saha App Configuration

`.saha-config.json` her deployment için özelleştirilen ana yapılandırma dosyasıdır. `.saha-config.example.json`'ı kopyalayıp düzenleyin.

```bash
cp config/.saha-config.example.json config/.saha-config.json
```

> ⚠️ `.saha-config.json` **gitignore**'da olmalıdır (deployment'a özel veriler).

---

## Alan Referansı

### `tenant`

| Alan | Tip | Açıklama |
|---|---|---|
| `id` | string | Tenant slug, kısa lowercase (örn: `parla`, `elmas`). DB schema isimleme ve loglarda kullanılır. |
| `name` | string | İnsan-okunabilir firma adı. |
| `domain` | string | Bu deployment'ın domain'i (Cloudflare Pages'te eşleşmeli). |

### `branding`

| Alan | Tip | Açıklama |
|---|---|---|
| `name` | string | UI'da görünecek marka adı (örn: header, login). |
| `logo` | string | Logo dosyasının path'i (`/assets/` altı önerilir). SVG tercih edilir. |
| `primaryColor` | string | HEX renk. Tailwind `--color-primary` CSS variable'ına atanır. |
| `accentColor` | string | HEX renk. Vurgu/highlight için. |

> Branding değiştirilince `npm run build` yeterli — runtime CSS variable atandığı için cold start gerekmez.

### `crm`

| Alan | Tip | Açıklama |
|---|---|---|
| `type` | `"supabase"` \| `"custom_rest"` | Hangi adapter kullanılacak. |
| `config` | object | Adapter'a özel ayarlar (aşağıdaki örnekler). |

#### CRM Tipi: `supabase` (built-in, default)

```json
"crm": {
  "type": "supabase",
  "config": {}
}
```

Built-in adapter Supabase'in kendisini kullanır, ek config gerekmez. Tablolar `0001_initial_schema.sql` migration'ı ile oluşur.

#### CRM Tipi: `custom_rest`

```json
"crm": {
  "type": "custom_rest",
  "config": {
    "baseUrl": "https://erp.firma.com/api/v1",
    "auth": {
      "type": "bearer",
      "tokenEnvVar": "CUSTOM_CRM_TOKEN"
    },
    "endpoints": {
      "listCustomers": { "method": "GET", "path": "/customers" },
      "getCustomer": { "method": "GET", "path": "/customers/{id}" },
      "searchNearby": { "method": "GET", "path": "/customers/nearby?lat={lat}&lng={lng}&radius={radius}" },
      "getBalance": { "method": "GET", "path": "/customers/{id}/balance" },
      "listOrders": { "method": "GET", "path": "/customers/{id}/orders" },
      "createOrder": { "method": "POST", "path": "/orders" },
      "quoteOrder": { "method": "POST", "path": "/orders/quote" },
      "listProducts": { "method": "GET", "path": "/products" },
      "getProduct": { "method": "GET", "path": "/products/{id}" }
    },
    "fieldMapping": {
      "customer": {
        "id": "$.customerId",
        "name": "$.companyName",
        "phone": "$.phone1",
        "whatsapp": "$.mobilePhone"
      },
      "order": {
        "id": "$.orderId",
        "status": "$.statusCode",
        "totalAmount": "$.grandTotal"
      },
      "product": {
        "id": "$.productId",
        "sku": "$.itemCode",
        "name": "$.itemName",
        "basePrice": "$.unitPrice"
      }
    }
  }
}
```

JSONPath formatında field mapping ile herhangi bir REST API yapısı eşleşir.

### `features`

Her özellik flag'i ile açılıp kapatılabilir. Müşteri "şu fonksiyon olmasın" derse `false` yap.

| Flag | Etki |
|---|---|
| `orders` | Mobil sipariş açma açık/kapalı |
| `balance` | Cari bakiye gösterimi |
| `campaigns` | Kampanya gösterimi (sadece read MVP'de) |
| `mileageTracking` | Yakıt/km tracking |
| `recurringRoutes` | Tekrarlayan rota tanımlama |
| `visitPhotos` | Ziyaret fotoğrafı upload |
| `offlineMode` | Service Worker + sync queue |
| `realtimeTraffic` | Mapbox trafik annotations |

### `external`

#### `external.mapbox`

| Alan | Açıklama |
|---|---|
| `publicTokenEnvVar` | Mapbox public token'ı hangi env var'da (Edge Function proxy yine de kullanılır, ama public token map render için lazım) |
| `rateLimit.optimizationPerUserPerDay` | Edge Function tarafında uygulanır |
| `rateLimit.directionsPerUserPerDay` | — |

#### `external.googlePlaces`

| Alan | Açıklama |
|---|---|
| `rateLimit.searchesPerUserPerDay` | Nearby search çağrı limiti |
| `rateLimit.autocompletePerUserPerDay` | Autocomplete session limit |

#### `external.mapTiler` (opsiyonel)

Offline tile pack için. `enabled: true` ise rota başlangıcında bölge tile'ları indirilir.

### `geo`

| Alan | Açıklama |
|---|---|
| `country` | ISO 3166-1 alpha-2 (örn: `TR`) — Google Places filter için |
| `defaultMapCenter` | Login sonrası ilk açılan harita konumu |
| `discoveryRadiusKm` | "Çevremdeki klinikler" varsayılan yarıçap |
| `discoveryMaxResults` | Tek seferde gösterilecek max sonuç |

### `legal`

| Alan | Açıklama |
|---|---|
| `kvkkRequired` | TR deployment için `true` (yasal) |
| `kvkkVersion` | Metin güncellenince artar, kullanıcıdan tekrar onay alınır |
| `kvkkUrl` | Aydınlatma metni PDF path'i |
| `dataRetention.*` | Otomatik veri silme süreleri (cron job ile) |

### `deployment`

Env var isimleri. Gerçek değerler `.env` dosyasında veya Cloudflare Pages dashboard'unda.

---

## Environment Variables

`.env` dosyası örneği (`.env.example`):

```bash
# Supabase
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...

# Mapbox (sadece public token client'a verilir)
VITE_MAPBOX_PUBLIC_TOKEN=pk.eyJ...

# MapTiler (opsiyonel, offline pack)
VITE_MAPTILER_KEY=...

# Custom CRM (sadece custom_rest adapter kullanılırsa)
CUSTOM_CRM_TOKEN=...
```

Edge Function tarafındaki secret'lar (Mapbox secret, Google Places key) Supabase secrets'ta saklanır:

```bash
supabase secrets set MAPBOX_SECRET_TOKEN=sk.eyJ...
supabase secrets set GOOGLE_PLACES_KEY=...
```

---

## Bootstrap Komutu

```bash
npm run saha:bootstrap
```

Bu komut `.saha-config.json`'ı okur ve:

1. CRM tipini tespit eder
2. Supabase ise → tabloları check eder, eksikse migration uygular
3. Custom REST ise → bağlantı testi yapar, endpoint sözleşmesi doğrular
4. Bootstrap raporu ekrana basar

```
✅ Tenant: parla (Parla Diş Deposu)
✅ CRM: supabase (built-in)
✅ Tablolar: 15/15 mevcut
✅ RLS: tüm tablolarda aktif
✅ Mapbox token: valid
✅ Google Places key: valid
🎉 Bootstrap tamamlandı.
```
