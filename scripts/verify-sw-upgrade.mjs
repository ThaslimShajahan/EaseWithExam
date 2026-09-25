/**
 * Proves a browser stuck on an OLD service worker picks up a new deploy.
 *
 *   node scripts/verify-sw-upgrade.mjs prepare <profileDir>   # BEFORE the deploy
 *   node scripts/verify-sw-upgrade.mjs check   <profileDir>   # AFTER the deploy
 *
 * prepare: opens the live site in a persistent Chromium profile and lets the
 *   CURRENT live service worker install. It can't install normally (its
 *   precache includes /404.html, a real 404 — the bug being fixed), so /404.html
 *   is answered 200 for this one step only: that recreates exactly the browsers
 *   that installed a worker before 2026-08-15 and have been frozen since.
 *   Records which bundle that worker serves.
 * check: reopens the SAME profile with no interception, like the returning
 *   visitor, loads the site, gives the browser time to fetch and install the
 *   new worker, reloads, and reports which bundle is running now.
 * Trackers are blocked throughout.
 */
import { chromium } from 'playwright';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [mode, dir] = process.argv.slice(2);
if (!['prepare', 'check'].includes(mode) || !dir) { console.error('usage: prepare|check <profileDir>'); process.exit(1); }
const SITE = 'https://www.easewithexam.com';
const stateFile = join(dir, 'sw-upgrade-state.json');

const ctx = await chromium.launchPersistentContext(dir, { headless: true });
await ctx.route(/facebook\.(net|com)|google-analytics\.com|googletagmanager\.com|doubleclick/, (r) => r.abort());
const page = ctx.pages()[0] ?? await ctx.newPage();
const bundleOf = () => page.evaluate(() => [...document.scripts].map((s) => s.src).find((u) => /assets\/index-.*\.js/.test(u))?.split('/').pop() ?? null);
const swState = () => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return { registered: !!r, active: r?.active?.scriptURL ?? null, waiting: !!r?.waiting, installing: !!r?.installing, controlled: !!navigator.serviceWorker.controller };
});

if (mode === 'prepare') {
  await ctx.route(`${SITE}/404.html`, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>404</title>' }));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 60000 }).catch(() => {});
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const st = { preparedAt: new Date().toISOString(), bundle: await bundleOf(), sw: await swState() };
  writeFileSync(stateFile, JSON.stringify(st, null, 1));
  console.log('prepared:', JSON.stringify(st));
} else {
  if (!existsSync(stateFile)) { console.error('run prepare first'); process.exit(1); }
  const before = JSON.parse(readFileSync(stateFile, 'utf8'));
  await page.goto(SITE, { waitUntil: 'load' });
  const first = await bundleOf();
  // The browser checks sw.js on navigation; the new worker installs, then
  // (skipWaiting + clientsClaim) takes over. Wait for that, then reload.
  // Wait for the NEW worker to take control (controllerchange) — checking
  // "nothing is installing" is already true before the update starts, which
  // is how the first version of this check reloaded too early. A cold install
  // downloads ~150 files.
  const tookOver = await page.evaluate(() => new Promise((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true });
    navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {});
    setTimeout(() => resolve(false), 240000);
  }));
  console.log('new worker took control:', tookOver);
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const after = await bundleOf();
  const live = (await (await fetch(SITE, { cache: 'no-store' })).text()).match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1];
  const ok = before.bundle !== live && after === live;
  console.log(JSON.stringify({ preparedBundle: before.bundle, firstLoadAfterDeploy: first, afterReload: after, liveBundle: live, sw: await swState() }, null, 1));
  console.log(ok ? 'PASS  stale-worker browser now runs the live bundle' : 'FAIL  browser did not reach the live bundle');
  process.exitCode = ok ? 0 : 1;
}
await ctx.close();
