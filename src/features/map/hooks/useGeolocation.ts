/**
 * useGeolocation — Browser Geolocation API hook.
 *
 * Permission state aware. `request()` çağrılana kadar prompt tetiklenmez.
 *
 * #56 fix: getCurrentPosition tek seferlik snapshot alıyordu → rep yürürken
 * konum bayatlıyor, mesafe/check-in doğrulaması eski koordinatla yapılıyordu.
 * Artık watchPosition ile sürekli takip yapılabilir. Aktif rota sırasında
 * `watch=true` ile maximumAge:0 (taze konum zorunlu), idle ekranlarda
 * maximumAge:60000 (cache'e izin → pil tasarrufu).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface GeolocationPosition {
  lat: number;
  lng: number;
  accuracy: number;
}

export type GeolocationStatus = 'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable';

export interface GeolocationState {
  position: GeolocationPosition | null;
  error: string | null;
  status: GeolocationStatus;
  /** Tek seferlik konum okuması (getCurrentPosition). */
  request: () => void;
  /**
   * Sürekli konum takibi başlatır (watchPosition). Aktif rota sırasında çağrılır.
   * `fresh=true` ise maximumAge:0 — cache yok, her tick taze GPS.
   */
  startWatching: (fresh?: boolean) => void;
  /** Aktif takibi durdurur (clearWatch). Rota bitince / ekrandan çıkınca çağrılır. */
  stopWatching: () => void;
}

// Tek seferlik okuma seçenekleri (idle): cache'e izin → hızlı + pil dostu.
const ONESHOT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000,
};

export function useGeolocation(): GeolocationState {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GeolocationStatus>('idle');

  // Aktif watch id — cleanup'ta clearWatch için saklanır (null = takip yok).
  const watchIdRef = useRef<number | null>(null);

  // Hata kodlarını ortak işleme — getCurrentPosition + watchPosition aynı mantığı paylaşır.
  const handleError = useCallback((err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      setStatus('denied');
      setError('Konum izni reddedildi.');
    } else if (err.code === err.POSITION_UNAVAILABLE) {
      setStatus('unavailable');
      setError('Konum bilgisi şu anda alınamıyor.');
    } else if (err.code === err.TIMEOUT) {
      setStatus('idle');
      setError('Konum alma işlemi zaman aşımına uğradı.');
    } else {
      setStatus('idle');
      setError(err.message || 'Bilinmeyen konum hatası.');
    }
  }, []);

  const handleSuccess = useCallback((pos: globalThis.GeolocationPosition) => {
    setPosition({
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
    });
    setStatus('granted');
    setError(null);
  }, []);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setError('Tarayıcınız konum servisini desteklemiyor.');
    }
  }, []);

  const request = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setStatus('unavailable');
      setError('Tarayıcınız konum servisini desteklemiyor.');
      return;
    }

    setStatus('prompting');
    setError(null);

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, ONESHOT_OPTIONS);
  }, [handleSuccess, handleError]);

  const stopWatching = useCallback(() => {
    if (watchIdRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatching = useCallback(
    (fresh = true) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setStatus('unavailable');
        setError('Tarayıcınız konum servisini desteklemiyor.');
        return;
      }

      // Önceki watch'ı temizle (çift abonelik / pil sızıntısı önlemi).
      stopWatching();

      setStatus('prompting');
      setError(null);

      // Aktif rota: fresh=true → maximumAge:0 (bayat konum engellenir).
      // Idle: fresh=false → 60sn cache (mesafe doğrulaması için yeterli, pil dostu).
      const watchOptions: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: fresh ? 0 : 60000,
      };

      watchIdRef.current = navigator.geolocation.watchPosition(
        handleSuccess,
        handleError,
        watchOptions,
      );
    },
    [handleSuccess, handleError, stopWatching],
  );

  // Unmount'ta aktif takip varsa temizle — sızıntı önlemi.
  useEffect(() => {
    return () => {
      stopWatching();
    };
  }, [stopWatching]);

  return { position, error, status, request, startWatching, stopWatching };
}
