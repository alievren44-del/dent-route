import { type ReactNode } from 'react';
import { VerticalContext } from './verticalContextValue';
import type { VerticalConfig } from './types';

export interface VerticalProviderProps {
  vertical: VerticalConfig;
  children: ReactNode;
}

export function VerticalProvider({ vertical, children }: VerticalProviderProps) {
  return <VerticalContext.Provider value={vertical}>{children}</VerticalContext.Provider>;
}
