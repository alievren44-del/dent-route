/**
 * Auth tipleri.
 *
 * Parla Supabase'ini paylaşıyoruz. Parla'nın `user_role` enum'u:
 *   ADMIN, DOCTOR, ASSISTANT, REP, PENDING, GUEST, WAREHOUSE, EDITOR
 *
 * Saha navigasyon sadece şu rolleri tanır:
 *   - REP        → sales_rep (saha temsilcisi)
 *   - ADMIN      → admin (tüm sisteme erişim)
 *   - (gelecek)  → MANAGER (henüz Parla'da yok, eklenince destekleriz)
 *
 * Diğer roller (DOCTOR, ASSISTANT, vb.) login engellenir.
 */

export type ParlaUserRole =
  | 'ADMIN'
  | 'DOCTOR'
  | 'ASSISTANT'
  | 'REP'
  | 'PENDING'
  | 'GUEST'
  | 'WAREHOUSE'
  | 'EDITOR';

export type SahaRole = 'sales_rep' | 'admin';

export interface SahaProfile {
  id: string;
  email: string | null;
  fullName: string | null;
  role: ParlaUserRole;
  region: string | null;
  avgFuelConsumption: number;
  kvkkAcceptedAt: string | null;
  kvkkVersion: string | null;
  isActive: boolean;
}

export interface AuthSession {
  userId: string;
  email: string | null;
  accessToken: string;
  expiresAt: number | null;
}

export interface AuthState {
  session: AuthSession | null;
  profile: SahaProfile | null;
  loading: boolean;
  error: string | null;
}

/**
 * Parla rolünü saha rolüne map'ler.
 * Saha-yetkili olmayan roller `null` döner — UI login engellemek için kullanır.
 */
export function mapParlaToSahaRole(role: ParlaUserRole | string | null | undefined): SahaRole | null {
  // Parla tarafında karma case var: 'REP' / 'rep' / 'sales_rep' / 'ADMIN' / 'admin'.
  // Saha defansif olarak hepsini kabul eder.
  if (!role) return null;
  const normalized = String(role).trim().toUpperCase();
  if (normalized === 'REP' || normalized === 'SALES_REP') return 'sales_rep';
  if (normalized === 'ADMIN') return 'admin';
  return null;
}
