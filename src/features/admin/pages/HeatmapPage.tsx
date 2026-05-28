/**
 * HeatmapPage — Admin ısı haritası.
 *
 * saha_visits.check_in_lat/lng noktalarını Mapbox heatmap layer'da gösterir.
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { getEnv } from '@config/env';
import { getSupabaseClient } from '@/lib/supabase';

export default function HeatmapPage() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const [pointCount, setPointCount] = useState<number | null>(null);
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

    map.on('load', async () => {
      map.resize();
      try {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase
          .from('saha_visits')
          .select('check_in_lat, check_in_lng, check_in_at')
          .not('check_in_lat', 'is', null)
          .not('check_in_lng', 'is', null);

        if (error) throw error;

        const rows = (data ?? []) as Array<{
          check_in_lat: number | null;
          check_in_lng: number | null;
          check_in_at: string;
        }>;
        const features = rows
          .filter(
            (v): v is { check_in_lat: number; check_in_lng: number; check_in_at: string } =>
              typeof v.check_in_lat === 'number' &&
              typeof v.check_in_lng === 'number',
          )
          .map((v) => ({
            type: 'Feature' as const,
            properties: { intensity: 1 },
            geometry: {
              type: 'Point' as const,
              coordinates: [v.check_in_lng, v.check_in_lat],
            },
          }));

        setPointCount(features.length);

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
              'heatmap-weight': [
                'interpolate',
                ['linear'],
                ['get', 'intensity'],
                0,
                0,
                1,
                1,
              ],
              'heatmap-intensity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                1,
                15,
                3,
              ],
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
              'heatmap-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                0,
                10,
                15,
                40,
              ],
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
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Veri yüklenemedi.';
        setErrorMsg(msg);
      }
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
          <h1 className="text-sm font-semibold text-slate-800">
            Ziyaret Isı Haritası
          </h1>
          <p className="text-xs text-slate-500">
            {pointCount === null
              ? 'Yükleniyor...'
              : `${pointCount.toLocaleString('tr-TR')} ziyaret noktası`}
          </p>
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
