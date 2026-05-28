/**
 * UsersPage — Admin kullanıcı yönetimi.
 *
 * URL: /admin/users
 * Sprint: 2, PROMPT-14
 *
 * Yetenekler:
 *  - profiles listesi (search + role filter + active/inactive)
 *  - Per-row aksiyonlar: role değiştir, bölge ata link'i, password reset, deaktive
 *  - "Yeni Kullanıcı" modal → admin-create-user Edge Function
 *  - Toast feedback (sonner)
 *
 * RLS: bu sayfa requireRole='admin' router'da garanti edilir; query'ler de
 * profiles SELECT/UPDATE policy'lerine güvenir.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, Search, Key, Power, MapPin, X, User as UserIcon, Copy } from 'lucide-react';

import { getSupabaseClient } from '@/lib/supabase';

type Role = 'ADMIN' | 'MANAGER' | 'REP' | 'USER';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'ADMIN', label: 'Admin' },
  { value: 'MANAGER', label: 'Manager' },
  { value: 'REP', label: 'Saha Rep' },
  { value: 'USER', label: 'Kullanıcı' },
];

interface ProfileRow {
  id: string;
  email: string | null;
  ad_soyad: string | null;
  telefon: string | null;
  klinik_adi: string | null;
  avatar_url: string | null;
  role: string | null;
  region: string | null;
  is_approved: boolean | null;
  created_at: string | null;
}

interface CreateUserBody {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  phone?: string;
  sendInvite?: boolean;
}

interface CreateUserResponse {
  status: 'ok' | 'error';
  userId?: string;
  inviteLink?: string;
  error?: string;
}

async function fetchUsers(): Promise<ProfileRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, email, ad_soyad, telefon, klinik_adi, avatar_url, role, region, is_approved, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as ProfileRow[];
}

function userLabel(u: ProfileRow): string {
  return u.ad_soyad ?? u.email ?? u.id.slice(0, 8);
}

function normalizeRole(r: string | null): Role {
  const up = (r ?? '').toUpperCase();
  if (up === 'ADMIN') return 'ADMIN';
  if (up === 'MANAGER') return 'MANAGER';
  if (up === 'REP' || up === 'SALES_REP') return 'REP';
  return 'USER';
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export default function UsersPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | Role>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [showCreate, setShowCreate] = useState(false);

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: fetchUsers,
  });

  const changeRole = useMutation({
    mutationFn: async (input: { userId: string; role: Role }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('profiles')
        .update({ role: input.role })
        .eq('id', input.userId);
      if (error) throw error;
      // Audit log (best effort — RLS engellerse sessiz geç)
      try {
        await supabase.from('admin_audit_logs').insert({
          action: 'change_role',
          target_table: 'profiles',
          target_id: input.userId,
          details: { role: input.role },
        });
      } catch {
        /* noop */
      }
    },
    onSuccess: (_, vars) => {
      toast.success(`Rol değiştirildi → ${vars.role}`);
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => {
      toast.error(`Rol değiştirilemedi: ${(err as Error).message}`);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async (input: { userId: string; nextActive: boolean }) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from('profiles')
        .update({ is_approved: input.nextActive })
        .eq('id', input.userId);
      if (error) throw error;
      try {
        await supabase.from('admin_audit_logs').insert({
          action: input.nextActive ? 'activate_user' : 'deactivate_user',
          target_table: 'profiles',
          target_id: input.userId,
        });
      } catch {
        /* noop */
      }
    },
    onSuccess: (_, vars) => {
      toast.success(vars.nextActive ? 'Kullanıcı aktive edildi' : 'Kullanıcı deaktive edildi');
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: (err) => {
      toast.error(`İşlem başarısız: ${(err as Error).message}`);
    },
  });

  const resetPassword = useMutation({
    mutationFn: async (email: string) => {
      const supabase = getSupabaseClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      try {
        await supabase.from('admin_audit_logs').insert({
          action: 'reset_password',
          target_table: 'auth.users',
          target_id: email,
        });
      } catch {
        /* noop */
      }
    },
    onSuccess: () => {
      toast.success('Şifre sıfırlama e-postası gönderildi', {
        description:
          'SMTP yapılandırılmamışsa admin manuel olarak Dashboard üzerinden işlem yapmalı.',
      });
    },
    onError: (err) => {
      toast.error(`Şifre sıfırlanamadı: ${(err as Error).message}`, {
        description: 'Supabase Dashboard üzerinden manuel olarak göndermeniz gerekebilir.',
      });
    },
  });

  const users = usersQuery.data ?? [];

  const filtered = useMemo<ProfileRow[]>(() => {
    const q = search.trim().toLocaleLowerCase('tr');
    return users.filter((u) => {
      if (roleFilter !== 'ALL' && normalizeRole(u.role) !== roleFilter) {
        return false;
      }
      if (statusFilter !== 'ALL') {
        const active = u.is_approved !== false; // null/true = active
        if (statusFilter === 'ACTIVE' && !active) return false;
        if (statusFilter === 'INACTIVE' && active) return false;
      }
      if (q) {
        const hay = `${u.ad_soyad ?? ''} ${u.email ?? ''} ${u.telefon ?? ''}`.toLocaleLowerCase(
          'tr',
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [users, search, roleFilter, statusFilter]);

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 space-y-2 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Kullanıcı Yönetimi</h1>
            <p className="text-xs text-slate-500">
              {usersQuery.isLoading
                ? 'Yükleniyor…'
                : `${filtered.length} / ${users.length} kullanıcı`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
          >
            <UserPlus className="h-4 w-4" />
            Yeni Kullanıcı
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ad / e-posta / telefon ara…"
              className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'ALL' | Role)}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            aria-label="Rol filtresi"
          >
            <option value="ALL">Tüm Roller</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'ALL' | 'ACTIVE' | 'INACTIVE')}
            className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
            aria-label="Aktiflik filtresi"
          >
            <option value="ALL">Tüm Durumlar</option>
            <option value="ACTIVE">Aktif</option>
            <option value="INACTIVE">Pasif</option>
          </select>
        </div>
      </header>

      <main className="flex-1 px-2 py-3 sm:px-4">
        {usersQuery.isError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            Kullanıcı listesi yüklenemedi:{' '}
            {(usersQuery.error as Error | null)?.message ?? 'bilinmiyor'}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Kullanıcı</th>
                <th className="px-3 py-2 text-left font-medium">E-posta</th>
                <th className="px-3 py-2 text-left font-medium">Rol</th>
                <th className="px-3 py-2 text-left font-medium">Bölge</th>
                <th className="px-3 py-2 text-left font-medium">Durum</th>
                <th className="px-3 py-2 text-left font-medium">Kayıt</th>
                <th className="px-3 py-2 text-right font-medium">Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((u) => {
                const active = u.is_approved !== false;
                const currentRole = normalizeRole(u.role);
                return (
                  <tr key={u.id} className={active ? '' : 'opacity-60'}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        {u.avatar_url ? (
                          <img
                            src={u.avatar_url}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-500">
                            <UserIcon className="h-4 w-4" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900">{userLabel(u)}</div>
                          {u.telefon && <div className="text-xs text-slate-500">{u.telefon}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{u.email ?? '—'}</td>
                    <td className="px-3 py-2">
                      <select
                        value={currentRole}
                        onChange={(e) =>
                          changeRole.mutate({
                            userId: u.id,
                            role: e.target.value as Role,
                          })
                        }
                        disabled={changeRole.isPending}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs focus:border-emerald-500 focus:outline-none"
                        aria-label="Rol değiştir"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{u.region ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-rose-100 text-rose-700'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            active ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        {active ? 'AKTİF' : 'PASİF'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">{formatDate(u.created_at)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Link
                          to="/admin/regions"
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                          title="Bölge ata"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          Bölge
                        </Link>
                        <button
                          type="button"
                          disabled={!u.email || resetPassword.isPending}
                          onClick={() => {
                            if (!u.email) return;
                            resetPassword.mutate(u.email);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          title="Şifre sıfırlama e-postası gönder"
                        >
                          <Key className="h-3.5 w-3.5" />
                          Şifre
                        </button>
                        <button
                          type="button"
                          disabled={toggleActive.isPending}
                          onClick={() => {
                            const confirmMsg = active
                              ? `${userLabel(u)} kullanıcısını PASİF yap?`
                              : `${userLabel(u)} kullanıcısını AKTİF yap?`;
                            if (!window.confirm(confirmMsg)) return;
                            toggleActive.mutate({
                              userId: u.id,
                              nextActive: !active,
                            });
                          }}
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs disabled:opacity-50 ${
                            active
                              ? 'border-rose-200 text-rose-700 hover:bg-rose-50'
                              : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                          }`}
                          title={active ? 'Pasif yap' : 'Aktif yap'}
                        >
                          <Power className="h-3.5 w-3.5" />
                          {active ? 'Pasif yap' : 'Aktif yap'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !usersQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                    Kullanıcı bulunamadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CreateUserModal
// ─────────────────────────────────────────────────────────────────────────────

interface CreateUserModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateUserModal({ onClose, onCreated }: CreateUserModalProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<Role>('REP');
  const [sendInvite, setSendInvite] = useState(true);
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const createUser = useMutation({
    mutationFn: async (body: CreateUserBody): Promise<CreateUserResponse> => {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke<CreateUserResponse>(
        'admin-create-user',
        { body },
      );
      if (error) throw error;
      if (!data) throw new Error('Boş yanıt');
      if (data.status === 'error') throw new Error(data.error ?? 'unknown_error');
      return data;
    },
    onSuccess: (data) => {
      toast.success('Kullanıcı oluşturuldu');
      onCreated();
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
      } else {
        onClose();
      }
    },
    onError: (err) => {
      toast.error(`Oluşturulamadı: ${(err as Error).message}`);
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (password.length < 8) {
      toast.error('Şifre en az 8 karakter olmalı');
      return;
    }
    if (!email.includes('@')) {
      toast.error('Geçerli e-posta gir');
      return;
    }
    if (!fullName.trim()) {
      toast.error('Ad-soyad gir');
      return;
    }
    const body: CreateUserBody = {
      email: email.trim(),
      password,
      fullName: fullName.trim(),
      role,
      sendInvite,
    };
    if (phone.trim()) body.phone = phone.trim();
    createUser.mutate(body);
  }

  function copyLink(): void {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink).then(
      () => toast.success('Bağlantı kopyalandı'),
      () => toast.error('Kopyalanamadı'),
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Yeni Kullanıcı</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {inviteLink ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              Davet bağlantısı oluşturuldu. SMTP yapılandırılmadıysa kullanıcıya bu bağlantıyı
              manuel ulaştırın.
            </div>
            <textarea
              readOnly
              value={inviteLink}
              rows={3}
              className="w-full rounded-md border border-slate-300 bg-slate-50 p-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={copyLink}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" />
                Kopyala
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                Tamam
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="cu-email" className="mb-1 block text-xs font-medium text-slate-600">
                E-posta
              </label>
              <input
                id="cu-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="cu-name" className="mb-1 block text-xs font-medium text-slate-600">
                Ad Soyad
              </label>
              <input
                id="cu-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="cu-phone" className="mb-1 block text-xs font-medium text-slate-600">
                Telefon (opsiyonel)
              </label>
              <input
                id="cu-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="cu-role" className="mb-1 block text-xs font-medium text-slate-600">
                  Rol
                </label>
                <select
                  id="cu-role"
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cu-pass" className="mb-1 block text-xs font-medium text-slate-600">
                  Şifre (min 8)
                </label>
                <input
                  id="cu-pass"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={sendInvite}
                onChange={(e) => setSendInvite(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-slate-700">
                Davet bağlantısı üret (admin manuel iletir)
              </span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                İptal
              </button>
              <button
                type="submit"
                disabled={createUser.isPending}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {createUser.isPending ? 'Oluşturuluyor…' : 'Oluştur'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
