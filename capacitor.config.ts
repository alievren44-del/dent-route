import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.parla.saha',
  appName: 'Parla Saha',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Native APK bundled webDir'ı kullanır — offline çalışır.
    // Eğer remote URL kullanmak istersen yorum sat:
    //   url: 'https://saha.parladisdeposu.com',
    // (ama ağ gerektirir, saha şartlarında riskli)
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
  },
};

export default config;
