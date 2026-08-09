import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const DEFAULTS = {
  platform_name:          'EaseWithExam',
  platform_tagline:       'AI-powered prep for NEET, JEE, CBSE, Class 8–12, UPSC & more — mock tests, EWE doubt clearing, and deep analytics.',
  platform_logo_url:      '',
  // Optional face for the EWE persona in chat. Empty = fall back to the brand
  // logo (see components/ui/VedaAvatar.jsx).
  ewe_avatar_url:         '',
  cookie_banner_enabled:  'false',
  cookie_banner_text:     'We use cookies to improve your experience. By continuing, you agree to our use of cookies.',
};

// Module-level cache — these rarely change, no need to refetch on every mount.
let cache = null;

export function usePlatformSettings() {
  const [settings, setSettings] = useState(cache ?? DEFAULTS);
  const [loaded,   setLoaded]   = useState(!!cache);

  useEffect(() => {
    if (cache) return;
    supabase
      .from('platform_settings')
      .select('key, value')
      .in('key', Object.keys(DEFAULTS))
      .then(({ data }) => {
        const merged = { ...DEFAULTS };
        (data ?? []).forEach((row) => { if (row.value) merged[row.key] = row.value; });
        cache = merged;
        setSettings(merged);
        setLoaded(true);
      });
  }, []);

  return { ...settings, loaded };
}
