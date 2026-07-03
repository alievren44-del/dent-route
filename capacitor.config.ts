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
    // Security (DEVICE-001): remote WebView debugging RELEASE'de KAPALI olmalı — açık
    // kalırsa USB/ADB ile WebView devtools açılıp localStorage'daki Supabase session
    // token'ı sızdırılabilir. Varsayılan KAPALI (release güvenli).
    // Yerel cihaz-testi/debug için: `CAP_WEBVIEW_DEBUG=true npx cap sync` ile aç.
    // (NODE_ENV `cap sync` sırasında güvenilir set edilmediğinden açık opt-in flag kullanılır.)
    webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === 'true',
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
      // style:'dark' = Style.Dark = light/white icons — kurumsal koyu-mavi şerit üzerinde okunur.
      // backgroundColor: Android 15 edge-to-edge'de statik config güvenilmez;
      //   runtime bootstrap (src/main.tsx) setBackgroundColor + setOverlaysWebView ile halleder.
      // overlaysWebView: CapacitorConfig plugin schema'sında geçerli key DEĞİL — sadece runtime'da set edilir.
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
