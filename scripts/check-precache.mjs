/**
 * Every URL the service worker precaches must answer 200 on the live site.
 *
 *   node scripts/check-precache.mjs [https://www.easewithexam.com]
 *
 * WHY: Workbox refuses to install a service worker if any precached URL is not
 * a 200. /404.html (a real 404 since 2026-08-15) sat in the precache list for
 * six weeks, so every install failed and returning visitors stayed on an old
 * cached copy of the app. Run after every deploy (docs/DEPLOY.md). Reads the
 * list from the LIVE sw.js, so it checks exactly what browsers get.
 */
const base = (process.argv[2] ?? 'https://www.easewithexam.com').replace(/\/$/, '');
const sw = await (await fetch(`${base}/sw.js`, { cache: 'no-store' })).text();
const urls = [...sw.matchAll(/\{url:"([^"]+)",revision:/g)].map((m) => m[1]);
if (!urls.length) { console.error('No precache entries found in sw.js — format changed? Check by hand.'); process.exit(1); }

const bad = [];
for (let i = 0; i < urls.length; i += 10) {
  await Promise.all(urls.slice(i, i + 10).map(async (u) => {
    const r = await fetch(`${base}/${u.replace(/^\//, '')}`, { method: 'GET', redirect: 'manual' });
    if (r.status !== 200) bad.push(`${r.status}  ${u}`);
    await r.body?.cancel();
  }));
}
console.log(`${urls.length} precached URLs checked, ${bad.length} not 200`);
bad.forEach((b) => console.log('  ✗ ' + b));
process.exitCode = bad.length ? 1 : 0;
