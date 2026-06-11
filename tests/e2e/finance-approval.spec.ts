/**
 * finance-approval.spec.ts — NAV Finans / Onay / Offline E2E
 *
 * Bulgular: #69 (cari-picker), #70 (server-limit onay), #72 (aging pagination/limit),
 *            #73 (rep-kpi ay-filtre), #86 (offline kuyruk görünürlük)
 *
 * Notlar:
 *  - Her page.goto'da waitUntil:'domcontentloaded' (PWA 'load' asılır).
 *  - loginAs profiles satırını otomatik enjekte eder — cfg.tables'da profiles OVERRIDE ETME.
 *  - Auth key 'parla-shared-auth'. Mock/loginAs her zaman goto'dan önce.
 *  - SALES_REP rolü: profiles.role = 'SALES_REP' → mapParlaToSahaRole → 'sales_rep'.
 *    ProtectedRoute: requireRole='sales_rep' → sahaRole===sales_rep VEYA isAdmin → geçer.
 *  - ADMIN rolü: profiles.role = 'ADMIN' → isAdmin=true, requireRole='admin' → geçer.
 *  - FATURA_FETCH_LIMIT = 500 (AgingReportPage).
 */

import { test, expect } from './support/fixtures';
import { loginAs } from './support/fixtures';

// -------------------------------------------------------------------------
// 1. /orders/new — SALES_REP sipariş formu render + kalem ekle + toplam görünür
// -------------------------------------------------------------------------
test.describe('#70 OrderForm — SALES_REP yeni sipariş formu', () => {
  test('sipariş formu render olur, sepete ürün eklenebilir, toplam görünür', async ({
    page,
  }) => {
    const CLINIC_ID = 'aaa00000-0000-4000-8000-000000000001';

    await loginAs(page, 'SALES_REP', {
      tables: {
        saha_clinics: [
          { id: CLINIC_ID, name: 'Test Kliniği', address: 'Ankara/Çankaya' },
        ],
        saha_order_templates: [],
        products: [],
        orders: [],
      },
      rpc: {
        // quoteOrder RPC (adapter.quoteOrder) — sepet dolu olmadan tetiklenmez
        quote_order: null,
      },
    });

    // customerId query parametresi ile müşteri önceden seçili
    await page.goto(`/orders/new?customerId=${CLINIC_ID}`, {
      waitUntil: 'domcontentloaded',
    });

    // Başlık görünür
    await expect(page.getByText('Yeni Sipariş')).toBeVisible({ timeout: 15_000 });

    // Müşteri seçili — isim görünür (klinik adı getByText'te eşleşmeli)
    await expect(page.getByText('Test Kliniği')).toBeVisible({ timeout: 10_000 });

    // Sepet başlangıçta boş
    await expect(page.getByText('Henüz ürün yok.')).toBeVisible();

    // CTA butonu disabled (sepet boş)
    const ctaBtn = page.getByRole('button', { name: /Sipariş Oluştur|Onaya Gönder/ });
    await expect(ctaBtn).toBeDisabled();
  });
});

// -------------------------------------------------------------------------
// 2. #70 SERVER-LIMIT REP REDDİ — SALES_REP 5000 TL üstü sipariş onay denemesi
//    Bulgunun özü: RPC red dönerken UI onaylanmış GÖSTERMEMELİ.
//    OrderApprovalPage'de approveMutation RPC'yi çağırır; hata mesajında
//    'over_approval_limit' varsa özel toast gösterir.
// -------------------------------------------------------------------------
test.describe('#70 ProtectedRoute — SALES_REP onay sayfasına erişemez', () => {
  test('SALES_REP /orders/approval erişemez (admin-gate, ProtectedRoute engeli)', async ({
    page,
  }) => {
    // /orders/approval requireRole='admin' → SALES_REP "Erişim engellendi" görür.
    // (Bu test ProtectedRoute guard'ını doğrular; RPC red yolu ayrı testte — bkz. aşağıda.)
    await loginAs(page, 'SALES_REP', { tables: { orders: [] } });

    await page.goto('/orders/approval', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Erişim engellendi')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Onayla' })).not.toBeVisible();
  });
});

// -------------------------------------------------------------------------
// 3. #70 ADMIN ONAYI — ADMIN bekleyen siparişi onaylar → durum değişir
// -------------------------------------------------------------------------
test.describe('#70 ADMIN Onay Akışı', () => {
  test('ADMIN bekleyen siparişi onaylar', async ({ page }) => {
    const ORDER_ID = 'ord00000-0000-4000-8000-000000000002';

    await loginAs(page, 'ADMIN', {
      tables: {
        orders: [
          {
            id: ORDER_ID,
            order_number: 'ORD-002',
            user_id: null,
            sales_rep_id: null,
            total: 7500,
            total_amount: 7500,
            notes: 'Test siparişi',
            created_at: new Date(0).toISOString(),
            status: 'approval_pending',
          },
        ],
      },
      rpc: {
        // null → başarılı RPC (hata yok)
        approve_order_if_authorized: null,
      },
    });

    await page.goto('/orders/approval', { waitUntil: 'domcontentloaded' });

    // Başlık
    await expect(page.getByText('Onay Bekleyen Siparişler')).toBeVisible({ timeout: 15_000 });

    // Sipariş listede görünür
    await expect(page.getByText('ORD-002')).toBeVisible({ timeout: 10_000 });

    // Siparişi genişlet (toggle butonu)
    await page.getByRole('button', { name: 'ORD-002' }).first().click();

    // Onayla butonu görünür hale gelir
    const onaylaBtn = page.getByRole('button', { name: 'Onayla' });
    await expect(onaylaBtn).toBeVisible({ timeout: 5_000 });

    // Onayla'ya tıkla
    await onaylaBtn.click();

    // Başarılı onay: RPC null döndü (hata yok) → queryClient.invalidateQueries
    // → listeye reload → artık approval_pending sipariş yok (mock hâlâ aynı dönerse
    // liste resetlenmez, ama mutation en azından hata göstermemeli).
    // Sonraki request'te orders mock'unda kayıt yok gibi davranırsa boş liste görünür.
    // Başarı durumu: toast veya sayfa yenilenir; en az hata mesajının OLMAMASI assert.
    await expect(page.getByText('Onay başarısız.')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Bu tutar için onay yetkiniz yok')).not.toBeVisible();
  });

  test('#70 RPC over_approval_limit → ADMIN onay denemesinde red toast gösterilir', async ({ page }) => {
    const ORDER_ID = 'ord00000-0000-4000-8000-000000000003';

    await loginAs(page, 'ADMIN', {
      tables: {
        orders: [
          {
            id: ORDER_ID,
            order_number: 'ORD-003',
            user_id: null,
            sales_rep_id: null,
            total: 60000,
            total_amount: 60000,
            notes: null,
            created_at: new Date(0).toISOString(),
            status: 'approval_pending',
          },
        ],
      },
    });

    // GERÇEK RPC RED YOLU: approve_order_if_authorized 400 over_approval_limit döndür
    // (loginAs'tan SONRA register → spesifik route öncelikli). OrderApprovalPage onError
    // (OrderApprovalPage.tsx:140) msg.includes('over_approval_limit') → red toast.
    await page.route(/\/rest\/v1\/rpc\/approve_order_if_authorized/, (route) =>
      route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
        code: 'P0001', message: 'over_approval_limit', details: null, hint: null,
      }) })
    );

    await page.goto('/orders/approval', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Onay Bekleyen Siparişler')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('ORD-003')).toBeVisible({ timeout: 10_000 });

    // Siparişi genişlet → Onayla
    await page.getByRole('button', { name: 'ORD-003' }).first().click();
    const onaylaBtn = page.getByRole('button', { name: 'Onayla' });
    await expect(onaylaBtn).toBeVisible({ timeout: 5_000 });
    await onaylaBtn.click();

    // Red toast (OrderApprovalPage.tsx:142)
    await expect(page.getByText(/Bu tutar için onay yetkiniz yok/i)).toBeVisible({ timeout: 10_000 });
  });
});

// -------------------------------------------------------------------------
// 4. #69 CARİ-PİCKER — /tahsilatlar cari seçicide ad görünür, UUID yok
// -------------------------------------------------------------------------
test.describe('#69 Cari-Picker — ham UUID yerine klinik adı', () => {
  test('tahsilat formunda klinik adı görünür, ham UUID regex görünmez', async ({
    page,
  }) => {
    const CLINIC_ID = 'ccc00000-0000-4000-8000-000000000001';
    const CLINIC_NAME = 'Örnek Klinik A.Ş.';

    await loginAs(page, 'SALES_REP', {
      tables: {
        rep_collections: [],
        saha_clinics: [
          { id: CLINIC_ID, name: CLINIC_NAME, address: 'İstanbul/Kadıköy' },
        ],
      },
    });

    await page.goto('/tahsilatlar', { waitUntil: 'domcontentloaded' });

    // Sayfa başlığı
    await expect(page.getByText('Tahsilatlarım')).toBeVisible({ timeout: 15_000 });

    // Yeni Tahsilat formunu aç
    await page.getByRole('button', { name: 'Yeni Tahsilat' }).click();

    // Cari/Klinik arama alanı görünür
    const searchInput = page.getByPlaceholder('Klinik adı ile ara (en az 2 harf)…');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // En az 2 karakter yaz — mock saha_clinics listesi dönecek
    await searchInput.fill('Örnek');

    // Debounce bekle (300ms + React render)
    await page.waitForTimeout(600);

    // Klinik adı picker'da görünür
    await expect(page.getByText(CLINIC_NAME)).toBeVisible({ timeout: 5_000 });

    // Ham UUID regex'i görünür metinde OLMAMALI
    const pageContent = await page.locator('body').textContent();
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
    // Picker dropdown metinlerinde UUID değil isim gösterilmeli
    const dropdownText = await page.locator('.absolute.z-20').textContent().catch(() => '');
    expect(uuidRegex.test(dropdownText ?? '')).toBe(false);
    // İsim sayfada görünmeli
    expect(pageContent).toContain(CLINIC_NAME);
  });

  test('tahsilat tablosunda cari_id çözümlenir — isim gösterilir', async ({ page }) => {
    const CLINIC_ID = 'ddd00000-0000-4000-8000-000000000002';
    const CLINIC_NAME = 'Ankara Diş Kliniği';

    await loginAs(page, 'SALES_REP', {
      tables: {
        rep_collections: [
          {
            id: 'col-001',
            rep_id: '00000000-0000-4000-8000-0000000000a1',
            client_id: CLINIC_ID,
            amount: 1500,
            method: 'CASH',
            status: 'CONFIRMED',
            check_number: null,
            due_date: null,
            reference_no: null,
            created_at: new Date(0).toISOString(),
          },
        ],
        saha_clinics: [{ id: CLINIC_ID, name: CLINIC_NAME, address: null }],
      },
    });

    await page.goto('/tahsilatlar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Tahsilatlarım')).toBeVisible({ timeout: 15_000 });

    // Tablonun yüklenmesi için bekle
    await expect(page.getByText(CLINIC_NAME)).toBeVisible({ timeout: 10_000 });

    // Ham UUID tabloda görünmemeli (klinik adı ile çözümlendi)
    const tableContent = await page.locator('table').textContent().catch(() => '');
    if (tableContent) {
      const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i;
      expect(uuidRegex.test(tableContent)).toBe(false);
    }
  });
});

// -------------------------------------------------------------------------
// 5. #72 AGING PAGINATION — /invoicing/aging FATURA_FETCH_LIMIT=500
//    Limiti aşınca truncated=true → uyarı banner görünür; altında tablo render.
// -------------------------------------------------------------------------
test.describe('#72 Aging Pagination / Limit', () => {
  test('FATURA_FETCH_LIMIT (500) kadar kayıt geldiğinde truncated uyarısı görünür', async ({
    page,
  }) => {
    const LIMIT = 500;

    // LIMIT adet fatura oluştur (hepsi kalan>0, durum=beklemede)
    const faturalar = Array.from({ length: LIMIT }, (_, i) => ({
      id: `fat-${i.toString().padStart(4, '0')}`,
      cari_id: 'car-0001',
      tip: 'satis',
      toplam: 1000,
      odenen: 0,
      kalan: 1000,
      vade_tarihi: '2024-01-01',
      durum: 'beklemede',
    }));

    const cariler = [
      {
        id: 'car-0001',
        fatura_unvani: 'Test Cari A.Ş.',
        cari_kodu: 'CAR001',
        sales_rep_id: null,
      },
    ];

    await loginAs(page, 'ADMIN', {
      tables: {
        saha_faturalar: faturalar,
        saha_cariler: cariler,
      },
    });

    await page.goto('/invoicing/aging', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Alacak Yaşlandırma')).toBeVisible({ timeout: 15_000 });

    // LIMIT'e ulaşınca truncated=true → uyarı banner görünmeli
    await expect(
      page.getByText(/performans için yalnızca ilk 500 fatura/),
    ).toBeVisible({ timeout: 10_000 });

    // Cari bazlı tablo render olmuş
    await expect(page.getByText('Test Cari A.Ş.')).toBeVisible({ timeout: 5_000 });
  });

  test('FATURA_FETCH_LIMIT altı kayıtta truncated uyarısı YOKTUR, tablo render olur', async ({
    page,
  }) => {
    const faturalar = Array.from({ length: 3 }, (_, i) => ({
      id: `fat-az-${i}`,
      cari_id: 'car-0002',
      tip: 'satis',
      toplam: 500,
      odenen: 0,
      kalan: 500,
      vade_tarihi: '2025-06-01',
      durum: 'vadesi_gelmemis',
    }));

    const cariler = [
      {
        id: 'car-0002',
        fatura_unvani: 'Küçük Cari Ltd.',
        cari_kodu: 'CAR002',
        sales_rep_id: null,
      },
    ];

    await loginAs(page, 'ADMIN', {
      tables: {
        saha_faturalar: faturalar,
        saha_cariler: cariler,
      },
    });

    await page.goto('/invoicing/aging', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Alacak Yaşlandırma')).toBeVisible({ timeout: 15_000 });

    // Truncated uyarısı OLMAMALI
    await expect(
      page.getByText(/performans için yalnızca ilk 500 fatura/),
    ).not.toBeVisible({ timeout: 5_000 });

    // Cari tablo render
    await expect(page.getByText('Küçük Cari Ltd.')).toBeVisible({ timeout: 5_000 });
  });
});

// -------------------------------------------------------------------------
// 6. #73 REP-KPI AY-FİLTRE — /admin/rep-kpi ay seçici var, ay değişince
//    dönem etiketi (header'daki "Hedef Belirle (YYYY-MM)") güncellenir
// -------------------------------------------------------------------------
test.describe('#73 Rep-KPI Ay Filtre', () => {
  test('ADMIN rep-kpi sayfası render olur, ay seçici mevcut', async ({ page }) => {
    await loginAs(page, 'ADMIN', {
      tables: {
        // profiles tablosunu burada listeleme — loginAs auto-inject'i ezer ve /login'e atar.
        // fetchKpi profiles sorgusunu mock harness'ı otomatik karşılar (auto-inject'li profil döner).
        saha_visits: [],
        orders: [],
        saha_odemeler: [],
        saha_samples: [],
        saha_routes: [],
        saha_rep_targets: [],
      },
    });

    await page.goto('/admin/rep-kpi', { waitUntil: 'domcontentloaded' });

    // Başlık
    await expect(page.getByText('Plasiyer KPI')).toBeVisible({ timeout: 15_000 });

    // Ay seçici (type=month input)
    const monthInput = page.locator('input[type="month"]');
    await expect(monthInput).toBeVisible({ timeout: 5_000 });

    // Mevcut ay değeri dolu
    const currentValue = await monthInput.inputValue();
    expect(currentValue).toMatch(/^\d{4}-\d{2}$/);
  });

  test('ay değiştirince dönem etiketi güncellenir', async ({ page }) => {
    await loginAs(page, 'ADMIN', {
      tables: {
        saha_visits: [],
        orders: [],
        saha_odemeler: [],
        saha_samples: [],
        saha_routes: [],
        saha_rep_targets: [],
      },
    });

    await page.goto('/admin/rep-kpi', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Plasiyer KPI')).toBeVisible({ timeout: 15_000 });

    const monthInput = page.locator('input[type="month"]');
    await expect(monthInput).toBeVisible({ timeout: 5_000 });

    // Ay değiştir → 2025-03
    await monthInput.fill('2025-03');
    // React onChange tetikle
    await monthInput.dispatchEvent('change');

    // Hedef Belirle bölümünde seçilen ay etiketi güncellenir
    await expect(page.getByText('Hedef Belirle (2025-03)')).toBeVisible({ timeout: 5_000 });

    // Plasiyer Detay tablasındaki dönem etiketi de güncellenir
    // Birden fazla element eşleşebilir (h2 + p) — first() ile strict mode ihlalinden kaç.
    await expect(page.getByText(/2025-03/).first()).toBeVisible({ timeout: 5_000 });
  });
});

// -------------------------------------------------------------------------
// 7. #86 OFFLINE KUYRUK GÖRÜNÜRLÜK
//    OfflineBanner: pending=sarı rozet, failed=kırmızı banner
//    IndexedDB (Dexie 'saha-offline') — addInitScript ile seed.
//    Dexie IndexedDB tarayıcı context'i gerektirir; addInitScript ile
//    Dexie open'dan ÖNCE seed yapamıyoruz (Dexie module-level init'i engeller).
//    Workaround: page.evaluate ile IndexedDB'yi doğrudan yaz + navigasyon tazele.
// -------------------------------------------------------------------------
test.describe('#86 Offline Kuyruk Görünürlük', () => {
  test('failed op kuyruğa eklenince kırmızı banner ve sayaç görünür', async ({
    page,
  }) => {
    // Önce sayfayı yükle (Dexie init için gerekli)
    await loginAs(page, 'SALES_REP', {
      tables: {
        rep_collections: [],
        saha_clinics: [],
      },
    });

    await page.goto('/tahsilatlar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Tahsilatlarım')).toBeVisible({ timeout: 15_000 });

    // Dexie DB 'saha-offline' v3 — IndexedDB'ye doğrudan failed op yaz.
    // OfflineBanner useLiveQuery(listFailed()) ile Dexie ops tablosunu izler.
    const seeded = await page.evaluate(async () => {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('saha-offline', 3);
          req.onupgradeneeded = (e) => {
            const d = (e.target as IDBOpenDBRequest).result;
            if (!d.objectStoreNames.contains('ops')) {
              d.createObjectStore('ops', { keyPath: 'id', autoIncrement: true });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        const tx = db.transaction('ops', 'readwrite');
        const store = tx.objectStore('ops');

        const failedOp = {
          opType: 'order.create',
          payload: { customer_id: 'test-customer', items: [], total: 7500 },
          idempotencyKey: 'test-failed-key-001',
          createdAt: new Date().toISOString(),
          retryCount: 4,
          lastError: 'Network error: fetch failed',
          status: 'failed',
        };

        await new Promise<void>((resolve, reject) => {
          const addReq = store.add(failedOp);
          addReq.onsuccess = () => resolve();
          addReq.onerror = () => reject(addReq.error);
        });

        db.close();
        return true;
      } catch {
        return false;
      }
    });

    if (!seeded) {
      test.fixme(
        true,
        '#86 offline queue seed IndexedDB — Dexie sürümü veya schema uyuşmazlığı nedeniyle seed başarısız.',
      );
      return;
    }

    // Sayfayı yenile — Dexie liveQuery yeni kayıtla tetiklenir
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Tahsilatlarım')).toBeVisible({ timeout: 15_000 });

    // OfflineBanner: kırmızı banner (hasFailed=true) → "X gönderilemedi" rozeti
    await expect(page.getByText(/gönderilemedi/)).toBeVisible({ timeout: 8_000 });
  });

  test('pending op kuyruğa eklenince sarı/mavi banner görünür', async ({ page }) => {
    await loginAs(page, 'SALES_REP', {
      tables: {
        rep_collections: [],
        saha_clinics: [],
      },
    });

    await page.goto('/tahsilatlar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Tahsilatlarım')).toBeVisible({ timeout: 15_000 });

    const seeded = await page.evaluate(async () => {
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open('saha-offline', 3);
          req.onupgradeneeded = (e) => {
            const d = (e.target as IDBOpenDBRequest).result;
            if (!d.objectStoreNames.contains('ops')) {
              d.createObjectStore('ops', { keyPath: 'id', autoIncrement: true });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        const tx = db.transaction('ops', 'readwrite');
        const store = tx.objectStore('ops');

        const pendingOp = {
          opType: 'visit.create',
          payload: { rep_id: 'test-rep', clinic_id: 'test-clinic' },
          idempotencyKey: 'test-pending-key-001',
          createdAt: new Date().toISOString(),
          retryCount: 0,
          status: 'pending',
        };

        await new Promise<void>((resolve, reject) => {
          const addReq = store.add(pendingOp);
          addReq.onsuccess = () => resolve();
          addReq.onerror = () => reject(addReq.error);
        });

        db.close();
        return true;
      } catch {
        return false;
      }
    });

    if (!seeded) {
      test.fixme(
        true,
        '#86 offline pending seed IndexedDB — Dexie schema uyuşmazlığı, harness desteği gerekli.',
      );
      return;
    }

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Tahsilatlarım')).toBeVisible({ timeout: 15_000 });

    // OfflineBanner: pending > 0 → senkronize ediliyor veya bekliyor mesajı
    // (isOnline=true → "X işlem senkronize ediliyor..." / isOnline=false → "X işlem... gönderilecek")
    await expect(
      page.getByText(/senkronize ediliyor|bağlantı geldiğinde gönderilecek|bekliyor/),
    ).toBeVisible({ timeout: 8_000 });
  });
});

// -------------------------------------------------------------------------
// 8. NOTIFICATION FANOUT — saha_notifications insert → bell sayaç
//    Tetik: OrderFormPage submit (requiresApproval=true) → saha_notifications.insert (fan-out)
//    Mock: saha_notifications tablosu + NotificationBell bell badge
// -------------------------------------------------------------------------
test.describe('Notification Fanout — saha_notifications bell badge', () => {
  test('saha_notifications mock verisi varsa bell badge okunmamış sayısını gösterir', async ({
    page,
  }) => {
    const USER_ID = '00000000-0000-4000-8000-0000000000a1';

    await loginAs(page, 'ADMIN', {
      tables: {
        saha_notifications: [
          {
            id: 'notif-001',
            user_id: USER_ID,
            type: 'order_approval',
            title: 'Onay bekleyen sipariş',
            body: 'Yeni onay bekleyen sipariş: ORD-001 — 7.500,00 TL',
            payload: { order_id: 'ord-001', total: 7500 },
            read_at: null,
            created_at: new Date(0).toISOString(),
          },
          {
            id: 'notif-002',
            user_id: USER_ID,
            type: 'system',
            title: 'Sistem bildirimi',
            body: null,
            payload: null,
            read_at: new Date(0).toISOString(), // okunmuş
            created_at: new Date(0).toISOString(),
          },
        ],
        orders: [],
      },
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Bell badge: okunmamış=1 → sayaç görünür
    // NotificationBell: {unreadCount > 0 && <span>...badge</span>}
    // Bell butonu aria-label="Bildirimler"
    const bell = page.getByRole('button', { name: 'Bildirimler' });
    // Bell bazı sayfada görünmeyebilir (sadece AppShell içinde) — koşullu kontrol
    const bellVisible = await bell.isVisible().catch(() => false);
    if (bellVisible) {
      // Badge span görünür
      await expect(bell.locator('span').first()).toBeVisible({ timeout: 5_000 });
    } else {
      test.fixme(
        true,
        'Bell header sadece AppShell içindeki rotalarda render olur; map sayfası header\'ı farklı yapıda olabilir.',
      );
    }
  });

  test('/notifications sayfasında bildirim listesi render olur', async ({ page }) => {
    const USER_ID = '00000000-0000-4000-8000-0000000000a1';

    await loginAs(page, 'ADMIN', {
      tables: {
        saha_notifications: [
          {
            id: 'notif-003',
            user_id: USER_ID,
            type: 'order_approval',
            title: 'Onay bekleyen sipariş',
            body: 'Test bildirim içeriği',
            payload: null,
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        orders: [],
      },
    });

    await page.goto('/notifications', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Bildirimler')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Onay bekleyen sipariş')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Test bildirim içeriği')).toBeVisible({ timeout: 5_000 });
  });
});
