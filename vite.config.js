/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'service-worker.ts',
            injectRegister: 'auto',
            devOptions: {
                enabled: false, // dev'de PWA kapalı (debugger karışmasın)
                type: 'module',
            },
            manifest: false, // public/manifest.json kullanıyoruz
            injectManifest: {
                // SW'in cache edeceği dosyalar (build sonrası)
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@core': path.resolve(__dirname, './src/core'),
            '@features': path.resolve(__dirname, './src/features'),
            '@components': path.resolve(__dirname, './src/components'),
            '@lib': path.resolve(__dirname, './src/lib'),
            '@config': path.resolve(__dirname, './src/config'),
            '@verticals': path.resolve(__dirname, './verticals'),
        },
    },
    build: {
        target: 'es2022',
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: {
                    'vendor-react': ['react', 'react-dom', 'react-router-dom'],
                    'vendor-supabase': ['@supabase/supabase-js'],
                    'vendor-query': [
                        '@tanstack/react-query',
                        '@tanstack/react-query-persist-client',
                        '@tanstack/query-async-storage-persister',
                    ],
                    'vendor-mapbox': ['mapbox-gl'],
                    'vendor-utils': ['date-fns', 'zod', 'zustand'],
                },
            },
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
        coverage: {
            reporter: ['text', 'html'],
            include: ['src/**/*.{ts,tsx}'],
            exclude: ['src/**/*.d.ts', 'src/**/*.test.{ts,tsx}', 'src/main.tsx'],
        },
    },
});
