import { createContext } from 'react';
import type { VerticalConfig } from './types';

export const VerticalContext = createContext<VerticalConfig | null>(null);
