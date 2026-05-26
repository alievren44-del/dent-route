/**
 * Branding Applier
 *
 * Config'teki primaryColor ve accentColor değerlerini CSS variables'a yazar.
 * Tailwind config bu variables'tan okur (rgb format).
 */

import type { BrandingConfig } from './types';

/**
 * HEX rengi RGB tuple'a çevirir.
 * "#2563EB" → "37 99 235"
 */
function hexToRgbString(hex: string): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Branding değerlerini :root CSS variables'a uygular.
 * Uygulama mount'unda main.tsx tarafından çağrılır.
 */
export function applyBranding(branding: BrandingConfig): void {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', hexToRgbString(branding.primaryColor));
  root.style.setProperty('--color-accent', hexToRgbString(branding.accentColor));

  // Document title
  document.title = branding.name;

  // Theme color meta (mobile address bar)
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  themeMeta?.setAttribute('content', branding.primaryColor);
}
