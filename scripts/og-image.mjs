/**
 * Builds public/og-image.png — the 1200x630 card shown when a link to the site
 * is shared on WhatsApp, LinkedIn, X, Slack or iMessage.
 *
 *   node scripts/og-image.mjs
 *
 * index.html has pointed og:image and twitter:image at /og-image.png since the
 * meta tags were written, but the file never existed — it returned 404 in
 * production, so every share rendered as a bare text link.
 *
 * Drawn rather than screenshotted, unlike scripts/landing-assets.mjs: an OG
 * card is brand furniture, not a product claim, so there is no real UI it could
 * be a crop of. It states only what SUPPORTED_SYLLABI actually lists.
 *
 * Rendered through Playwright because it is already a dependency (see
 * landing-shots.mjs) and Chromium's text rendering beats hand-rolled SVG
 * rasterisation for this.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT  = resolve(ROOT, 'public');
const TMP  = resolve(ROOT, '.og-build');

const W = 1200, H = 630;

// Brand palette, from tailwind.config.js.
const GREEN = '#21A375', GREEN_DK = '#156A4C', SLATE = '#0f172a';

// The nav wordmark, inlined so the page has no external requests to wait on.
const LOGO = pathToFileURL(resolve(ROOT, 'public/ewe_nav_icon.svg')).href;

const HTML = `<!doctype html>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${W}px;height:${H}px}
  body{
    font-family:Inter,system-ui,sans-serif;
    background:${SLATE};
    color:#fff;
    position:relative;
    overflow:hidden;
  }
  /* One soft brand-green wash from the lower left. Flat fills elsewhere, per
     the landing page's no-gradient rule — this is the single exception, and it
     exists so the card does not read as a black rectangle in a dark-mode feed. */
  .wash{
    position:absolute;left:-260px;bottom:-360px;width:1000px;height:1000px;
    border-radius:50%;
    background:radial-gradient(circle,${GREEN}38 0%,${GREEN}00 68%);
  }
  .frame{position:relative;height:100%;padding:74px 82px;display:flex;flex-direction:column}
  .brand{display:flex;align-items:center;gap:16px}
  .brand img{height:52px;width:auto}
  .brand span{font-size:31px;font-weight:700;letter-spacing:-.02em}
  h1{
    margin-top:auto;
    font-size:75px;line-height:1.03;font-weight:900;letter-spacing:-.035em;
    max-width:19ch;
  }
  h1 em{font-style:normal;color:${GREEN}}
  p{
    margin-top:26px;font-size:27px;line-height:1.45;font-weight:400;
    color:#cbd5e1;max-width:30ch;
  }
  .rule{margin-top:auto;padding-top:36px;display:flex;align-items:center;gap:14px;
        border-top:1px solid rgba(255,255,255,.14)}
  .pill{
    font-size:20px;font-weight:600;color:#e2e8f0;
    background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);
    padding:9px 20px;border-radius:999px;
  }
  .free{margin-left:auto;font-size:21px;font-weight:700;color:${GREEN}}
</style>
<div class="wash"></div>
<div class="frame">
  <div class="brand">
    <img src="${LOGO}" alt="">
    <span>EaseWithExam</span>
  </div>

  <h1>Exam prep with an <em>AI tutor</em> that explains.</h1>
  <p>Real exam-pattern papers, unlimited practice and a study plan that adapts.</p>

  <div class="rule">
    <div class="pill">NEET</div>
    <div class="pill">JEE</div>
    <div class="pill">CBSE</div>
    <div class="pill">Kerala State</div>
    <div class="free">Free to start</div>
  </div>
</div>`;

mkdirSync(TMP, { recursive: true });
const htmlPath = resolve(TMP, 'og.html');
writeFileSync(htmlPath, HTML);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

// file:// rather than setContent — an about:blank origin blocks the file:// logo.
await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
await page.waitForFunction(
  () => document.fonts.ready.then(() => true),
  null, { timeout: 15000 },
);
await page.waitForFunction(
  () => [...document.images].every((i) => i.complete && i.naturalWidth > 0),
  null, { timeout: 15000 },
);
await page.waitForTimeout(250);

await page.screenshot({ path: resolve(OUT, 'og-image.png'), scale: 'css' });
await browser.close();

console.log(`built: public/og-image.png  ${W}x${H}`);
