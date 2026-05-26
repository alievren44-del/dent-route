# 🏛️ Architecture — Saha App v1.0

> Bu dosya `00-master-prompt.md` okunduktan sonra incelenir.

---

## 1. Mimari Prensipler

1. **Hexagonal (Ports & Adapters):** Core iş mantığı external sistemden bağımsız
2. **Domain-driven foldering:** `features/` altında her ekran/akış kendi modülü
3. **Type-first:** Önce TypeScript interface, sonra implementation
4. **Offline-first:** Tüm critical akışlar offline çalışmalı, online optimizasyon
5. **No premature abstraction:** İkinci kullanım gelmeden abstraction yaratma

---

## 2. Katman Diyagramı

```
┌──────────────────────────────────────────────────────────┐
│  PRESENTATION (React Components, Pages, Routes)          │
│  - features/*/components, features/*/pages               │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  APPLICATION (Hooks, Use Cases)                          │
│  - features/*/hooks, features/*/services                 │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  DOMAIN / CORE (CRM-agnostik iş kuralları)               │
│  - core/routing, core/sync, core/auth                    │
└──────────────────────┬───────────────────────────────────┘
                       │
       ┌───────────────┼────────────────┐
       ▼               ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ INFRASTRUCTURE│ │ ADAPTERS     │ │ EXTERNAL SVC │
│ - Supabase    │ │ - Built-in   │ │ - Mapbox     │
│ - Storage     │ │ - CustomREST │ │ - Google     │
└──────────────┘ └──────────────┘ └──────────────┘
```

**Bağımlılık yönü:** Yukarıdan aşağıya. Üst katman alt katmanı çağırır, asla tersi olmaz.

---

## 3. Folder Structure

```
saha-app/
├── .ai_context/                    # AI context (bu dizin)
│   ├── 00-master-prompt.md
│   ├── 01-decisions.md
│   ├── 02-architecture.md          # bu dosya
│   ├── 03-database-schema.md
│   ├── 04-adapter-contract.md      # gelecek
│   ├── 05-verticals.md             # vertical template system
│   ├── 06-risks.md                 # gelecek
│   └── 07-roadmap.md               # gelecek
│
├── verticals/                      # SEKTÖR ŞABLONLARI (JSON)
│   ├── dental.json
│   ├── pharmacy.json
│   ├── optician.json
│   ├── veterinary.json
│   ├── medical_supply.json
│   ├── cafe_restaurant.json
│   ├── mini_market.json
│   ├── cosmetics_beauty.json
│   ├── automotive_parts.json
│   ├── construction_materials.json
│   ├── industrial_supply.json
│   ├── agriculture_feed.json
│   └── generic.json
│
├── .github/
│   └── workflows/
│       ├── ci.yml                  # lint + typecheck + test + build
│       └── duplicate-check.yml     # duplicate filename guard
│
├── config/
│   ├── .saha-config.example.json   # template
│   └── .saha-config.json           # gitignore'da, deploy başına
│
├── public/
│   ├── icons/                      # PWA icons
│   ├── manifest.json
│   └── assets/                     # logo, brand resources
│
├── src/
│   ├── core/                       # CRM-agnostik iş mantığı
│   │   ├── adapters/
│   │   │   ├── ICRMAdapter.ts      # Interface (port)
│   │   │   ├── builtin/
│   │   │   │   ├── SupabaseCRMAdapter.ts
│   │   │   │   └── index.ts
│   │   │   ├── custom-rest/
│   │   │   │   ├── CustomRESTAdapter.ts
│   │   │   │   ├── fieldMapper.ts
│   │   │   │   └── index.ts
│   │   │   └── factory.ts          # adapter selector
│   │   ├── verticals/              # VERTICAL TEMPLATE LOADER
│   │   │   ├── VerticalLoader.ts   # JSON template load + merge overrides
│   │   │   ├── VerticalContext.tsx # React context provider
│   │   │   ├── useVertical.ts      # hook (labels, types, outcomes)
│   │   │   ├── validators.ts       # custom field validation
│   │   │   └── types.ts            # Vertical, CustomField TypeScript types
│   │   ├── routing/
│   │   │   ├── OptimizationClient.ts  # Mapbox wrapper
│   │   │   ├── DirectionsClient.ts
│   │   │   └── types.ts
│   │   ├── sync/
│   │   │   ├── SyncQueue.ts        # offline operations
│   │   │   ├── BackgroundSync.ts   # SW handler
│   │   │   └── ConflictResolver.ts
│   │   ├── auth/
│   │   │   ├── AuthClient.ts       # Supabase Auth wrapper
│   │   │   └── usePermissions.ts
│   │   ├── geolocation/
│   │   │   └── GeolocationService.ts
│   │   └── storage/
│   │       └── IndexedDB.ts        # Dexie schema
│   │
│   ├── features/                   # UI feature modülleri
│   │   ├── map/
│   │   │   ├── pages/MapPage.tsx
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── index.ts
│   │   ├── clinics/                # accounts in DB; UI'da "klinik"
│   │   │   ├── pages/
│   │   │   │   ├── ClinicListPage.tsx
│   │   │   │   ├── ClinicDetailPage.tsx
│   │   │   │   └── ClinicDiscoverPage.tsx
│   │   │   ├── components/
│   │   │   ├── hooks/useClinics.ts
│   │   │   └── services/
│   │   ├── routes/
│   │   │   ├── pages/
│   │   │   │   ├── RoutePlannerPage.tsx
│   │   │   │   └── ActiveRoutePage.tsx
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   ├── visits/
│   │   │   ├── pages/
│   │   │   │   ├── CheckInPage.tsx
│   │   │   │   └── VisitFormPage.tsx
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   ├── orders/
│   │   │   ├── pages/OrderFormPage.tsx
│   │   │   ├── components/
│   │   │   └── hooks/
│   │   ├── history/
│   │   │   └── pages/HistoryPage.tsx
│   │   ├── admin/                  # manager + admin only
│   │   │   ├── pages/
│   │   │   │   ├── DashboardPage.tsx
│   │   │   │   ├── HeatmapPage.tsx
│   │   │   │   ├── UsersPage.tsx
│   │   │   │   └── ClinicsAdminPage.tsx
│   │   │   └── components/
│   │   └── auth/
│   │       └── pages/LoginPage.tsx
│   │
│   ├── components/                 # Reusable UI primitives
│   │   ├── ui/                     # Button, Input, Card, Modal
│   │   ├── layout/                 # AppShell, BottomNav, Header
│   │   └── map/                    # MapboxMap, RouteOverlay, ClinicMarker
│   │
│   ├── lib/
│   │   ├── format/                 # date, currency, phone formatters
│   │   ├── validation/             # zod schemas
│   │   ├── http/                   # fetch wrapper, retry logic
│   │   └── analytics/              # event tracking (opt-in)
│   │
│   ├── config/
│   │   ├── loadConfig.ts           # .saha-config.json reader
│   │   ├── branding.ts             # CSS variable applier
│   │   └── env.ts                  # typed env vars
│   │
│   ├── styles/
│   │   └── globals.css             # Tailwind + CSS variables
│   │
│   ├── App.tsx
│   ├── main.tsx
│   ├── router.tsx
│   └── service-worker.ts           # Workbox SW
│
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   │   ├── 0001_initial_schema.sql
│   │   ├── 0002_rls_policies.sql
│   │   └── 0003_seed_data.sql
│   ├── functions/                  # Edge Functions (Deno)
│   │   ├── mapbox-optimize/
│   │   ├── mapbox-directions/
│   │   ├── google-places-search/
│   │   └── _shared/
│   │       ├── auth.ts
│   │       └── rateLimit.ts
│   └── seed.sql
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/                        # Playwright
│
├── scripts/
│   ├── saha-bootstrap.ts           # bootstrap CLI
│   └── seed-mock-data.ts
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── README.md
```

---

## 4. Data Flow Örnekleri

### Akış 1: "Çevremdeki klinikleri göster"

```
[User] tap "Yakındakiler"
  → useNearbyClinics() hook
    → GeolocationService.getCurrentPosition()
    → adapter.searchNearby(coords, radius)
      → if built-in: Supabase PostGIS ST_DWithin query
      → if custom_rest: HTTP GET to configured endpoint
    → enrich with Google Places (Edge Function proxy)
      → /functions/google-places-search?type=dentist&location=...
    → merge results (dedupe by google_place_id)
    → return Clinic[]
  → Map renders markers
  → List view shows items
```

### Akış 2: "Rota oluştur"

```
[User] selects 5 clinics → tap "Rota Oluştur"
  → useRouteOptimizer() hook
    → buildWaypoints(clinics, currentLocation)
    → OptimizationClient.optimize(waypoints)
      → POST /functions/mapbox-optimize
        → server: rate-limit check, then Mapbox Optimization API
        → returns ordered waypoints + polyline
    → renders polyline on Map
    → user confirms → routes table'a INSERT
    → status: 'planned'
```

### Akış 3: "Check-in" (offline scenario)

```
[User offline] tap "Check-in" at clinic
  → useCheckIn() hook
    → captures: location, timestamp, account_id
    → tries to push to Supabase
    → FAILS (offline)
    → falls back to SyncQueue
      → IndexedDB'ye 'create_visit' operation eklenir
      → UI'da "Senkron beklemede" badge
  ...
[Later, online]
  → BackgroundSync triggers
    → SyncQueue.flush()
      → pending operations push to Supabase
      → success → status: 'completed'
      → conflict → ConflictResolver (last-write-wins for visits)
```

---

## 5. Adapter Pattern Detayı

### Sözleşme (Port)

```typescript
// src/core/adapters/ICRMAdapter.ts

export interface ICRMAdapter {
  // Customer/Account operations
  listCustomers(filter?: CustomerFilter): Promise<Customer[]>;
  getCustomer(id: string): Promise<Customer>;
  searchNearby(location: LatLng, radiusKm: number): Promise<Customer[]>;
  
  // Balance
  getBalance(customerId: string): Promise<Balance>;
  
  // Orders
  listOrders(customerId: string, limit?: number): Promise<Order[]>;
  createOrder(order: NewOrder): Promise<OrderResult>;
  quoteOrder(items: OrderItem[], customerId: string): Promise<OrderQuote>;
  
  // Products
  listProducts(filter?: ProductFilter): Promise<Product[]>;
  getProduct(id: string): Promise<Product>;
  
  // Health
  testConnection(): Promise<HealthStatus>;
  getCapabilities(): AdapterCapabilities; // hangi feature destekleniyor
}
```

Detaylı tipler ve davranış spesifikasyonu `04-adapter-contract.md`'de (gelecek dosya).

### Factory

```typescript
// src/core/adapters/factory.ts

export function createCRMAdapter(config: SahaConfig): ICRMAdapter {
  switch (config.crm.type) {
    case 'supabase':
      return new SupabaseCRMAdapter(config.crm.config);
    case 'custom_rest':
      return new CustomRESTAdapter(config.crm.config);
    default:
      throw new Error(`Unknown CRM type: ${config.crm.type}`);
  }
}
```

---

## 6. State Management Stratejisi

| Veri tipi | Çözüm |
|---|---|
| Server state (CRM data, routes, visits) | **TanStack Query** + IndexedDB persist |
| Auth state | **Zustand** store (persisted) |
| UI state (modal açık, filter) | React `useState` (component-local) |
| Form state | `react-hook-form` + `zod` |
| Map state (selected clinic, active layer) | **Zustand** (map slice) |
| Offline queue | **Dexie.js** direct (SyncQueue) |

---

## 7. Routing Stratejisi

React Router v6, lazy-loaded routes:

```
/                     → MapPage (default landing)
/clinics              → ClinicListPage
/clinics/:id          → ClinicDetailPage
/clinics/discover     → ClinicDiscoverPage (Google Places)
/routes/plan          → RoutePlannerPage
/routes/active/:id    → ActiveRoutePage
/visits/check-in/:id  → CheckInPage
/visits/:id           → VisitFormPage
/orders/new           → OrderFormPage
/history              → HistoryPage

/admin/dashboard      → DashboardPage (role: manager/admin)
/admin/users          → UsersPage (role: admin)
/admin/clinics        → ClinicsAdminPage
/admin/heatmap        → HeatmapPage

/login                → LoginPage
/onboarding/kvkk      → KVKK consent (ilk login)
```

---

## 8. Bundle / Performance

- **Code splitting:** Her `pages/*` lazy import
- **Mapbox GL:** dynamic import (sadece map sayfasında yüklenir)
- **Vite manualChunks:**
  - `vendor-react` (React + Router)
  - `vendor-supabase`
  - `vendor-mapbox`
  - `vendor-query` (TanStack)
- **Service Worker:** Workbox precaches app shell + critical assets

Hedef metrikler `00-master-prompt.md` Bölüm 6'da.

---

## 9. Test Stratejisi

```
tests/
├── unit/                    # Vitest
│   ├── adapters/            # her adapter için unit
│   ├── routing/             # optimization logic
│   └── sync/                # queue behavior
├── integration/             # Vitest + Supabase test DB
│   ├── auth-flow.test.ts
│   └── visit-create.test.ts
└── e2e/                     # Playwright
    ├── critical-path.spec.ts   # login → map → route → check-in
    └── offline-mode.spec.ts
```

Coverage hedefi: %70+ critical path, %50+ overall.

---

## 10. Deployment Topolojisi

```
[Cloudflare Pages]
  ├── Static frontend (Vite build)
  ├── Custom domain per tenant
  └── CDN cache for assets

[Supabase Project] (per tenant)
  ├── PostgreSQL (data + RLS)
  ├── Edge Functions (Deno) — API proxies
  ├── Storage (visit photos)
  └── Auth

[External]
  ├── Mapbox (via Edge Function proxy)
  ├── Google Places (via Edge Function proxy)
  └── MapTiler (optional, offline tiles)
```

Her tenant için:
- Ayrı Supabase projesi
- Ayrı Cloudflare Pages domain
- Ayrı `.saha-config.json`
- Ortak codebase (Git monorepo)
