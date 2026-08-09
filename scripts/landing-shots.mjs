/**
 * Captures raw screenshots of the running app for the landing-page imagery.
 *
 * Signs in through the DEV-only `?qa_uid=` bypass in src/context/AuthContext.jsx,
 * so it needs `npm run dev` up and will not work against a production build
 * (Vite dead-code-eliminates that branch).
 *
 *   npm run dev
 *   node scripts/landing-shots.mjs                 # default set of screens
 *   BASE_URL=http://localhost:5175 node scripts/landing-shots.mjs
 *
 * Output goes to .landing-shots/ (gitignored); scripts/landing-assets.mjs turns
 * those into the six files in public/landing/.
 *
 * Populated dashboard and analytics screens need a seeded account — see
 * public/landing/README.txt.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = resolve(ROOT, '.landing-shots');
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const UID  = process.env.QA_UID   || 'ewe-demo';

mkdirSync(OUT, { recursive: true });

const DEFAULT_TARGETS = [
  { name: 'dash',      path: '/dashboard', wait: 7000 },
  { name: 'chat',      path: '/doubt',     wait: 6000 },
  { name: 'exams',     path: '/exams',     wait: 6000 },
  { name: 'progress',  path: '/progress',  wait: 6000 },
  { name: 'onb-board', path: '/onboarding', wait: 5000,
    qaUid: 'ewe-shot-new', steps: ['text=Class 12', 'text=Next'] },
  { name: 'signup',    path: '/', wait: 5000, anon: true,
    steps: ['text=Get Started'], settle: 2000 },
];

const targets = process.env.TARGETS ? JSON.parse(process.env.TARGETS) : DEFAULT_TARGETS;

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 160)));

// Chrome that shouldn't appear in marketing shots: the cookie bar, and the
// "Getting started" checklist, which is a first-run state rather than the
// product itself.
async function dismissChrome() {
  for (const sel of ['button:has-text("Accept")', 'button:has-text("Got it")']) {
    const el = page.locator(sel).first();
    if (await el.count() && await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  const card = page.locator('div').filter({ hasText: /^Getting started/ }).first();
  if (await card.count()) {
    const x = card.locator('button').last();
    if (await x.count() && await x.isVisible().catch(() => false)) {
      await x.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

for (const t of targets) {
  if (t.viewport) await page.setViewportSize(t.viewport);

  // `anon` visits without qa_uid — needed for signed-out screens, which would
  // otherwise redirect straight to the dashboard on an established session.
  if (t.anon) {
    await ctx.clearCookies();
    await page.goto(`${BASE}/`).catch(() => {});
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});
  }
  // Built through the URL API rather than string concatenation: a path with a
  // fragment ("/profile#notifications") would otherwise get ?qa_uid appended
  // AFTER the hash, burying it in the fragment where nothing reads it — the
  // page then just bounces to the signed-out landing route.
  const target = new URL(t.path, BASE);
  if (!t.anon) target.searchParams.set('qa_uid', t.qaUid || UID);
  const url = target.toString();

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(t.wait ?? 3000);
  await dismissChrome();
  for (const step of t.steps ?? []) {
    await page.click(step, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  // Playwright keeps the scroll position across same-URL navigations, which
  // silently produces a screenshot of whatever section was last viewed.
  if (!t.keepScroll) {
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(t.settle ?? 600);

  const opts = { path: resolve(OUT, `${t.name}.png`), fullPage: !!t.full };
  if (t.clip) opts.clip = t.clip;
  await page.screenshot(opts);
  console.log(`shot: ${t.name}`);
}

if (errors.length) {
  console.log('--- console errors:');
  [...new Set(errors)].slice(0, 10).forEach((e) => console.log('   ' + e));
}
await browser.close();
