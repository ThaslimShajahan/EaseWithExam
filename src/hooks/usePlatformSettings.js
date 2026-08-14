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
  // The prefix on a student's "Bonus access" badge (ExpiryBadge.jsx) when they
  // have an active quota grant — e.g. swap it to "Independence Day Special" for
  // the duration of a named campaign. Only the label is editable; the day/hour
  // count after it is always computed by ExpiryBadge itself, never hand-typed
  // into this string — that is what keeps "3 days" vs "1 day" vs "4 hours"
  // correctly singular/plural without asking an admin to manage that in text.
  quota_grant_badge_label: 'Bonus access',
  // Landing page campaign section (LandingPage.jsx CampaignSection). Hidden
  // unless enabled AND a form URL is set — deliberately independent of
  // quota_overrides (per-student grants), see that component's own comment
  // for why the two must not share one signal.
  landing_campaign_enabled:     'false',
  landing_campaign_form_url:    '',
  landing_campaign_label:       '',
  // Two-column redesign, 2026-08-15. Both optional/additive — empty image
  // means CampaignSection renders full-width text only (no broken/empty
  // image box); empty description falls back to the section's own default
  // copy, same as an empty label already falls back to "Special campaign".
  landing_campaign_image_url:   '',
  landing_campaign_description: '',
  // GST/tax rate for the order-summary review step (OrderSummaryModal) and
  // the payment confirmation page. Deliberately empty by default — whether
  // the flat prices charged today are tax-inclusive, tax-exempt, or need a
  // separate line at all is still an open question (see
  // docs/ACTION_ITEMS_FOR_YOU.md's GST section), not something to guess a
  // number for. Empty means "no tax line shown", not "0% tax" — those are
  // different claims. The moment that question resolves, filling these in
  // here is the whole change; no code deploy needed.
  tax_rate_percent: '',
  tax_label:        'GST',
};

// Module-level cache — these rarely change, no need to refetch on every mount.
let cache = null;
// Components already mounted when a setting changes need telling; the cache
// alone would keep serving the old value to them for the rest of the session.
const subscribers = new Set();

/**
 * Drops the cache and re-renders every mounted consumer.
 *
 * Called by Admin > Platform > Settings after a save. Without it an admin who
 * uploaded a new avatar or logo saw no change anywhere in the app until a full
 * page reload — the upload had genuinely worked, it just wasn't observable.
 */
export function invalidatePlatformSettings() {
  cache = null;
  subscribers.forEach((fn) => fn());
}

export function usePlatformSettings() {
  const [settings, setSettings] = useState(cache ?? DEFAULTS);
  const [loaded,   setLoaded]   = useState(!!cache);
  const [nonce,    setNonce]    = useState(0);

  // Re-run the effect below when the cache is invalidated elsewhere.
  useEffect(() => {
    const bump = () => setNonce((n) => n + 1);
    subscribers.add(bump);
    return () => { subscribers.delete(bump); };
  }, []);

  useEffect(() => {
    if (cache) { setSettings(cache); setLoaded(true); return; }
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
    // `nonce` is the invalidation signal — without it in the deps this effect
    // would never re-run and the invalidate call above would do nothing.
  }, [nonce]);

  return { ...settings, loaded };
}
