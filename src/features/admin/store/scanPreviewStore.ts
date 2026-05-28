/**
 * scanPreviewStore — Klinik tarama preview için kısa-ömürlü (ephemeral) state.
 *
 * Phase C — Tarama akışı:
 *   1) ClinicScanPage `dryRun: true` ile clinic-scan-v2'yi çağırır.
 *   2) Edge function `clinics[]` + `filtered_reasons[]` döndürür (DB yazımı atlanır).
 *   3) Bu store `openPreview()` ile doldurulur, dialog açılır.
 *   4) Kullanıcı seçim yapar → `selectedIds` Set'i güncellenir.
 *   5) "Kaydet" → ClinicScanPage 2. invoke (`placeIdsAllowlist`) atar.
 *   6) `close()` her şeyi sıfırlar (persist YOK — yenilemede uçar).
 *
 * persist YOK: tarama sonuçları geçici; localStorage gereksiz.
 */

import { create } from 'zustand';

export interface ScanPreviewClinic {
  place_id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  rating?: number;
  user_ratings_total?: number;
  types: string[];
  sources: string[];
  db_status: 'new' | 'existing';
  confidence: number;
  is_suspicious: boolean;
  suspicious_reasons: string[];
  filter_reason?: string;
  segment?: 'private' | 'kamu';
}

export type ScanPreviewFilter = 'all' | 'new' | 'existing' | 'suspicious' | 'filtered';

interface ScanPreviewState {
  open: boolean;
  clinics: ScanPreviewClinic[];
  filteredReasons: Array<{ name: string; reason: string }>;
  selectedIds: Set<string>;
  searchQuery: string;
  filter: ScanPreviewFilter;
  /** Scan request parameters — needed for 2nd invoke (commit) */
  lastScanInput: Record<string, unknown> | null;

  // Actions
  openPreview: (input: {
    clinics: ScanPreviewClinic[];
    filteredReasons: Array<{ name: string; reason: string }>;
    scanInput: Record<string, unknown>;
  }) => void;
  close: () => void;
  toggleSelect: (placeId: string) => void;
  selectAll: () => void;
  selectOnlyNew: () => void;
  selectOnlyTrusted: () => void;
  clearSelection: () => void;
  setSearchQuery: (q: string) => void;
  setFilter: (f: ScanPreviewFilter) => void;
}

export const useScanPreview = create<ScanPreviewState>((set) => ({
  open: false,
  clinics: [],
  filteredReasons: [],
  selectedIds: new Set<string>(),
  searchQuery: '',
  filter: 'all',
  lastScanInput: null,

  openPreview: ({ clinics, filteredReasons, scanInput }) =>
    set({
      open: true,
      clinics,
      filteredReasons,
      // Default seçim: SADECE yeni + güvenilir + doğru ilçe.
      // - db_status === 'new'  → mevcut olanlar tekrar yazılmasın
      // - !is_suspicious        → düşük confidence'lılar manuel onaya bırakılsın
      // - filter_reason !== 'district_mismatch' → Etimesgut taramasında Sincan adresliler hariç
      // Kullanıcı isterse "Tümünü seç" veya "Sadece yenileri seç" ile değiştirebilir.
      selectedIds: new Set(
        clinics
          .filter(
            (c) =>
              c.db_status === 'new' && !c.is_suspicious && c.filter_reason !== 'district_mismatch',
          )
          .map((c) => c.place_id),
      ),
      searchQuery: '',
      filter: 'all',
      lastScanInput: scanInput,
    }),

  close: () =>
    set({
      open: false,
      clinics: [],
      filteredReasons: [],
      selectedIds: new Set<string>(),
      searchQuery: '',
      filter: 'all',
      lastScanInput: null,
    }),

  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedIds: next };
    }),

  selectAll: () => set((s) => ({ selectedIds: new Set(s.clinics.map((c) => c.place_id)) })),

  selectOnlyNew: () =>
    set((s) => ({
      selectedIds: new Set(s.clinics.filter((c) => c.db_status === 'new').map((c) => c.place_id)),
    })),

  selectOnlyTrusted: () =>
    set((s) => ({
      selectedIds: new Set(s.clinics.filter((c) => !c.is_suspicious).map((c) => c.place_id)),
    })),

  clearSelection: () => set({ selectedIds: new Set<string>() }),

  setSearchQuery: (q) => set({ searchQuery: q }),

  setFilter: (f) => set({ filter: f }),
}));
