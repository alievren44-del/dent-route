# 🏷️ Vertical Template System — Saha App v1.0

> App sektör-agnostiktir. Her deployment kendi sektör şablonunu seçer. Yeni sektör eklemek kod değişikliği gerektirmez.

---

## 1. Neden?

Saha satış mantığı her sektörde aynı: müşteriyi ziyaret et, kaydet, sipariş al. Ama:
- **Müşteri terminolojisi farklı:** "Klinik" (diş), "Eczane" (ilaç), "Bayi" (oto yedek), "İşletme" (cafe)
- **Müşteri tipleri farklı:** Diş'te `polyclinic`, eczanede `chain`, oto'da `service_station`
- **Google Places type'ları farklı:** `dentist`, `pharmacy`, `car_repair`, `cafe`
- **Ziyaret outcome'ları farklı:** Eczanede `sample_left` (numune), restoranda `tasting_done` (degüstasyon)
- **Custom field'lar farklı:** Diş'te "hekim sayısı", eczanede "24 saat açık mı"

**Çözüm:** Her sektör için bir **JSON template**, runtime'da yüklenir, UI ve validation buna göre davranır.

---

## 2. Mimari

```
.saha-config.json
  └─ vertical: { extends: "dental", overrides: {...} }
       │
       ▼
verticals/dental.json  ← Base template
       │
       ▼
VerticalLoader (core/verticals/VerticalLoader.ts)
  │
  ├─ Loads base template
  ├─ Merges overrides
  ├─ Validates schema
  └─ Returns Vertical object
       │
       ▼
VerticalContext (React provider)
  │
  └─ useVertical() hook ile her component erişir
       │
       ├─ labels         → UI metin (örn: "Klinik" / "Eczane")
       ├─ customerTypes  → Klinik tipi dropdown
       ├─ visitOutcomes  → Ziyaret formu seçenekler
       ├─ customFields   → Dinamik form alanları
       └─ googlePlacesTypes → Discovery API parametresi
```

---

## 3. JSON Şeması

Her vertical template şu yapıdadır:

```typescript
interface Vertical {
  id: string;                          // "dental", "pharmacy" vb.
  displayName: string;                 // İnsan-okunabilir: "Diş Hekimliği"
  description?: string;                // Kısa açıklama
  
  labels: {
    customer: {
      singular: string;                // "Klinik" / "Eczane"
      plural: string;                  // "Klinikler" / "Eczaneler"
    };
    customer_type: string;             // "Klinik Tipi" / "Eczane Tipi"
    discovery: string;                 // "Çevremdeki Klinikler"
    visit: string;                     // "Ziyaret"
  };
  
  customerTypes: Array<{
    key: string;                       // DB'de saklanan değer
    label: string;                     // UI'da görünen
    icon?: string;                     // opsiyonel ikon ID
  }>;
  
  googlePlacesTypes: string[];         // Google Places API 'type' parametresi
  
  visitOutcomes: Array<{
    key: string;
    label: string;
    color?: string;                    // UI badge rengi
    requiresOrder?: boolean;           // 'order_taken' için true
  }>;
  
  customFields: {
    account?: CustomField[];           // Müşteri formu ek alanları
    visit?: CustomField[];             // Ziyaret formu ek alanları
  };
  
  iconSet?: string;                    // "medical", "retail", "automotive"...
  primaryColorSuggestion?: string;     // Branding default önerisi (opsiyonel)
  
  // Faz 2 için
  features?: {
    photoCompliance?: {
      enabled: boolean;
      minPhotos?: number;              // Min ziyaret foto sayısı
      categories?: string[];           // Foto kategorileri
    };
  };
}

interface CustomField {
  key: string;                         // JSONB'de anahtar
  label: string;                       // UI etiket
  type: 'text' | 'number' | 'boolean' | 'select' | 'multiselect' | 'date';
  required?: boolean;
  options?: string[];                  // select/multiselect için
  placeholder?: string;
  helperText?: string;
  defaultValue?: any;
}
```

---

## 4. Config'te Kullanımı

`.saha-config.json` içinde:

```json
{
  "vertical": {
    "extends": "dental"
  }
}
```

**Override örneği** (Parla, dental'a ek branş ekliyor):

```json
{
  "vertical": {
    "extends": "dental",
    "overrides": {
      "customFields": {
        "account": [
          {
            "key": "branch",
            "label": "Branş",
            "type": "multiselect",
            "options": [
              "Ortodonti",
              "Endodonti",
              "Cerrahi",
              "Pedodonti",
              "Periodontoloji",
              "Restoratif"
            ]
          }
        ]
      }
    }
  }
}
```

**Override mantığı:** `customFields.account` gibi liste alanlarda **inline merge** yapılır (anahtar eşleşirse override eder, yoksa eklenir). Diğer alanlar tam replace.

---

## 5. Hazır Şablonlar (v1.0 — 13 adet)

| ID | Sektör | Müşteri Etiketi | Örnek Tipler |
|---|---|---|---|
| `dental` | Diş Hekimliği | Klinik | Özel/Devlet/Poli/Hastane |
| `pharmacy` | Eczane | Eczane | Bağımsız/Zincir/Hastane |
| `optician` | Optisyen | Optik | Bağımsız/Zincir |
| `veterinary` | Veteriner | Klinik | Klinik/Pet Shop/Çiftlik |
| `medical_supply` | Medikal | Müşteri | Hastane/Klinik/Eczane/Dağıtıcı |
| `cafe_restaurant` | HORECA | İşletme | Cafe/Restoran/Bar/Otel |
| `mini_market` | FMCG/Bakkal | Market | Bakkal/Süpermarket/Bayi |
| `cosmetics_beauty` | Kozmetik | Salon | Güzellik/Kuaför/Spa |
| `automotive_parts` | Oto Yedek | Bayi | Servis/Yetkili/Lastikçi |
| `construction_materials` | İnşaat | Müşteri | Yapı Market/Müteahhit |
| `industrial_supply` | Sanayi | Müşteri | Fabrika/Atölye |
| `agriculture_feed` | Tarım/Yem | Müşteri | Çiftçi/Kooperatif/Bayi |
| `generic` | Genel | Müşteri | (kullanıcı tanımlar) |

Tüm şablonlar `verticals/` dizininde JSON dosyaları olarak ship edilir.

---

## 6. Yeni Vertical Ekleme (Geliştirici Notu)

Yeni bir sektör için (örn: `bookstore`):

1. `verticals/bookstore.json` oluştur (mevcut bir şablonu kopyala, düzenle)
2. Şemaya uyduğundan emin ol (`core/verticals/validators.ts` ile validate edilir)
3. **Kod değişikliği yok** — `.saha-config.json`'da `extends: "bookstore"` yazılır
4. `npm run dev` → app yeni vertical ile açılır

`VerticalLoader` `verticals/` dizinini taradığı için yeni JSON otomatik tanınır.

---

## 7. UI'a Etkisi

Her UI bileşeni `useVertical()` hook'undan etiket çeker:

```tsx
function ClinicListPage() {
  const v = useVertical();
  return (
    <h1>{v.labels.customer.plural}</h1>  // "Klinikler" veya "Eczaneler" vb.
  );
}
```

Form alanları custom fields'tan dinamik render edilir:

```tsx
function AccountForm() {
  const v = useVertical();
  return (
    <>
      <input name="name" placeholder={v.labels.customer.singular} />
      <select name="type">
        {v.customerTypes.map(t => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
      </select>
      {v.customFields.account?.map(field => (
        <DynamicField key={field.key} field={field} />
      ))}
    </>
  );
}
```

---

## 8. Validation Stratejisi

DB tarafında `type` ve `outcome` üzerinde CHECK constraint **yoktur** (vertical-defined).

Application layer'da:
- **Insert/update öncesi:** `validators.ts` aktif vertical'ın `customerTypes.key`'leri içinde mi kontrol
- **Custom fields:** Her field type'ı için validation (örn: `number` ise NaN değil, `select` ise options içinde)
- **Adapter tarafında:** `ICRMAdapter.createAccount()` ve `createOrder()` validate çağrısı yapar

---

## 9. Sınırlar / Bilinen Eksikler

- **Çoklu vertical aynı deployment'ta yok:** Bir deployment = bir vertical. İki sektöre birden satış yapan firmalar için ileride değerlendirilebilir.
- **Vertical değişikliği migration ister:** Bir deployment vertical değiştirirse mevcut `accounts.type` değerleri eski şablonun anahtarlarıyla olur — manuel migration gerekir.
- **i18n entegrasyonu yok (MVP):** Etiketler vertical JSON'da düz string. Çoklu dil ileride `labels.en.customer.singular` gibi nested yapılabilir.

---

## 10. Faz 2'de Genişleme

- **Industry-specific feature toggle'lar:** `pharmacy.json`'da `features.expirationDateTracking: true` gibi
- **Photo compliance** (D-017 bonus feature): `pharmacy`, `cosmetics_beauty`, `mini_market` için zorunlu foto kategorileri
- **Demographic overlay konfigürasyonu:** vertical'a göre hangi demografik veri katmanları gösterilir (örn: dental için nüfus yoğunluğu, cafe için gelir seviyesi)
