/**
 * Analytics hook — deliberately unwired.
 *
 * No vendor is connected yet (owner's call, 2026-08-11). This exists so that
 * connecting one later is a config change and a single init() body, rather than
 * a hunt for every place a pageview should fire.
 *
 * Google Search Console is already verified for the property and needs nothing
 * in the bundle — it reads the sitemap and the served HTML, not a script tag.
 * What is missing is *behaviour* data: which pages people land on, and whether
 * they stay. Until a vendor is chosen, trackPageView() is a no-op and costs
 * nothing at runtime.
 *
 * TO CONNECT GA4
 *   1. Set VITE_GA4_ID=G-XXXXXXXXXX in .env (and on the build machine).
 *   2. Fill in init() below with the gtag snippet.
 *   3. Gate it on the existing cookie-consent state in PlatformChrome — GA4
 *      sets cookies, and the banner already exists to cover exactly that.
 *
 * TO CONNECT PLAUSIBLE
 *   1. Set VITE_PLAUSIBLE_DOMAIN=www.easewithexam.com.
 *   2. Inject the script in init(). No consent gate needed — no cookies.
 */

export const ANALYTICS_ID =
  import.meta.env?.VITE_GA4_ID || import.meta.env?.VITE_PLAUSIBLE_DOMAIN || null;

export const isAnalyticsEnabled = () => Boolean(ANALYTICS_ID);

/** Loads the vendor script. No-op until one is configured. */
export function initAnalytics() {
  if (!isAnalyticsEnabled()) return;
  // Intentionally empty — see the header. Landing a vendor here without the
  // consent gate would ship tracking cookies ahead of the banner that discloses
  // them, so this stays a no-op until that is wired together.
}

/**
 * Records a pageview. Called from useSeo() so it fires on the same signal that
 * updates the canonical — one place that already knows a route changed.
 */
export function trackPageView(_path) {
  if (!isAnalyticsEnabled()) return;
}
