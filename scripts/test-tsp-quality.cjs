/* eslint-disable */
// TSP algoritma kalite testi:
//   1. 6-8 random nokta üret
//   2. Brute-force OPTIMAL bul (faktöriyel, n=7 → 5040 perm)
//   3. NN-greedy hesabı yap (uygulamadaki algoritma)
//   4. 2-opt iyileştir
//   5. Karşılaştır: NN vs NN+2-opt vs OPTIMAL
//
// Çalıştırma: node scripts/test-tsp-quality.cjs

'use strict';

function haversineKm(a, b) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function tourKm(start, points, order) {
  let total = 0;
  let prev = start;
  for (const i of order) {
    total += haversineKm(prev, points[i]);
    prev = points[i];
  }
  return total;
}

// NN-greedy (uygulamadaki tsp.ts ile aynı mantık)
function nearestNeighbor(start, points) {
  const remaining = points.map((_, i) => i);
  const order = [];
  let cur = start;
  while (remaining.length > 0) {
    let bestI = 0;
    let bestD = Infinity;
    for (let j = 0; j < remaining.length; j++) {
      const d = haversineKm(cur, points[remaining[j]]);
      if (d < bestD) {
        bestD = d;
        bestI = j;
      }
    }
    const next = remaining.splice(bestI, 1)[0];
    order.push(next);
    cur = points[next];
  }
  return order;
}

// 2-opt iyileştirme
function twoOpt(start, points, initialOrder) {
  let order = initialOrder.slice();
  let improved = true;
  let iter = 0;
  while (improved && iter < 100) {
    improved = false;
    iter++;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const newOrder = order.slice();
        // i..j reverse
        const segment = newOrder.slice(i, j + 1).reverse();
        newOrder.splice(i, segment.length, ...segment);
        if (tourKm(start, points, newOrder) < tourKm(start, points, order) - 1e-9) {
          order = newOrder;
          improved = true;
        }
      }
    }
  }
  return order;
}

// Brute-force TÜM permütasyonlar
function* permutations(arr) {
  if (arr.length <= 1) {
    yield arr;
    return;
  }
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    for (const sub of permutations(rest)) {
      yield [arr[i], ...sub];
    }
  }
}

function bruteForce(start, points) {
  let best = null;
  let bestKm = Infinity;
  const indices = points.map((_, i) => i);
  for (const perm of permutations(indices)) {
    const km = tourKm(start, points, perm);
    if (km < bestKm) {
      bestKm = km;
      best = perm.slice();
    }
  }
  return { order: best, km: bestKm };
}

// 5 senaryo test
const scenarios = [
  // Senaryo 1: Ankara Etimesgut/Çankaya yakın 6 nokta
  {
    name: 'Ankara 6 nokta (Etimesgut-Çankaya)',
    start: { lat: 39.9471, lng: 32.66 }, // Etimesgut centroid
    points: [
      { lat: 39.92, lng: 32.85 }, // Çankaya doğu
      { lat: 39.97, lng: 32.62 }, // Eryaman
      { lat: 39.93, lng: 32.71 }, // Şaşmaz
      { lat: 39.89, lng: 32.65 }, // Bağlıca
      { lat: 39.95, lng: 32.69 }, // Etimesgut güney
      { lat: 39.97, lng: 32.86 }, // Çankaya kuzey
    ],
  },
  // Senaryo 2: küçük 5 nokta yakın küme
  {
    name: 'Küçük 5 nokta',
    start: { lat: 39.95, lng: 32.85 },
    points: [
      { lat: 39.92, lng: 32.83 },
      { lat: 39.93, lng: 32.86 },
      { lat: 39.94, lng: 32.84 },
      { lat: 39.96, lng: 32.87 },
      { lat: 39.97, lng: 32.85 },
    ],
  },
  // Senaryo 3: 7 nokta dağınık
  {
    name: 'Dağınık 7 nokta',
    start: { lat: 39.9334, lng: 32.8597 }, // Ankara merkez
    points: [
      { lat: 39.85, lng: 32.55 },
      { lat: 40.02, lng: 32.93 },
      { lat: 39.79, lng: 32.78 },
      { lat: 39.98, lng: 32.66 },
      { lat: 39.92, lng: 32.83 },
      { lat: 40.05, lng: 32.7 },
      { lat: 39.88, lng: 32.95 },
    ],
  },
];

console.log('TSP Kalite Testi (NN + 2-opt vs Brute-force OPTIMAL)\n');
console.log('═'.repeat(80));

for (const sc of scenarios) {
  console.log(`\n📍 ${sc.name}`);
  console.log('─'.repeat(80));
  const n = sc.points.length;

  // Sepet sırası (input order) — baseline
  const baselineOrder = sc.points.map((_, i) => i);
  const baselineKm = tourKm(sc.start, sc.points, baselineOrder);

  // NN-greedy
  const nnOrder = nearestNeighbor(sc.start, sc.points);
  const nnKm = tourKm(sc.start, sc.points, nnOrder);

  // NN + 2-opt
  const nn2OptOrder = twoOpt(sc.start, sc.points, nnOrder);
  const nn2OptKm = tourKm(sc.start, sc.points, nn2OptOrder);

  // Brute-force optimum
  const t0 = Date.now();
  const opt = bruteForce(sc.start, sc.points);
  const bfMs = Date.now() - t0;

  const nnGap = ((nnKm - opt.km) / opt.km) * 100;
  const nn2Gap = ((nn2OptKm - opt.km) / opt.km) * 100;
  const baseGap = ((baselineKm - opt.km) / opt.km) * 100;

  console.log(`  Nokta sayısı: ${n}, brute-force ${bfMs}ms`);
  console.log(`  Sepet sırası   : ${baselineKm.toFixed(3)} km  (+%${baseGap.toFixed(1)} vs optimal)`);
  console.log(`  NN-greedy      : ${nnKm.toFixed(3)} km        (+%${nnGap.toFixed(1)} vs optimal)`);
  console.log(`  NN + 2-opt     : ${nn2OptKm.toFixed(3)} km    (+%${nn2Gap.toFixed(1)} vs optimal) ${nn2Gap < 0.01 ? '✓ OPTIMAL' : ''}`);
  console.log(`  Brute-force    : ${opt.km.toFixed(3)} km      (referans)`);
}

console.log('\n═'.repeat(80));
console.log('Yorum:');
console.log('  Sepet sırası: optimize EDILMEDIĞINDE ne kadar km — baseline');
console.log('  NN-greedy: hızlı ama %5-25 gap olabilir');
console.log('  NN+2-opt: çoğu zaman %0-2 gap (pratik optimal)');
console.log('  Brute-force: gerçek optimal (sadece n≤8 için tractable)');
