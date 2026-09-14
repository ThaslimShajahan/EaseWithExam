/**
 * Meta (Facebook/Instagram) Pixel — ad campaign conversion tracking, wired
 * 2026-09-14 for easewithexam.com.
 *
 * Lives here rather than as a raw <script> in index.html because index.html
 * is static and Vite does not run its import.meta.env substitution on plain
 * inline scripts there — see index.html's own GA4 snippet, which is
 * unconditional and fires in dev too. import.meta.env.PROD only gives a real,
 * dead-code-eliminated guarantee inside a JS module (same mechanism as
 * src/lib/aiProxy.js and src/firebase/config.js), so the base code, the
 * loader, and every event call all live in this file and go through PROD.
 */

const PIXEL_ID = '1578642539786990';

/** True once fbq has been installed by initMetaPixel(). Mirrors
 *  analytics.js's hasGtag() — every tracking call below tolerates this being
 *  false (dev, tests, or a build where init never ran). */
const hasFbq = () => typeof window !== 'undefined' && typeof window.fbq === 'function';

/**
 * Installs the Pixel and fires the base PageView. Call once at app boot.
 * No-ops outside a production build — import.meta.env.PROD resolves to a
 * static `false` in dev, so this entire body is stripped from the dev bundle.
 */
export function initMetaPixel() {
  if (!import.meta.env.PROD) return;
  if (hasFbq()) return; // StrictMode/HMR re-entry guard

  /* eslint-disable */
  !function(f,b,e,v,n,t,s)
  {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};
  if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
  n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];
  s.parentNode.insertBefore(t,s)}(window, document,'script',
  'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */

  window.fbq('init', PIXEL_ID);
  window.fbq('track', 'PageView');
}

/** A named Pixel event (InitiateCheckout, Purchase, ...). Thin wrapper so
 *  call sites never touch window.fbq directly. */
export function trackPixelEvent(name, params = {}) {
  if (!hasFbq()) return;
  window.fbq('track', name, params);
}
