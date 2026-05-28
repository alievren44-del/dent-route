/**
 * ScanPreviewDialog — Tarama sonuçlarını commit'ten ÖNCE incele/seç modali.
 *
 * Phase C akışı:
 *   - `useScanPreview` store dolu olduğunda (`open === true`) render edilir.
 *   - Klinik kartları liste halinde gösterilir; filter tabs ile darbe filtreleme,
 *     toolbar quick-select butonları, search kutusu vardır.
 *   - "Kaydet" → `onCommit(selectedPlaceIds, lastScanInput)` çağrılır;
 *     ClinicScanPage 2. invoke ile `placeIdsAllowlist` upsert eder.
 *
 * Accessibility:
 *   - role="dialog", aria-modal, ESC ile kapanır, overlay click kapanır.
 *
 * Library-free modal pattern (UsersPage.CreateUserModal referansı).
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { X, Search, Star, Phone, MapPin, AlertTriangle, Pencil, Plus, Loader2 } from 'lucide-react';
import {
  useScanPreview,
  type ScanPreviewClinic,
  type ScanPreviewFilter,
} from '@features/admin/store/scanPreviewStore';
import { useRoutePlanner, type RouteClinic } from '@features/admin/store/routePlannerStore';

interface Props {
  onCommit: (selectedPlaceIds: string[], lastScanInput: Record<string, unknown>) => Promise<void>;
  onEditClinic?: (clinic: ScanPreviewClinic) => void;
  onManualAdd?: () => void;
}

const FILTER_TABS: Array<{ key: ScanPreviewFilter; label: string }> = [
  { key: 'all', label: 'Tümü' },
  { key: 'new', label: 'Yeniler' },
  { key: 'existing', label: 'Var olan' },
  { key: 'suspicious', label: 'Şüpheli' },
  { key: 'filtered', label: 'Filtre dışı' },
];

function ConfidenceChip({ value }: { value: number }) {
  // Backend confidence zaten 0-100 integer döndürüyor (computeConfidence v3).
  // Önceki kod * 100 yaparak 4500% gibi yanlış değerler basıyordu.
  const pct = Math.round(value);
  let cls = 'bg-slate-100 text-slate-700';
  if (pct >= 80) cls = 'bg-emerald-100 text-emerald-800';
  else if (pct >= 60) cls = 'bg-amber-100 text-amber-800';
  else cls = 'bg-red-100 text-red-800';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {pct}%
    </span>
  );
}

function StatusChip({ status }: { status: 'new' | 'existing' }) {
  if (status === 'new') {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
        YENİ
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-800">
      var
    </span>
  );
}

function SourceChip({ source }: { source: string }) {
  return (
    <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
      {source}
    </span>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

function ClinicCard({
  clinic,
  selected,
  onToggle,
  onEditClick,
}: {
  clinic: ScanPreviewClinic;
  selected: boolean;
  onToggle: () => void;
  onEditClick?: (c: ScanPreviewClinic) => void;
}) {
  return (
    <div
      className={`rounded-lg border p-3 transition ${
        selected ? 'border-primary bg-primary/5' : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer"
          aria-label={`${clinic.name} seç`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm truncate" title={clinic.name}>
              {clinic.name}
            </span>
            <ConfidenceChip value={clinic.confidence} />
            <StatusChip status={clinic.db_status} />
            {onEditClick && (
              <button
                type="button"
                onClick={() => onEditClick(clinic)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
              >
                <Pencil className="h-3 w-3" />
                Düzenle
              </button>
            )}
          </div>

          {clinic.address && (
            <div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{truncate(clinic.address, 80)}</span>
            </div>
          )}

          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {clinic.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {clinic.phone}
              </span>
            )}
            {typeof clinic.rating === 'number' && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 text-amber-500" />
                {clinic.rating.toFixed(1)}
                {typeof clinic.user_ratings_total === 'number' && (
                  <span className="text-muted-foreground">({clinic.user_ratings_total})</span>
                )}
              </span>
            )}
            {clinic.sources.length > 0 && (
              <span className="inline-flex items-center gap-1">
                {clinic.sources.map((s) => (
                  <SourceChip key={s} source={s} />
                ))}
              </span>
            )}
          </div>

          {clinic.is_suspicious && (
            <div className="mt-2 flex items-start gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                <strong>Şüpheli:</strong>{' '}
                {clinic.suspicious_reasons.length > 0
                  ? clinic.suspicious_reasons.join(', ')
                  : 'belirsiz'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ScanPreviewDialog({ onCommit, onEditClinic, onManualAdd }: Props) {
  const open = useScanPreview((s) => s.open);
  const clinics = useScanPreview((s) => s.clinics);
  const filteredReasons = useScanPreview((s) => s.filteredReasons);
  const selectedIds = useScanPreview((s) => s.selectedIds);
  const searchQuery = useScanPreview((s) => s.searchQuery);
  const filter = useScanPreview((s) => s.filter);
  const lastScanInput = useScanPreview((s) => s.lastScanInput);

  const close = useScanPreview((s) => s.close);
  const toggleSelect = useScanPreview((s) => s.toggleSelect);
  const selectAll = useScanPreview((s) => s.selectAll);
  const selectOnlyNew = useScanPreview((s) => s.selectOnlyNew);
  const selectOnlyTrusted = useScanPreview((s) => s.selectOnlyTrusted);
  const clearSelection = useScanPreview((s) => s.clearSelection);
  const setSearchQuery = useScanPreview((s) => s.setSearchQuery);
  const setFilter = useScanPreview((s) => s.setFilter);

  // Debounced search input (200ms)
  const [searchInput, setSearchInput] = useState<string>(searchQuery);
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (searchInput !== searchQuery) setSearchQuery(searchInput);
    }, 200);
    return () => window.clearTimeout(t);
  }, [searchInput, searchQuery, setSearchQuery]);

  const [committing, setCommitting] = useState(false);
  const navigate = useNavigate();

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !committing) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, committing]);

  const stats = useMemo(() => {
    const total = clinics.length;
    const newCount = clinics.filter((c) => c.db_status === 'new').length;
    const existingCount = clinics.filter((c) => c.db_status === 'existing').length;
    const suspiciousCount = clinics.filter((c) => c.is_suspicious).length;
    return { total, newCount, existingCount, suspiciousCount };
  }, [clinics]);

  const visible = useMemo<ScanPreviewClinic[]>(() => {
    if (filter === 'filtered') return [];
    let list = clinics;
    if (filter === 'new') list = list.filter((c) => c.db_status === 'new');
    else if (filter === 'existing') list = list.filter((c) => c.db_status === 'existing');
    else if (filter === 'suspicious') list = list.filter((c) => c.is_suspicious);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || (c.address ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [clinics, filter, searchQuery]);

  if (!open) return null;

  const handleCommit = async () => {
    if (selectedIds.size === 0 || !lastScanInput) return;
    setCommitting(true);
    // Commit sırasında store kapanır (close()), bu yüzden routePlanner payload'ını
    // SNAPSHOT olarak şimdi al — toast eylem callback'i kapandıktan sonra çalışacak.
    const selectedSnapshot: ScanPreviewClinic[] = clinics.filter((c) =>
      selectedIds.has(c.place_id),
    );
    const scanInputSnapshot = lastScanInput;
    try {
      await onCommit(Array.from(selectedIds), lastScanInput);
      // Commit başarılıysa "Rota planla?" toast — kullanıcı saniyeler içinde
      // rota planlayıcıya gidebilsin.
      toast.success(`${selectedSnapshot.length} klinik kaydedildi`, {
        duration: 8000,
        action: {
          label: 'Rota planla',
          onClick: () => {
            const mapped: RouteClinic[] = selectedSnapshot.map((c) => ({
              // ScanPreview place_id'leri henüz commit edilmiş; saha_clinics.id
              // henüz preview payload'ında yok → id null, place_id ile eşleşir.
              id: null,
              place_id: c.place_id,
              name: c.name,
              lat: c.lat,
              lng: c.lng,
              ...(c.address != null ? { address: c.address } : {}),
              ...(c.phone != null ? { phone: c.phone } : {}),
              ...(c.rating != null ? { rating: c.rating } : {}),
              ...(c.user_ratings_total != null ? { user_ratings_total: c.user_ratings_total } : {}),
              segment:
                (c as unknown as { segment?: string }).segment === 'kamu' ? 'kamu' : 'private',
              types: c.types,
            }));
            useRoutePlanner.getState().setClinics(mapped);
            useRoutePlanner.getState().setMeta({
              provinceSlug: String(scanInputSnapshot.provinceSlug ?? ''),
              districtSlug:
                typeof scanInputSnapshot.districtSlug === 'string' &&
                scanInputSnapshot.districtSlug.length > 0
                  ? scanInputSnapshot.districtSlug
                  : null,
              repName: '',
            });
            navigate('/admin/route-planner');
          },
        },
      });
    } finally {
      setCommitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scan-preview-title"
      onClick={() => {
        if (!committing) close();
      }}
    >
      <div
        className="flex w-full max-w-5xl max-h-[90vh] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 id="scan-preview-title" className="text-lg font-semibold">
            Tarama Sonuçları
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={committing}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-50"
            aria-label="Kapat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stats row */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs">
            <span className="text-muted-foreground">Toplam:</span>
            <strong>{stats.total}</strong>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800">
            <span>Yeni:</span>
            <strong>{stats.newCount}</strong>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs text-blue-800">
            <span>Var olan:</span>
            <strong>{stats.existingCount}</strong>
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-800">
            <span>Şüpheli:</span>
            <strong>{stats.suspiciousCount}</strong>
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-border px-5">
          {FILTER_TABS.map((t) => {
            const active = filter === t.key;
            const badge =
              t.key === 'filtered'
                ? filteredReasons.length
                : t.key === 'new'
                  ? stats.newCount
                  : t.key === 'existing'
                    ? stats.existingCount
                    : t.key === 'suspicious'
                      ? stats.suspiciousCount
                      : stats.total;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setFilter(t.key)}
                className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 h-10 text-sm ${
                  active
                    ? 'border-primary text-primary font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">
                  {badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Toolbar */}
        {filter !== 'filtered' && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Ara (ad veya adres)…"
                className="h-8 w-56 rounded-md border border-border bg-background pl-7 pr-2 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={selectAll}
              className="rounded border border-border px-2 h-8 text-xs hover:bg-slate-50"
            >
              Hepsi Seç
            </button>
            <button
              type="button"
              onClick={selectOnlyNew}
              className="rounded border border-border px-2 h-8 text-xs hover:bg-slate-50"
            >
              Sadece Yeniler
            </button>
            <button
              type="button"
              onClick={selectOnlyTrusted}
              className="rounded border border-border px-2 h-8 text-xs hover:bg-slate-50"
            >
              Güvenilir
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded border border-border px-2 h-8 text-xs hover:bg-slate-50"
            >
              Temizle
            </button>
            <span className="ml-auto inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {selectedIds.size} seçili
            </span>
          </div>
        )}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {filter === 'filtered' ? (
            <div className="space-y-2">
              {filteredReasons.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">
                  Filtreye takılan kayıt yok.
                </p>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      Bu kayıtlar reddedildi (kategori/keyword filtresi). Yine de eklemek isterseniz
                      manuel ekleme açın.
                    </p>
                    {onManualAdd && (
                      <button
                        type="button"
                        onClick={onManualAdd}
                        className="inline-flex items-center gap-1 rounded border border-primary/40 px-2 py-1 text-xs text-primary hover:bg-primary/5"
                      >
                        <Plus className="h-3 w-3" />
                        Manuel Ekle
                      </button>
                    )}
                  </div>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {filteredReasons.map((r, i) => (
                      <li
                        key={`${r.name}-${i}`}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="truncate" title={r.name}>
                          {r.name}
                        </span>
                        <span className="inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-800">
                          {r.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          ) : visible.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              Bu filtrede klinik yok.
            </p>
          ) : (
            <div className="space-y-2">
              {visible.map((c) => (
                <ClinicCard
                  key={c.place_id}
                  clinic={c}
                  selected={selectedIds.has(c.place_id)}
                  onToggle={() => toggleSelect(c.place_id)}
                  {...(onEditClinic ? { onEditClick: onEditClinic } : {})}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={close}
            disabled={committing}
            className="rounded-lg border border-border bg-white px-4 h-10 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleCommit}
            disabled={selectedIds.size === 0 || committing || !lastScanInput}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 h-10 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {committing && <Loader2 className="h-4 w-4 animate-spin" />}
            {committing ? 'Kaydediliyor…' : `${selectedIds.size} Klinik Kaydet`}
          </button>
        </div>
      </div>
    </div>
  );
}
