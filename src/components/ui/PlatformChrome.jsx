import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';
import { isSeoManagedPage } from '../../lib/seo';

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

  if (!loaded || dismissed || cookie_banner_enabled !== 'true') return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[1000] bg-slate-900 text-white px-4 py-3.5 flex flex-col sm:flex-row items-center gap-3 shadow-2xl">
      <p className="text-xs sm:text-sm text-slate-200 flex-1">
        {cookie_banner_text}{' '}
        <a href="/privacy" className="underline text-primary-300 hover:text-primary-200 font-semibold">
          Read our Privacy &amp; Cookie Policy
        </a>
      </p>
      <button
        onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); }}
        className="shrink-0 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold transition-colors"
      >
        Accept
      </button>
    </div>
  );
}
