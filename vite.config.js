import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'EaseWithExam',
        short_name: 'EWE',
        description: 'AI-powered NEET / JEE / CBSE prep — mock tests, Veda AI, spaced repetition',
        theme_color: '#41A2B6',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/dashboard',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg}'],
        importScripts: ['/push-handler.js'],
        runtimeCaching: [
          {
            // Cache Supabase API responses for 2 minutes
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: { maxAgeSeconds: 120, maxEntries: 50 },
            },
          },
          {
            // Cache app shell indefinitely (versioned by build hash)
            urlPattern: /^https:\/\/.*\.(js|css|woff2?)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'static-assets', expiration: { maxAgeSeconds: 86400 } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
  server: {
    port: 5173,
    open: true,
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
  },
  optimizeDeps: {
    // pdfjs-dist ships only .mjs workers; keep it out of Vite's pre-bundle so the
    // CDN worker URL we set at runtime is the only one ever used (no local .mjs stub).
    exclude: ['pdfjs-dist'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
          'vendor-query':    ['@tanstack/react-query'],
          'vendor-firebase': ['firebase/app', 'firebase/auth'],
          'vendor-motion':   ['framer-motion'],
          'vendor-icons':    ['lucide-react'],
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-openai':   ['openai'],
          // pdfjs-dist is NOT in manualChunks — Rollup must not bundle its .mjs worker
          // as a local asset (server can't serve .mjs with correct MIME type).
          // pdfjs is loaded via dynamic import(); worker is served from jsDelivr CDN.
        },
      },
    },
  },
});
