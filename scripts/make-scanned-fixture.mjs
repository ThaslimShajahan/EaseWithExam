/**
 * Builds the SYNTHETIC image-only PDF fixture used to exercise the vision path.
 *
 *   node scripts/make-scanned-fixture.mjs [sourcePdf] [pageCount]
 *
 * Rasterises the first N pages of a source PDF with Playwright's Chromium (the
 * same engine the app renders in) and reassembles them as a PDF whose pages are
 * nothing but images — no text layer at all. That is precisely the input the
 * old pipeline rejected outright at AdminContentIntake's "No extractable text"
 * check, and precisely what needsVision() must catch.
 *
 * ⚠ SYNTHETIC — DE-RISKS DEVELOPMENT, DOES NOT SUBSTITUTE FOR A REAL SCAN.
 * A real scan carries skew, speckle, JPEG artefacts, uneven contrast and
 * bleed-through that a clean rasterisation does not. Passing against this
 * fixture proves the GATE and the PLUMBING work; it does not prove OCR quality
 * on real scanned paper. Re-run the pilot against a genuine scan at
 * `easy with exam/_pilot/scanned-paper.pdf` before treating §1 as done.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] || 'easy with exam/11 NCRT SC/PHYSICS 1/keph104.pdf';
const PAGES = Number(process.argv[3] || 2);
const OUT = resolve(ROOT, 'test-fixtures/scanned-synthetic.pdf');

const srcPath = resolve(ROOT, SRC);
if (!existsSync(srcPath)) {
  console.error(`[fixture] Source not found: ${srcPath}`);
  process.exit(1);
}
mkdirSync(dirname(OUT), { recursive: true });

const pdfBase64 = readFileSync(srcPath).toString('base64');

// pdf.js has to be imported from a real http origin: Chromium treats file:// as
// an opaque origin for ES modules, and jsdelivr's own pages send a CSP that
// blocks importing from them. A throwaway static server over node_modules is
// the simplest thing that works, and keeps this script offline-capable.
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.map': 'application/json' };
const server = createServer((req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
  const file = resolve(ROOT, rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404).end('nope'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

const libUrl    = `${origin}/node_modules/pdfjs-dist/legacy/build/pdf.mjs`;
const workerUrl = `${origin}/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs`;

const shellPath = resolve(ROOT, 'test-fixtures/_shell.html');
writeFileSync(shellPath, '<!doctype html><meta charset="utf-8"><title>fixture</title>');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${origin}/test-fixtures/_shell.html`, { waitUntil: 'domcontentloaded' });

// Rasterise inside the page so pdf.js has a real canvas to render into.
const images = await page.evaluate(async ({ pdfBase64, libUrl, workerUrl, PAGES }) => {
  const lib = await import(libUrl);
  lib.GlobalWorkerOptions.workerSrc = workerUrl;
  const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  const pdf = await lib.getDocument({ data: bytes }).promise;

  const out = [];
  for (let i = 1; i <= Math.min(PAGES, pdf.numPages); i++) {
    const p = await pdf.getPage(i);
    const viewport = p.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvasContext: ctx, viewport }).promise;
    out.push({ data: canvas.toDataURL('image/jpeg', 0.9), w: canvas.width, h: canvas.height });
  }
  return out;
}, { pdfBase64, libUrl, workerUrl, PAGES });

// Re-print the images as PDF pages. Chromium's PDF printer emits no text run
// for an <img>, so the result genuinely has no text layer.
// line-height:0 matters: an inline-level <img> otherwise sits on a text
// baseline, and those few extra pixels overflow the page box, splitting every
// image across two PDF pages — half of them blank. Blank pages would then trip
// the vision gate and burn a call each.
// Each image is pinned to exactly one page-sized box (100vw x 100vh with the
// PDF page size set below). Letting the image size the page instead leaves a
// sub-pixel overflow that splits every image across two pages — half of them
// blank, each of which would then trip the vision gate and burn a call.
const html = `<!doctype html><meta charset="utf-8"><style>
  @page { margin: 0; }
  html,body { margin:0; padding:0; line-height:0; font-size:0; }
  .pg { width:100vw; height:100vh; overflow:hidden; page-break-after:always; }
  .pg:last-child { page-break-after:auto; }
  .pg img { display:block; width:100%; height:100%; object-fit:contain; }
</style>${images.map((im) => `<div class="pg"><img src="${im.data}"></div>`).join('')}`;

await page.setContent(html, { waitUntil: 'load' });
const buf = await page.pdf({ printBackground: true, width: `${images[0].w}px`, height: `${images[0].h}px` });
writeFileSync(OUT, buf);
await browser.close();
server.close();

console.log(`[fixture] Wrote ${OUT} — ${images.length} image-only page(s) from ${SRC}`);
console.log('[fixture] SYNTHETIC: proves the gate and plumbing, not OCR quality on real scans.');
