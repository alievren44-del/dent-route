/**
 * CariListPage — Cari (müşteri hesap) liste ekranı.
 *
 * URL: /invoicing/cari
 *
 * Özellikler:
 *   - Tablo: ad, kod, vergi no, bakiye (TRY), kredi limit, vade durumu chip, son işlem
 *   - Filtreler: bakiyeli only, vadesi geçen, durum, il
 *   - Row click → /invoicing/cari/:id
 *   - "+ Yeni Cari" → modal: profile autocomplete + form
 *   - Renkler: vade geçti = kırmızı, yaklaşıyor = sarı, OK = yeşil
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, X, Filter, Check, AlertTriangle } from 'lucide-react';

import { getSupabaseClient } from '@lib/supabase';
import { formatTRY } from '@features/invoicing/lib/invoiceCalc';

interface CariListRow {
  id: string;
  cari_kodu: string;
  fatura_unvani: string;
  vergi_no: string | null;
  kredi_limiti: number;
  acilis_bakiyesi: number;
  il: string | null;
  durum: string;
  odeme_vadesi_gun: number;
  profile_id: string | null;
  account_id: string | null;
  updated_at: string;
}

interface CariWithBalance extends CariListRow {
  bakiye: number;
  oldestDueDate: string | null;
  hasOverdue: boolean;
  hasApproaching: boolean;
  sonIslemTarihi: string | null;
}

interface ProfileOption {
  id: string;
  ad_soyad: string | null;
  klinik_adi: string | null;
  email: string | null;
}

function useDebounced<T>(value: T, ms: number): T {
  const [d, setD] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setD(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return d;
}

async function fetchCariler(filters: {
  search: string;
  durum: string;
  il: string;
}): Promise<CariListRow[]> {
  const supabase = getSupabaseClient();
  let q = supabase
    .from('saha_cariler')
    .select(
      'id, cari_kodu, fatura_unvani, vergi_no, kredi_limiti, acilis_bakiyesi, il, durum, odeme_vadesi_gun, profile_id, account_id, updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(500);

  if (filters.durum) q = q.eq('durum', filters.durum);
  if (filters.il) q = q.eq('il', filters.il);
  if (filters.search.trim().length >= 2) {
    const term = `%${filters.search.trim()}%`;
    q = q.or(`fatura_unvani.ilike.${term},cari_kodu.ilike.${term},vergi_no.ilike.${term}`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CariListRow[];
}

async function fetchFaturaSums(
  cariIds: string[],
): Promise<Map<string, { kalan: number; oldestDue: string | null; updatedAt: string | null }>> {
  const map = new Map<
    string,
    { kalan: number; oldestDue: string | null; updatedAt: string | null }
  >();
  if (cariIds.length === 0) return map;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('saha_faturalar')
    .select('cari_id, kalan, vade_tarihi, tip, durum, updated_at')
    .in('cari_id', cariIds)
    .not('durum', 'in', '(iptal)');
  if (error) throw error;
  for (const row of (data ?? []) as Array<{
    cari_id: string;
    kalan: number | null;
    vade_tarihi: string | null;
    tip: string;
    durum: string;
    updated_at: string;
  }>) {
    const prev = map.get(row.cari_id) ?? { kalan: 0, oldestDue: null, updatedAt: null };
    const sign = row.tip === 'iade' ? -1 : 1;
    prev.kalan += sign * Number(row.kalan ?? 0);
    if (row.vade_tarihi && Number(row.kalan ?? 0) > 0) {
      if (!prev.oldestDue || row.vade_tarihi < prev.oldestDue) prev.oldestDue = row.vade_tarihi;
    }
    if (!prev.updatedAt || row.updated_at > prev.updatedAt) prev.updatedAt = row.updated_at;
    map.set(row.cari_id, prev);
  }
  return map;
}

function vadeBadge(c: CariWithBalance): { label: string; cls: string } {
  if (c.bakiye <= 0) {
    return { label: 'OK', cls: 'bg-green-100 text-green-700' };
  }
  if (c.hasOverdue) {
    return { label: 'Vade Geçti', cls: 'bg-red-100 text-red-700' };
  }
  if (c.hasApproaching) {
    return { label: 'Vade Yakın', cls: 'bg-amber-100 text-amber-700' };
  }
  return { label: 'Açık', cls: 'bg-blue-100 text-blue-700' };
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function CariListPage(): JSX.Element {
  const [searchParams] = useSearchParams();
  const initialCreateFor = searchParams.get('createFor');

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 300);

  const [showFilters, setShowFilters] = useState(false);
  const [filterBakiyeli, setFilterBakiyeli] = useState(false);
  const [filterVadeGecen, setFilterVadeGecen] = useState(false);
  const [filterDurum, setFilterDurum] = useState('');
  const [filterIl, setFilterIl] = useState('');

  const [createOpen, setCreateOpen] = useState(!!initialCreateFor);

  const { data: cariler, isLoading } = useQuery({
    queryKey: ['cariler', debouncedSearch, filterDurum, filterIl],
    queryFn: () => fetchCariler({ search: debouncedSearch, durum: filterDurum, il: filterIl }),
  });

  const cariIds = useMemo(() => (cariler ?? []).map((c) => c.id), [cariler]);

  const { data: faturaSums } = useQuery({
    queryKey: ['cariler-fatura-sums', cariIds],
    enabled: cariIds.length > 0,
    queryFn: () => fetchFaturaSums(cariIds),
  });

  const enriched = useMemo<CariWithBalance[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const tenDaysLater = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    return (cariler ?? []).map((c) => {
      const sums = faturaSums?.get(c.id);
      const bakiye = Number(c.acilis_bakiyesi ?? 0) + (sums?.kalan ?? 0);
      const oldestDue = sums?.oldestDue ?? null;
      const hasOverdue = !!oldestDue && bakiye > 0 && oldestDue < today;
      const hasApproaching =
        !!oldestDue && bakiye > 0 && oldestDue >= today && oldestDue <= tenDaysLater;
      return {
        ...c,
        bakiye: Math.round(bakiye * 100) / 100,
        oldestDueDate: oldestDue,
        hasOverdue,
        hasApproaching,
        sonIslemTarihi: sums?.updatedAt ?? c.updated_at,
      };
    });
  }, [cariler, faturaSums]);

  const filtered = useMemo(() => {
    return enriched.filter((c) => {
      if (filterBakiyeli && c.bakiye <= 0) return false;
      if (filterVadeGecen && !c.hasOverdue) return false;
      return true;
    });
  }, [enriched, filterBakiyeli, filterVadeGecen]);

  // İl listesi (filter dropdown)
  const ilOptions = useMemo(() => {
    const s = new Set<string>();
    for (const c of cariler ?? []) {
      if (c.il) s.add(c.il);
    }
    return Array.from(s).sort();
  }, [cariler]);

  return (
    <div className="flex flex-col min-h-full pb-24">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h1 className="text-lg font-semibold text-foreground">Cariler</h1>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium min-h-tap-min"
          >
            <Plus className="h-4 w-4" />
            Yeni Cari
          </button>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ünvan / kod / VKN ara…"
              className="flex-1 bg-transparent text-sm outline-none"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Temizle"
                className="p-1 min-h-tap-min min-w-tap-min flex items-center justify-center"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            className={`p-2 rounded-lg border min-h-tap-min min-w-tap-min flex items-center justify-center ${
              showFilters ? 'bg-primary/10 border-primary text-primary' : 'border-border'
            }`}
            aria-label="Filtreler"
          >
            <Filter className="h-4 w-4" />
          </button>
        </div>

        {showFilters && (
          <div className="mt-3 p-3 rounded-lg border border-border bg-card space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filterBakiyeli}
                onChange={(e) => setFilterBakiyeli(e.target.checked)}
              />
              Sadece bakiyeli
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={filterVadeGecen}
                onChange={(e) => setFilterVadeGecen(e.target.checked)}
              />
              Vadesi geçen
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Durum</label>
                <select
                  value={filterDurum}
                  onChange={(e) => setFilterDurum(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-background text-sm"
                >
                  <option value="">Tümü</option>
                  <option value="aktif">Aktif</option>
                  <option value="pasif">Pasif</option>
                  <option value="kara_liste">Kara Liste</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">İl</label>
                <select
                  value={filterIl}
                  onChange={(e) => setFilterIl(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-background text-sm"
                >
                  <option value="">Tümü</option>
                  {ilOptions.map((il) => (
                    <option key={il} value={il}>
                      {il}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Liste */}
      <div className="px-4 py-3 space-y-2">
        {isLoading && <p className="text-center text-muted-foreground py-6 text-sm">Yükleniyor…</p>}
        {!isLoading && filtered.length === 0 && (
          <p className="text-center text-muted-foreground py-10 text-sm">Cari bulunamadı.</p>
        )}
        {filtered.map((c) => {
          const badge = vadeBadge(c);
          return (
            <Link
              key={c.id}
              to={`/invoicing/cari/${c.id}`}
              className="block rounded-lg border border-border bg-card p-3 hover:bg-muted/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {c.fatura_unvani}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.cari_kodu}
                    {c.vergi_no && <span className="ml-2">VKN: {c.vergi_no}</span>}
                    {c.il && <span className="ml-2">• {c.il}</span>}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Son işlem: {formatDate(c.sonIslemTarihi)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                    {badge.label}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      c.bakiye > 0
                        ? 'text-red-600'
                        : c.bakiye < 0
                          ? 'text-green-600'
                          : 'text-foreground'
                    }`}
                  >
                    {formatTRY(c.bakiye)}
                  </span>
                  {c.kredi_limiti > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      Limit {formatTRY(Number(c.kredi_limiti))}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {createOpen && (
        <NewCariModal initialProfileId={initialCreateFor} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  );
}

// ============================================================================
// Yeni Cari Modal
// ============================================================================

interface NewCariModalProps {
  initialProfileId: string | null;
  onClose: () => void;
}

function NewCariModal({ initialProfileId, onClose }: NewCariModalProps): JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [profileId, setProfileId] = useState<string | null>(initialProfileId);
  const [profileLabel, setProfileLabel] = useState<string>('');
  const [profileSearch, setProfileSearch] = useState<string>('');
  const [profilePickerOpen, setProfilePickerOpen] = useState<boolean>(!initialProfileId);
  const debouncedSearch = useDebounced(profileSearch, 300);

  const [faturaUnvani, setFaturaUnvani] = useState('');
  const [vergiNo, setVergiNo] = useState('');
  const [vergiDairesi, setVergiDairesi] = useState('');
  const [faturaAdresi, setFaturaAdresi] = useState('');
  const [il, setIl] = useState('');
  const [ilce, setIlce] = useState('');
  const [iban, setIban] = useState('');
  const [bankaAdi, setBankaAdi] = useState('');
  const [odemeVadesiGun, setOdemeVadesiGun] = useState(30);
  const [krediLimiti, setKrediLimiti] = useState(0);
  const [salesRepId, setSalesRepId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Plasiyer dropdown — REP / ADMIN rolleri
  const { data: salesReps } = useQuery({
    queryKey: ['cari-new-sales-reps'],
    queryFn: async (): Promise<Array<{ id: string; label: string; role: string }>> => {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, ad_soyad, email, role')
        .in('role', ['REP', 'SALES_REP', 'ADMIN', 'MANAGER'])
        .order('ad_soyad', { ascending: true });
      if (err) throw err;
      return ((data ?? []) as Array<{
        id: string;
        ad_soyad: string | null;
        email: string | null;
        role: string;
      }>).map((r) => ({
        id: r.id,
        label: r.ad_soyad?.trim() || r.email || r.id.slice(0, 8),
        role: r.role,
      }));
    },
  });

  // Initial profile pre-fill
  useQuery({
    queryKey: ['cari-new-initial-profile', initialProfileId],
    enabled: !!initialProfileId,
    queryFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, ad_soyad, klinik_adi, email, tax_number, tax_office, city')
        .eq('id', initialProfileId!)
        .maybeSingle();
      if (err) throw err;
      const p = data as {
        id: string;
        ad_soyad: string | null;
        klinik_adi: string | null;
        email: string | null;
        tax_number: string | null;
        tax_office: string | null;
        city: string | null;
      } | null;
      if (p) {
        setProfileLabel(p.klinik_adi ?? p.ad_soyad ?? p.email ?? p.id);
        setFaturaUnvani(p.klinik_adi ?? p.ad_soyad ?? '');
        setVergiNo(p.tax_number ?? '');
        setVergiDairesi(p.tax_office ?? '');
        setIl(p.city ?? '');
      }
      return p;
    },
  });

  const { data: profileOptions, isFetching: profileSearching } = useQuery({
    queryKey: ['cari-new-profile-search', debouncedSearch],
    enabled: profilePickerOpen && debouncedSearch.trim().length >= 2,
    queryFn: async (): Promise<ProfileOption[]> => {
      const supabase = getSupabaseClient();
      const term = `%${debouncedSearch}%`;
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, ad_soyad, klinik_adi, email')
        .or(`klinik_adi.ilike.${term},ad_soyad.ilike.${term},email.ilike.${term}`)
        .limit(15);
      if (err) throw err;
      return (data ?? []) as ProfileOption[];
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase
        .from('saha_cariler')
        .insert({
          profile_id: profileId,
          fatura_unvani: faturaUnvani.trim(),
          vergi_no: vergiNo.trim() || null,
          vergi_dairesi: vergiDairesi.trim() || null,
          fatura_adresi: faturaAdresi.trim() || null,
          il: il.trim() || null,
          ilce: ilce.trim() || null,
          iban: iban.trim() || null,
          banka_adi: bankaAdi.trim() || null,
          odeme_vadesi_gun: odemeVadesiGun,
          kredi_limiti: krediLimiti,
          sales_rep_id: salesRepId || null,
        })
        .select('id')
        .single();
      if (err) throw err;
      return data as { id: string };
    },
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey: ['cariler'] });
      onClose();
      navigate(`/invoicing/cari/${row.id}`);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Cari oluşturulamadı.');
    },
  });

  function handleSubmit(): void {
    setError(null);
    if (!faturaUnvani.trim()) {
      setError('Fatura unvanı zorunludur.');
      return;
    }
    mutation.mutate();
  }

  function pickProfile(p: ProfileOption): void {
    setProfileId(p.id);
    setProfileLabel(p.klinik_adi ?? p.ad_soyad ?? p.email ?? p.id);
    setProfilePickerOpen(false);
    if (!faturaUnvani) setFaturaUnvani(p.klinik_adi ?? p.ad_soyad ?? '');
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <div className="w-full max-w-lg bg-background rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Yeni Cari</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-2 -mr-2 min-h-tap-min min-w-tap-min flex items-center justify-center"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {/* Profile autocomplete */}
          <section>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Müşteri (opsiyonel) — mevcut Parla profili
            </label>
            {profileId && !profilePickerOpen ? (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border bg-card">
                <p className="text-sm truncate">{profileLabel}</p>
                <button
                  type="button"
                  onClick={() => {
                    setProfileId(null);
                    setProfileLabel('');
                    setProfilePickerOpen(true);
                  }}
                  className="text-xs text-primary px-2 py-1 min-h-tap-min"
                >
                  Değiştir
                </button>
              </div>
            ) : (
              <div className="relative">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={profileSearch}
                    onChange={(e) => setProfileSearch(e.target.value)}
                    onFocus={() => setProfilePickerOpen(true)}
                    placeholder="Klinik / kullanıcı ara…"
                    className="flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
                {debouncedSearch.trim().length >= 2 && (
                  <div className="mt-1 rounded-lg border border-border bg-card shadow-lg max-h-60 overflow-y-auto">
                    {profileSearching && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Aranıyor…</p>
                    )}
                    {!profileSearching && (profileOptions ?? []).length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">Sonuç yok.</p>
                    )}
                    {(profileOptions ?? []).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => pickProfile(p)}
                        className="w-full text-left px-3 py-2 min-h-tap-min hover:bg-muted/60 border-b border-border last:border-b-0"
                      >
                        <p className="text-sm font-medium truncate">
                          {p.klinik_adi ?? p.ad_soyad ?? p.email ?? p.id}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          <Field label="Fatura Unvanı *" value={faturaUnvani} onChange={setFaturaUnvani} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Vergi No" value={vergiNo} onChange={setVergiNo} />
            <Field label="Vergi Dairesi" value={vergiDairesi} onChange={setVergiDairesi} />
          </div>
          <Field label="Fatura Adresi" value={faturaAdresi} onChange={setFaturaAdresi} textarea />
          <div className="grid grid-cols-2 gap-2">
            <Field label="İl" value={il} onChange={setIl} />
            <Field label="İlçe" value={ilce} onChange={setIlce} />
          </div>
          <Field label="IBAN" value={iban} onChange={setIban} />
          <Field label="Banka Adı" value={bankaAdi} onChange={setBankaAdi} />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Ödeme Vadesi (gün)"
              value={odemeVadesiGun}
              onChange={setOdemeVadesiGun}
            />
            <NumberField label="Kredi Limiti (₺)" value={krediLimiti} onChange={setKrediLimiti} />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Atanacak Plasiyer (opsiyonel)
            </label>
            <select
              value={salesRepId}
              onChange={(e) => setSalesRepId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">— Atanmamış (admin görür) —</option>
              {(salesReps ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ({r.role})
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </p>
          )}
        </div>

        <div className="sticky bottom-0 bg-background border-t border-border px-4 py-3 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-border text-sm font-medium min-h-tap-min"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold flex items-center justify-center gap-1.5 min-h-tap-min disabled:opacity-50"
          >
            {mutation.isPending ? (
              'Kaydediliyor…'
            ) : (
              <>
                <Check className="h-4 w-4" />
                Kaydet
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}): JSX.Element {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      <input
        type="number"
        inputMode="decimal"
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-3 py-2 rounded-lg border border-border bg-card text-sm outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  );
}

export default CariListPage;
