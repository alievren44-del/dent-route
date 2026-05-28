/**
 * RouteCorridorClinicsPage — Tek rotanın klinik detay sayfası.
 *
 * URL: /rota/koridor/klinikler  (state-passed: route + candidates + a/b)
 *   - Üstte rota özet kartı (km/dk/via şehir)
 *   - Tablo: sıra / ad / detour / segment / aksiyon (+/− WhatsApp telefon)
 *   - Footer: Hepsini sepete + WhatsApp paylaş + Google Maps + Atama + PDF
 */

import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Phone,
  MessageCircle,
  ShoppingCart,
  CheckCircle2,
  ExternalLink,
  Users,
  Printer,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  useRouteBasket,
  MAX_BASKET,
  type BasketStop,
} from '@features/routes/store/routeBasketStore';
import { buildGoogleMapsRouteUrl, buildWaWhatsappMessage } from '@core/routing/exporters';
import { AssignRouteModal } from '@features/routes/components/AssignRouteModal';
import { useAuthStore } from '@core/auth/authStore';

interface RouteSummary {
  km: number;
  durationMin: number;
  viaCity?: string | null;
  provider: 'mapbox' | 'google';
}

interface RouteCandidate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  phone: string | null;
  clinic_segment?: 'private' | 'kamu';
  province_slug?: string | null;
  district_slug?: string | null;
  detourKm: number;
  detourMin: number;
}

interface LocationState {
  route: RouteSummary;
  candidates: RouteCandidate[];
  a: { lat: number; lng: number; name?: string } | null;
  b: { lat: number; lng: number; name?: string } | null;
  routeName?: string;
}

export default function RouteCorridorClinicsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? null) as LocationState | null;
  const profile = useAuthStore((s) => s.profile);

  const [assignOpen, setAssignOpen] = useState(false);
  const basketAdd = useRouteBasket((s) => s.add);
  const basketItems = useRouteBasket((s) => s.items);

  if (!state || !state.route) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-slate-600">Rota verisi bulunamadı. Geri dönüp tekrar deneyin.</p>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
        >
          <ArrowLeft size={14} /> Geri
        </button>
      </div>
    );
  }

  const { route, candidates, a, b, routeName } = state;
  const basketIds = useMemo(() => new Set(basketItems.map((x) => x.id)), [basketItems]);

  const addOne = (c: RouteCandidate) => {
    const stop: Omit<BasketStop, 'addedAt'> = {
      id: c.id,
      name: c.name,
      lat: c.lat,
      lng: c.lng,
      source: 'saha',
      address: c.address ?? undefined,
      phone: c.phone ?? undefined,
    };
    const res = basketAdd(stop);
    if (res.ok) toast.success(`${c.name} sepete eklendi`);
    else if (res.reason === 'duplicate') toast.info('Zaten sepette');
    else toast.error(`Sepet dolu (max ${MAX_BASKET})`);
  };

  const addAll = () => {
    let added = 0;
    let dup = 0;
    let full = 0;
    for (const c of candidates) {
      const res = basketAdd({
        id: c.id,
        name: c.name,
        lat: c.lat,
        lng: c.lng,
        source: 'saha',
        address: c.address ?? undefined,
        phone: c.phone ?? undefined,
      });
      if (res.ok) added++;
      else if (res.reason === 'duplicate') dup++;
      else full++;
    }
    toast.success(`${added} eklendi · ${dup} zaten vardı · ${full} sepet doluydu`);
    if (added > 0) navigate('/routes/plan');
  };

  const buildSharePayload = () => {
    const stops = candidates.map((c) => ({
      lat: c.lat,
      lng: c.lng,
      name: c.name,
    }));
    const stopsWithEnds = [
      ...(a ? [{ lat: a.lat, lng: a.lng, name: a.name ?? 'Başlangıç' }] : []),
      ...stops,
      ...(b ? [{ lat: b.lat, lng: b.lng, name: b.name ?? 'Varış' }] : []),
    ];
    return stopsWithEnds;
  };

  const handleWhatsapp = () => {
    const url = buildGoogleMapsRouteUrl(buildSharePayload());
    const repName = profile?.fullName ?? 'Plasiyer';
    const msg = buildWaWhatsappMessage({
      repName,
      routeName: routeName ?? 'Yeni rota',
      origin: a?.name ?? 'Başlangıç',
      destination: b?.name ?? 'Varış',
      km: route.km,
      durationMin: route.durationMin,
      clinics: candidates.map((c) => ({ name: c.name, district: c.district_slug ?? null })),
      mapsUrl: url,
    });
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleGoogleMaps = () => {
    const url = buildGoogleMapsRouteUrl(buildSharePayload());
    window.open(url, '_blank');
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-4 pb-32">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 rounded-full hover:bg-slate-100"
          aria-label="Geri"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold truncate">Yol Üstü Klinikler</h1>
          <p className="text-xs text-slate-500">{candidates.length} klinik</p>
        </div>
      </header>

      <section className="rounded-xl bg-blue-50 p-3 text-sm">
        <div className="font-semibold text-blue-900">
          {route.durationMin} dk · {route.km.toFixed(1)} km
        </div>
        {route.viaCity && <div className="text-xs text-blue-700">{route.viaCity} üzerinden</div>}
        <div className="text-[10px] text-blue-600 mt-0.5">
          Provider: {route.provider === 'google' ? 'Google Maps' : 'Mapbox'}
        </div>
      </section>

      <ul className="space-y-2">
        {candidates.map((c, i) => {
          const inBasket = basketIds.has(c.id);
          return (
            <li key={c.id} className="flex items-start gap-2 rounded-lg bg-white p-3 shadow-sm">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold truncate">{c.name}</span>
                  {c.clinic_segment === 'kamu' && (
                    <span className="rounded bg-purple-100 px-1 py-0.5 text-[9px] text-purple-700">
                      KAMU
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs">
                  <span className="font-medium text-amber-700">
                    +{c.detourKm.toFixed(1)} km / +{Math.round(c.detourMin)} dk
                  </span>
                  {c.address && (
                    <span className="ml-1.5 text-slate-500 truncate">· {c.address}</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.phone && (
                    <>
                      <a
                        href={`tel:${c.phone}`}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
                      >
                        <Phone size={10} /> Ara
                      </a>
                      <a
                        href={`https://wa.me/${c.phone.replace(/\D+/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded border border-green-200 bg-green-50 px-1.5 py-0.5 text-[10px] text-green-700 hover:bg-green-100"
                      >
                        <MessageCircle size={10} /> WhatsApp
                      </a>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => addOne(c)}
                    disabled={inBasket}
                    className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                      inBasket
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    }`}
                  >
                    {inBasket ? (
                      <>
                        <CheckCircle2 size={10} /> Sepette
                      </>
                    ) : (
                      <>
                        <ShoppingCart size={10} /> Sepete
                      </>
                    )}
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Sticky aksiyon barı */}
      <div className="fixed bottom-0 inset-x-0 z-20 border-t border-slate-200 bg-white p-3 shadow-lg">
        <div className="mx-auto max-w-3xl grid grid-cols-2 sm:grid-cols-5 gap-2">
          <button
            type="button"
            onClick={addAll}
            className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
          >
            <ShoppingCart size={14} /> Hepsini sepete
          </button>
          <button
            type="button"
            onClick={handleWhatsapp}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
          >
            <MessageCircle size={14} /> WhatsApp
          </button>
          <button
            type="button"
            onClick={handleGoogleMaps}
            className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            <ExternalLink size={14} /> Maps
          </button>
          <button
            type="button"
            onClick={() => setAssignOpen(true)}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Users size={14} /> Ata
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer size={14} /> PDF
          </button>
        </div>
      </div>

      <AssignRouteModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        payload={{
          account_ids: candidates.map((c) => c.id),
          total_distance_km: route.km,
          total_duration_min: route.durationMin,
          name: routeName ?? (route.viaCity ? `${route.viaCity} üzerinden` : 'Yol üstü rota'),
        }}
      />
    </div>
  );
}
