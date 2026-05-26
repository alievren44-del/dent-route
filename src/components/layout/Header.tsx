import { useAuthStore } from '@core/auth/authStore';
import { loadSahaConfig } from '@config/loadConfig';

function handleSignOut() {
  void useAuthStore.getState().signOut();
}

export function Header() {
  const config = loadSahaConfig();
  const profile = useAuthStore((s) => s.profile);

  return (
    <header className="flex items-center justify-between border-b border-border bg-background px-4 py-3 pt-safe">
      <div className="flex items-center gap-2">
        <span className="text-base font-bold text-foreground">{config.branding.name}</span>
      </div>
      {profile && (
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {profile.fullName ?? profile.email}
          </span>
          <button
            type="button"
            onClick={handleSignOut}
            className="rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-foreground"
            aria-label="Çıkış yap"
          >
            Çıkış
          </button>
        </div>
      )}
    </header>
  );
}
