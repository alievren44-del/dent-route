import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

import { AppShell } from '@components/layout/AppShell';
import { ProtectedRoute } from '@components/layout/ProtectedRoute';

const LoginPage = lazy(() => import('@features/auth/pages/LoginPage'));
const KvkkConsentPage = lazy(() => import('@features/auth/pages/KvkkConsentPage'));
const MapPage = lazy(() => import('@features/map/pages/MapPage'));
const DiscoveryPage = lazy(() => import('@features/discovery/pages/DiscoveryPage'));
const RoutePlannerPage = lazy(() => import('@features/routes/pages/RoutePlannerPage'));
const ActiveRoutePage = lazy(() => import('@features/routes/pages/ActiveRoutePage'));
const SamplesPage = lazy(() => import('@features/sampling/pages/SamplesPage'));
const NotificationsPage = lazy(() => import('@features/notifications/pages/NotificationsPage'));
const RegionAssignmentPage = lazy(() => import('@features/admin/pages/RegionAssignmentPage'));
const CustomerDetailPage = lazy(() => import('@features/customers/pages/CustomerDetailPage'));
const OrderFormPage = lazy(() => import('@features/orders/pages/OrderFormPage'));
const DashboardPage = lazy(() => import('@features/admin/pages/DashboardPage'));
const HeatmapPage = lazy(() => import('@features/admin/pages/HeatmapPage'));
const CsvImportPage = lazy(() => import('@features/admin/pages/CsvImportPage'));
const ClinicScanPage = lazy(() => import('@features/admin/pages/ClinicScanPage'));

function PlaceholderPage({ name }: { name: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
        <p className="mt-2 text-muted-foreground">Bu ekran ilgili sprint&apos;te geliştirilecek.</p>
      </div>
    </div>
  );
}

const Loading = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="text-muted-foreground">Yükleniyor…</div>
  </div>
);

function withShell(name: string, hideNav = false) {
  return (
    <ProtectedRoute>
      <AppShell hideNav={hideNav}>
        <PlaceholderPage name={name} />
      </AppShell>
    </ProtectedRoute>
  );
}

function withShellAdmin(name: string) {
  return (
    <ProtectedRoute requireRole="admin">
      <AppShell>
        <PlaceholderPage name={name} />
      </AppShell>
    </ProtectedRoute>
  );
}

export function AppRouter() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        {/* Auth ekranları — shell DIŞINDA */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding/kvkk" element={<KvkkConsentPage />} />

        {/* Saha rep / admin ekranları — shell İÇİNDE */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell>
                <MapPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route path="/clinics" element={withShell('Müşteri Listesi')} />
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
        <Route path="/visits/check-in/:id" element={withShell('Check-in', true)} />
        <Route path="/visits/:id" element={withShell('Ziyaret Formu')} />
        <Route
          path="/orders/new"
          element={
            <ProtectedRoute>
              <AppShell>
                <OrderFormPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
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
          path="/samples"
          element={
            <ProtectedRoute>
              <AppShell>
                <SamplesPage />
              </AppShell>
            </ProtectedRoute>
          }
        />
        <Route path="/history" element={withShell('Geçmiş')} />

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
        <Route path="/admin/users" element={withShellAdmin('Kullanıcı Yönetimi')} />
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
