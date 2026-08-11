/**
 * Multimodal PDF extraction — recovers pages that the text layer can't.
 *
 * WHY THIS EXISTS
 * Extraction was `pdfjs.getTextContent()` and nothing else. That returns a flat
 * run of positioned glyphs, which is fine for prose and useless for anything
 * else:
 *   - A scanned paper has no text layer at all, so intake rejected it outright
 *     ("No extractable text — scanned/image-only PDF?").
 *   - Equations survive as scrambled inline debris — integral signs, fraction
 *     bars and superscripts lose their spatial meaning the moment they become
 *     a 1-D string.
 *   - Figures are invisible. `diagrams.js` synthesises SVGs from an LLM-invented
 *     description; nothing ever read the real figure off the page.
 *
 * WHAT THIS IS (AND ISN'T)
 * This is a TEXT-LAYER REPAIR plus a figure/equation sidecar — deliberately not
 * a replacement for the structuring pass. Per page: if the text layer is thin,
 * vision reconstructs that page's text, and the reconstructed text flows into
 * the existing runNotesExtraction / runPYQExtraction unchanged. The blast radius
 * stays inside extraction.
 *
 * BROWSER ONLY. Rendering needs a real <canvas>; the retired Node ingest script
 * had no canvas and is gone. Calling this outside a browser throws immediately
 * rather than failing somewhere confusing downstream.
 */

import { chatComplete } from './aiProxy';
import { loadPdfDocument, getPdfjs } from './pdfAnalyzer';
import { supabase } from './supabase';

/** A page with fewer than this many extracted characters is treated as
 *  image-only. 80 matches the existing image-PDF signal in pdfAnalyzer's
 *  analyzeText(), so the two agree on what "no real text" means. */
export const MIN_TEXT_CHARS = 80;

/** Hard ceiling on vision calls per document. A 300-page scan at detail:"high"
 *  is a real bill that would otherwise arrive with no warning. Pages past this
 *  keep whatever text layer they have and are reported back to the caller. */
export const MAX_VISION_PAGES = 40;

/** OpenAI downsamples to roughly 2000px on the long edge for detail:"high",
 *  so rendering larger is spend with no accuracy behind it. */
const RENDER_MAX_EDGE = 1600;

/** JPEG for the vision payload: a 2x A4 PNG is 1.5-3MB and base64 adds another
 *  third on top, per page, through an edge function. q0.85 lands ~150-350KB
 *  with no measurable OCR cost. Figure images stay PNG — they're line art,
 *  where JPEG ringing actually shows. */
const PAGE_JPEG_QUALITY = 0.85;

/**
 * Whether to crop a figure out of the page using the bounding box the vision
 * model reports. DEFAULT OFF, on evidence.
 *
 * Measured across the two pilots: 5 of 5 model boxes were materially wrong.
 * Three cropped nothing but body text; one clipped a real figure in half while
 * dragging in unrelated paragraphs; on the scanned page the box caught three of
 * the five figures and cut the left edge off the text it wrongly included.
 * Every one of those boxes was well-formed and plausibly sized, so structural
 * validation (isUsableBbox) let them all through — the boxes aren't malformed,
 * they're just inaccurate. That is a known VLM weakness: these models identify
 * THAT a figure exists far more reliably than WHERE it is.
 *
 * So the figure image is the WHOLE PAGE. Coarser, but always actually contains
 * the figure — and a student looking at the page it came from is strictly
 * better served than by a confidently-wrong crop of the wrong region. The
 * caption (which was consistently accurate) plus chapter/page is what makes it
 * findable.
 *
 * The real fix is geometric — but NOT the way this comment used to claim.
 * "Track the CTM through paintImageXObject" was audited on 2026-08-10 and is
 * WRONG for this corpus: every NCERT page paints exactly two rasters, a
 * full-bleed background and the "not to be republished" watermark, and both
 * repeat identically on every page. The actual figures are VECTOR line art,
 * invisible to every paintImage* op.
 *
 * The workable source is constructPath, whose pdfjs-6 args carry a free
 * per-path bounding box ([opsFlags, coords, minMax]) that CTM maps to an exact
 * page rect. A scratch prototype cropped real figures tightly where the model
 * bboxes went 0 for 5. Parked behind launch — full findings, the clustering
 * pitfall that matters, and the staged plan are in
 * docs/ACTION_ITEMS_FOR_YOU.md, "PARKED (post-launch) — geometric figure
 * cropping".
 */
const CROP_FROM_MODEL_BBOX = false;

export function isBrowser() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/* ── Gate ────────────────────────────────────────────────────────────── */

/**
 * True when a page needs the vision path. Kept as a named export (rather than
 * inlined) so the threshold is testable at its boundary — the difference
 * between 79 and 80 characters decides whether a page costs an AI call.
 */
export function needsVision(pageText, { minChars = MIN_TEXT_CHARS } = {}) {
  return (pageText ?? '').trim().length < minChars;
}

/**
 * True when a page paints a raster image — i.e. it probably contains a figure.
 *
 * This is a SECOND, independent trigger, and it exists because the thin-text
 * gate alone silently fails the figure half of the job: an NCERT chapter has a
 * perfectly good text layer, so `needsVision` returns false on every page, so
 * vision never runs, so its diagrams are never seen. The gate is correct for
 * TEXT REPAIR and wrong as the only route to FIGURES.
 *
 * Read off the operator list rather than guessed from caption text ("Fig. 4.1"),
 * because the operator list is what the renderer itself will execute — it can't
 * be fooled by a chapter that merely mentions a figure in prose.
 */
export async function pageHasRasterImage(pdfDoc, pageNo) {
  try {
    const lib = await getPdfjs();
    const OPS = lib.OPS ?? {};
    const paintOps = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject]
      .filter((v) => typeof v === 'number');
    if (!paintOps.length) return false;

    const page = await pdfDoc.getPage(pageNo);
    const { fnArray } = await page.getOperatorList();
    return fnArray.some((fn) => paintOps.includes(fn));
  } catch {
    return false;
  }
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function assertBrowser() {
  if (!isBrowser()) {
    throw new Error('pdfVision requires a browser environment (canvas rendering).');
  }
}

/**
 * Rasterises one page to a canvas, scaled so the long edge is ~maxEdge.
 * Upscaling is capped at 3x: a low-DPI source gains nothing from being blown up
 * past that, it just costs bytes.
 */
export async function renderPageToCanvas(pdfDoc, pageNo, { maxEdge = RENDER_MAX_EDGE } = {}) {
  assertBrowser();
  const page = await pdfDoc.getPage(pageNo);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxEdge / Math.max(base.width, base.height), 3);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width  = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  // Scanned pages often have transparent margins; without a white ground they
  // render as black once flattened into JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Rasterises a page straight to a data URI (JPEG by default — see the note on
 *  PAGE_JPEG_QUALITY for why this isn't PNG). */
export async function renderPageToImage(
  pdfDoc, pageNo, { maxEdge = RENDER_MAX_EDGE, format = 'jpeg', quality = PAGE_JPEG_QUALITY } = {},
) {
  const canvas = await renderPageToCanvas(pdfDoc, pageNo, { maxEdge });
  return canvas.toDataURL(`image/${format}`, quality);
}

/* ── Figure cropping ─────────────────────────────────────────────────── */

/**
 * Structural validation of a model-supplied bounding box.
 *
 * NOTE: passing this does NOT mean the box is correct — see CROP_FROM_MODEL_BBOX
 * below. This only rejects boxes that are malformed or degenerate. It is kept
 * because the box is still recorded as advisory metadata on content_figures,
 * and storing obvious garbage there helps nobody.
 */
export function isUsableBbox(bbox) {
  if (!bbox || typeof bbox !== 'object') return false;
  const { x, y, w, h } = bbox;
  if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) return false;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return false;
  if (x + w > 1.001 || y + h > 1.001) return false;
  // Slivers and near-full-page boxes carry no information over the whole page.
  if (w < 0.05 || h < 0.05) return false;
  if (w > 0.98 && h > 0.98) return false;
  return true;
}

/** Crops a normalised {x,y,w,h} region out of an already-rendered page canvas.
 *  PNG out — figures are line art. */
export function cropCanvas(pageCanvas, bbox) {
  assertBrowser();
  const sx = Math.round(bbox.x * pageCanvas.width);
  const sy = Math.round(bbox.y * pageCanvas.height);
  const sw = Math.round(bbox.w * pageCanvas.width);
  const sh = Math.round(bbox.h * pageCanvas.height);

  const out = document.createElement('canvas');
  out.width  = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(pageCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out;
}

function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob returned null'))), type, quality);
  });
}

const slug = (s) => (s || 'misc').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'misc';

/**
 * Uploads a cropped figure to the existing public `question-papers` bucket
 * (same bucket the manual per-question diagram upload already uses).
 * Returns a public URL, or null — a figure that fails to upload must never take
 * the whole ingestion down with it.
 */
export async function uploadFigure(blob, { subject, chapter } = {}) {
  try {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const path = `figures/${slug(subject)}/${slug(chapter)}/${name}`;
    const { error } = await supabase.storage
      .from('question-papers')
      .upload(path, blob, { upsert: true, contentType: 'image/png' });
    if (error) return null;
    const { data } = supabase.storage.from('question-papers').getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

/* ── Vision extraction ───────────────────────────────────────────────── */

const VISION_SYSTEM = `You transcribe a single page of an Indian exam-prep document (NCERT textbook chapter or an exam question paper) from an image.

Transcribe what is ACTUALLY ON THE PAGE. Never continue, summarise, complete or invent content — a partial sentence at a page edge stays partial. If the page is blank or unreadable, say so via an empty markdown string rather than guessing.

Return ONLY valid JSON.`;

function buildVisionPrompt({ subject, examType, pageNo, textLayer }) {
  return `Page ${pageNo}${subject ? ` of ${subject}` : ''}${examType ? ` (${examType})` : ''}.

${textLayer?.trim()
    ? `A partial text layer was extracted for this page. Use it to resolve ambiguous characters, but the IMAGE is authoritative — transcribe everything visible, including what the text layer missed:\n"""\n${textLayer.slice(0, 2000)}\n"""`
    : 'This page has no usable text layer — transcribe it entirely from the image.'}

Return JSON:
{
  "markdown": "Full page text in reading order. Preserve headings, numbered questions and list structure. Every mathematical or chemical expression MUST be LaTeX: inline $...$, display $$...$$. Chemical formulas as $\\\\text{H}_2\\\\text{SO}_4$. Where a figure sits, leave a line reading [FIGURE 1], [FIGURE 2] ... matching the figures array below.",
  "equations": [
    { "latex": "F = ma", "inline": true }
  ],
  "figures": [
    {
      "index": 1,
      "caption": "What the figure shows, including any labelled parts (e.g. 'Vector addition by the parallelogram law, with components A, B and resultant R labelled')",
      "kind": "diagram" | "graph" | "chemical_structure" | "table" | "photo",
      "bbox": { "x": 0.12, "y": 0.34, "w": 0.5, "h": 0.22 }
    }
  ]
}

bbox is the figure's position as fractions of the page (0-1, origin top-left). Give your best estimate; omit bbox entirely if you cannot place it confidently — an omitted box is handled correctly, a wrong one is not.
Return "equations": [] and "figures": [] when there are none.`;
}

/**
 * Runs one vision call for one page.
 *
 * Resolves to a null-ish result rather than throwing on a bad response: one
 * unreadable page must not abort a 40-page document. The caller keeps whatever
 * text layer that page already had.
 *
 * BUT IT SAYS SO. The result carries `ok` and, when false, an `error` reason.
 * This used to return a bare empty result for every failure, which made a rate
 * limit indistinguishable from a genuinely blank page — the document finished
 * with silently unrepaired pages and intake reported success. "Failed" and
 * "empty" are different claims and the caller needs to tell them apart.
 *
 * A caller abort still throws: cancelling means stop the document, whereas a
 * timeout (which aiProxy raises as AiRequestError, not AbortError) means fail
 * this page and carry on.
 */
export async function visionExtractPage(dataUri, textLayer, ctx = {}, { signal } = {}) {
  const empty = { markdown: '', equations: [], figures: [], ok: false, error: null };
  try {
    const resp = await chatComplete({
      model: 'gpt-4o',
      max_tokens: 4000,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: VISION_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: buildVisionPrompt({ ...ctx, textLayer }) },
            // detail:"high" is required — the small labels on a vector diagram
            // and the exponents in an equation are exactly what "low" discards.
            { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
          ],
        },
      ],
    }, { signal });

    const raw = resp?.choices?.[0]?.message?.content;
    if (!raw) return { ...empty, error: 'model returned an empty response' };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ...empty, error: 'model returned unparseable JSON' };
    }

    return {
      markdown:  typeof parsed.markdown === 'string' ? parsed.markdown : '',
      equations: Array.isArray(parsed.equations) ? parsed.equations.filter((e) => e?.latex) : [],
      figures:   Array.isArray(parsed.figures)   ? parsed.figures   : [],
      ok:        true,
      error:     null,
    };
  } catch (e) {
    // An aborted request is the caller cancelling or navigating away —
    // propagate it so the orchestrator stops instead of grinding through the
    // rest of the document.
    if (e?.name === 'AbortError') throw e;
    // Everything else (timeout, 429 past its retries, 5xx, network) is this
    // page's failure alone.
    return { ...empty, error: e?.message || 'vision call failed' };
  }
}

/* ── Orchestrator ────────────────────────────────────────────────────── */

/**
 * Extracts every page, repairing thin-text pages via vision.
 *
 * Returns the same `pages: string[]` shape the existing extractPdfPages()
 * returns, so the intake screen's downstream structuring is untouched — plus
 * the figures and equations found along the way.
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {{subject?: string, examType?: string, chapter?: string}} ctx
 * @param {{onProgress?: fn, maxVisionPages?: number, forceVision?: boolean, signal?: AbortSignal}} opts
 */
export async function extractPagesWithVision(arrayBuffer, ctx = {}, {
  onProgress,
  maxVisionPages = MAX_VISION_PAGES,
  forceVision = false,
  // Also visit pages that paint a raster image, even when their text layer is
  // fine. Without this, figures are only ever extracted from scanned documents
  // — a normal textbook chapter would yield zero. Set false for a text-only
  // pass (e.g. a plain question paper with no diagrams) to save the calls.
  extractFigures = true,
  signal,
} = {}) {
  const pdfDoc = await loadPdfDocument(arrayBuffer);
  const pageCount = pdfDoc.numPages;

  // Text layer first for every page — it's free, and on a clean digital PDF it
  // is also better than a transcription (no OCR substitution errors at all).
  const pages = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((s) => s.str).join(' '));
  }

  // Two independent reasons to look at a page: its text is unusable (repair),
  // or it carries a figure (extraction). Tracked separately so the caller can
  // report honestly on which reason drove the spend.
  const thinPages = [];
  const figurePages = [];
  for (let i = 0; i < pageCount; i++) {
    const pageNo = i + 1;
    if (forceVision || needsVision(pages[i])) { thinPages.push(pageNo); continue; }
    if (extractFigures && await pageHasRasterImage(pdfDoc, pageNo)) figurePages.push(pageNo);
  }

  // Text repair first: a page nobody can read is worse than a missing figure.
  const candidates = [...thinPages, ...figurePages];
  const targets = candidates.slice(0, maxVisionPages);
  const skipped = candidates.length - targets.length;
  const thinSet = new Set(thinPages);

  const figures = [];
  // Keyed by page number so a chunk can inherit the LaTeX from the pages it
  // actually spans — the notes extractor already reports a marker range per
  // lesson, which is what makes that association possible.
  const equationsByPage = {};
  let equationCount = 0;
  // Pages the model actually READ. This used to be incremented for every page
  // we merely attempted, so a document whose calls all failed still reported
  // "N page(s) read by vision" — an over-report of exactly the pages the
  // operator most needed to know about.
  let visionPageCount = 0;
  let repairedPageCount = 0;   // of those, pages whose text was actually replaced
  const failedPages = [];      // [{ pageNo, reason }] — surfaced to the caller

  // Index drives the progress counter rather than visionPageCount: a failed
  // page must still advance "3/16", or the display stalls on a number that
  // never moves again and looks exactly like the hang this replaces.
  for (const [idx, pageNo] of targets.entries()) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress?.(`Reading page ${pageNo} with vision… (${idx + 1}/${targets.length})`);

    let pageCanvas;
    try {
      pageCanvas = await renderPageToCanvas(pdfDoc, pageNo);
    } catch (e) {
      // Page won't rasterise — keep whatever text layer it had, but say so.
      failedPages.push({ pageNo, reason: e?.message || 'page could not be rasterised' });
      continue;
    }

    const dataUri = pageCanvas.toDataURL('image/jpeg', PAGE_JPEG_QUALITY);
    const result = await visionExtractPage(dataUri, pages[pageNo - 1], { ...ctx, pageNo }, { signal });

    if (!result.ok) {
      failedPages.push({ pageNo, reason: result.error || 'vision call failed' });
      continue;
    }

    // Only a page whose text was unusable gets overwritten. On a figure page
    // the extracted text layer is exact and the transcription is not — swapping
    // a good text layer for OCR would be a downgrade, and the reason we're on
    // this page at all is the figure, not the words.
    if (thinSet.has(pageNo) && result.markdown.trim()) {
      pages[pageNo - 1] = result.markdown;
      repairedPageCount += 1;
    }
    visionPageCount += 1;
    if (result.equations.length) {
      equationsByPage[pageNo] = result.equations.map((e) => e.latex).filter(Boolean);
      equationCount += equationsByPage[pageNo].length;
    }

    // One page image, uploaded once, shared by every figure the model reported
    // on it — with cropping off there is nothing to distinguish them, and
    // uploading N identical copies of the same page would be pure waste.
    let pageImageUrl = null;
    if (result.figures.length) {
      try {
        const blob = await canvasToBlob(pageCanvas, 'image/png');
        pageImageUrl = blob ? await uploadFigure(blob, { subject: ctx.subject, chapter: ctx.chapter }) : null;
      } catch { pageImageUrl = null; }
    }

    for (const fig of result.figures) {
      const structurallyOk = isUsableBbox(fig.bbox);
      let url = pageImageUrl;
      let cropped = false;

      if (CROP_FROM_MODEL_BBOX && structurallyOk) {
        try {
          const blob = await canvasToBlob(cropCanvas(pageCanvas, fig.bbox), 'image/png');
          const cropUrl = blob ? await uploadFigure(blob, { subject: ctx.subject, chapter: ctx.chapter }) : null;
          if (cropUrl) { url = cropUrl; cropped = true; }
        } catch { /* fall back to the page image */ }
      }
      if (!url) continue;

      figures.push({
        page_no: pageNo,
        image_url: url,
        caption: typeof fig.caption === 'string' ? fig.caption.slice(0, 500) : null,
        kind: ['diagram', 'graph', 'chemical_structure', 'table', 'photo'].includes(fig.kind) ? fig.kind : null,
        // Advisory only — recorded so a future geometric pass can be compared
        // against it, NOT used to produce the image above.
        bbox: structurallyOk ? fig.bbox : null,
        cropped,
      });
    }

  }

  return {
    pages,
    figures,
    equationsByPage,
    equationCount,
    visionPageCount,
    repairedPageCount,
    thinPageCount: thinPages.length,
    figurePageCount: figurePages.length,
    pageCount,
    skippedVisionPages: skipped,
    // Pages we tried and could not read, with the reason for each. Distinct
    // from skippedVisionPages, which were never attempted (over the cap).
    failedPages,
    failedPageCount: failedPages.length,
  };
}
