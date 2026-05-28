export type DistrictSize = 'MEGA' | 'Büyük' | 'Orta' | 'Küçük' | 'ÇokKüçük';

export interface DistrictClassification {
  size: DistrictSize;
  minBatch: number;
  expectedMin: number;
  expectedMax: number;
  gridPointCount: number;
}

const THRESHOLDS: Array<{ min: number } & DistrictClassification> = [
  {
    min: 500_000,
    size: 'MEGA',
    minBatch: 16,
    expectedMin: 150,
    expectedMax: 400,
    gridPointCount: 35,
  },
  {
    min: 200_000,
    size: 'Büyük',
    minBatch: 8,
    expectedMin: 80,
    expectedMax: 180,
    gridPointCount: 25,
  },
  { min: 80_000, size: 'Orta', minBatch: 5, expectedMin: 30, expectedMax: 80, gridPointCount: 15 },
  { min: 20_000, size: 'Küçük', minBatch: 3, expectedMin: 10, expectedMax: 30, gridPointCount: 8 },
  { min: 0, size: 'ÇokKüçük', minBatch: 2, expectedMin: 0, expectedMax: 12, gridPointCount: 5 },
];

export function classifyDistrict(nufus: number): DistrictClassification {
  for (const t of THRESHOLDS) {
    if (nufus >= t.min) {
      return {
        size: t.size,
        minBatch: t.minBatch,
        expectedMin: t.expectedMin,
        expectedMax: t.expectedMax,
        gridPointCount: t.gridPointCount,
      };
    }
  }
  // Son threshold min=0 olduğu için yukarıdaki döngü her zaman match eder.
  throw new Error('unreachable: THRESHOLDS son elemanı min=0 olmalı');
}
