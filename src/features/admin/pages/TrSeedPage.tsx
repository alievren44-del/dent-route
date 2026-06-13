/**
 * TrSeedPage — Türkiye'nin 77 stratejik ilçesini tek seferde tara.
 *
 * URL: /admin/tr-seed
 * Yetki: ADMIN
 *
 * Strateji: 27 large (500k+) + 50 mid (top 200-500k). Standard intensity.
 * Tahmini maliyet: $200 (free credit $200 + extra credit $120 budget içinde).
 */

import { useMemo, useState } from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  SkipForward,
  TrendingUp,
  DollarSign,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  TR_SEED_LIST,
  buildFullSeedList,
  estimateTotalCost,
  estimateCallsForCity,
  runTrSeed,
  type SeedCity,
  type SeedProgress,
} from '@features/admin/lib/tr-seed';
import provincesRaw from '@/data/tr-locations/provinces.json';

type TierFilter = 'all' | 'large' | 'mid' | 'small';

/** Türkçe-duyarlı normalize — il adı/slug eşleştirme için */
function normTr(s: string): string {
  return s
    .toLowerCase()
    .replaceAll('ı', 'i')
    .replaceAll('ş', 's')
    .replaceAll('ğ', 'g')
    .replaceAll('ü', 'u')
    .replaceAll('ö', 'o')
    .replaceAll('ç', 'c')
    .replace(/\s+/g, '')
    .trim();
}

// Kullanıcı "ankara, istanbul" yazınca → slug çöz (ad veya slug eşleşir)
const PROVINCE_SLUG_LOOKUP = new Map<string, string>();
for (const p of provincesRaw as Array<{ ad: string; slug: string }>) {
  PROVINCE_SLUG_LOOKUP.set(normTr(p.ad), p.slug);
  PROVINCE_SLUG_LOOKUP.set(normTr(p.slug), p.slug);
}

function parsePriorityProvinces(input: string): string[] {
  const out: string[] = [];
  for (const token of input.split(',')) {
    const slug = PROVINCE_SLUG_LOOKUP.get(normTr(token));
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

export default function TrSeedPage() {
  const [progress, setProgress] = useState<SeedProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<'seed77' | 'full'>('full');
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [intensity, setIntensity] = useState<'standard' | 'deep'>('standard');
  const [priorityInput, setPriorityInput] = useState('');
  const [monthlyCap, setMonthlyCap] = useState(4500);
  const [skipFreshDays, setSkipFreshDays] = useState(30);
  const [skipClinicThreshold, setSkipClinicThreshold] = useState(50);

  const priorityProvinces = useMemo(() => parsePriorityProvinces(priorityInput), [priorityInput]);

  // Mode'a göre temel liste (öncelik illeri önce sıralanmış)
  const baseList = useMemo<SeedCity[]>(
    () => (mode === 'full' ? buildFullSeedList(priorityProvinces, intensity) : TR_SEED_LIST),
    [mode, priorityProvinces, intensity],
  );

  const filteredList = useMemo(
    () => (tierFilter === 'all' ? baseList : baseList.filter((c) => c.tier === tierFilter)),
    [baseList, tierFilter],
  );

  const cost = useMemo(() => estimateTotalCost(filteredList), [filteredList]);

  // Bu run'da tavan altında kaç ilçe işlenir (kabaca — skip hariç)
  const districtsThisRun = useMemo(() => {
    let calls = 0;
    let n = 0;
    for (const c of filteredList) {
      const next = calls + estimateCallsForCity(c);
      if (next > monthlyCap) break;
      calls = next;
      n += 1;
    }
    return { n, calls };
  }, [filteredList, monthlyCap]);

  const handleRun = async () => {
    const capNote =
      mode === 'full'
        ? `\n\nBu ay ücretsiz tavan (~${monthlyCap} call) altında ~${districtsThisRun.n} ilçe taranacak, kalan sonraki aya kalır.`
        : '';
    if (
      !window.confirm(
        `${filteredList.length} ilçe kuyrukta. Tahmini bu run: ~${districtsThisRun.n} ilçe / ~$${(districtsThisRun.calls * 0.032).toFixed(0)}.${capNote}\n\nDevam et?`,
      )
    ) {
      return;
    }
    setRunning(true);
    try {
      const result = await runTrSeed(
        {
          list: baseList,
          tier: tierFilter === 'all' ? undefined : tierFilter,
          monthlyCallCap: mode === 'full' ? monthlyCap : undefined,
          skipFreshDays,
          skipIfClinicCount: skipClinicThreshold,
        },
        (p) => setProgress({ ...p }),
      );
      const capped = result.results.some((r) => r.error === 'monthly_cap_reached');
      toast.success(
        `✓ ${result.done} ilçe işlendi · ${result.newClinics} yeni klinik · ~$${result.estimatedCost.toFixed(0)} harcandı${capped ? ' · aylık tavan doldu, kalan sonraki aya' : ''}`,
      );
    } catch (e) {
      toast.error(`Seed hatası: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4">
      <header className="rounded-xl bg-gradient-to-br from-indigo-600 to-purple-700 p-4 text-white">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Globe size={22} /> TR Seed Tarama
        </h1>
        <p className="mt-1 text-xs opacity-90">
          Tüm Türkiye'yi (973 ilçe) clinic-scan-v3 source:'all' ile doldur. Aylık ücretsiz Google
          tavanına tempolu — her ay ~{districtsThisRun.n} ilçe, cep $0. Plasiyer bölgeleri önce.
        </p>
      </header>

      {/* Mode toggle */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase text-slate-600">Kapsam</h2>
        <div className="grid grid-cols-2 gap-1.5">
          {(
            [
              { key: 'full', label: `Tüm Türkiye (973 ilçe)` },
              { key: 'seed77', label: `Stratejik 77` },
            ] as const
          ).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                mode === key
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'full' && (
          <div className="mt-3 space-y-2">
            <label className="block text-xs">
              <span className="text-slate-600">
                Öncelikli iller (önce taransın) — virgülle ayır
              </span>
              <input
                type="text"
                value={priorityInput}
                onChange={(e) => setPriorityInput(e.target.value)}
                placeholder="örn: ankara, istanbul, izmir"
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
              {priorityInput.trim().length > 0 && (
                <span className="mt-0.5 block text-[10px] text-emerald-700">
                  {priorityProvinces.length} il tanındı: {priorityProvinces.join(', ') || '—'}
                </span>
              )}
            </label>
            <div className="text-xs">
              <span className="text-slate-600">Tarama derinliği</span>
              <div className="mt-1 grid grid-cols-2 gap-1.5">
                {(
                  [
                    { key: 'standard', label: 'Standard (~55 call/ilçe)' },
                    { key: 'deep', label: 'Derinlemesine (~100 call/ilçe)' },
                  ] as const
                ).map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIntensity(key)}
                    className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition ${
                      intensity === key
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-xs">
              <span className="text-slate-600">
                Aylık ücretsiz Google tavanı (call) — Pro ~5000/ay, güvenli 4500
              </span>
              <input
                type="number"
                min={100}
                max={50_000}
                step={100}
                value={monthlyCap}
                onChange={(e) => setMonthlyCap(Number.parseInt(e.target.value) || 4500)}
                className="mt-1 w-full rounded border border-slate-200 px-2 py-1.5 text-sm"
              />
              <span className="mt-0.5 block text-[10px] text-slate-500">
                Bu run'da ~{districtsThisRun.n} ilçe (~{districtsThisRun.calls} call) işlenir, tavan
                dolunca durur.
              </span>
            </label>
          </div>
        )}
      </section>

      {/* Tier filter */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase text-slate-600">Tier filtresi</h2>
        <div className="grid grid-cols-4 gap-1.5">
          {(['all', 'large', 'mid', 'small'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTierFilter(t)}
              className={`rounded-lg border px-2 py-2 text-[11px] font-medium transition ${
                tierFilter === t
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {t === 'all' && `Tümü (${baseList.length})`}
              {t === 'large' && `500k+ (${baseList.filter((c) => c.tier === 'large').length})`}
              {t === 'mid' && `80-500k (${baseList.filter((c) => c.tier === 'mid').length})`}
              {t === 'small' && `<80k (${baseList.filter((c) => c.tier === 'small').length})`}
            </button>
          ))}
        </div>
      </section>

      {/* Skip guards */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase text-slate-600">Skip kuralları</h2>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            <span className="text-slate-600">Son N gün taranmışsa skip</span>
            <input
              type="number"
              min={1}
              max={365}
              value={skipFreshDays}
              onChange={(e) => setSkipFreshDays(Number.parseInt(e.target.value) || 30)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-slate-600">Min klinik eşiği</span>
            <input
              type="number"
              min={0}
              max={500}
              value={skipClinicThreshold}
              onChange={(e) => setSkipClinicThreshold(Number.parseInt(e.target.value) || 50)}
              className="mt-1 w-full rounded border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        </div>
        <p className="mt-1.5 text-[10px] text-slate-500">
          Bu sayıdan fazla klinik varsa VE son {skipFreshDays}gün taranmışsa skip.
        </p>
      </section>

      {/* Cost summary */}
      <section className="rounded-xl bg-amber-50 border border-amber-200 p-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase text-amber-900">
          <DollarSign size={14} /> Tahmini maliyet
        </h2>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] text-amber-800">Toplam call</div>
            <div className="text-base font-bold text-amber-900">
              {cost.totalCalls.toLocaleString('tr-TR')}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-amber-800">USD</div>
            <div className="text-base font-bold text-amber-900">
              ${cost.totalCostUsd.toFixed(0)}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-amber-800">TL</div>
            <div className="text-base font-bold text-amber-900">
              ~{(cost.totalCostUsd * 39).toFixed(0)}
            </div>
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-amber-700">
          ⚠️ Google $200/ay credit Mart 2025'te kalktı. Yeni: SKU-başına aylık ücretsiz tavan (Pro
          Nearby ~5000/ay). Tüm-Türkiye modu bu tavana tempolar → ayda ~{districtsThisRun.n} ilçe,
          cep $0. ~10 ayda 973 ilçe biter.
        </p>
      </section>

      {/* Run button */}
      <button
        type="button"
        onClick={() => void handleRun()}
        disabled={running}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-700 px-4 text-sm font-semibold text-white shadow-md disabled:opacity-60"
      >
        {running ? (
          <>
            <Loader2 size={16} className="animate-spin" /> Taranıyor…
          </>
        ) : (
          <>
            <Sparkles size={16} />{' '}
            {mode === 'full'
              ? `Bu ay ~${districtsThisRun.n} ilçeyi tara`
              : `${filteredList.length} ilçeyi tara`}
          </>
        )}
      </button>

      {/* Progress */}
      {progress && (
        <section className="rounded-xl bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold uppercase text-slate-700">
              İlerleme: {progress.done}/{progress.total}
            </h2>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              +{progress.newClinics} klinik
            </span>
          </div>
          {progress.currentCity && (
            <div className="mt-1 text-xs text-slate-600">
              <Loader2 size={10} className="inline animate-spin mr-1" />
              <strong>{progress.currentCity.district}</strong> / {progress.currentCity.province}{' '}
              taranıyor…
            </div>
          )}
          <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-2 text-center text-[10px]">
            <div>
              <div className="text-slate-500">Tahmin</div>
              <div className="font-bold text-slate-700">${progress.estimatedCost.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-slate-500">Hata</div>
              <div className="font-bold text-rose-700">{progress.failed}</div>
            </div>
            <div>
              <div className="text-slate-500">Toplam taranan</div>
              <div className="font-bold text-slate-700">
                {progress.totalScanned.toLocaleString('tr-TR')}
              </div>
            </div>
          </div>

          {/* Results list */}
          <div className="mt-2 max-h-60 overflow-y-auto rounded border border-slate-200 bg-slate-50">
            {progress.results.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 px-2 py-1 text-[10px] border-b border-slate-100 last:border-0"
              >
                {r.status === 'ok' && (
                  <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                )}
                {r.status === 'fail' && (
                  <AlertTriangle size={12} className="text-rose-600 shrink-0" />
                )}
                {r.status === 'skipped' && (
                  <SkipForward size={12} className="text-slate-400 shrink-0" />
                )}
                <span className="font-medium text-slate-800">{r.district}</span>
                <span className="text-slate-500">/ {r.province}</span>
                {r.newCount !== undefined && r.newCount > 0 && (
                  <span className="ml-auto text-emerald-700 font-semibold">+{r.newCount}</span>
                )}
                {r.error && (
                  <span className="ml-auto text-rose-700 truncate">{r.error.slice(0, 30)}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Strategy info */}
      <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
        <h3 className="flex items-center gap-1.5 font-semibold text-slate-700">
          <TrendingUp size={12} /> Strateji
        </h3>
        <ul className="mt-1 space-y-0.5 text-slate-600">
          <li>• source:'all' = DoktorTakvimi + Google Places + OSM (birleşik, dedup içinde)</li>
          <li>• Öncelikli iller önce → plasiyer bölgesi anında dolar</li>
          <li>• Aylık tavan dolunca otomatik durur → her ay "Devam" ile kaldığı yerden</li>
          <li>• Skip: yakın zamanda tarandı + zaten klinik var → call harcamaz</li>
          <li>• Standard intensity = grid /2 (Çankaya kalitesi), 1.5sn rate limit delay</li>
        </ul>
      </section>
    </div>
  );
}
