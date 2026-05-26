/**
 * MapPage — Saha rep ana harita ekranı.
 *
 * Mapbox GL container + konum bulma butonu + vertical-aware başlık.
 */

import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

import { useGeolocation } from '../hooks/useGeolocation';
import { useVertical } from '@core/verticals/useVertical';
import { getEnv } from '@config/env';

export default function MapPage() {
  const vertical = useVertical();
  const geolocation = useGeolocation();

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = getEnv().MAPBOX_PUBLIC_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [35.2, 39.0],
      zoom: 5,
    });

    map.on('load', () => {
      setMapReady(true);
      map.resize();
    });

    mapRef.current = map;

    // Container 0x0 init olabilir — ResizeObserver ile takip et
    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(containerRef.current);

    // İlk render sonrası bir kez daha resize (Mapbox'ın bilinen pattern'i)
    const t1 = setTimeout(() => map.resize(), 100);
    const t2 = setTimeout(() => map.resize(), 500);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const pos = geolocation.position;
    if (!map || !pos || !mapReady) return;

    const lngLat: [number, number] = [pos.lng, pos.lat];

    if (markerRef.current) {
      markerRef.current.setLngLat(lngLat);
    } else {
      markerRef.current = new mapboxgl.Marker({ color: '#2563eb' })
        .setLngLat(lngLat)
        .addTo(map);
    }

    map.flyTo({ center: lngLat, zoom: 14, essential: true });
  }, [geolocation.position, mapReady]);

  const isPrompting = geolocation.status === 'prompting';
  const isDenied = geolocation.status === 'denied';

  return (
    <div
      ref={containerRef}
      className="relative w-full"
      style={{ height: 'calc(100dvh - 4rem - 5rem)', minHeight: '400px' }}
    >

      <div className="pointer-events-none absolute right-3 top-3 z-10">
        <div className="pointer-events-auto rounded-lg bg-white/90 px-3 py-2 shadow-md backdrop-blur">
          <h1 className="text-sm font-semibold text-foreground">
            {vertical.labels.discovery}
          </h1>
        </div>
      </div>

      {isPrompting && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2">
          <div className="pointer-events-auto rounded-lg bg-black/70 px-4 py-2 text-sm text-white shadow-md">
            Konum alınıyor…
          </div>
        </div>
      )}

      {isDenied && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 max-w-[90%]">
          <div className="pointer-events-auto rounded-lg bg-red-600 px-4 py-2 text-center text-sm text-white shadow-md">
            Tarayıcı ayarlarından konum izni ver
          </div>
        </div>
      )}

      <div className="absolute bottom-4 right-3 z-10">
        <button
          type="button"
          onClick={() => geolocation.request()}
          disabled={isPrompting}
          className="min-h-tap-min h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-lg hover:bg-blue-700 disabled:opacity-60"
        >
          {isPrompting ? 'Aranıyor…' : 'Konumumu Bul'}
        </button>
      </div>
    </div>
  );
}
