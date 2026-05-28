/**
 * DistrictClinicsDialog — İl/ilçe bazında saha_clinics tablosunu listeleyen
 * modal. ClinicScanPage'in "Mevcut Veritabanı" satırına tıklanınca açılır.
 *
 * Sprint: 2 — Phase D (Drill-down list & manage)
 *
 * Yetenekler:
 *  - province_slug (+ optional district_slug) filtresiyle klinik listesi
 *  - Search (name/address) + debounced 200ms
 *  - Sort: name_asc / rating_desc / verified_desc
 *  - Pagination: 50/sayfa
 *  - Aksiyonlar: Düzenle (callback), Sil (confirm + audit), Haritada Gör
 *  - CSV export (client-side, UTF-8 BOM)
 *  - "Manuel Ekle" tetikleyici (Phase E ile bağlanır)
 *  - Empty state, loading, error
 *
 * Pattern: UsersPage.CreateUserModal mirror (overlay click + ESC kapat,
 *          stopPropagation içeride).
 *
 * Bağımlılıklar: TanStack Query, sonner, lucide-react, date-fns — yeni dep yok.
 */

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatDistanceToNowStrict } from 'date-fns';
import { tr as trLocale } from 'date-fns/locale';
import {
  Pencil,
  Trash2,
  MapPin,
  Download,
  Plus,
  Search,
  X,
  Route as RouteIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { getSupabaseClient } from '@lib/supabase';
import { logClinicEdit } from '@lib/clinicEditAudit';
import { useRoutePlanner, type RouteClinic } from '@features/admin/store/routePlannerStore';

// ─────────────────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────────────────

export interface SahaClinicRow {
  id: string;
  google_place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  province_slug: string | null;
  district_slug: string | null;
  vertical_key: string | null;
  rating: number | null;
  user_ratings_total: number | null;
  sources: string[] | null;
  last_verified_at: string | null;
  raw_payload: Record<string, unknown> | null;
}

type SortKey = 'name_asc' | 'rating_desc' | 'verified_desc';

interface Props {
  open: boolean;
  onClose: () => void;
  provinceSlug: string;
  /** null = il geneli */
  districtSlug: string | null;
  /** Cache invalidation tetikleyici — manuel ekle/edit/sil sonrası */
  onChanged?: () => void;
  /** Phase E ile bağlanır */
  onManualAdd?: () => void;
  /** Phase F ile bağlanır — clinic row tıklanınca edit modal */
  onEditClinic?: (clinic: SahaClinicRow) => void;
}

const PAGE_SIZE = 50;

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name_asc', label: 'Ad (A-Z)' },
  { value: 'rating_desc', label: 'Rating ↓' },
  { value: 'verified_desc', label: 'Yeni eklenenler' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Yardımcılar
// ─────────────────────────────────────────────────────────────────────────────

function slugToReadable(slug: string | null): string {
  if (!slug) return '';
  return slug
    .split('-')
    .map((p) => (p.length === 0 ? p : p.charAt(0).toLocaleUpperCase('tr') + p.slice(1)))
    .join(' ');
}

function escapeCsv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows: SahaClinicRow[], filename: string): void {
  const header = ['Ad', 'Adres', 'Telefon', 'Lat', 'Lng', 'Rating', 'Reviews', 'Last Verified'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const cells = [
      escapeCsv(r.name),
      escapeCsv(r.address ?? ''),
      escapeCsv(r.phone ?? ''),
      String(r.lat),
      String(r.lng),
      r.rating != null ? String(r.rating) : '',
      r.user_ratings_total != null ? String(r.user_ratings_total) : '',
      r.last_verified_at ?? '',
    ];
    lines.push(cells.join(','));
  }
  // UTF-8 BOM (Excel TR uyumlu)
  const blob = new Blob(['﻿' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatVerified(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return formatDistanceToNowStrict(d, { addSuffix: true, locale: trLocale });
  } catch {
    return d.toLocaleDateString('tr-TR');
  }
}

function truncate(s: string | null, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bileşen
// ─────────────────────────────────────────────────────────────────────────────

export default function DistrictClinicsDialog({
  open,
  onClose,
  provinceSlug,
  districtSlug,
  onChanged,
  onManualAdd,
  onEditClinic,
}: Props): JSX.Element | null {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const setRouteClinics = useRoutePlanner((s) => s.setClinics);
  const setRouteMeta = useRoutePlanner((s) => s.setMeta);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, 200);
  const [sortKey, setSortKey] = useState<SortKey>('name_asc');
  const [page, setPage] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Rotaya Çevir için seçili klinik id'leri.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Modal kapanınca state'i resetle (yeniden açılırsa temiz başlasın).
  useEffect(() => {
    if (!open) {
      setSearch('');
      setSortKey('name_asc');
      setPage(0);
      setDeletingId(null);
      setSelectedIds(new Set());
    }
  }, [open]);

  // Filtre değişince sayfa başa dön.
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch, sortKey, provinceSlug, districtSlug]);

  const queryKey = useMemo<QueryKey>(
    () => ['district-clinics', provinceSlug, districtSlug ?? null],
    [provinceSlug, districtSlug],
  );

  const { data, isLoading, isError, error, refetch } = useQuery<SahaClinicRow[]>({
    queryKey,
    enabled: open && !!provinceSlug,
    queryFn: async () => {
      const supabase = getSupabaseClient();
      let q = supabase
        .from('saha_clinics')
        .select(
          'id, google_place_id, name, address, phone, lat, lng, province_slug, district_slug, vertical_key, rating, user_ratings_total, sources, last_verified_at, raw_payload',
        )
        .eq('province_slug', provinceSlug);
      if (districtSlug) q = q.eq('district_slug', districtSlug);
      const { data: rows, error: qErr } = await q.order('name', { ascending: true }).limit(2000);
      if (qErr) throw qErr;
      return (rows ?? []) as SahaClinicRow[];
    },
  });

  const allClinics = data ?? [];

  // Filter + sort (client-side).
  const filteredSorted = useMemo<SahaClinicRow[]>(() => {
    const q = debouncedSearch.trim().toLocaleLowerCase('tr');
    let arr = allClinics;
    if (q) {
      arr = arr.filter((c) => {
        const hay = `${c.name} ${c.address ?? ''}`.toLocaleLowerCase('tr');
        return hay.includes(q);
      });
    }
    const sorted = [...arr];
    if (sortKey === 'name_asc') {
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    } else if (sortKey === 'rating_desc') {
      sorted.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    } else if (sortKey === 'verified_desc') {
      sorted.sort((a, b) => {
        const av = a.last_verified_at ?? '';
        const bv = b.last_verified_at ?? '';
        if (av === bv) return 0;
        return bv > av ? 1 : -1;
      });
    }
    return sorted;
  }, [allClinics, debouncedSearch, sortKey]);

  const totalCount = filteredSorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = useMemo<SahaClinicRow[]>(() => {
    const start = safePage * PAGE_SIZE;
    return filteredSorted.slice(start, start + PAGE_SIZE);
  }, [filteredSorted, safePage]);

  // ESC ile kapat
  const handleClose = useCallback(() => {
    if (deletingId) return; // delete sürerken kapatma
    onClose();
  }, [deletingId, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') handleClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  if (!open) return null;

  const provinceLabel = slugToReadable(provinceSlug);
  const districtLabel = districtSlug ? slugToReadable(districtSlug) : 'Tüm il';

  // ───────────────────────────────────────────────────────────────────────
  // Aksiyon handler'lar
  // ───────────────────────────────────────────────────────────────────────

  async function handleDelete(clinic: SahaClinicRow): Promise<void> {
    if (!window.confirm(`"${clinic.name}" silinsin mi?`)) return;
    setDeletingId(clinic.id);
    const supabase = getSupabaseClient();
    try {
      const { error: delErr } = await supabase.from('saha_clinics').delete().eq('id', clinic.id);
      if (delErr) throw delErr;

      // Audit log — best effort
      await logClinicEdit({
        clinicId: null,
        action: 'delete',
        before: {
          id: clinic.id,
          name: clinic.name,
          address: clinic.address,
          phone: clinic.phone,
          lat: clinic.lat,
          lng: clinic.lng,
          province_slug: clinic.province_slug,
          district_slug: clinic.district_slug,
          vertical_key: clinic.vertical_key,
        },
        after: null,
      });

      toast.success('Silindi');
      // Local refetch + parent invalidation
      await refetch();
      void queryClient.invalidateQueries({ queryKey: ['clinic-scan-stats'] });
      onChanged?.();
    } catch (e) {
      toast.error(`Silinemedi: ${(e as Error)?.message ?? 'bilinmeyen hata'}`);
    } finally {
      setDeletingId(null);
    }
  }

  function handleMapOpen(clinic: SahaClinicRow): void {
    const url = `https://www.google.com/maps/search/?api=1&query=${clinic.lat},${clinic.lng}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function handleCsvDownload(): void {
    if (filteredSorted.length === 0) {
      toast.info('İndirilecek kayıt yok');
      return;
    }
    const fname = districtSlug
      ? `klinikler_${provinceSlug}_${districtSlug}.csv`
      : `klinikler_${provinceSlug}.csv`;
    downloadCsv(filteredSorted, fname);
    toast.success(`${filteredSorted.length} kayıt CSV olarak indirildi`);
  }

  function handleSortChange(e: ChangeEvent<HTMLSelectElement>): void {
    setSortKey(e.target.value as SortKey);
  }

  function toggleRowSelect(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible(): void {
    setSelectedIds((prev) => {
      const visibleIds = pageRows.map((r) => r.id);
      const allSelected = visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  function handleRotaya(): void {
    if (selectedIds.size === 0) return;
    const selected = allClinics.filter((c) => selectedIds.has(c.id));
    const mapped: RouteClinic[] = selected.map((r) => ({
      id: r.id,
      ...(r.google_place_id ? { place_id: r.google_place_id } : {}),
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      ...(r.address != null ? { address: r.address } : {}),
      ...(r.phone != null ? { phone: r.phone } : {}),
      ...(r.rating != null ? { rating: r.rating } : {}),
      ...(r.user_ratings_total != null ? { user_ratings_total: r.user_ratings_total } : {}),
      segment:
        (r as unknown as { clinic_segment?: string }).clinic_segment === 'kamu'
          ? 'kamu'
          : 'private',
    }));
    setRouteClinics(mapped);
    setRouteMeta({
      provinceSlug,
      districtSlug: districtSlug ?? null,
      repName: '',
    });
    onClose();
    navigate('/admin/route-planner');
  }

  // ───────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="district-clinics-title"
      onClick={handleClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div className="min-w-0">
            <h2
              id="district-clinics-title"
              className="flex items-center gap-2 text-lg font-semibold text-slate-900"
            >
              <MapPin className="h-4 w-4 text-emerald-600" />
              İl: {provinceLabel} <span className="text-slate-400">/</span> İlçe: {districtLabel}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {isLoading
                ? 'Yükleniyor…'
                : isError
                  ? 'Hata oluştu'
                  : `${totalCount.toLocaleString('tr-TR')} klinik`}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={!!deletingId}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Kapat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Toolbar ────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onManualAdd?.()}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
            >
              <Plus className="h-3.5 w-3.5" />
              Manuel Ekle
            </button>
            <button
              type="button"
              onClick={handleRotaya}
              disabled={selectedIds.size === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Seçili klinikleri rotaya çevir"
            >
              <RouteIcon className="h-3.5 w-3.5" />
              Rotaya Çevir ({selectedIds.size})
            </button>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ad / adres ara…"
                className="w-56 rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-2 text-sm focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <select
              value={sortKey}
              onChange={handleSortChange}
              aria-label="Sıralama"
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleCsvDownload}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            CSV İndir
          </button>
        </div>

        {/* ── Content ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-auto">
          {isError && (
            <div className="m-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              Liste yüklenemedi: {(error as Error | null)?.message ?? 'bilinmiyor'}
            </div>
          )}

          {isLoading && (
            <div className="flex items-center justify-center px-4 py-12 text-sm text-slate-500">
              Yükleniyor…
            </div>
          )}

          {!isLoading && !isError && totalCount === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <p className="text-sm text-slate-600">
                Bu {districtSlug ? 'ilçede' : 'ilde'} klinik yok.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onManualAdd?.()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Manuel Ekle
                </button>
                <span className="text-xs text-slate-500">
                  veya "Tarama Yap" sekmesinden tarama başlatın.
                </span>
              </div>
            </div>
          )}

          {!isLoading && !isError && totalCount > 0 && (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    <input
                      type="checkbox"
                      checked={pageRows.length > 0 && pageRows.every((r) => selectedIds.has(r.id))}
                      onChange={toggleAllVisible}
                      aria-label="Sayfadaki klinikleri seç"
                      className="h-3.5 w-3.5 cursor-pointer"
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium">Ad</th>
                  <th className="px-3 py-2 text-left font-medium">Adres</th>
                  <th className="px-3 py-2 text-left font-medium">Telefon</th>
                  <th className="px-3 py-2 text-left font-medium">Rating</th>
                  <th className="px-3 py-2 text-left font-medium">Son doğrulama</th>
                  <th className="px-3 py-2 text-right font-medium">Aksiyon</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageRows.map((c) => {
                  const isDeleting = deletingId === c.id;
                  const isChecked = selectedIds.has(c.id);
                  return (
                    <tr key={c.id} className={isDeleting ? 'opacity-50' : 'hover:bg-slate-50'}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleRowSelect(c.id)}
                          disabled={isDeleting}
                          aria-label={`${c.name} seç`}
                          className="h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">{c.name}</td>
                      <td className="px-3 py-2 text-slate-600" title={c.address ?? ''}>
                        {truncate(c.address, 50)}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.phone ? (
                          <a href={`tel:${c.phone}`} className="text-emerald-700 hover:underline">
                            {c.phone}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-600">
                        {c.rating != null ? (
                          <span>
                            <span aria-hidden="true">⭐ </span>
                            {c.rating.toFixed(1)}
                            {c.user_ratings_total != null && (
                              <span className="ml-1 text-xs text-slate-400">
                                ({c.user_ratings_total})
                              </span>
                            )}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {formatVerified(c.last_verified_at)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => onEditClinic?.(c)}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            title="Düzenle"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void handleDelete(c);
                            }}
                            disabled={!!deletingId}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            title="Sil"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {isDeleting ? 'Siliniyor…' : 'Sil'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMapOpen(c)}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            title="Haritada Gör"
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            Harita
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer / Pagination ────────────────────────────────────── */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-white px-5 py-2 text-xs text-slate-600">
            <span>
              Sayfa {safePage + 1} / {totalPages} · {totalCount.toLocaleString('tr-TR')} kayıt
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
              >
                Önceki
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-40"
              >
                Sonraki
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
