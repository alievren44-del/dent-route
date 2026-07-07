/**
 * ForgotPasswordPage — Parola sıfırlama isteği (public).
 *
 * URL: /forgot-password
 *
 * E-posta alır, Supabase auth.resetPasswordForEmail ile sıfırlama bağlantısı
 * gönderir. Kullanıcı e-postadaki bağlantıya tıklayınca oturum açılır ve
 * Ayarlar > Parola ekranından yeni parolasını belirleyebilir.
 */

import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { loadSahaConfig } from '@config/loadConfig';
import { getSupabaseClient } from '@lib/supabase';

export default function ForgotPasswordPage() {
  const config = loadSahaConfig();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/settings` : undefined;
      const { error: err } = await getSupabaseClient().auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (err) throw err;
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantı gönderilemedi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl bg-background p-6 shadow-lg">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">{config.branding.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Parola sıfırlama</p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div
              role="status"
              className="rounded-lg bg-green-50 px-3 py-3 text-sm text-green-700"
            >
              Eğer bu e-posta sistemde kayıtlıysa, parola sıfırlama bağlantısı gönderildi.
              Gelen kutunuzu kontrol edin.
            </div>
            <Link
              to="/login"
              className="block w-full rounded-lg bg-primary px-4 py-3 text-center text-base font-semibold text-primary-foreground"
            >
              Girişe dön
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-sm text-muted-foreground">
              Hesabınıza ait e-posta adresini girin, size bir sıfırlama bağlantısı gönderelim.
            </p>

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

            {error && (
              <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="min-h-tap-min w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
            >
              {submitting ? 'Gönderiliyor…' : 'Sıfırlama Bağlantısı Gönder'}
            </button>

            <p className="text-center text-sm">
              <Link to="/login" className="text-primary underline-offset-2 hover:underline">
                Girişe dön
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
