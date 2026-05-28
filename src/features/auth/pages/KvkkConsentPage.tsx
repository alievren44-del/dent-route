import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@core/auth/authStore';
import { usePermissions } from '@core/auth/usePermissions';
import { loadSahaConfig } from '@config/loadConfig';

export default function KvkkConsentPage() {
  const config = loadSahaConfig();
  const { isAuthenticated, kvkkAccepted } = usePermissions();

  const [submitting, setSubmitting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (kvkkAccepted) return <Navigate to="/" replace />;

  function handleAccept() {
    if (!agreed) return;
    setSubmitting(true);
    setError(null);
    void useAuthStore
      .getState()
      .acceptKvkk(config.legal.kvkkVersion)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setSubmitting(false);
      });
  }

  return (
    <div className="min-h-screen bg-muted px-4 py-8">
      <div className="mx-auto max-w-md space-y-5 rounded-2xl bg-background p-6 shadow-lg">
        <h1 className="text-xl font-bold text-foreground">KVKK Aydınlatma ve Onay</h1>

        <p className="text-sm text-foreground">
          {config.branding.name} uygulamasını kullanmak için aydınlatma metnini okuyup kabul etmeniz
          gereklidir. Uygulama, saha satış aktivitelerinizi (ziyaret, rota, konum) işler.
        </p>

        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>GPS konum sadece aktif rota süresince kayıt edilir.</li>
          <li>Ziyaret kayıtları {config.legal.dataRetention.visitsMonths} ay saklanır.</li>
          <li>GPS log {config.legal.dataRetention.gpsLogDays} gün saklanır.</li>
          <li>Foto {config.legal.dataRetention.photosMonths} ay saklanır.</li>
        </ul>

        <a
          href={config.legal.kvkkUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-sm font-medium text-primary underline"
        >
          Tam aydınlatma metnini görüntüle →
        </a>

        <label className="flex items-start gap-3 rounded-lg bg-muted p-3">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 h-5 w-5"
          />
          <span className="text-sm text-foreground">
            Aydınlatma metnini okudum, açık rızamla kabul ediyorum (v{config.legal.kvkkVersion}).
          </span>
        </label>

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleAccept}
          disabled={!agreed || submitting}
          className="min-h-tap-min w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? 'Kaydediliyor…' : 'Kabul Et ve Devam Et'}
        </button>
      </div>
    </div>
  );
}
