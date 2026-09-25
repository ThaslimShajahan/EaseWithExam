/**
 * Live check: GA4 and the Meta Pixel load and fire ONLY after Accept.
 *
 *   node scripts/verify-consent-trackers.mjs
 *
 * Runs Chromium with automation hidden (navigator.webdriver = false), because
 * the site deliberately never loads trackers for automated browsers. Tracker
 * SCRIPTS may load; every tracking HIT (facebook.com/tr, GA /collect) is
 * recorded and then aborted, so a test run never reaches the ad or analytics
 * accounts.
 */
import { chromium } from 'playwright';

const SITE = 'https://www.easewithexam.com';
const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
const results = [];
const check = (id, desc, ok, ev) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${desc}\n       ${ev}`); };

async function visit(label, steps) {
  // A normal Chrome user-agent: fbevents.js drops events from "HeadlessChrome" (bot filter).
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 },
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36' });
  const seen = { fbScript: 0, fbConfig: 0, fbHits: [], gaScript: 0, gaHits: [] };
  await ctx.route(/facebook\.com\/tr|google-analytics\.com\/(g\/)?collect|analytics\.google\.com\/g\/collect/, (r) => {
    const u = r.request().url();
    if (u.includes('facebook.com/tr')) seen.fbHits.push(new URL(u).searchParams.get('ev') ?? '?');
    else seen.gaHits.push(new URL(u).searchParams.get('en') ?? '?');
    r.abort();
  });
  ctx.on('request', (r) => {
    const u = r.url();
    if (process.env.DEBUG_FB && /facebook/.test(u)) console.log('   fb req:', r.resourceType(), u.slice(0, 110));
    if (u.includes('connect.facebook.net') && u.includes('fbevents.js')) seen.fbScript++;
    if (u.includes('connect.facebook.net/signals/config')) seen.fbConfig++;
    if (u.includes('googletagmanager.com/gtag/js')) seen.gaScript++;
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error' && /fbq|execStart|gtag/i.test(m.text())) errors.push(m.text().slice(0, 120)); });
  const webdriver = async () => page.evaluate(() => navigator.webdriver);
  await steps(page, { seen, errors, webdriver, ctx });
  await ctx.close();
  return seen;
}
const snap = (s) => JSON.stringify({ fbScript: s.fbScript, fbConfig: s.fbConfig, fbHits: s.fbHits, gaScript: s.gaScript, gaHits: s.gaHits });

// 1. First visit, no choice made
await visit('none', async (page, { seen, webdriver }) => {
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  const banner = await page.getByRole('button', { name: 'Accept' }).isVisible() && await page.getByRole('button', { name: 'Decline' }).isVisible();
  check('C1', 'before any choice: banner shows Accept + Decline, NO GA / Pixel at all', banner && seen.fbScript + seen.fbConfig + seen.gaScript + seen.fbHits.length + seen.gaHits.length === 0,
    `webdriver=${await webdriver()} banner=${banner} ${snap(seen)}`);
});

// 2. Decline
await visit('decline', async (page, { seen }) => {
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  await page.getByRole('button', { name: 'Decline' }).click();
  await page.waitForTimeout(5000);
  await page.goto(`${SITE}/about/`, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  const bannerGone = !(await page.getByRole('button', { name: 'Accept' }).isVisible().catch(() => false));
  check('C2', 'Decline: nothing loads, now or on the next page; banner stays closed', bannerGone && seen.fbScript + seen.gaScript + seen.fbHits.length + seen.gaHits.length === 0, snap(seen));
});

// 3. Accept
await visit('accept', async (page, { seen, errors }) => {
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const beforeAccept = seen.fbScript + seen.gaScript + seen.fbHits.length + seen.gaHits.length;
  await page.getByRole('button', { name: 'Accept' }).click();
  await page.waitForTimeout(10000);
  check('C3', 'Accept: Pixel loads once and fires PageView; GA loads and sends page_view',
    beforeAccept === 0 && seen.fbScript === 1 && seen.fbHits.includes('PageView') && seen.gaScript === 1 && seen.gaHits.includes('page_view'),
    `before accept: ${beforeAccept} tracker requests; after: ${snap(seen)}`);
  check('C4', 'no "fbq is not defined" / "execStart" / gtag errors', errors.length === 0, errors.join(' | ') || 'none');
  // returning visitor who accepted earlier: trackers load at boot
  const s0 = { fb: seen.fbHits.length, ga: seen.gaHits.length };
  await page.goto(`${SITE}/about/`, { waitUntil: 'load' });
  await page.waitForTimeout(8000);
  check('C5', 'returning visitor who accepted: trackers load on the next page by themselves',
    seen.fbHits.length > s0.fb && seen.gaHits.length > s0.ga, `after navigating: ${snap(seen)}`);
});

// 4. Automation (the prerender's situation): nothing even with consent
{
  const ctx = await (await chromium.launch()).newContext();
  const page = await ctx.newPage();
  let tracker = 0;
  ctx.on('request', (r) => { if (/connect\.facebook\.net|googletagmanager\.com\/gtag/.test(r.url())) tracker++; });
  await page.goto(`${SITE}/robots.txt`);
  await page.evaluate(() => localStorage.setItem('ewe_cookie_consent_v2', 'granted'));
  await page.goto(SITE, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  check('C6', 'automated browser (like the build prerender) never loads trackers, even with consent stored', tracker === 0, `tracker requests: ${tracker}`);
  await ctx.browser().close();
}

await browser.close();
console.log(`\n${results.filter(Boolean).length} passed, ${results.filter((x) => !x).length} failed`);
process.exitCode = results.every(Boolean) ? 0 : 1;
