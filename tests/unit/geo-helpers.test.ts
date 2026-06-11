/**
 * geo-helpers — normalizeRegionSlug birim testleri
 *
 * Türkçe karakter normalize, boşluk/tire, idempotency, boş string,
 * compound district key ('il|ilçe') testleri.
 */

import { describe, it, expect } from 'vitest';
import { normalizeRegionSlug, slugify } from '@/data/tr-locations/geo-helpers';

describe('normalizeRegionSlug', () => {
  // Türkçe karakter dönüşümleri
  it('İstanbul → istanbul', () => {
    expect(normalizeRegionSlug('İstanbul')).toBe('istanbul');
  });

  it('Çankaya → cankaya', () => {
    expect(normalizeRegionSlug('Çankaya')).toBe('cankaya');
  });

  it('Şişli → sisli', () => {
    expect(normalizeRegionSlug('Şişli')).toBe('sisli');
  });

  it('DİYARBAKIR → diyarbakir', () => {
    expect(normalizeRegionSlug('DİYARBAKIR')).toBe('diyarbakir');
  });

  it('Ğ/ğ → g', () => {
    expect(normalizeRegionSlug('Ğ')).toBe('g');
    expect(normalizeRegionSlug('ğ')).toBe('g');
  });

  it('Ü/ü → u', () => {
    expect(normalizeRegionSlug('Üsküdar')).toBe('uskudar');
  });

  it('Ö/ö → o', () => {
    expect(normalizeRegionSlug('Özgür')).toBe('ozgur');
  });

  // Boşluk/tire normalizasyonu
  it('boşluk → tire', () => {
    expect(normalizeRegionSlug('İzmir Konak')).toBe('izmir-konak');
  });

  it('birden fazla boşluk → tek tire', () => {
    expect(normalizeRegionSlug('  Ankara  ')).toBe('ankara');
  });

  it('tire korunur (zaten slug)', () => {
    expect(normalizeRegionSlug('izmir-konak')).toBe('izmir-konak');
  });

  // Idempotency: normalizeRegionSlug(normalizeRegionSlug(x)) === normalizeRegionSlug(x)
  it('idempotent — Türkçe şehir', () => {
    const once = normalizeRegionSlug('İstanbul');
    expect(normalizeRegionSlug(once)).toBe(once);
  });

  it('idempotent — Çankaya', () => {
    const once = normalizeRegionSlug('Çankaya');
    expect(normalizeRegionSlug(once)).toBe(once);
  });

  it('idempotent — zaten slug', () => {
    const once = normalizeRegionSlug('diyarbakir');
    expect(normalizeRegionSlug(once)).toBe(once);
  });

  // Boş string
  it('boş string → boş string', () => {
    expect(normalizeRegionSlug('')).toBe('');
  });

  // Compound district key: '<il>|<ilçe>' — pipe korunur
  it('compound key — Ankara|Çankaya → ankara|cankaya', () => {
    expect(normalizeRegionSlug('Ankara|Çankaya')).toBe('ankara|cankaya');
  });

  it('compound key — İstanbul|Şişli → istanbul|sisli', () => {
    expect(normalizeRegionSlug('İstanbul|Şişli')).toBe('istanbul|sisli');
  });

  it('compound key idempotent', () => {
    const once = normalizeRegionSlug('Ankara|Çankaya');
    expect(normalizeRegionSlug(once)).toBe(once);
  });

  it('compound key — zaten normalize → değişmez', () => {
    expect(normalizeRegionSlug('ankara|cankaya')).toBe('ankara|cankaya');
  });

  // slugify ile uyum: normalizeRegionSlug(x) === slugify(x) (pipe olmayan değerler için)
  it('normalizeRegionSlug simple === slugify', () => {
    const inputs = ['İstanbul', 'Çankaya', 'Şişli', 'DİYARBAKIR', 'Üsküdar', 'Ğ'];
    for (const inp of inputs) {
      expect(normalizeRegionSlug(inp)).toBe(slugify(inp));
    }
  });
});
