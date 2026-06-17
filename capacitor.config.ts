import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.parla.saha',
  appName: 'Parla CRM',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // LOCAL TEST: bundled dist (https://localhost secure context → geolocation çalışır).
    // Canlı/remote'a dönmek için aşağıdaki url satırının yorumunu kaldır + cap sync.
    // url: 'https://saha.parladisdeposu.com',
    cleartext: false,
    // Deep-link/OAuth callback için izinli host'lar (CapacitorHttp bypass):
    allowNavigation: [
      'saha.parladisdeposu.com',
      '*.parladisdeposu.com',
      'rranpzicmhgfupgabgbi.supabase.co',
      'api.mapbox.com',
      'maps.googleapis.com',
    ],
  },
  android: {
    backgroundColor: '#1F4E78',
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#1F4E78',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#1F4E78',
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    // OTA: web-bundle uzaktan güncelleme (kontrol src/ota/checkUpdate.ts)
    CapacitorUpdater: {
      autoUpdate: false,
      resetWhenUpdate: true,
    },
  },
};

export default config;
