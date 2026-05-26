# 🗄️ Database Schema — Saha App v1.0

> Migration SQL'i: `supabase/migrations/0001_initial_schema.sql`
> Bu dosya şemayı insan dilinde belgeler.

---

## Genel Tasarım Prensipleri

1. **İki katman ayrımı:**
   - **Built-in CRM tabloları** (`accounts`, `products`, `orders` vb.) → sadece `crm.type=supabase` ise kullanılır
   - **Saha tabloları** (`profiles`, `visits`, `routes` vb.) → her zaman var

2. **External ID desteği:** `account_id` saha tablolarında `TEXT` tipinde — built-in mode'da UUID stringi, custom_rest mode'da external ERP'nin ID'si.

3. **UUID PK:** Tüm tablolarda `id UUID DEFAULT gen_random_uuid()`.

4. **Soft delete yok (MVP'de):** Veriler hard delete; ileride `archived_at` eklenebilir.

5. **`updated_at` trigger:** Her tabloda otomatik güncellenen kolon.

6. **PostGIS:** Coğrafi sorgular için `geography(POINT, 4326)`.

7. **RLS her tabloda zorunlu:** Hiçbir tablo RLS'siz oluşturulmaz.

---

## Katman A: Built-in CRM (opsiyonel, sadece `supabase` mod)

### `accounts` — Müşteri/Klinik kaydı

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | Primary key |
| `external_id` | TEXT | Adapter modunda dış ID (örn: Logo cari kod) |
| `name` | TEXT NOT NULL | Klinik/firma adı |
| `type` | TEXT | **Vertical template'in customerTypes anahtarı** (CHECK yok, validation app layer'da) |
| `tax_id` | TEXT | Vergi no |
| `phone`, `whatsapp`, `email` | TEXT | İletişim |
| `notes` | TEXT | Genel notlar |
| `status` | TEXT | `active`, `inactive`, `prospect` |
| `region` | TEXT | Manager filter için |
| `custom_fields` | JSONB | **Vertical template'in customFields'ından** (örn: `{"doctor_count": 3, "branch": "Ortodonti"}`) |
| `created_at`, `updated_at` | TIMESTAMPTZ | Otomatik |

**İndeks:** `custom_fields` üzerinde GIN index (özel alan sorgulamak için)

### `account_addresses` — Adres + koordinat

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `account_id` | UUID FK | `accounts.id` |
| `label` | TEXT | `primary`, `billing`, `shipping` |
| `address_line` | TEXT NOT NULL | |
| `district`, `city`, `postal_code` | TEXT | |
| `country` | TEXT | Default `TR` |
| `location` | GEOGRAPHY(POINT, 4326) | PostGIS koordinat |
| `google_place_id` | TEXT | Google Places ID (deduplication için) |
| `is_primary` | BOOLEAN | |

**Index:** `GIST` index `location` üzerinde (yakınlık sorguları için)

### `account_contacts` — Kişiler (hekim, sekreter)

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `account_id` | UUID FK | |
| `full_name` | TEXT NOT NULL | |
| `title` | TEXT | `Klinik Sahibi`, `Hekim`, `Sekreter` |
| `phone`, `whatsapp`, `email` | TEXT | |
| `is_primary` | BOOLEAN | |

### `products` — Ürün kataloğu

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `external_id` | TEXT | ERP ürün kodu |
| `sku` | TEXT UNIQUE | |
| `name` | TEXT NOT NULL | |
| `description` | TEXT | |
| `category` | TEXT | |
| `unit` | TEXT | Default `adet` |
| `base_price` | NUMERIC(12,2) | |
| `currency` | TEXT | Default `TRY` |
| `vat_rate` | NUMERIC(5,2) | Default 20.0 |
| `stock_quantity` | NUMERIC(12,3) | Cached stock |
| `is_active` | BOOLEAN | |
| `image_url` | TEXT | Supabase Storage URL |

### `account_prices` — Müşteri özel fiyatları

| Kolon | Tip |
|---|---|
| `account_id` | UUID FK |
| `product_id` | UUID FK |
| `price` | NUMERIC(12,2) |
| `currency` | TEXT |
| `valid_from`, `valid_until` | DATE |

**PK:** `(account_id, product_id)`

### `campaigns` — Kampanyalar

| Kolon | Tip |
|---|---|
| `id` | UUID PK |
| `name`, `description` | TEXT |
| `discount_type` | TEXT (`percent`, `fixed`, `buy_x_get_y`) |
| `discount_value` | NUMERIC(10,2) |
| `conditions` | JSONB (esnek kurallar) |
| `starts_at`, `ends_at` | TIMESTAMPTZ |
| `is_active` | BOOLEAN |
| `applies_to_products` | UUID[] |

### `orders` — Siparişler

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `external_id` | TEXT | Sync sonrası ERP order ID |
| `account_id` | UUID FK | |
| `created_by` | UUID FK → profiles | |
| `visit_id` | UUID FK → visits (opsiyonel) | Ziyaret bağlantısı |
| `status` | TEXT | `draft`, `pending`, `confirmed`, `shipped`, `delivered`, `cancelled` |
| `total_amount` | NUMERIC(12,2) | |
| `currency` | TEXT | |
| `notes` | TEXT | |
| `idempotency_key` | TEXT UNIQUE | Çift sipariş önleme |

### `order_items` — Sipariş kalemleri

| Kolon | Tip |
|---|---|
| `id` | UUID PK |
| `order_id` | UUID FK |
| `product_id` | UUID FK |
| `product_sku`, `product_name` | TEXT (snapshot) |
| `quantity` | NUMERIC(12,3) |
| `unit_price` | NUMERIC(12,2) |
| `discount_amount` | NUMERIC(12,2) |
| `vat_rate` | NUMERIC(5,2) |
| `line_total` | NUMERIC GENERATED |
| `campaign_id` | UUID FK (nullable) |

### `payments` — Tahsilatlar (gelecek için hazır)

| Kolon | Tip |
|---|---|
| `id` | UUID PK |
| `account_id` | UUID FK |
| `amount` | NUMERIC(12,2) |
| `currency` | TEXT |
| `payment_date` | DATE |
| `method` | TEXT |
| `reference` | TEXT |

### `account_balances` — VIEW (hesaplanan bakiye)

```sql
CREATE VIEW account_balances AS
SELECT
  a.id AS account_id,
  SUM(CASE WHEN o.status IN ('confirmed','shipped','delivered')
           THEN o.total_amount ELSE 0 END) AS total_orders,
  SUM(p.amount) AS total_paid,
  ... - ... AS balance
FROM accounts a
LEFT JOIN orders o ON o.account_id = a.id
LEFT JOIN payments p ON p.account_id = a.id
GROUP BY a.id;
```

---

## Katman B: Saha (her zaman var)

### `profiles` — Kullanıcı profili (auth.users uzantısı)

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | `auth.users.id` ile aynı |
| `full_name` | TEXT NOT NULL | |
| `email`, `phone` | TEXT | |
| `role` | TEXT NOT NULL | `sales_rep`, `manager`, `admin` |
| `region` | TEXT | Bölge (manager filter için) |
| `is_active` | BOOLEAN | |
| `avg_fuel_consumption` | NUMERIC(5,2) | L/100km (default 7.0) |

### `assignments` — Saha temsilcisi ↔ müşteri eşlemesi

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `profile_id` | UUID FK | |
| `account_id` | **TEXT** | Hem UUID hem external ID destekli |
| `assigned_at` | TIMESTAMPTZ | |
| `assigned_by` | UUID FK | |

**Unique:** `(profile_id, account_id)`

### `visits` — Ziyaret kayıtları

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `profile_id` | UUID FK | |
| `account_id` | TEXT | |
| `route_id` | UUID FK (nullable) | İlgili rota |
| `checked_in_at` | TIMESTAMPTZ | |
| `checked_out_at` | TIMESTAMPTZ | |
| `check_in_location` | GEOGRAPHY(POINT) | Hile önleme |
| `outcome` | TEXT | **Vertical template'in visitOutcomes anahtarı** (CHECK yok, validation app layer'da) |
| `notes` | TEXT | |
| `photos` | TEXT[] | Storage URL array |
| `next_action` | TEXT | |
| `next_action_due` | DATE | |
| `custom_fields` | JSONB | **Vertical template'in visitCustomFields'ından** |

### `routes` — Rotalar (planlanan/aktif/tamamlanan)

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `profile_id` | UUID FK | |
| `name` | TEXT | "Beşiktaş Pazartesi", "Anadolu Yakası Salı" |
| `account_ids` | TEXT[] NOT NULL | Optimize sıralı |
| `status` | TEXT | `planned`, `active`, `completed`, `cancelled` |
| `is_recurring` | BOOLEAN | |
| `recurrence_rule` | TEXT | RFC 5545 RRULE (örn: `FREQ=WEEKLY;BYDAY=MO`) |
| `optimized` | BOOLEAN | |
| `total_distance_km` | NUMERIC(8,2) | |
| `total_duration_min` | INTEGER | |
| `started_at`, `completed_at` | TIMESTAMPTZ | |

### `mileage_logs` — Yakıt/km kayıtları

| Kolon | Tip |
|---|---|
| `id` | UUID PK |
| `profile_id` | UUID FK |
| `route_id` | UUID FK |
| `distance_km` | NUMERIC(8,2) |
| `duration_min` | INTEGER |
| `estimated_fuel_l` | NUMERIC(8,3) |
| `estimated_fuel_cost` | NUMERIC(10,2) |
| `log_date` | DATE |

### `account_notes` — Klinik kalıcı notları

| Kolon | Tip |
|---|---|
| `id` | UUID PK |
| `account_id` | TEXT |
| `profile_id` | UUID FK |
| `note` | TEXT NOT NULL |
| `pinned` | BOOLEAN |

### `sync_queue` — Offline işlemler kuyruğu

| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | UUID PK | |
| `profile_id` | UUID FK | |
| `operation_type` | TEXT | `create_visit`, `create_order`, `update_note` |
| `payload` | JSONB | Sunucuya gönderilecek body |
| `status` | TEXT | `pending`, `processing`, `completed`, `failed` |
| `error_message` | TEXT | |
| `retry_count` | INTEGER | |
| `created_at`, `processed_at` | TIMESTAMPTZ | |

---

## Row Level Security (RLS) Özeti

### Kural Matrisi

| Tablo | sales_rep | manager | admin |
|---|---|---|---|
| `accounts` | SELECT (atanmış) | SELECT (bölge) | ALL |
| `account_addresses` | SELECT (atanmış) | SELECT (bölge) | ALL |
| `products` | SELECT (tümü) | SELECT | ALL |
| `orders` | SELECT/INSERT (kendi) | SELECT (bölge) | ALL |
| `visits` | SELECT/INSERT (kendi) | SELECT (bölge) | ALL |
| `routes` | SELECT/INSERT/UPDATE (kendi) | SELECT (bölge) | ALL |
| `profiles` | SELECT (kendi) | SELECT (bölge) | ALL |
| `assignments` | SELECT (kendi) | SELECT (bölge) | ALL |
| `mileage_logs` | SELECT/INSERT (kendi) | SELECT (bölge) | ALL |
| `account_notes` | SELECT (atanmış), INSERT (kendi) | SELECT (bölge) | ALL |
| `sync_queue` | SELECT/INSERT/UPDATE (kendi) | — | ALL |

### Yardımcı Fonksiyonlar

```sql
-- Mevcut kullanıcının rolünü döner
CREATE FUNCTION auth_user_role() RETURNS TEXT ...

-- Mevcut kullanıcı admin mi?
CREATE FUNCTION is_admin() RETURNS BOOLEAN ...

-- Mevcut kullanıcı manager veya admin mi?
CREATE FUNCTION is_manager_or_admin() RETURNS BOOLEAN ...

-- Mevcut kullanıcının atanmış account ID listesi
CREATE FUNCTION my_assigned_accounts() RETURNS SETOF TEXT ...

-- Mevcut kullanıcının bölgesi
CREATE FUNCTION my_region() RETURNS TEXT ...
```

---

## Triggers

### `set_updated_at` — Otomatik timestamp

Tüm `updated_at` kolonu olan tablolarda `BEFORE UPDATE` trigger.

### `set_profile_on_auth_user_create` — Otomatik profil oluştur

`auth.users` tablosuna INSERT olduğunda otomatik `profiles` kaydı oluştur (default role: `sales_rep`).

---

## İndeksler

```sql
-- PostGIS spatial index
CREATE INDEX idx_account_addresses_location 
  ON account_addresses USING GIST (location);

-- Foreign key indexleri
CREATE INDEX idx_visits_account ON visits(account_id);
CREATE INDEX idx_visits_profile ON visits(profile_id);
CREATE INDEX idx_visits_route ON visits(route_id);
CREATE INDEX idx_orders_account ON orders(account_id);
CREATE INDEX idx_assignments_profile ON assignments(profile_id);
CREATE INDEX idx_assignments_account ON assignments(account_id);

-- Sync queue performansı
CREATE INDEX idx_sync_queue_pending 
  ON sync_queue(profile_id, status) 
  WHERE status = 'pending';

-- Tarih bazlı sorgular
CREATE INDEX idx_visits_checked_in 
  ON visits(checked_in_at DESC);

CREATE INDEX idx_routes_status 
  ON routes(profile_id, status);
```

---

## Mock / Seed Data (Geliştirme için)

- 3 örnek profile (1 admin, 1 manager, 5 sales_rep)
- 50 örnek `accounts` (İstanbul dental klinikleri)
- 100 örnek `products` (dental supply)
- 20 örnek `assignments`

Seed dosyası: `supabase/migrations/0003_seed_data.sql` (sadece dev environment'ta uygulanır)
