/**
 * Reads a textbook's OWN contents page and prints it, for Stage B of the
 * non-STEM corpus load.
 *
 *   node scripts/read-book-contents.mjs                      # every discovered book
 *   node scripts/read-book-contents.mjs --book hornbill      # one book, substring match
 *   node scripts/read-book-contents.mjs --pages 8            # scan more front matter
 *   node scripts/read-book-contents.mjs --raw                # full text, no line filtering
 *
 * WHY THIS EXISTS RATHER THAN A WEB SEARCH
 * Third-party chapter lists disagree across the 2023 NCERT rationalisation. That
 * edition mismatch is exactly what produced the 10 stale Class 8 Maths syllabus
 * rows — names that looked right, snapped cleanly, and pointed at chapters with
 * no corpus behind them. The book in hand is the only source that cannot be a
 * different edition from the book being loaded.
 *
 * WHY THE POSITIONAL SORT MATTERS
 * pdfjs returns text items in CONTENT-STREAM order, which on a two-column or
 * boxed contents page is not reading order — a naive join produces interleaved
 * garbage ("1 Chapter 7 The Portrait 23 of a Lady"). Items are therefore bucketed
 * into lines by their y coordinate and sorted top-to-bottom, then left-to-right
 * within a line. This is the method that worked on the Kerala SCERT contents
 * pages where a naive join did not.
 *
 * READ-ONLY. Opens local PDFs, prints to stdout, writes nothing and calls no
 * API. Nothing here costs tokens.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';

const CORPUS = process.env.CORPUS_DIR
  ? resolve(process.env.CORPUS_DIR)
  : resolve('C:/Users/THASLIM/OneDrive/Documents/ewe_data/cbse ncrt notes');

const argOf = (flag, dflt) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const ONLY      = argOf('--book', null)?.toLowerCase() ?? null;
const MAX_PAGES = Number(argOf('--pages', 6));
const RAW       = process.argv.includes('--raw');
const FIND      = process.argv.includes('--find-contents');

/* ── Book discovery ──────────────────────────────────────────────────────
 *
 * A "book" is the deepest folder that directly contains PDFs. That is what makes
 * Hornbill and Woven Words two books rather than one "English", and it is also
 * why `chemistry part 1` / `part 2` would surface as two here — the caller
 * decides which pairs are two volumes of one book (continuous numbering) and
 * which are two separate books (each numbering from 1). This script reports; it
 * does not classify.
 */
function walkBooks(dir, out = []) {
  const entries = readdirSync(dir);
  const pdfs = entries.filter((e) => /\.pdf$/i.test(e));
  const subs = entries.filter((e) => {
    try { return statSync(join(dir, e)).isDirectory(); } catch { return false; }
  });
  if (pdfs.length) out.push({ dir, pdfs: pdfs.sort() });
  for (const s of subs) walkBooks(join(dir, s), out);
  return out;
}

/* The prelims file carries the cover and the contents page. NCERT names it
 * `<code>ps.pdf`; the hand-named folders use some spelling of "index". These are
 * exactly the files bulk-load-corpus skips as front matter — front matter is
 * useless as a chapter but it is the single most useful file here. */
function contentsCandidates(pdfs) {
  const ps    = pdfs.filter((f) => /ps\.pdf$/i.test(f));
  const index = pdfs.filter((f) => /index|intex|contents/i.test(f));
  const rest  = pdfs.filter((f) => !ps.includes(f) && !index.includes(f));
  return [...index, ...ps, ...rest.slice(0, 1)];
}

/* ── Positional text extraction ─────────────────────────────────────── */

async function pageLines(page) {
  const content = await page.getTextContent();
  const rows = new Map(); // rounded y -> items

  for (const item of content.items) {
    if (!item.str?.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    // 2pt buckets: superscripts and slightly-off baselines belong to their line,
    // but genuinely separate lines stay separate.
    const key = Math.round(y / 2) * 2;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push({ x, str: item.str });
  }

  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])                       // top of page first
    .map(([, items]) => items
      .sort((a, b) => a.x - b.x)                       // left to right
      .map((i) => i.str).join(' ')
      .replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/* A contents line is a title, usually with a page number trailing it. Dropping
 * everything else keeps ~200 lines of prelims boilerplate out of the output —
 * but --raw exists because a book whose contents page this filter misreads must
 * be inspectable, not silently empty. */
/* NCERT sets some headings with a drop-shadow effect: the same string is painted
 * several times at tiny offsets, and the text layer keeps every copy. The heading
 * arrives as "Contents Contents Contents Contents Contents", and — because the
 * copies sit within the same y-bucket — as one line. Collapsing immediate word
 * repetition recovers the heading.
 *
 * This silently defeated the detector on First Flight, Footprints Without Feet
 * and Contemporary India II: all three DO print a contents page, and all three
 * reported "no Contents heading". A miss that looks like an absent page is the
 * dangerous shape here, because the fallback is guessing chapter names. */
const dedupeShadow = (l) =>
  l.trim().replace(/\b(\S+)(\s+\1\b)+/gi, '$1').replace(/\s+/g, ' ').trim();

const looksLikeContentsLine = (l) =>
  l.length > 3 && l.length < 120 && /[A-Za-z\u0900-\u097F]/.test(l);

async function readBook({ dir, pdfs }) {
  const rel = relative(CORPUS, dir).replace(/\\/g, '/');
  console.log(`\n${'='.repeat(78)}\n${rel}\n  ${pdfs.length} pdfs  |  ${pdfs.slice(0, 3).join(', ')}${pdfs.length > 3 ? ', …' : ''}`);

  const candidate = contentsCandidates(pdfs)[0];
  if (!candidate) { console.log('  (no pdf)'); return; }
  console.log(`  reading: ${candidate}\n`);

  let task, doc;
  try {
    task = getDocument({
      data: new Uint8Array(readFileSync(join(dir, candidate))),
      // NCERT PDFs carry embedded CID fonts; without these pdfjs drops Devanagari
      // and some ligatures entirely, which would silently blank the Hindi books.
      useSystemFonts: true,
      standardFontDataUrl: './node_modules/pdfjs-dist/standard_fonts/',
    });
    doc = await task.promise;
  } catch (e) {
    console.log(`  ⚠ could not open: ${e.message}`);
    return;
  }

  const n = Math.min(doc.numPages, MAX_PAGES);
  let printed = 0;
  for (let p = 1; p <= n; p++) {
    const lines = await pageLines(await doc.getPage(p));

    /* NCERT prelims run 10+ pages of foreword, rationalisation note, committee
     * list and acknowledgements before the contents. Printing all of it buries
     * the one page that matters, so --find-contents keeps only the page whose
     * heading IS "Contents" and the page after it (the list often runs over). */
    if (FIND) {
      /* Not just lines[0], and not a plain string compare. The heading is
       * sometimes preceded by a running header or a stray artefact, and NCERT
       * sets it in SMALL CAPS, which this corpus's fonts render as separate
       * glyphs — "Contents" comes back as "C ontents" or "C O N T E N T S". The
       * spaced-letter pattern matches all of those without matching the word
       * "contents" occurring in a sentence, because it is anchored. */
      const isContents = lines.slice(0, 3)
        .some((l) => /^c\s*o\s*n\s*t\s*e\s*n\s*t\s*s$/i.test(dedupeShadow(l)));
      if (isContents) printed = 2;
      if (!printed) continue;
      printed--;
    }

    const shown = RAW ? lines : lines.filter(looksLikeContentsLine);
    if (!shown.length) continue;
    console.log(`  ── page ${p} ${'─'.repeat(60)}`);
    for (const l of shown) console.log(`    ${l}`);
  }
  if (FIND && !printed && n === MAX_PAGES) {
    console.log(`  (no "Contents" heading in the first ${n} pages — raise --pages, or the book may not print one)`);
  }
  // pdfjs 6 has no doc.destroy(); the loading TASK owns teardown. Without this
  // the worker stays alive and a full run over ~35 books leaks one per book.
  await task.destroy();
}

/* ── main ────────────────────────────────────────────────────────────── */

const books = walkBooks(CORPUS)
  .filter((b) => !ONLY || `${b.dir}`.toLowerCase().includes(ONLY));

console.log(`corpus : ${CORPUS}`);
console.log(`books  : ${books.length}${ONLY ? `  (filtered by "${ONLY}")` : ''}`);

for (const b of books) await readBook(b);
console.log('');
