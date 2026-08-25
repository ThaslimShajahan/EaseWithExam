/**
 * Prerenders the public routes into real HTML files, after `vite build`.
 *
 *   npm run build && node scripts/prerender.mjs
 *   (or just: npm run build:seo)
 *
 * WHY THIS EXISTS
 * The app ships a single index.html whose body is `<div id="root"></div>`. Every
 * route serves that same file, so before JavaScript runs:
 *
 *   - there is NO CONTENT for a crawler to read; and
 *   - every URL carries the HOMEPAGE's <title>, description and — worst —
 *     `<link rel="canonical" href="https://www.easewithexam.com/">`, so /about
 *     and /privacy each declare themselves duplicates of the homepage.
 *
 * src/lib/seo.js fixes all of that once React mounts. Google renders JS and will
 * usually see the corrected version, but on a second, slower pass; Bing's first
 * pass, every social scraper, and the LLM crawlers do not run JS at all. A
 * canonical that points somewhere else is the kind of signal that gets a page
 * dropped rather than merely ranked lower.
 *
 * This runs the real app in a headless browser and saves what it produces, so
 * the shipped HTML already contains the right tags AND the rendered content.
 * No SSR framework, no second rendering path to keep in sync — the output is by
 * construction whatever the app actually renders.
 *
 * SCOPE: the five public URLs in sitemap.xml, which are the entire indexable
 * surface. Authenticated routes are Disallowed in robots.txt and must never be
 * prerendered — their content is per-student.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { absUrl } from '../src/lib/seo.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/* Kept in step with sitemap.xml and PAGE_SEO by seoRoutes.test.js, which asserts
 * the indexable set is the same in all three places. */
const ROUTES = ['/', '/about', '/contact', '/privacy', '/terms', '/refund'];

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('\ndist/index.html not found — run `npm run build` first.\n');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml',
};

/* Static server with SPA fallback — the same shape the real host uses, so a
 * route resolves exactly as it will in production. */
const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = join(DIST, urlPath);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  const body = readFileSync(file);
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(body);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const page = await browser.newPage();
const problems = [];

for (const route of ROUTES) {
  // 'load', not 'networkidle': the PWA service worker keeps connections alive
  // and networkidle never fires.
  await page.goto(`${origin}${route}`, { waitUntil: 'load' });

  // Wait for the app to have actually rendered something, rather than saving an
  // empty shell that would look like a success.
  await page.waitForFunction(() => {
    const r = document.getElementById('root');
    return r && r.children.length > 0 && r.innerText.trim().length > 200;
  }, { timeout: 30000 }).catch(() => problems.push(`${route}: root never filled`));

  // seo.js writes title/description/canonical in an effect. A fixed
  // waitForTimeout(400) here raced that effect -- confirmed live 2026-08-25,
  // reproduced 2 failures in 3 consecutive runs, a different route each time.
  // index.html's static canonical always defaults to the homepage (see its
  // own comment), so a route whose useSeo() effect hadn't committed within
  // the fixed window got its build BLOCKED by the check below, which read
  // correctly and refused to write the bad file -- so this never shipped a
  // wrong canonical, but it did make `build:seo` randomly fail. Wait for the
  // actual condition instead of guessing how long the effect takes.
  const expected = absUrl(route);
  await page.waitForFunction(
    (exp) => document.head.querySelector('link[rel="canonical"]')?.href === exp,
    expected,
    { timeout: 5000 },
  ).catch(() => problems.push(`${route}: canonical never reached ${expected} within 5s`));

  const html = await page.content();
  const title = await page.title();
  const canonical = await page.evaluate(() => document.head.querySelector('link[rel="canonical"]')?.href ?? null);
  const robots = await page.evaluate(() => document.head.querySelector('meta[name="robots"]')?.content ?? null);

  // The whole point of the exercise: refuse to emit a file whose canonical
  // still points at the homepage, or that is accidentally noindexed. Uses the
  // same absUrl() the running app calls, so this can never drift from what
  // seo.js actually produces (see absUrl's own comment for why it's
  // trailing-slashed).
  if (canonical !== expected) problems.push(`${route}: canonical is ${canonical}, expected ${expected}`);
  if (robots && robots.includes('noindex')) problems.push(`${route}: emitted with noindex`);

  const outDir = route === '/' ? DIST : join(DIST, route);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'index.html'), html);

  const bodyChars = await page.evaluate(() => document.body.innerText.trim().length);
  console.log(`  ${route.padEnd(10)} ${String(bodyChars).padStart(6)} chars  "${title.slice(0, 58)}"`);
}

await browser.close();
server.close();

if (problems.length) {
  console.error('\nPrerender problems:');
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  console.error('\nThe written files are wrong — fix before deploying.\n');
  process.exit(1);
}
console.log(`\nPrerendered ${ROUTES.length} route(s) into dist/.`);
