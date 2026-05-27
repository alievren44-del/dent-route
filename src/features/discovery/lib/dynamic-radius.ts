/**
 * dynamic-radius — Nüfusa göre tarama yarıçapı.
 *
 * Saha-rep tarama modu için. Büyük şehirde sokak başına klinik var → küçük
 * radius. Küçük ilçede klinikler dağınık → büyük radius.
 */

export function radiusForNufus(nufus: number): number {
  if (!Number.isFinite(nufus) || nufus <= 0) return 3000;
  if (nufus >= 500_000) return 1000; // MEGA — yoğun
  if (nufus >= 100_000) return 2000; // Büyük
  return 3000; // Orta/Küçük
}

export function describeRadius(radiusM: number): string {
  if (radiusM <= 1000) return 'Yoğun bölge — 1 km tarama';
  if (radiusM <= 2000) return 'Büyük ilçe — 2 km tarama';
  return 'Geniş ilçe — 3 km tarama';
}
