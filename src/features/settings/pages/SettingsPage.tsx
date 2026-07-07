/**
 * SettingsPage — Kullanıcı ayarları (tüm roller).
 *
 * URL: /settings
 *
 * Sekmeler:
 *   - Profil: ad_soyad / telefon / klinik_adi göster + düzenle (profiles, kendi satırı).
 *   - Parola: Supabase auth.updateUser({ password }).
 *   - Bildirimler: profiles.notification_settings (jsonb) — push / e-posta / sessiz saat.
 *
 * RLS: profiles kendi satırı update — mevcut policy izin verir. Kendi id'sine yazar.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { User, KeyRound, Bell, Loader2, Save } from 'lucide-react';
import { toast } from 'sonner';

import { getSupabaseClient, getTypedClient } from '@lib/supabase';
import { useAuthStore } from '@core/auth/authStore';
import type { Json } from '@/types/database.types';
import QueryErrorState from '@components/common/QueryErrorState';

type Tab = 'profil' | 'parola' | 'bildirim';

interface ProfileForm {
  ad_soyad: string;
  telefon: string;
  klinik_adi: string;
}

interface NotificationSettings {
  push?: boolean;
  email?: boolean;
  quiet_hours_enabled?: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

interface ProfileRow {
  ad_soyad: string | null;
  telefon: string | null;
  klinik_adi: string | null;
  notification_settings: Json | null;
}

const TABS: { key: Tab; label: string; Icon: typeof User }[] = [
  { key: 'profil', label: 'Profil', Icon: User },
  { key: 'parola', label: 'Parola', Icon: KeyRound },
  { key: 'bildirim', label: 'Bildirimler', Icon: Bell },
];

function parseNotificationSettings(raw: Json | null): NotificationSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return raw as NotificationSettings;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [tab, setTab] = useState<Tab>('profil');

  const query = useQuery<ProfileRow, Error>({
    queryKey: ['settings-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const supabase = getTypedClient();
      const { data, error } = await supabase
        .from('profiles')
        .select('ad_soyad, telefon, klinik_adi, notification_settings')
        .eq('id', userId!)
        .single();
      if (error) throw error;
      return data as ProfileRow;
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Ayarlar</h1>
        <p className="text-sm text-muted-foreground">Profil, parola ve bildirim tercihleriniz.</p>
      </header>

      <nav className="flex gap-1 rounded-xl bg-muted p-1">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium ${
              tab === key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
        </div>
      ) : query.isError ? (
        <QueryErrorState
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      ) : (
        <>
          {tab === 'profil' && (
            <ProfileTab
              userId={userId!}
              initial={{
                ad_soyad: query.data?.ad_soyad ?? '',
                telefon: query.data?.telefon ?? '',
                klinik_adi: query.data?.klinik_adi ?? '',
              }}
              onSaved={() => {
                void query.refetch();
                void refreshProfile();
              }}
            />
          )}
          {tab === 'parola' && <PasswordTab />}
          {tab === 'bildirim' && (
            <NotificationTab
              userId={userId!}
              initial={parseNotificationSettings(query.data?.notification_settings ?? null)}
              onSaved={() => {
                void queryClient.invalidateQueries({ queryKey: ['settings-profile', userId] });
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

// ── Profil ────────────────────────────────────────────────────────────────
function ProfileTab({
  userId,
  initial,
  onSaved,
}: {
  userId: string;
  initial: ProfileForm;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProfileForm>(initial);

  const save = useMutation({
    mutationFn: async (data: ProfileForm) => {
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('profiles')
        .update({
          ad_soyad: data.ad_soyad.trim() || null,
          telefon: data.telefon.trim() || null,
          klinik_adi: data.klinik_adi.trim() || null,
        })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Profil güncellendi');
      onSaved();
    },
    onError: (e: Error) => toast.error('Hata: ' + e.message),
  });

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 shadow-sm">
      <Field label="Ad Soyad">
        <input
          type="text"
          value={form.ad_soyad}
          onChange={(e) => setForm({ ...form, ad_soyad: e.target.value })}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
      </Field>
      <Field label="Telefon">
        <input
          type="tel"
          value={form.telefon}
          onChange={(e) => setForm({ ...form, telefon: e.target.value })}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
      </Field>
      <Field label="Klinik / Firma">
        <input
          type="text"
          value={form.klinik_adi}
          onChange={(e) => setForm({ ...form, klinik_adi: e.target.value })}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
      </Field>
      <button
        type="button"
        onClick={() => save.mutate(form)}
        disabled={save.isPending}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Kaydet
      </button>
    </section>
  );
}

// ── Parola ────────────────────────────────────────────────────────────────
function PasswordTab() {
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      if (pwd.length < 6) throw new Error('Parola en az 6 karakter olmalı.');
      if (pwd !== pwd2) throw new Error('Parolalar eşleşmiyor.');
      const { error } = await getSupabaseClient().auth.updateUser({ password: pwd });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Parola güncellendi');
      setPwd('');
      setPwd2('');
    },
    onError: (e: Error) => toast.error('Hata: ' + e.message),
  });

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 shadow-sm">
      <Field label="Yeni Parola">
        <input
          type="password"
          autoComplete="new-password"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
      </Field>
      <Field label="Yeni Parola (tekrar)">
        <input
          type="password"
          autoComplete="new-password"
          value={pwd2}
          onChange={(e) => setPwd2(e.target.value)}
          className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
        />
      </Field>
      <button
        type="button"
        onClick={() => save.mutate()}
        disabled={save.isPending || !pwd || !pwd2}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
        Parolayı Değiştir
      </button>
    </section>
  );
}

// ── Bildirimler ─────────────────────────────────────────────────────────────
function NotificationTab({
  userId,
  initial,
  onSaved,
}: {
  userId: string;
  initial: NotificationSettings;
  onSaved: () => void;
}) {
  const [settings, setSettings] = useState<NotificationSettings>({
    push: initial.push ?? true,
    email: initial.email ?? true,
    quiet_hours_enabled: initial.quiet_hours_enabled ?? false,
    quiet_hours_start: initial.quiet_hours_start ?? '22:00',
    quiet_hours_end: initial.quiet_hours_end ?? '08:00',
  });

  const save = useMutation({
    mutationFn: async (next: NotificationSettings) => {
      const supabase = getTypedClient();
      const { error } = await supabase
        .from('profiles')
        .update({ notification_settings: next as unknown as Json })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Bildirim tercihleri kaydedildi');
      onSaved();
    },
    onError: (e: Error) => toast.error('Hata: ' + e.message),
  });

  const quietEnabled = settings.quiet_hours_enabled ?? false;

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 shadow-sm">
      <Toggle
        label="Anlık bildirimler (push)"
        checked={settings.push ?? true}
        onChange={(v) => setSettings((s) => ({ ...s, push: v }))}
      />
      <Toggle
        label="E-posta bildirimleri"
        checked={settings.email ?? true}
        onChange={(v) => setSettings((s) => ({ ...s, email: v }))}
      />
      <Toggle
        label="Sessiz saatler"
        checked={quietEnabled}
        onChange={(v) => setSettings((s) => ({ ...s, quiet_hours_enabled: v }))}
      />
      {quietEnabled && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-background p-3">
          <Field label="Başlangıç">
            <input
              type="time"
              value={settings.quiet_hours_start ?? '22:00'}
              onChange={(e) => setSettings((s) => ({ ...s, quiet_hours_start: e.target.value }))}
              className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
            />
          </Field>
          <Field label="Bitiş">
            <input
              type="time"
              value={settings.quiet_hours_end ?? '08:00'}
              onChange={(e) => setSettings((s) => ({ ...s, quiet_hours_end: e.target.value }))}
              className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
            />
          </Field>
        </div>
      )}
      <button
        type="button"
        onClick={() => save.mutate(settings)}
        disabled={save.isPending}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Kaydet
      </button>
    </section>
  );
}

// ── Ortak küçük bileşenler ──────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-3 text-left"
    >
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-primary' : 'bg-muted-foreground/30'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
