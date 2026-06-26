import { useState } from 'react';
import { Menu } from 'lucide-react';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions } from '@core/auth/usePermissions';
import { loadSahaConfig } from '@config/loadConfig';
import { NotificationBell } from '@features/notifications/components/NotificationBell';
import { NavDrawer } from '@components/layout/NavDrawer';

function handleSignOut() {
  void useAuthStore.getState().signOut();
}

export function Header() {
  const config = loadSahaConfig();
  const profile = useAuthStore((s) => s.profile);
  const { isAdmin } = usePermissions();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/*
        Statüs çubuğu şeridi: bg-[#1F4E78] + pt-safe → kurumsal koyu-mavi zemin üzerinde
        beyaz sistem ikonları (saat/batarya/bildirim) okunur olur.
        Android 15 edge-to-edge'de OS, WebView içeriğini şeffaf statüs çubuğunun altına kadar
        genişletir; bu sarmalayıcı şerit, şeffaf katmanın arkasındaki rengi sağlar.
        Gerçek uygulama başlık satırı (aşağıdaki <header>) beyaz bg-background ile tasarım
        tutarlılığını korur.
      */}
      <div className="bg-[#1F4E78] pt-safe">
        <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3">
          <div className="flex items-center gap-2">
            {profile && (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                aria-label="Menü"
                className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-foreground hover:bg-muted"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <span className="text-base font-bold text-foreground">{config.branding.name}</span>
          </div>
          {profile && (
            <div className="flex items-center gap-3">
              <NotificationBell />
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {profile.fullName ?? profile.email}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center justify-center rounded-md bg-muted px-3 h-11 text-xs font-medium text-foreground"
                aria-label="Çıkış yap"
              >
                Çıkış
              </button>
            </div>
          )}
        </header>
      </div>

      {profile && (
        <NavDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} isAdmin={isAdmin} />
      )}
    </>
  );
}
