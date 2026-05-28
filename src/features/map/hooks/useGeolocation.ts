/**
 * useGeolocation — Browser Geolocation API hook.
 *
 * Permission state aware. `request()` çağrılana kadar prompt tetiklenmez.
 */

import { useCallback, useEffect, useState } from 'react';

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
  request: () => void;
}

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000,
};

export function useGeolocation(): GeolocationState {
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<GeolocationStatus>('idle');

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

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
        setStatus('granted');
        setError(null);
      },
      (err) => {
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
      },
      OPTIONS,
    );
  }, []);

  return { position, error, status, request };
}
