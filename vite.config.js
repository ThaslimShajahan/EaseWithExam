import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Without this, `npm run dev` never registers a service worker at all
      // (vite-plugin-pwa only injects registration in production builds by
      // default) — navigator.serviceWorker.ready then has nothing to ever
      // resolve, which is exactly what caused the push-notification
      // "Finishing setup…" hang to be untestable/invisible in dev (Batch 15).
      devOptions: { enabled: true, type: 'module' },
      includeAssets: [
        'favicon.svg', 'favicon-32.png', 'robots.txt',
        'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
      ],
      manifest: {
        name: 'EaseWithExam',
        short_name: 'EWE',
        description: 'AI-powered NEET / JEE / CBSE prep — mock tests, Veda AI, spaced repetition',
        theme_color: '#21A375',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/dashboard',
        // 'any' and 'maskable' are deliberately separate entries. The old
        // single `purpose: 'any maskable'` told Android the transparent-corner
        // icon was safe to crop, so a circular/squircle mask cut into the
        // artwork. The maskable file bleeds its background to every edge and
        // insets the wordmark into the middle 80% safe zone instead.
        icons: [
          { src: '/icon-192.png',          sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png',          sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
    // Professional chunking: lower warning threshold to catch large bundles
    // early, and split vendor code per NPM package so heavy libraries are
    // isolated and only loaded when needed.
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id) return null;
          if (!id.includes('node_modules')) return null;

          // Keep some important bundles explicit for clarity/performance
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('@supabase') || id.includes('supabase-js')) return 'vendor-supabase';
          if (id.includes('firebase')) return 'vendor-firebase';
          if (id.includes('openai')) return 'vendor-openai';
          if (id.includes('framer-motion')) return 'vendor-motion';
          if (id.includes('@tanstack/react-query')) return 'vendor-query';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) return 'vendor-react';

          // Generic package-based chunking: use package name (scoped names preserved)
          const nm = id.split('node_modules/').pop();
          const parts = nm.split('/');
          let pkg = parts[0];
          if (pkg.startsWith('@') && parts.length > 1) pkg = `${pkg}/${parts[1]}`;
          const safeName = pkg.replace('@', '').replace('/', '-');
          return `vendor-${safeName}`;
        },
        plugins: [
          // Add the visualizer only when `ANALYZE=true` is set to avoid
          // generating reports on every CI/build. It writes `dist/bundle-stats.html`.
          process.env.ANALYZE === 'true' && visualizer({ filename: 'dist/bundle-stats.html', open: false }),
        ].filter(Boolean),
      },
    },
  },
});
