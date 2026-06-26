/**
 * HeatmapPage — Admin ısı haritası.
 *
 * İki kaynaktan ısı noktası çizer:
 *  1. saha_visits.check_in_lat/lng  — GPS check-in koordinatları (son 90 gün)
 *  2. saha_reminders (status='done') — tamamlanan randevu/takip/tanıtımların
 *     bağlı kliniğinin saha_clinics.lat/lng koordinatları (son 90 gün)
 *
 * Circle katmanında (minzoom 12) tıklayınca /clinics/:id'ye yönlendirir.
 * Çakışan noktalar için mini popup listesi gösterilir.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { getEnv } from '@config/env';
import { getTypedClient, getSupabaseClient } from '@/lib/supabase';

// ── Tip tanımları ────────────────────────────────────────────────────────────

type VisitRow = {
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_at: string;
  account_id: string | null;
};

type ClinicInfo = { lat: number | null; lng: number | null; name: string | null };
type ReminderRow = {
  account_id: string | null;
  created_at: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // useNavigate hook must be called at component level (React rules).
  // navigateRef keeps it stable inside the effect closure without
  // re-running the entire effect when navigate identity changes.
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [pointCount, setPointCount] = useState<number | null>(null);
  const [capHit, setCapHit] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [35.2, 39.0],
      zoom: 6,
    });

    mapRef.current = map;

    map.on('load', () => {
      void (async () => {
        map.resize();
        try {
          const supabase = getTypedClient();
          const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

          // ── Source 1: GPS check-in noktaları (saha_visits) ──────────────
          const { data: visitData, error: visitError } = await supabase
            .from('saha_visits')
            .select('check_in_lat, check_in_lng, check_in_at, account_id')
            .not('check_in_lat', 'is', null)
            .not('check_in_lng', 'is', null)
            .gte('check_in_at', since90)
            .order('check_in_at', { ascending: false })
            .limit(10000);

          if (visitError) throw visitError;

          // ── Source 2: Tamamlanan hatırlatmalar (saha_reminders) ─────────
          // Malatya gibi yerlerde GPS check-in olmasa da randevu/tanıtım/takip
          // aktiviteleri "done" statüsüyle saha_reminders'da tutulur.
          // saha_reminders generated Database tiplerinde yok → untyped client (CalendarPage ile aynı pattern).
          const rawSb = getSupabaseClient();
          const { data: reminderData, error: reminderError } = await rawSb
            .from('saha_reminders')
            .select('account_id, created_at')
            .eq('status', 'done')
            .gte('created_at', since90)
            .limit(10000);

          if (reminderError) throw reminderError;

          const visits = (visitData ?? []) as VisitRow[];
          const reminders = (reminderData ?? []) as ReminderRow[];

          // ── Klinik koordinat/ad lookup (2-adım join) ────────────────────
          // saha_visits.account_id ve saha_reminders.account_id TEXT tipinde (uuid string);
          // saha_clinics ile PostgREST FK ilişkisi YOK → embed çalışmaz. Ayrı sorgu + JS map.
          const accountIds = Array.from(
            new Set(
              [...visits, ...reminders]
                .map((r) => r.account_id)
                .filter((id): id is string => !!id),
            ),
          );
          const clinicMap = new Map<string, ClinicInfo>();
          if (accountIds.length > 0) {
            const { data: clinicData, error: clinicError } = await supabase
              .from('saha_clinics')
              .select('id, lat, lng, name')
              .in('id', accountIds);
            if (clinicError) throw clinicError;
            for (const c of (clinicData ?? []) as Array<{ id: string } & ClinicInfo>) {
              clinicMap.set(c.id, { lat: c.lat, lng: c.lng, name: c.name });
            }
          }

          // Visit features — kendi GPS koordinatlarını kullanır; ad clinicMap'ten
          const visitFeatures = visits
            .filter(
              (v): v is VisitRow & { check_in_lat: number; check_in_lng: number } =>
                typeof v.check_in_lat === 'number' && typeof v.check_in_lng === 'number',
            )
            .map((v) => ({
              type: 'Feature' as const,
              properties: {
                intensity: 1,
                account_id: v.account_id ?? null,
                name: (v.account_id && clinicMap.get(v.account_id)?.name) || null,
                source: 'visit',
              },
              geometry: {
                type: 'Point' as const,
                coordinates: [v.check_in_lng, v.check_in_lat],
              },
            }));

          // Reminder features — klinik koordinatlarını clinicMap'ten alır (GPS yok)
          const reminderFeatures = reminders
            .map((r) => {
              const c = r.account_id ? clinicMap.get(r.account_id) : undefined;
              if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return null;
              return {
                type: 'Feature' as const,
                properties: {
                  intensity: 1,
                  account_id: r.account_id ?? null,
                  name: c.name ?? null,
                  source: 'reminder',
                },
                geometry: {
                  type: 'Point' as const,
                  coordinates: [c.lng, c.lat] as [number, number],
                },
              };
            })
            .filter((f): f is NonNullable<typeof f> => f !== null);

          const features = [...visitFeatures, ...reminderFeatures];

          setPointCount(features.length);
          setCapHit(visits.length >= 10000 || reminders.length >= 10000);

          if (!map.getSource('visits')) {
            map.addSource('visits', {
              type: 'geojson',
              data: {
                type: 'FeatureCollection',
                features,
              },
            });

            map.addLayer({
              id: 'visits-heat',
              type: 'heatmap',
              source: 'visits',
              paint: {
                'heatmap-weight': ['interpolate', ['linear'], ['get', 'intensity'], 0, 0, 1, 1],
                'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1, 15, 3],
                'heatmap-color': [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0,
                  'rgba(33,102,172,0)',
                  0.2,
                  'rgb(103,169,207)',
                  0.4,
                  'rgb(209,229,240)',
                  0.6,
                  'rgb(253,219,199)',
                  0.8,
                  'rgb(239,138,98)',
                  1,
                  'rgb(178,24,43)',
                ],
                'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 15, 40],
                'heatmap-opacity': 0.7,
              },
            });

            map.addLayer({
              id: 'visits-point',
              type: 'circle',
              source: 'visits',
              minzoom: 12,
              paint: {
                'circle-radius': 4,
                'circle-color': 'rgb(178,24,43)',
                'circle-stroke-color': 'white',
                'circle-stroke-width': 1,
                'circle-opacity': 0.8,
              },
            });
          }

          // ── Hover cursor ─────────────────────────────────────────────────
          map.on('mouseenter', 'visits-point', () => {
            map.getCanvas().style.cursor = 'pointer';
          });
          map.on('mouseleave', 'visits-point', () => {
            map.getCanvas().style.cursor = '';
          });

          // ── Tıklama → klinik kartı yönlendirmesi ────────────────────────
          // Sadece circle katmanı (minzoom 12) tıklamalarını yakalar.
          // Zoom < 12'de ısı haritası görünür ama tıklama çalışmaz (Mapbox sınırı).
          //
          // queryRenderedFeatures ile aynı pikseldeki TÜM üst üste gelen noktalar
          // alınır. Tek klinik → doğrudan navigate. Çoklu klinik → popup listesi.
          let activePopup: mapboxgl.Popup | null = null;

          map.on('click', 'visits-point', (e) => {
            // Close existing popup
            if (activePopup) {
              activePopup.remove();
              activePopup = null;
            }

            // Tıklanan pikseldeki tüm circle feature'larını al
            const clicked = map.queryRenderedFeatures(e.point, { layers: ['visits-point'] });
            const seen = new Set<string>();
            const clinics: Array<{ id: string; name: string }> = [];

            for (const f of clicked) {
              const id = (f.properties?.account_id as string | null) ?? null;
              const name = (f.properties?.name as string | null) ?? 'Klinik';
              if (id && !seen.has(id)) {
                seen.add(id);
                clinics.push({ id, name });
              }
            }

            if (clinics.length === 0) return;

            if (clinics.length === 1) {
              // Tek klinik — doğrudan yönlendir
              navigateRef.current('/clinics/' + clinics[0]!.id);
              return;
            }

            // Çoklu klinik — popup listesi
            const html = `
              <div style="font-size:13px;max-height:200px;overflow-y:auto;min-width:160px;padding:4px 0;">
                <p style="font-weight:600;margin:0 0 6px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">
                  ${clinics.length} klinik
                </p>
                ${clinics
                  .map(
                    (c) =>
                      `<button
                        data-id="${c.id}"
                        style="display:block;width:100%;text-align:left;padding:5px 0;background:none;border:none;border-bottom:1px solid #f1f5f9;cursor:pointer;color:#0f172a;font-size:13px;line-height:1.4;"
                       >${c.name}</button>`,
                  )
                  .join('')}
              </div>`;

            const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: '260px' })
              .setLngLat(e.lngLat)
              .setHTML(html)
              .addTo(map);

            activePopup = popup;

            // Popup içi click delegation — navigate'i doğrudan çağırır
            popup.getElement()?.addEventListener('click', (evt) => {
              const btn = (evt.target as HTMLElement).closest('[data-id]');
              if (!btn) return;
              const id = btn.getAttribute('data-id');
              popup.remove();
              activePopup = null;
              if (id) navigateRef.current('/clinics/' + id);
            });
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Veri yüklenemedi.';
          setErrorMsg(msg);
        }
      })();
    });

    // Container 0x0 init olabilir — ResizeObserver ile takip et
    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(containerRef.current);

    const t1 = setTimeout(() => map.resize(), 100);
    const t2 = setTimeout(() => map.resize(), 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: 'calc(100dvh - 4rem - 5rem)', minHeight: '400px' }}
    >
      <div className="pointer-events-none absolute left-3 top-3 z-10">
        <div className="pointer-events-auto rounded-lg bg-white/90 px-3 py-2 shadow-md backdrop-blur">
          <h1 className="text-sm font-semibold text-slate-800">Ziyaret Isı Haritası</h1>
          <p className="text-xs text-slate-500">
            {pointCount === null
              ? 'Yükleniyor...'
              : `${pointCount.toLocaleString('tr-TR')} aktivite noktası`}
          </p>
          {capHit && (
            <p className="text-xs text-amber-600">Son 10.000 kayıt gösteriliyor</p>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 max-w-[90%]">
          <div className="pointer-events-auto rounded-lg bg-red-600 px-4 py-2 text-center text-sm text-white shadow-md">
            {errorMsg}
          </div>
        </div>
      )}
    </div>
  );
}
