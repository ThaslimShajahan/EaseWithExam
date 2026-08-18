import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PAGE_SEO, absUrl, SITE_URL } from '../seo';
import { topLevelRoutes, prerenderedRoutes } from '../../../scripts/gen-nginx-routes.mjs';

const ROOT = resolve(__dirname, '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

// Both regex `location` blocks in the conf, in file order: prerendered
// routes first (try_files $uri $uri/ /index.html), then pure SPA-only
// routes (try_files $uri /index.html).
function routeLocationBlocks(conf) {
  const matches = [...conf.matchAll(/location ~ \^\/\(([^)]+)\)[^{]*\{\s*try_files ([^;]+);/g)];
  return matches.map((m) => ({ routes: m[1].split('|').sort(), tryFiles: m[2].trim() }));
}

describe('nginx route config', () => {
  /**
   * The whole point of generating the conf is that a new route in App.jsx
   * cannot silently start 404ing in production. That guarantee is only real if
   * something asserts it, which is this.
   */
  it('is in sync with the routes declared in App.jsx', () => {
    const conf = read('deploy/nginx-easewithexam.conf');
    const blocks = routeLocationBlocks(conf);
    expect(blocks.length, 'conf does not have exactly 2 route alternation blocks').toBe(2);

    const inConf = [...blocks[0].routes, ...blocks[1].routes].sort();
    expect(inConf).toEqual(topLevelRoutes());
  });

  /**
   * The regression this guards: 2026-08-15's nginx conf tried `$uri` only for
   * every app route, including the 5 that ARE real prerendered directories
   * (dist/about/index.html etc). Without `$uri/`, nginx never resolves that
   * directory and falls straight to the root index.html — every prerendered
   * page silently served the HOMEPAGE's title and canonical instead of its
   * own, for 4 days, undetected because status codes were 200 either way.
   */
  it('gives prerendered routes $uri/ before falling back to the SPA shell', () => {
    const conf = read('deploy/nginx-easewithexam.conf');
    const blocks = routeLocationBlocks(conf);
    const prerendered = blocks.find((b) => b.routes.includes('about'));
    const spaOnly = blocks.find((b) => b.routes.includes('dashboard'));

    expect(prerendered.routes).toEqual(prerenderedRoutes());
    expect(prerendered.tryFiles).toBe('$uri $uri/ /index.html');

    // Pure client-only routes have no prerendered file — $uri/ would only
    // ever match the root's own directory, so this block deliberately keeps
    // the original two-target form.
    expect(spaOnly.tryFiles).toBe('$uri /index.html');
    for (const route of prerenderedRoutes()) {
      expect(spaOnly.routes, `${route} is prerendered but also in the SPA-only block`).not.toContain(route);
    }
  });

  it('does not hoist nested admin routes to top level', () => {
    // <Route path="content"> lives inside /admin. If it were hoisted, /content
    // would serve index.html and React would render its 404 under HTTP 200 —
    // the exact soft-404 this work removes.
    const routes = topLevelRoutes();
    for (const nested of ['content', 'publish', 'students', 'papers', 'flags']) {
      expect(routes).not.toContain(nested);
    }
  });

  it('covers every public route that has SEO metadata', () => {
    const routes = topLevelRoutes();
    for (const path of Object.keys(PAGE_SEO)) {
      if (path === '/' || path === '/404') continue;
      expect(routes).toContain(path.slice(1));
    }
  });
});

describe('per-route SEO metadata', () => {
  it('gives every page a distinct canonical URL', () => {
    // The bug this replaces: index.html hardcoded one canonical pointing at the
    // homepage, so /about, /contact, /privacy and /terms all declared
    // themselves duplicates of / and asked to be dropped from the index.
    const urls = Object.keys(PAGE_SEO).map(absUrl);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('keeps titles and descriptions within what Google renders', () => {
    for (const [path, { title, description }] of Object.entries(PAGE_SEO)) {
      expect(title.length, `${path} title too long`).toBeLessThanOrEqual(65);
      expect(description.length, `${path} description too long`).toBeLessThanOrEqual(160);
      expect(description.length, `${path} description too short`).toBeGreaterThan(50);
    }
  });

  it('noindexes the 404 and nothing else', () => {
    const noindexed = Object.entries(PAGE_SEO).filter(([, v]) => v.noindex).map(([k]) => k);
    expect(noindexed).toEqual(['/404']);
  });

  it('does not claim board coverage the product does not have', async () => {
    // SUPPORTED_SYLLABI is CBSE + Kerala State. "all state boards" in a
    // description is a promise the product breaks on arrival, and a bounce is
    // a ranking signal. Guards the metadata against the same drift the landing
    // page's "nothing invented" rule guards the page copy against.
    const blob = JSON.stringify(PAGE_SEO).toLowerCase() + read('index.html').toLowerCase();
    expect(blob).not.toMatch(/all state (and central )?boards/);
    expect(blob).not.toMatch(/every state board/);
  });
});

describe('static SEO files', () => {
  it('references an og-image that exists at the declared size', () => {
    const html = read('index.html');
    expect(html).toContain('og-image.png');
    // 404ing on this tag is what made every share render as a bare text link.
    expect(() => readFileSync(resolve(ROOT, 'public/og-image.png'))).not.toThrow();
    expect(html).toMatch(/og:image:width" content="1200"/);
    expect(html).toMatch(/og:image:height" content="630"/);
  });

  it('lists only canonical, indexable URLs in the sitemap', () => {
    const sitemap = read('public/sitemap.xml');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      expect(loc.startsWith(`${SITE_URL}/`), `${loc} is not on the canonical host`).toBe(true);
      // Sitemap entries are trailing-slashed — that's the URL nginx actually
      // serves without a redirect (see absUrl in seo.js). PAGE_SEO's keys are
      // route identifiers matching App.jsx's <Route path> values, which are
      // not slash-terminated, so strip it back off before looking one up.
      const raw = loc.replace(SITE_URL, '') || '/';
      const path = raw === '/' ? '/' : raw.replace(/\/$/, '');
      // A sitemap URL with no SEO entry inherits index.html's homepage
      // canonical, so it would be listed as indexable while pointing elsewhere.
      expect(PAGE_SEO[path], `${loc} has no PAGE_SEO entry`).toBeTruthy();
      expect(PAGE_SEO[path].noindex).toBeFalsy();
    }
  });

  it('keeps robots.txt disallows away from the indexable set', () => {
    const robots = read('public/robots.txt');
    const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1]);
    for (const path of Object.keys(PAGE_SEO)) {
      if (PAGE_SEO[path].noindex) continue;
      expect(disallowed, `${path} is both indexable and Disallowed`).not.toContain(path);
    }
  });
});
