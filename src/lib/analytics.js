/**
 * Analytics — GA4, wired 2026-08-14 (owner's call).
 *
 * The gtag.js loader lives in index.html, not here, because that file is served
 * for every route and so guarantees the tag is present site-wide with no
 * dependency on React having mounted. What this module owns is the part a raw
 * gtag snippet gets WRONG in a single-page app: pageviews after the first one.
 *
 * WHY THE SNIPPET ALONE IS NOT ENOUGH
 * `gtag('config', ID)` sends one page_view when the script loads and nothing
 * afterwards. React Router changes the URL without a document load, so every
 * screen after the entry point is invisible. index.html therefore sets
 * send_page_view:false and this module sends every pageview itself — including
 * the first — so there is exactly one sender and no double count.
 *
 * Google Search Console is verified separately and needs nothing in the bundle.
 */

/** True once the gtag stub from index.html exists. It is defined synchronously
 *  by the inline script, well before React mounts, so this is really asking
 *  "was the tag left in the page?" — false in tests and in any build where the
 *  snippet was stripped, which is why every function below tolerates it. */
const hasGtag = () => typeof window !== 'undefined' && typeof window.gtag === 'function';

export const isAnalyticsEnabled = () => hasGtag();

/**
 * Records a pageview for a client-side route change.
 *
 * page_path is passed explicitly rather than letting GA read location: gtag
 * would otherwise report whatever the URL was when the event fired, and React
 * Router updates history before effects run, which is usually right but not
 * guaranteed for redirects. Passing the path the app believes it is on keeps
 * the report and the app in agreement.
 */
export function trackPageView(path) {
  if (!hasGtag()) return;
  window.gtag('event', 'page_view', {
    page_path:     path,
    page_location: window.location.href,
    page_title:    document.title,
  });
}

/** A named event. Thin wrapper so call sites never touch window.gtag directly
 *  and a vendor swap stays a one-file change. */
export function trackEvent(name, params = {}) {
  if (!hasGtag()) return;
  window.gtag('event', name, params);
}
