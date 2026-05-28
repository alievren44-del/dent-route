export interface DiscoveryCandidate {
  source: 'saha' | 'google_places';
  externalId?: string;
  name: string;
  lat: number;
  lng: number;
  phone?: string;
  address?: string;
  types?: string[];
  rating?: number;
  customerId?: string;
}

export interface DedupedCandidate extends DiscoveryCandidate {
  sources: string[];
  mergedFrom: DiscoveryCandidate[];
}

export function normalizePhone(phone: string | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D+/g, '');
  if (digits.length === 0) return '';
  return digits.slice(-10);
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9À-ſ\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const m = a.length;
  const n = b.length;
  let prev: number[] = new Array(n + 1);
  let curr: number[] = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }

  return prev[n]!;
}

interface Cluster {
  primary: DiscoveryCandidate;
  members: DiscoveryCandidate[];
}

function candidatesMatch(a: DiscoveryCandidate, b: DiscoveryCandidate): boolean {
  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  if (phoneA && phoneB && phoneA === phoneB) return true;

  const distance = haversineMeters(a.lat, a.lng, b.lat, b.lng);
  if (distance <= 50) return true;

  if (distance <= 200) {
    const nameA = normalizeName(a.name);
    const nameB = normalizeName(b.name);
    if (nameA.length > 0 && nameB.length > 0) {
      const dist = levenshtein(nameA, nameB);
      if (dist <= 3) return true;
    }
  }

  return false;
}

function clusterMatches(cluster: Cluster, candidate: DiscoveryCandidate): boolean {
  for (const member of cluster.members) {
    if (candidatesMatch(member, candidate)) return true;
  }
  return false;
}

function pickLongest(values: Array<string | undefined>): string | undefined {
  let best: string | undefined;
  for (const v of values) {
    if (!v) continue;
    if (best === undefined || v.length > best.length) best = v;
  }
  return best;
}

function mergeCluster(cluster: Cluster): DedupedCandidate {
  const members = cluster.members;
  const primary = cluster.primary;

  const sourcesSet = new Set<string>();
  for (const m of members) sourcesSet.add(m.source);

  const sahaMember = members.find((m) => m.source === 'saha');
  const customerId = sahaMember?.customerId ?? primary.customerId;

  let bestRating: number | undefined;
  for (const m of members) {
    if (typeof m.rating === 'number') {
      if (bestRating === undefined || m.rating > bestRating) bestRating = m.rating;
    }
  }

  const address = pickLongest(members.map((m) => m.address));

  const phone = pickLongest(members.map((m) => m.phone));

  const typesSet = new Set<string>();
  for (const m of members) {
    if (m.types) {
      for (const t of m.types) typesSet.add(t);
    }
  }
  const types = typesSet.size > 0 ? Array.from(typesSet) : undefined;

  const externalId = primary.externalId ?? members.find((m) => m.externalId)?.externalId;

  return {
    source: primary.source,
    externalId,
    name: primary.name,
    lat: primary.lat,
    lng: primary.lng,
    phone,
    address,
    types,
    rating: bestRating,
    customerId,
    sources: Array.from(sourcesSet),
    mergedFrom: members.slice(),
  };
}

export function dedupCandidates(candidates: DiscoveryCandidate[]): DedupedCandidate[] {
  const clusters: Cluster[] = [];

  for (const candidate of candidates) {
    let matched: Cluster | undefined;
    for (const cluster of clusters) {
      if (clusterMatches(cluster, candidate)) {
        matched = cluster;
        break;
      }
    }
    if (matched) {
      matched.members.push(candidate);
    } else {
      clusters.push({ primary: candidate, members: [candidate] });
    }
  }

  return clusters.map(mergeCluster);
}
