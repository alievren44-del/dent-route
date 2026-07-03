import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions } from '@core/auth/usePermissions';
import { loadSahaConfig } from '@config/loadConfig';
import { getTypedClient } from '@lib/supabase';

async function shouldShowFirstSetup(): Promise<boolean> {
  try {
    const supabase = getTypedClient();
    const { count, error } = await supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true });
    if (error) return false;
    return (count ?? 0) === 0;
  } catch {
    return false;
  }
}

export default function LoginPage() {
  const config = loadSahaConfig();
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const { isAuthenticated, kvkkAccepted } = usePermissions();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showFirstSetup, setShowFirstSetup] = useState(false);
  const locationHint = (location.state as { hint?: string } | null)?.hint ?? null;

  useEffect(() => {
    let cancelled = false;
    void shouldShowFirstSetup().then((show) => {
      if (!cancelled) setShowFirstSetup(show);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isAuthenticated) {
    const next = kvkkAccepted
      ? ((location.state as { from?: string } | null)?.from ?? '/')
      : '/onboarding/kvkk';
    return <Navigate to={next} replace />;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    void useAuthStore
      .getState()
      .signIn(email.trim(), password, rememberMe)
      .catch(() => {
        // Hata authStore.error'a yazıldı.
      })
      .finally(() => setSubmitting(false));
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl bg-background p-6 shadow-lg"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">{config.branding.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Saha satış uygulaması</p>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-foreground">E-posta</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-primary focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-foreground">Parola</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-primary focus:outline-none"
          />
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          <span>Beni hatırla</span>
        </label>

        {locationHint && (
          <div role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            {locationHint}
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || loading}
          className="min-h-tap-min w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? 'Giriş yapılıyor…' : 'Giriş Yap'}
        </button>

        {showFirstSetup && (
          <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-3 text-center text-sm text-foreground">
            <p className="mb-1 text-xs text-muted-foreground">Sistemde henüz kullanıcı yok.</p>
            <p>
              İlk kez kuruyorsanız:{' '}
              <Link
                to="/onboarding/first-admin"
                className="font-semibold text-primary underline-offset-2 hover:underline"
              >
                İlk Admin Kurulumu
              </Link>
            </p>
          </div>
        )}

        <p className="text-center text-xs text-muted-foreground">
          Parla web/mobil ile aynı hesabı kullanın.
        </p>
      </form>
    </div>
  );
}
