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
  estimateTotalCost,
  runTrSeed,
  type SeedProgress,
} from '@features/admin/lib/tr-seed';

export default function TrSeedPage() {
  const [progress, setProgress] = useState<SeedProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [tierFilter, setTierFilter] = useState<'all' | 'large' | 'mid'>('all');
  const [skipFreshDays, setSkipFreshDays] = useState(30);
  const [skipClinicThreshold, setSkipClinicThreshold] = useState(50);

  const filteredList = useMemo(() => {
    if (tierFilter === 'all') return TR_SEED_LIST;
    return TR_SEED_LIST.filter((c) => c.tier === tierFilter);
  }, [tierFilter]);

  const cost = useMemo(() => estimateTotalCost(filteredList), [filteredList]);

  const handleRun = async () => {
    if (
      !window.confirm(
        `${filteredList.length} ilçe tarayacak. Tahmini maliyet: $${cost.totalCostUsd.toFixed(0)} (~${(cost.totalCostUsd * 39).toFixed(0)} TL).\n\nDevam et?`,
      )
    ) {
      return;
    }
    setRunning(true);
    try {
      const result = await runTrSeed(
        {
          tier: tierFilter === 'all' ? undefined : tierFilter,
          skipFreshDays,
          skipIfClinicCount: skipClinicThreshold,
        },
        (p) => setProgress({ ...p }),
      );
      toast.success(
        `✓ ${result.done} ilçe işlendi · ${result.newClinics} yeni klinik · ~$${result.estimatedCost.toFixed(0)} harcandı`,
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
          Türkiye'nin stratejik 77 büyük ilçesini Google Places ile detaylı tara. Plasiyer
          rotalarında "yol üstü" klinikler hazır olur, free credit boyutunda kullanılır.
        </p>
      </header>

      {/* Tier filter */}
      <section className="rounded-xl bg-white p-3 shadow-sm">
        <h2 className="mb-2 text-xs font-semibold uppercase text-slate-600">Tier filtresi</h2>
        <div className="grid grid-cols-3 gap-1.5">
          {(['all', 'large', 'mid'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTierFilter(t)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
                tierFilter === t
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              {t === 'all' && `Tümü (${TR_SEED_LIST.length})`}
              {t === 'large' && `Large 500k+ (${TR_SEED_LIST.filter((c) => c.tier === 'large').length})`}
              {t === 'mid' && `Mid 200-500k (${TR_SEED_LIST.filter((c) => c.tier === 'mid').length})`}
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
              onChange={(e) =>
                setSkipClinicThreshold(Number.parseInt(e.target.value) || 50)
              }
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
          Free credit $200/ay + senin $120 credit = $320 toplam bütçe. Skip kuralları %20-40
          tasarruf sağlar.
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
            <Sparkles size={16} /> {filteredList.length} ilçeyi tara
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
              <div className="font-bold text-slate-700">
                ${progress.estimatedCost.toFixed(2)}
              </div>
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
          <li>• Standard intensity = grid /2 (Çankaya kalitesi)</li>
          <li>• Per-city skip: yakın zamanda tarandı + zaten klinik var → skip</li>
          <li>• 1.5sn rate limit delay</li>
          <li>• Sonraki 11 ay free credit ($200/ay) ile organik plasiyer scan yeterli</li>
        </ul>
      </section>
    </div>
  );
}
