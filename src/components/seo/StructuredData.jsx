import { useEffect } from 'react';
import { FAQ_FLAT, SUPPORTED_SYLLABI } from '../../lib/landingContent';
import { SITE_URL } from '../../lib/seo';

const NODE_ID = 'ewe-structured-data';

/**
 * Injects the landing page's JSON-LD.
 *
 * index.html already ships a static EducationalOrganization block, which is the
 * right thing to keep there: it is the only structured data a non-JS crawler or
 * a social scraper will ever see. This adds the two types that depend on app
 * data and so cannot be hand-maintained in a static file.
 *
 *   WebSite + SearchAction — makes the site eligible for a sitelinks search box.
 *   FAQPage               — built from FAQ_FLAT, the same constant that renders
 *                           the visible FAQ. Google requires the marked-up
 *                           answer to match the on-page text; deriving both from
 *                           one source is what guarantees that, and is why this
 *                           is generated rather than written out by hand.
 *
 * FAQPage rich results are currently limited to well-known authoritative sites,
 * so treat this as correctness groundwork rather than an expected SERP change.
 */
export default function StructuredData() {
  useEffect(() => {
    const graph = [
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: `${SITE_URL}/`,
        name: 'EaseWithExam',
        description: `AI-powered exam preparation for ${SUPPORTED_SYLLABI.join(', ')}.`,
        inLanguage: 'en-IN',
        publisher: { '@id': `${SITE_URL}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/study?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@type': 'FAQPage',
        '@id': `${SITE_URL}/#faq`,
        mainEntity: FAQ_FLAT.map(({ q, a }) => ({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        })),
      },
    ];

    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = NODE_ID;
    el.textContent = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
    document.head.appendChild(el);

    // Removed on unmount, unlike the meta tags in useSeo(). A stale FAQPage
    // block asserting the homepage's FAQ while the user reads /terms is a
    // structured-data mismatch; a stale <title> is not, because the next route
    // overwrites it either way.
    return () => { document.getElementById(NODE_ID)?.remove(); };
  }, []);

  return null;
}
