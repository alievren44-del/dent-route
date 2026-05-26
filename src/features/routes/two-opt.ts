export interface Waypoint {
  lat: number;
  lng: number;
}

export interface TwoOptResult {
  order: number[];
  initialDistanceM: number;
  optimizedDistanceM: number;
  savedM: number;
  iterations: number;
}

export interface TwoOptOptions {
  maxIterations?: number;
  startFixed?: boolean;
  endFixed?: boolean;
}

const EARTH_RADIUS_M = 6371000;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

export function haversineMeters(a: Waypoint, b: Waypoint): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_M * c;
}

export function tourDistance(points: Waypoint[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineMeters(points[i]!, points[i + 1]!);
  }
  return total;
}

function distanceForOrder(waypoints: Waypoint[], order: number[]): number {
  let total = 0;
  for (let i = 0; i < order.length - 1; i++) {
    total += haversineMeters(waypoints[order[i]!]!, waypoints[order[i + 1]!]!);
  }
  return total;
}

function reverseSegment(order: number[], i: number, j: number): void {
  let lo = i;
  let hi = j;
  while (lo < hi) {
    const tmp = order[lo]!;
    order[lo] = order[hi]!;
    order[hi] = tmp;
    lo++;
    hi--;
  }
}

export function twoOpt(
  waypoints: Waypoint[],
  options?: TwoOptOptions,
): TwoOptResult {
  const maxIterations = options?.maxIterations ?? 50;
  const startFixed = options?.startFixed ?? true;
  const endFixed = options?.endFixed ?? false;

  const n = waypoints.length;
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);

  if (n < 3) {
    const d = distanceForOrder(waypoints, order);
    return {
      order,
      initialDistanceM: d,
      optimizedDistanceM: d,
      savedM: 0,
      iterations: 0,
    };
  }

  const initialDistanceM = distanceForOrder(waypoints, order);

  const iStart = startFixed ? 1 : 0;
  const jEnd = endFixed ? n - 2 : n - 1;

  let iterations = 0;
  let improved = true;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations++;

    outer: for (let i = iStart; i <= n - 2; i++) {
      for (let j = i + 1; j <= jEnd; j++) {
        if (j - i < 1) continue;

        const aIdx = order[i - 1]!;
        const bIdx = order[i]!;
        const cIdx = order[j]!;
        const dIdx = j + 1 < n ? order[j + 1]! : -1;

        const a = waypoints[aIdx]!;
        const b = waypoints[bIdx]!;
        const c = waypoints[cIdx]!;

        let removed = haversineMeters(a, b);
        let added = haversineMeters(a, c);

        if (dIdx !== -1) {
          const d = waypoints[dIdx]!;
          removed += haversineMeters(c, d);
          added += haversineMeters(b, d);
        }

        if (added + 1e-9 < removed) {
          reverseSegment(order, i, j);
          improved = true;
          break outer;
        }
      }
    }
  }

  const optimizedDistanceM = distanceForOrder(waypoints, order);
  const savedM = initialDistanceM - optimizedDistanceM;

  return {
    order,
    initialDistanceM,
    optimizedDistanceM,
    savedM: savedM > 0 ? savedM : 0,
    iterations,
  };
}
