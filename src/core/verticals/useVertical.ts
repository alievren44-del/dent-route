/**
 * useVertical — Aktif vertical config'e erişim hook'u.
 *
 * Provider dışında çağrılırsa hata fırlatır.
 */

import { useContext } from 'react';
import { VerticalContext } from './verticalContextValue';
import type { VerticalConfig } from './types';

export function useVertical(): VerticalConfig {
  const ctx = useContext(VerticalContext);
  if (!ctx) {
    throw new Error('useVertical must be used within a VerticalProvider');
  }
  return ctx;
}
