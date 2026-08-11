/**
 * Per-route SEO metadata for the public (unauthenticated) pages.
 *
 * WHY A HOOK AND NOT react-helmet-async
 *   Five public routes need five titles, descriptions and canonicals. Helmet
 *   brings a provider, a context and a dependency for what is ~60 lines here,
 *   and the codebase already leans on small local hooks. If the public surface
 *   ever grows past a handful of static routes, revisit.
 *
 * WHAT THIS FIXES
 *   index.html ships ONE canonical, hardcoded to the homepage. Every route
 *   serves that same file, so /about, /contact, /privacy and /terms each told
 *   Google "I am a duplicate of /" — while sitemap.xml simultaneously listed
 *   them as distinct URLs worth indexing. The canonical wins that argument, so
 *   four of the five public pages were asking to be dropped from the index.
 *
 * WHAT THIS DOES NOT FIX
 *   This runs in the browser. Crawlers that execute JS (Google, mostly) see the
 *   corrected tags; crawlers that do not (Bing's first pass, and every social
 *   scraper — WhatsApp, LinkedIn, Slack, X) still read the static index.html.
 *   Getting the right tags into the served HTML needs prerendering, which is
 *   Tier 2 work. Until then index.html's static tags stay tuned for the
 *   homepage, because that is the URL that actually gets shared.
 */
import { useEffect } from 'react';
import { trackPageView } from './analytics';

export const SITE_URL = 'https://www.easewithexam.com';

/** Absolute URL for a path, with no trailing slash except at the root. */
export const absUrl = (path = '/') =>
  path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Titles stay under ~60 characters so Google does not truncate them, and each
 * leads with the distinctive term rather than the brand — "EaseWithExam" is not
 * what anyone searches for yet.
 *
 * Descriptions stay under ~155 characters.
 *
 * Board coverage is stated as "CBSE & Kerala State" throughout, NOT "all state
 * boards". SUPPORTED_SYLLABI in landingContent.js is the source of truth and
 * lists exactly CBSE, Kerala State, NEET UG, JEE Main and JEE Advanced. The
 * landing page's "nothing invented" rule applies to metadata too — an
 * overclaiming description earns a bounce, and bounces are a ranking signal.
 */
export const PAGE_SEO = {
  '/': {
    title: 'NEET, JEE & CBSE Exam Prep with an AI Tutor | EaseWithExam',
    description:
      'AI exam preparation for NEET, JEE, CBSE and Kerala State board students in India. Unlimited practice, real exam-pattern mock tests, and a tutor that explains.',
  },
  '/about': {
    title: 'About EaseWithExam — AI Exam Prep Built for Indian Students',
    description:
      'An AI exam-preparation platform for NEET, JEE, CBSE and Kerala State board students, built around real exam patterns and marking schemes. Operated by Acenzos.',
  },
  '/contact': {
    title: 'Contact EaseWithExam — Support for NEET, JEE & Board Prep',
    description:
      'Get in touch with the EaseWithExam team about NEET, JEE, CBSE or Kerala State board exam preparation, subscriptions, or support.',
  },
  '/privacy': {
    title: 'Privacy & Cookie Policy | EaseWithExam',
    description:
      'How EaseWithExam collects, uses and protects student data, and how cookies are used across the platform.',
  },
  '/terms': {
    title: 'Terms of Service | EaseWithExam',
    description:
      'The terms governing use of EaseWithExam, including accounts, subscriptions, acceptable use and content ownership.',
  },
  // Not in the sitemap and noindexed below — a 404 that competes for search
  // traffic is worse than no 404 at all.
  '/404': {
    title: 'Page Not Found | EaseWithExam',
    description: 'The page you are looking for does not exist or has moved.',
    noindex: true,
  },
};

/**
 * Marks <html> while a page that manages its own <title> is mounted.
 *
 * PlatformChrome reads this rather than testing the pathname against PAGE_SEO,
 * because the 404 route matches no fixed path — a visitor on /some-bad-url is
 * SEO-managed but `PAGE_SEO['/some-bad-url']` is undefined, so a path lookup
 * would let the platform name overwrite the 404 title. Set on mount and cleared
 * on unmount, so it always describes the page currently rendered.
 */
export const SEO_OWNED_ATTR = 'data-seo-managed';

export const isSeoManagedPage = () =>
  document.documentElement.hasAttribute(SEO_OWNED_ATTR);

/** Upsert a <meta> by name= or property=, creating it if index.html lacks it. */
function setMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/**
 * Applies the metadata for `path` to the live document.
 *
 * Deliberately NOT reverted on unmount. Every navigation lands on another route
 * that sets its own tags, and a cleanup pass would briefly restore index.html's
 * homepage canonical mid-transition — precisely the wrong value to expose to a
 * crawler snapshotting the page.
 */
export function useSeo(path) {
  useEffect(() => {
    const seo = PAGE_SEO[path];
    if (!seo) return;

    const url = absUrl(path);
    document.title = seo.title;

    setMeta('name', 'description', seo.description);
    setMeta('property', 'og:title', seo.title);
    setMeta('property', 'og:description', seo.description);
    setMeta('property', 'og:url', url);
    setMeta('name', 'twitter:title', seo.title);
    setMeta('name', 'twitter:description', seo.description);

    // Keep a 404 out of the index. Every other route inherits index.html's
    // "index, follow", so this only ever needs to write the negative case —
    // but it must also be able to write it BACK, or a visitor who lands on a
    // 404 and then navigates to the homepage leaves it noindexed for the rest
    // of the session, and that snapshot is what a crawler could capture.
    setMeta('name', 'robots', seo.noindex ? 'noindex, follow' : 'index, follow');

    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', url);

    // No-op until a vendor is configured — see lib/analytics.js.
    trackPageView(path);

    // Claim the title for as long as this page is mounted. Platform settings
    // load asynchronously, so PlatformChrome's effect can fire long after this
    // one; without the claim it would overwrite the title at that point.
    document.documentElement.setAttribute(SEO_OWNED_ATTR, '');
    return () => document.documentElement.removeAttribute(SEO_OWNED_ATTR);
  }, [path]);
}
