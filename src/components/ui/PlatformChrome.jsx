import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';
import { isSeoManagedPage } from '../../lib/seo';

// Brand green — Tailwind primary-600 (tailwind.config.js), "THE action
// color". Same value already used for the web <meta name="theme-color">
// (index.html) and the PWA manifest's theme_color (vite.config.js); this is
// the native app's status bar picking up that same, already-declared intent
// rather than defaulting to Android's plain grey (no @capacitor/status-bar
// plugin was installed at all until now).
const BRAND_COLOR = '#21A375';

// NativeAuthScreen's dark hero background (also its capacitor.config.json
// splash-screen color) — a flat green bar looked like a hard seam against
// it, so this one screen gets its own status bar treatment instead.
const AUTH_SCREEN_COLOR = '#0f172a';

const DISMISS_KEY = 'ewe_cookie_consent_v1';

/**
 * Mounted once at the app root. Applies admin-configured platform settings
 * that have no other natural home: the browser tab title, and the cookie
 * consent banner (Admin > Platform Settings).
 */
export default function PlatformChrome() {
  const { platform_name, cookie_banner_enabled, cookie_banner_text, loaded } = usePlatformSettings();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');
  const { pathname } = useLocation();

  // The public pages own their own <title> via useSeo() — each one is a tuned,
  // keyword-led string, and Google indexes the RENDERED title. This effect used
  // to run unconditionally and overwrite whatever was there with the bare
  // platform name, so every public page rendered as "EaseWithExam" and the
  // titles in index.html and seo.js never survived to be indexed.
  //
  // isSeoManagedPage() reads a marker the mounted page sets, rather than testing
  // pathname against PAGE_SEO: the 404 matches no fixed path, so a lookup would
  // miss it and clobber its title once settings finish loading.
  //
  // Inside the app the rename is still the point: an admin who sets a custom
  // platform_name expects the tab to say so.
  useEffect(() => {
    if (!loaded || !platform_name) return;
    if (isSeoManagedPage()) return;
    document.title = platform_name;
  }, [loaded, platform_name, pathname]);

  // Native status bar (the OS bar with clock/battery, not any web content) —
  // Android defaults it to plain grey with no plugin installed at all, which
  // is the "grey toolbar" gap this fixes. Screen-aware, not a single static
  // color: the sign-in screen (App.jsx's root route, native + '/' — the only
  // way pathname settles on '/' on native is RequireNoAuth showing
  // NativeAuthScreen, since an authenticated visit redirects away from '/'
  // immediately) has a dark hero, everywhere else is the light app chrome.
  // Style.Light (white icons/text) reads fine on both backgrounds — the
  // brand green isn't light enough for dark icons either — so only the
  // background color needs to change per screen, not the icon style.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const isAuthScreen = pathname === '/';
    (async () => {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setBackgroundColor({ color: isAuthScreen ? AUTH_SCREEN_COLOR : BRAND_COLOR });
      await StatusBar.setStyle({ style: Style.Light });
    })();
  }, [pathname]);

  // No cookie-consent banner inside the native app — it's a web/browser-
  // cookies concept, meaningless for a WebView loading local bundled assets,
  // and its /privacy/ link is a web-site page, not a real in-app route.
  if (Capacitor.isNativePlatform()) return null;
  if (!loaded || dismissed || cookie_banner_enabled !== 'true') return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[1000] bg-slate-900 text-white px-4 py-3.5 flex flex-col sm:flex-row items-center gap-3 shadow-2xl">
      <p className="text-xs sm:text-sm text-slate-200 flex-1">
        {cookie_banner_text}{' '}
        <a href="/privacy/" className="underline text-primary-300 hover:text-primary-200 font-semibold">
          Read our Privacy &amp; Cookie Policy
        </a>
      </p>
      <button
        onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); }}
        className="shrink-0 px-4 py-3.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold transition-colors"
      >
        Accept
      </button>
    </div>
  );
}
