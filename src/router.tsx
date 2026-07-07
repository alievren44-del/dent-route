import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { AppShell } from '@components/layout/AppShell';
import { ProtectedRoute } from '@components/layout/ProtectedRoute';

const LoginPage = lazy(() => import('@features/auth/pages/LoginPage'));
const ForgotPasswordPage = lazy(() => import('@features/auth/pages/ForgotPasswordPage'));
const SettingsPage = lazy(() => import('@features/settings/pages/SettingsPage'));
const KvkkConsentPage = lazy(() => import('@features/auth/pages/KvkkConsentPage'));
const FirstAdminPage = lazy(() => import('@features/auth/pages/FirstAdminPage'));
const MapPage = lazy(() => import('@features/map/pages/MapPage'));
const DiscoveryPage = lazy(() => import('@features/discovery/pages/DiscoveryPage'));
const NearbyProvincesPage = lazy(() => import('@features/discovery/pages/NearbyProvincesPage'));
const SahaTaraPage = lazy(() => import('@features/discovery/pages/SahaTaraPage'));
const RoutePlannerPage = lazy(() => import('@features/routes/pages/RoutePlannerPage'));
const ActiveRoutePage = lazy(() => import('@features/routes/pages/ActiveRoutePage'));
const DistrictAutoRoutePage = lazy(() => import('@features/routes/pages/DistrictAutoRoutePage'));
const CorridorRoutePage = lazy(() => import('@features/routes/pages/CorridorRoutePage'));
const RouteCorridorClinicsPage = lazy(
  () => import('@features/routes/pages/RouteCorridorClinicsPage'),
);
const AssignedRoutesPage = lazy(() => import('@features/routes/pages/AssignedRoutesPage'));
const CollectionListPage = lazy(() => import('@features/rep-ops/pages/CollectionListPage'));
const TaskListPage = lazy(() => import('@features/rep-ops/pages/TaskListPage'));
const DownloadAPKPage = lazy(() => import('@features/app/pages/DownloadAPKPage'));
const SamplesPage = lazy(() => import('@features/sampling/pages/SamplesPage'));
const NotificationsPage = lazy(() => import('@features/notifications/pages/NotificationsPage'));
const RegionAssignmentPage = lazy(() => import('@features/admin/pages/RegionAssignmentPage'));
const SampleBudgetPage = lazy(() => import('@features/admin/pages/SampleBudgetPage'));
const CustomerListPage = lazy(() => import('@features/customers/pages/CustomerListPage'));
const CustomerDetailPage = lazy(() => import('@features/customers/pages/CustomerDetailPage'));
const OrderFormPage = lazy(() => import('@features/orders/pages/OrderFormPage'));
const OrderApprovalPage = lazy(() => import('@features/orders/pages/OrderApprovalPage'));
const OrderHistoryPage = lazy(() => import('@features/orders/pages/OrderHistoryPage'));
const SalesHubPage = lazy(() => import('@features/sales/pages/SalesHubPage'));
const DashboardPage = lazy(() => import('@features/admin/pages/DashboardPage'));
const HeatmapPage = lazy(() => import('@features/admin/pages/HeatmapPage'));
const CsvImportPage = lazy(() => import('@features/admin/pages/CsvImportPage'));
const ClinicScanPage = lazy(() => import('@features/admin/pages/ClinicScanPage'));
const ScanJobDetailPage = lazy(() => import('@features/admin/pages/ScanJobDetailPage'));
const ScanRoutePlanner = lazy(() => import('@features/admin/pages/ScanRoutePlanner'));
const UsersPage = lazy(() => import('@features/admin/pages/UsersPage'));
const TrSeedPage = lazy(() => import('@features/admin/pages/TrSeedPage'));
const AuditLogPage = lazy(() => import('@features/admin/pages/AuditLogPage'));
const AdminBroadcastPage = lazy(() => import('@features/admin/pages/AdminBroadcastPage'));

// Visits (Sprint 4)
const CheckInPage = lazy(() => import('@features/visits/pages/CheckInPage'));
const VisitFormPage = lazy(() => import('@features/visits/pages/VisitFormPage'));
const VisitHistoryPage = lazy(() => import('@features/visits/pages/VisitHistoryPage'));

// Takvim (plasiyer hatırlatma/randevu ajandası)
const CalendarPage = lazy(() => import('@features/calendar/pages/CalendarPage'));

// Invoicing (Sprint 6 — cari + fatura + ödeme + çek/senet)
const CariListPage = lazy(() => import('@features/invoicing/pages/CariListPage'));
const CariDetailPage = lazy(() => import('@features/invoicing/pages/CariDetailPage'));
const InvoiceFormPage = lazy(() => import('@features/invoicing/pages/InvoiceFormPage'));
const InvoiceDetailPage = lazy(() => import('@features/invoicing/pages/InvoiceDetailPage'));
const PaymentFormPage = lazy(() => import('@features/invoicing/pages/PaymentFormPage'));
const CekSenetListPage = lazy(() => import('@features/invoicing/pages/CekSenetListPage'));
const AgingReportPage = lazy(() => import('@features/invoicing/pages/AgingReportPage'));
const StockLedgerPage = lazy(() => import('@features/admin/pages/StockLedgerPage'));
const RepKpiPage = lazy(() => import('@features/admin/pages/RepKpiPage'));
const BIDashboardPage = lazy(() => import('@features/admin/pages/BIDashboardPage'));

const Loading = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="text-muted-foreground">Yükleniyor…</div>
  </div>
);

export function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Auth ekranları — shell DIŞINDA */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/onboarding/kvkk" element={<KvkkConsentPage />} />
        <Route path="/apk" element={<DownloadAPKPage />} />
        <Route path="/indir" element={<DownloadAPKPage />} />
        <Route path="/onboarding/first-admin" element={<FirstAdminPage />} />

        {/* Açılış: takvim (kullanıcı açılışta kendi takvimini görür). Harita /harita'da. */}
        <Route path="/" element={<Navigate to="/takvim" replace />} />
        <Route
          path="/harita"
          element={
            <ProtectedRoute>
              <AppShell>
                <MapPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Müşteri (account) ekranları */}
        <Route
          path="/clinics"
          element={
            <ProtectedRoute>
              <AppShell>
                <CustomerListPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/clinics/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <CustomerDetailPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/clinics/discover"
          element={
            <ProtectedRoute>
              <AppShell>
                <DiscoveryPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/nearby-provinces"
          element={
            <ProtectedRoute>
              <AppShell>
                <NearbyProvincesPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/saha/tara"
          element={
            <ProtectedRoute>
              <AppShell>
                <SahaTaraPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Rotalar */}
        <Route
          path="/routes/plan"
          element={
            <ProtectedRoute>
              <AppShell>
                <RoutePlannerPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/routes/active/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <ActiveRoutePage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/routes/auto"
          element={
            <ProtectedRoute>
              <AppShell>
                <DistrictAutoRoutePage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/routes/corridor"
          element={
            <ProtectedRoute>
              <AppShell>
                <CorridorRoutePage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/routes/corridor/clinics"
          element={
            <ProtectedRoute>
              <AppShell>
                <RouteCorridorClinicsPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/routes/assigned"
          element={
            <ProtectedRoute>
              <AppShell>
                <AssignedRoutesPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/tahsilatlar"
          element={
            <ProtectedRoute>
              <AppShell>
                <CollectionListPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/gorevler"
          element={
            <ProtectedRoute>
              <AppShell>
                <TaskListPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Ziyaretler (Sprint 4) */}
        <Route
          path="/visits/check-in/:id"
          element={
            <ProtectedRoute>
              <AppShell hideNav>
                <CheckInPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/visits/:id"
          element={
            <ProtectedRoute>
              <AppShell>
                <VisitFormPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <AppShell>
                <VisitHistoryPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/takvim"
          element={
            <ProtectedRoute>
              <AppShell>
                <CalendarPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Satış sekmesi (rep + admin) */}
        <Route
          path="/sales"
          element={
            <ProtectedRoute>
              <AppShell>
                <SalesHubPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Siparişler */}
        <Route
          path="/orders/new"
          element={
            <ProtectedRoute requireRole="sales_rep">
              <AppShell>
                <OrderFormPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders/approval"
          element={
            <ProtectedRoute allowRawRoles={['MANAGER', 'ADMIN']}>
              <AppShell>
                <OrderApprovalPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/orders/history"
          element={
            <ProtectedRoute>
              <AppShell>
                <OrderHistoryPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Cari / Fatura / Ödeme / Çek-Senet (Sprint 6) */}
        <Route
          path="/invoicing/cari"
          element={
            <ProtectedRoute requirePermission="saha:invoicing:access">
              <AppShell>
                <CariListPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoicing/cari/:id"
          element={
            <ProtectedRoute requirePermission="saha:invoicing:access">
              <AppShell>
                <CariDetailPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoicing/fatura/yeni"
          element={
            <ProtectedRoute requirePermission="saha:invoicing:access">
              <AppShell>
                <InvoiceFormPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoicing/fatura/:id"
          element={
            <ProtectedRoute requirePermission="saha:invoicing:access">
              <AppShell>
                <InvoiceDetailPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        {/* Sprint 2/4 — Order-to-cash, Stok, BI, KPI, Yaşlandırma */}
        <Route
          path="/invoicing/aging"
          element={
            <ProtectedRoute requirePermission="saha:invoicing:access">
              <AppShell>
                <AgingReportPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/stock"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <StockLedgerPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/rep-kpi"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <RepKpiPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/bi"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <BIDashboardPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoicing/odeme/yeni"
          element={
            <ProtectedRoute requirePermission="saha:invoicing:access">
              <AppShell>
                <PaymentFormPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/invoicing/cek-senet"
          element={
            <ProtectedRoute requirePermission="saha:invoicing:access">
              <AppShell>
                <CekSenetListPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Bildirimler */}
        <Route
          path="/notifications"
          element={
            <ProtectedRoute>
              <AppShell>
                <NotificationsPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Ayarlar (tüm roller) */}
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <AppShell>
                <SettingsPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Numune */}
        <Route
          path="/samples"
          element={
            <ProtectedRoute>
              <AppShell>
                <SamplesPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        {/* Admin ekranları */}
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <DashboardPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/regions"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <RegionAssignmentPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/sample-budget"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <SampleBudgetPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <UsersPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/tr-seed"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <TrSeedPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/audit-logs"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <AuditLogPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/clinics"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <CsvImportPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/heatmap"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <HeatmapPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/clinic-scan"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <ClinicScanPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/clinic-scan/jobs/:id"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <ScanJobDetailPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/route-planner"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <ScanRoutePlanner />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/broadcast"
          element={
            <ProtectedRoute requireRole="admin">
              <AppShell>
                <AdminBroadcastPage />
              </AppShell>
            </ProtectedRoute>
          }
        />

        <Route
          path="*"
          element={
            <div className="flex min-h-screen items-center justify-center p-8 text-center">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">404</h1>
                <p className="mt-2 text-muted-foreground">Sayfa bulunamadı.</p>
              </div>
            </div>
          }
        />
      </Routes>
    </Suspense>
  );
}
