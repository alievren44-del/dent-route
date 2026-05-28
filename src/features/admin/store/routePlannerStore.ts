/**
 * routePlannerStore — ScanRoutePlanner için ephemeral (persist YOK) zustand store.
 *
 * Phase 4 (Akıllı Tarama Motoru) — DistrictClinicsDialog → ScanRoutePlanner geçişinde
 * seçili klinikleri, başlangıç noktasını ve meta bilgileri taşır.
 *
 * persist YOK: tarama sonrası rota planlama tek-seferlik akış; yenilemede uçar.
 * (`scanPreviewStore` ile aynı mantık.)
 */

import { create } from 'zustand';

// ─────────────────────────────────────────────────────────────────────────────
// Tipler
// ─────────────────────────────────────────────────────────────────────────────

export interface RouteClinic {
  /**
   * saha_clinics.id (DB'deki gerçek kayıt). Henüz commit edilmemiş geçici
   * klinikler için `null` olabilir — "Rotayı Sakla" o durumda DB'ye yazma yapamaz.
   */
  id: string | null;
  /** Google Places place_id (varsa) */
  place_id?: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  neighborhood?: string;
  phone?: string;
  rating?: number;
  user_ratings_total?: number;
  /** 'private' (özel klinik) veya 'kamu' (ADSM/devlet hastanesi) */
  segment: 'private' | 'kamu';
  /** Google Places `types` veya OSM `tags` özet */
  types?: string[];
}

interface RoutePlannerState {
  clinics: RouteClinic[];
  start: { lat: number; lng: number } | null;
  provinceSlug: string;
  districtSlug: string | null;
  repName: string;

  // Actions
  setClinics: (clinics: RouteClinic[]) => void;
  setStart: (start: { lat: number; lng: number } | null) => void;
  setMeta: (meta: { provinceSlug: string; districtSlug: string | null; repName: string }) => void;
  clear: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export const useRoutePlanner = create<RoutePlannerState>((set) => ({
  clinics: [],
  start: null,
  provinceSlug: '',
  districtSlug: null,
  repName: '',

  setClinics: (clinics) => set({ clinics }),
  setStart: (start) => set({ start }),
  setMeta: (meta) => set(meta),
  clear: () =>
    set({
      clinics: [],
      start: null,
      provinceSlug: '',
      districtSlug: null,
      repName: '',
    }),
}));
