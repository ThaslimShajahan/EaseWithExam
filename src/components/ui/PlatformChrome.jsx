import { useEffect, useState } from 'react';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';

const DISMISS_KEY = 'ewe_cookie_consent_v1';

/**
 * Mounted once at the app root. Applies admin-configured platform settings
 * that have no other natural home: the browser tab title, and the cookie
 * consent banner (Admin > Platform Settings).
 */
export default function PlatformChrome() {
  const { platform_name, cookie_banner_enabled, cookie_banner_text, loaded } = usePlatformSettings();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    if (loaded && platform_name) document.title = platform_name;
  }, [loaded, platform_name]);

  if (!loaded || dismissed || cookie_banner_enabled !== 'true') return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[1000] bg-slate-900 text-white px-4 py-3.5 flex flex-col sm:flex-row items-center gap-3 shadow-2xl">
      <p className="text-xs sm:text-sm text-slate-200 flex-1">{cookie_banner_text}</p>
      <button
        onClick={() => { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); }}
        className="shrink-0 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold transition-colors"
      >
        Accept
      </button>
    </div>
  );
}
