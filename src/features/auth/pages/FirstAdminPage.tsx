import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { getSupabaseClient } from '@lib/supabase';
import { loadSahaConfig } from '@config/loadConfig';

const FormSchema = z
  .object({
    ad: z.string().trim().min(2, 'Ad en az 2 karakter olmalı.'),
    soyad: z.string().trim().min(2, 'Soyad en az 2 karakter olmalı.'),
    email: z.string().trim().email('Geçerli bir e-posta giriniz.'),
    password: z.string().min(8, 'Parola en az 8 karakter olmalı.'),
    passwordConfirm: z.string().min(8, 'Parola tekrarı en az 8 karakter olmalı.'),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: 'Parolalar eşleşmiyor.',
    path: ['passwordConfirm'],
  });

type CheckState = 'checking' | 'allowed' | 'redirect';

export default function FirstAdminPage() {
  const config = loadSahaConfig();
  const navigate = useNavigate();

  const [checkState, setCheckState] = useState<CheckState>('checking');
  const [ad, setAd] = useState('');
  const [soyad, setSoyad] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Guard: profiles tablosunda kayıt varsa /login'e at.
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabaseClient();
    void supabase
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .then(({ count, error: countErr }) => {
        if (cancelled) return;
        if (countErr) {
          // Tabloya erişim yoksa kullanıcı yine de görsün — devam et.
          setCheckState('allowed');
          return;
        }
        if ((count ?? 0) > 0) {
          setCheckState('redirect');
        } else {
          setCheckState('allowed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (checkState === 'redirect') {
      navigate('/login', { replace: true });
    }
  }, [checkState, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = FormSchema.safeParse({ ad, soyad, email, password, passwordConfirm });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Form geçerli değil.');
      return;
    }

    setSubmitting(true);
    try {
      const fullName = `${parsed.data.ad} ${parsed.data.soyad}`;
      const supabase = getSupabaseClient();
      const { error: signUpErr } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          data: { full_name: fullName, ad_soyad: fullName },
        },
      });
      if (signUpErr) {
        setError(signUpErr.message);
        return;
      }
      setSuccess('Hesabınız oluşturuldu. Giriş ekranına yönlendiriliyorsunuz…');
      window.setTimeout(() => {
        navigate('/login', {
          replace: true,
          state: { hint: 'Hesabınız oluşturuldu, giriş yapın.' },
        });
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (checkState === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted">
        <div className="text-muted-foreground">Kontrol ediliyor…</div>
      </div>
    );
  }

  if (checkState === 'redirect') {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-5 rounded-2xl bg-background p-6 shadow-lg"
      >
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">{config.branding.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">İlk Admin Kurulumu</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Sistemde henüz kullanıcı yok. İlk admin hesabını burada oluşturun.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-foreground">Ad</span>
            <input
              type="text"
              autoComplete="given-name"
              required
              value={ad}
              onChange={(e) => setAd(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-primary focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-foreground">Soyad</span>
            <input
              type="text"
              autoComplete="family-name"
              required
              value={soyad}
              onChange={(e) => setSoyad(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-primary focus:outline-none"
            />
          </label>
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
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-primary focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-foreground">Parola (Tekrar)</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-primary focus:outline-none"
          />
        </label>

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700"
          >
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-tap-min w-full rounded-lg bg-primary px-4 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50"
        >
          {submitting ? 'Oluşturuluyor…' : 'Admin Hesabını Oluştur'}
        </button>

        <p className="text-center text-xs text-muted-foreground">
          Bu sayfa yalnızca sistemde hiç kullanıcı yokken erişilebilir.
        </p>
      </form>
    </div>
  );
}
