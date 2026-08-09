/**
 * Builds the six landing-page images in public/landing/ from the raw
 * screenshots in .landing-shots/ (see scripts/landing-shots.mjs).
 *
 *   node scripts/landing-assets.mjs
 *
 * Every pixel is the real running app — this only crops, rounds corners and
 * composites. It never draws fake UI.
 *
 * Crop coordinates are in the source screenshot's own pixels: a 1440x900
 * viewport captured at deviceScaleFactor 2, so 2880x1800. If the app's layout
 * changes, these numbers need revisiting.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT  = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, '.landing-shots');
const OUT   = resolve(ROOT, 'public/landing');

if (!existsSync(SHOTS)) {
  console.error('No .landing-shots/ — run scripts/landing-shots.mjs first.');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const img = (name) => pathToFileURL(resolve(SHOTS, `${name}.png`)).href;

// The scale lives on a wrapper rather than the <img> so the crop offsets scale
// with it — scaling the image alone leaves the offsets in source pixels and the
// crop lands somewhere else entirely.
const crop = (src, x, y, w, h, radius = 0, s = 1) => `
  <div style="width:${Math.round(w * s)}px;height:${Math.round(h * s)}px;overflow:hidden;
              border-radius:${radius}px;position:relative;flex:none;background:#fff">
    <div style="position:absolute;left:0;top:0;transform:scale(${s});transform-origin:0 0">
      <img src="${img(src)}" style="position:absolute;left:${-x}px;top:${-y}px;max-width:none">
    </div>
  </div>`;

const PAGE = (body, w, h, bg) => `
<!doctype html><meta charset="utf-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:${w}px;height:${h}px;background:${bg}}
  #stage{width:${w}px;height:${h}px;position:relative;overflow:hidden;
         display:flex;align-items:center;justify-content:center}
</style>
<div id="stage">${body}</div>`;

// The dashboard is cropped to 1650px tall: the sidebar is full-height, so its
// profile row (and the QA account's email) sits at the bottom of the viewport.
const DASH_H = 1650;

const assets = [
  // Tinted to match the slate panel it sits inside, so the image edge doesn't
  // read as a white rectangle pasted onto the section. Near-square on purpose:
  // the slot is object-cover in a roughly 1:1 box, and a wide image would lose
  // half its width to the centre crop.
  { name: 'showcase', w: 1120, h: 880, bg: '#f8fafc',
    body: `<div style="box-shadow:0 16px 40px -18px rgba(15,23,42,.28);border-radius:12px">
             ${crop('dash', 0, 0, 2880, DASH_H, 12, 0.372)}
           </div>` },

  // Wide and short — the landing card renders it at max 160px tall.
  { name: 'feature-tutor', w: 1300, h: 480, bg: '#ffffff',
    body: crop('chat', 1530, 210, 1300, 480) },

  // Just the sign-in card. A wider crop drags in the blurred page behind the
  // modal, which reads as grey smudges down both edges of the step card.
  { name: 'step-1', w: 1280, h: 860, bg: '#f8fafc',
    body: `<div style="box-shadow:0 18px 40px -18px rgba(15,23,42,.30);border-radius:14px">
             ${crop('signup', 1056, 414, 766, 966, 14, 0.78)}
           </div>` },

  { name: 'step-2', w: 1350, h: 900, bg: '#ffffff',
    body: crop('onb-board', 700, 600, 1350, 900) },

  { name: 'step-3', w: 1450, h: 1020, bg: '#ffffff',
    body: crop('exams', 950, 380, 1450, 1020) },

  // Hero collage: the dashboard as the hero plate with the analytics score
  // trend and the onboarding card layered in front, on transparency so it sits
  // on the landing page's white background without a visible box.
  { name: 'hero-collage', w: 1600, h: 1200, bg: 'transparent', body: `
      <div style="position:absolute;left:110px;top:130px;
                  box-shadow:0 30px 70px -20px rgba(15,23,42,.35);border-radius:20px">
        ${crop('dash', 0, 0, 2880, DASH_H, 20, 0.44)}
      </div>
      <div style="position:absolute;right:24px;bottom:212px;
                  box-shadow:0 26px 60px -16px rgba(15,23,42,.42);border-radius:16px;
                  border:1px solid rgba(226,232,240,.9)">
        ${crop('progress', 504, 576, 2304, 690, 16, 0.28)}
      </div>
      <div style="position:absolute;left:36px;bottom:96px;
                  box-shadow:0 22px 50px -14px rgba(15,23,42,.38);border-radius:16px;
                  border:1px solid rgba(226,232,240,.9)">
        ${crop('onb-board', 770, 706, 1340, 598, 16, 0.32)}
      </div>` },
];

const browser = await chromium.launch();
for (const a of assets) {
  const page = await browser.newPage({ viewport: { width: a.w, height: a.h }, deviceScaleFactor: 1 });

  // Written to disk and loaded over file:// — a setContent page has an
  // about:blank origin, which silently blocks every file:// <img> it contains.
  const html = resolve(SHOTS, `_build_${a.name}.html`);
  writeFileSync(html, PAGE(a.body, a.w, a.h, a.bg));
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.waitForFunction(
    () => [...document.images].every((i) => i.complete && i.naturalWidth > 0),
    null, { timeout: 15000 },
  );
  await page.waitForTimeout(300);

  await page.screenshot({
    path: resolve(OUT, `${a.name}.png`),
    omitBackground: a.bg === 'transparent',
    scale: 'css',
  });
  console.log(`built: ${a.name}.png  ${a.w}x${a.h}`);
  await page.close();
}
await browser.close();
