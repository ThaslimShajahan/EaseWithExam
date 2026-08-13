/**
 * Bulk-loads the local NCERT corpus into knowledge_base through the Phase 1
 * pipeline, as disposable dev data.
 *
 *   npm run dev                              (note the port)
 *   BASE_URL=http://localhost:5175 node scripts/bulk-load-corpus.mjs --dry-run
 *   BASE_URL=http://localhost:5175 node scripts/bulk-load-corpus.mjs
 *   ... --concurrency=4 --limit=5 --reset
 *   ... --file-timeout=20        (minutes per file before it is failed)
 *
 * Drives the REAL production modules — src/lib/pdfVision.js and
 * src/lib/contentExtraction.js — inside browser pages served by Vite, exactly
 * as scripts/run-pilot.mjs does. No separate ingestion logic exists here: the
 * retired 800-char chunker and the old bulk script are gone and stay gone.
 *
 * SCOPE: STEM only, figures OFF (option D).
 *   Figure extraction is disabled because pageHasRasterImage() has a 100% hit
 *   rate on this corpus — NCERT pages paint a raster on essentially every page,
 *   so the figure trigger provides no selectivity and would turn ~3,000 pages
 *   into ~3,000 vision calls (~$63, ~16h) for full-page images that cropping is
 *   currently disabled for anyway. With it off, vision fires only on genuinely
 *   thin-text pages (~3% measured).
 *
 * NOT WRITTEN: study_notes rows. That path goes through admin_upsert_study_note,
 * which needs an authenticated admin session this script does not have. Phase
 * 2-5 read knowledge_base, which is what this populates.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
// Plain ESM with no imports of its own, so it loads in node exactly as it does
// in the browser — one mapping table, not a copy that can drift.
import { resolveCorpusFile, workbookUnitFor } from '../src/lib/corpusMapping.js';

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/**
 * Corpus root. CLASS_BY_TOP matches the FIRST path segment below this, so this
 * must point at the folder whose children are '10 NCRT', '9 NCRT', 'NCRT 8',
 * '11 NCRT SC' — not at their parent. Point it one level too high and every
 * file is silently skipped as `unknownClass`.
 *
 *   CORPUS_DIR="/c/Users/.../ewe_data/cbse ncrt notes" node scripts/bulk-load-corpus.mjs --dry-run
 *
 * Overridable rather than hardcoded because the corpus lives outside the repo
 * (it is ~1.6GB and gitignored) and has already moved once.
 */
const CORPUS = process.env.CORPUS_DIR
  ? resolve(process.env.CORPUS_DIR)
  : resolve(ROOT, 'easy with exam');
const BASE   = process.env.BASE_URL || 'http://localhost:5173';
const CHECKPOINT = resolve(ROOT, '.corpus-load-checkpoint.json');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const DRY_RUN     = process.argv.includes('--dry-run');
const RESET       = process.argv.includes('--reset');
const LIMIT       = Number(arg('limit', Infinity));
/* Run the corpus in class-sized batches rather than one long unattended pass.
 * A 229-file run is hours of paid model calls, and a fault 180 files in is
 * discovered far too late -- batching gives a natural sample-check point and
 * bounds what a bad batch can cost. The checkpoint makes batches resumable and
 * non-overlapping. */
const ONLY_CLASS  = arg('class', null);
/* Spot-load specific files by path substring. Exists so a taxonomy change can be
 * proven on files CHOSEN to exercise it before a full batch is paid for: two
 * conceptual chapters landing in 'prose' cannot distinguish "these chapters are
 * prose" from "the new content types never fire". */
const ONLY_MATCH  = arg('match', null);

// Default 1, not 4. OpenAI charges `max_tokens` as RESERVED against the TPM
// budget, not just what a call actually consumes — the structuring call
// reserves 16k on top of ~8k of input, so one request claims ~24k of this
// org's 30,000 TPM. Two in flight exceed the limit before either returns;
// concurrency 4 failed on 24 of 26 files with nothing but 429s. Raise this
// only after raising the org's rate limit.
const CONCURRENCY = Math.max(1, Math.min(6, Number(arg('concurrency', 1))));
const MAX_RETRIES = Number(arg('retries', 6));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e) => /rate limit|429|TPM|tokens per min/i.test(String(e?.message ?? e));

/* Per-file deadline.
 *
 * Nothing in the chain below processFile() sets one. The model calls happen
 * inside the page, through the same modules the app uses, and a request that
 * never settles therefore stalls the whole queue: no error, no FAIL line, no
 * checkpoint write, the run simply stops advancing until someone notices. That
 * is the identical hole src/lib/aiProxy.js closed for the vision upload, which
 * sat on "Reading page 4 with vision…" for 15+ minutes against `signal:
 * undefined`. A load meant to run unattended overnight cannot carry it.
 *
 * The deadline lives here rather than in aiProxy's withDeadline() because there
 * is no signal to hand the in-page work — page.evaluate() takes none. Racing a
 * timer is the only lever node has, so a fired deadline leaves the in-page call
 * still running: the caller MUST tear the context down, which is the sole real
 * cancellation available. See the timeout branch in worker(). */
const FILE_TIMEOUT_MS = Math.max(1, Number(arg('file-timeout', 20))) * 60_000;
const TIMEOUT_MARK    = 'file deadline exceeded';
const isFileTimeout   = (e) => String(e?.message ?? e).includes(TIMEOUT_MARK);

function withDeadline(promise, timeoutMs) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${TIMEOUT_MARK} after ${Math.round(timeoutMs / 60_000)}m`)),
      timeoutMs,
    );
  });
  // The losing promise is deliberately not awaited — on a timeout it is the
  // abandoned in-page work, and it dies with the context the caller closes.
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/* ── Scope: which folders are STEM ──────────────────────────────────── */

const CLASS_BY_TOP = { 'ncrt 8': '8', '9 ncrt': '9', '10 ncrt': '10', '11 ncrt sc': '11' };

// Second-level folder -> subject. Matched on a normalised lowercase name, so
// the corpus's inconsistent casing and spacing ("chemistry part 1",
// "NCRT CLASS 8 MATHS  GANITHAPRAKASH PART 1") all resolve.
function subjectForFolder(folder) {
  const f = folder.toLowerCase();
  // Exclusions run FIRST: "COMPUTER SCIENCE" and "POLITICAL SCIENCE ..." both
  // contain "science" and were otherwise swept in by the generic match below,
  // adding 29 non-STEM files as a bogus "Class 11 Science".
  if (f.includes('computer') || f.includes('political') || f.includes('social')) return null;
  if (f.includes('biotech'))   return 'Biotechnology';
  if (f.includes('biology'))   return 'Biology';
  if (f.includes('chemistry')) return 'Chemistry';
  if (f.includes('physics'))   return 'Physics';
  if (f.includes('math'))      return 'Mathematics';
  if (f.includes('science'))   return 'Science';   // Class 8/9/10 combined science
  return null;                                     // -> not STEM, skipped
}

// NCERT short-code filenames end in two digits for a real chapter; letter
// suffixes are front matter (an = answers, ps = prelims, aN = appendix).
// Loading those as chapters would put "Answers" in the chapter list.
const NCERT_CODE = /^([a-z]{4})(\d)([a-z0-9]{2})$/i;

/* The non-STEM folders are largely HAND-NAMED, so the code check above sees
 * nothing to reject in them. Every one of these is front matter that would
 * otherwise load as a chapter:
 *
 *   *INDEX.pdf / CURIOSITY INTEX.pdf   contents pages (note the typo)
 *   FIRST FLIGHT Text Book...pdf       prelims of the whole book
 *   PART 1.pdf                         Class 8 Social prelims
 *   full unit.pdf                      an AUDIO TRANSCRIPT APPENDIX, despite
 *                                      the name promising the opposite
 *   POLITICAL MAP.pdf                  a map plate
 *
 * This is not hypothetical for STEM either: `Exploration text book for 9.pdf`
 * IS currently loaded, and is why CBSE Class 9 Science carries a 21-chunk
 * chapter called "Exploration" alongside the real "Exploration: Entering the
 * World of Secondary Science". Pre-existing, recorded in ACTION_ITEMS, and NOT
 * repaired here — this only stops it recurring. The file is checkpointed, so
 * adding it here does not trigger a reload. */
/* ANCHOR ANYTHING THAT COULD APPEAR INSIDE A CHAPTER TITLE. The dry-run caught
 * an unanchored /political map/ eating a real chapter — Class 8 Social's
 * `THEME B CHAPTER 2 RESHAPING INDIA_S POLITICAL MAP.pdf` — while the intended
 * target was a standalone map plate named exactly `POLITICAL MAP.pdf`. A
 * front-matter rule that silently drops a chapter is worse than one that lets
 * front matter through: the extra chapter is visible in the chapter list, the
 * missing one is not. */
const FRONT_MATTER_NAME = [
  /\bindex\b/i,           // "... INDEX.pdf"
  /\bintex\b/i,           // the "CURIOSITY INTEX.pdf" typo
  /text\s*book/i,         // "... Text Book for class 10", "Exploration text book for 9"
  /^full unit/i,
  /^part\s*\d+$/i,        // "PART 1" — a whole volume's prelims, not a chapter
  /^political map$/i,     // the standalone map plate ONLY — see the note above
  /^learning material/i,
];

/* Book-title-as-filename. These carry no marker at all — the only thing that
 * identifies them is knowing the book. Listed explicitly rather than pattern-
 * matched, because a pattern loose enough to catch them would eat real
 * chapters. Verified in Stage B: Kaveri.pdf is Kaveri's front matter and
 * GANITA MANJARI.pdf is the Class 9 Maths book file. */
const FRONT_MATTER_EXACT = new Set([
  'kaveri',
  'ganita manjari',
  'exploration text book for 9',
  'first flight text book for class 10',
  // Class 9 Social's whole-volume prelims: 24 pages of title page, foreword and
  // the contents page. Same role as Class 8 Social's `PART 1.pdf`, but named
  // after the book instead, so no pattern catches it.
  'understanding society india and beyond',
]);

function isFrontMatter(file) {
  const name = basename(file, extname(file)).trim();
  const m = name.match(NCERT_CODE);
  if (m) return !/^\d{2}$/.test(m[3]);
  if (FRONT_MATTER_EXACT.has(name.toLowerCase().replace(/\s+/g, ' '))) return true;
  return FRONT_MATTER_NAME.some((re) => re.test(name));
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.pdf$/i.test(e)) out.push(f);
  }
  return out;
}

/* Hindi is deferred: every Hindi PDF carries a legacy Devanagari encoding rather
 * than Unicode, so the text layer extracts as mojibake ("gfjgj dkdk" for
 * हरिहर काका). Not a scan and not corrupt — the glyphs are there, the character
 * map is not. Skipped explicitly and COUNTED, rather than falling out of
 * resolveCorpusFile() as an unremarkable null, so the number stays visible.
 * See ACTION_ITEMS: revisit with forceVision. */
const HINDI_DIR = /hindi|aroh|kshitij|krithika|sparsh|sanchayan/i;

function buildQueue() {
  const jobs = [];
  const skipped = { hindi: 0, unmapped: 0, unmappedFiles: [], frontMatter: 0, unknownClass: 0 };

  for (const abs of walk(CORPUS).sort()) {
    const rel   = relative(CORPUS, abs).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts[0] === '_pilot') continue;

    const classLevel = CLASS_BY_TOP[parts[0].toLowerCase()];
    if (!classLevel) { skipped.unknownClass++; continue; }

    if (HINDI_DIR.test(rel)) { skipped.hindi++; continue; }

    /* Front matter is decided BEFORE any book resolution. It is a property of
     * the file, not of the mapping, and running it later mislabels things: the
     * workbook's own prelims (`jewe2ps.pdf`) reached the workbook branch first
     * and were counted "unmapped", which reads as a gap in the book table when
     * it is simply a prelims page being correctly ignored. Same outcome, wrong
     * diagnosis — and the diagnosis is the reason the counters exist. */
    if (isFrontMatter(abs)) { skipped.frontMatter++; continue; }

    /* STEM keeps its original path, untouched. 148 files were classified by
     * subjectForFolder() and are checkpointed against it; re-deriving them
     * through the new mapping would risk a different subject for an already
     * loaded file, which is a corpus problem for zero gain. */
    const stem = parts.length > 1 ? subjectForFolder(parts[1]) : null;

    let job = null;
    if (stem) {
      job = { rel, abs, subject: stem, classLevel, examType: `CBSE Class ${classLevel}`, book: null };
    } else {
      const m = resolveCorpusFile(rel);
      // Named, not just counted: an unmapped file is a book table gap, and a
      // bare count hides which book is missing.
      if (!m) { skipped.unmapped++; skipped.unmappedFiles.push(rel); continue; }

      job = {
        rel, abs,
        subject:  m.subject,
        classLevel,
        examType: m.examType,
        book:     m.book,
        contentTypeOverride: m.contentTypeOverride ?? null,
      };

      /* The workbook attaches to the reader: its chapters must be First
       * Flight's, not names invented from its own unit headings. Units 3 and 5
       * carry several candidates, which are handed to matchSyllabusChapter
       * rather than resolved here. */
      if (m.attachesTo) {
        const wu = workbookUnitFor(basename(abs));
        if (!wu) { skipped.unmapped++; skipped.unmappedFiles.push(`${rel} (workbook file with no unit ordinal)`); continue; }
        job.forceUnit         = wu.unit;
        job.chapterCandidates = wu.chapters;
      }

      /* A sanity check the STEM path never needed: exam_type from the mapping
       * must agree with the folder the file physically sits in. Disagreement
       * means the book table and the corpus layout have drifted. */
      if (m.examType !== `CBSE Class ${classLevel}`) {
        throw new Error(`exam_type mismatch for ${rel}: mapping says ${m.examType}, folder says CBSE Class ${classLevel}`);
      }
    }

    jobs.push(job);
  }
  return { jobs, skipped };
}

/* ── Checkpoint ─────────────────────────────────────────────────────── */

function loadDone() {
  if (RESET && existsSync(CHECKPOINT)) unlinkSync(CHECKPOINT);
  try { return new Set(JSON.parse(readFileSync(CHECKPOINT, 'utf8')).done ?? []); }
  catch { return new Set(); }
}
function saveDone(done) {
  writeFileSync(CHECKPOINT, JSON.stringify({ done: [...done], updatedAt: new Date().toISOString() }, null, 2));
}

/* ── Corpus file server (CORS-enabled) ──────────────────────────────── */
// The corpus is ~500MB and lives outside public/. Serving it over its own
// origin avoids copying half a gigabyte into the Vite public dir.
function startCorpusServer() {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(req.url.replace(/^\//, ''));
    const file = resolve(CORPUS, rel);
    if (!file.startsWith(resolve(CORPUS)) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/* ── The per-file pipeline, run inside the browser ──────────────────── */

async function processFile(page, job, corpusOrigin) {
  return page.evaluate(async ({ url, subject, examType, source, forceUnit, chapterCandidates, contentTypeOverride }) => {
    const [{ extractPagesWithVision }, ce, { adminSaveKnowledgeChunks }] = await Promise.all([
      import('/src/lib/pdfVision.js'),
      import('/src/lib/contentExtraction.js'),
      import('/src/lib/supabase.js'),
    ]);

    const buf = await (await fetch(url)).arrayBuffer();

    // extractFigures:false -> vision fires only on genuinely thin-text pages.
    const ex = await extractPagesWithVision(buf, { subject, examType }, { extractFigures: false });

    const rawText = ex.pages.join('\n\n').trim();
    if (rawText.length < 500) return { skipped: 'no usable text', pages: ex.pageCount };

    const marked = ex.pages.map((t, i) => `[[PAGE ${i + 1}]]\n${t}`).join('\n\n');
    const { unit, lessons } = await ce.runNotesExtraction({
      rawText: marked, pages: ex.pages, examType, subject, onProgress: () => {},
    });

    // Chapter name comes from the AI-read lesson title, not the filename —
    // NCERT short codes like "jesc101.pdf" carry no title at all.
    //
    // EXCEPT for a workbook, whose content belongs to the READER's chapters.
    // Left to its own titles it would coin "Unit 3" or "Two Stories about
    // Flying" — the second of which matches no chapter row at all, because that
    // printed chapter was split into two. Snapping onto the supplied candidates
    // is what makes the exercises land on the texts they are about.
    const resolveChapter = (lesson) => {
      const title = lesson.title || 'Untitled';
      if (!chapterCandidates?.length) return title;
      if (chapterCandidates.length === 1) return chapterCandidates[0];
      return ce.matchSyllabusChapter(title, chapterCandidates);
    };

    const rows = lessons.flatMap((lesson) => ce.buildKbRows({
      lesson,
      chapterName: resolveChapter(lesson),
      unit: forceUnit ?? unit,
      subject, examType, source,
      figures: [], equationsByPage: ex.equationsByPage,
    }));
    if (!rows.length) return { skipped: 'no chunks', pages: ex.pageCount };

    // A workbook is exercises, whatever the classifier decided per chunk.
    if (contentTypeOverride) for (const r of rows) r.content_type = contentTypeOverride;

    const inserted = await adminSaveKnowledgeChunks(rows);

    return {
      pages: ex.pageCount,
      visionCalls: ex.visionPageCount,
      lessons: lessons.length,
      chapters: [...new Set(rows.map((r) => r.chapter))],
      rows: rows.length,
      inserted: inserted?.length ?? 0,
      typed: rows.filter((r) => r.content_type).length,
    };
  }, {
    url: `${corpusOrigin}/${job.rel}`,
    subject: job.subject,
    examType: job.examType,
    source: `corpus:${job.rel}`,
    forceUnit:           job.forceUnit ?? null,
    chapterCandidates:   job.chapterCandidates ?? null,
    contentTypeOverride: job.contentTypeOverride ?? null,
  });
}

/* ── Main ───────────────────────────────────────────────────────────── */

const { jobs, skipped } = buildQueue();
const done  = loadDone();
const queue = jobs
  .filter((j) => !done.has(j.rel))
  .filter((j) => !ONLY_CLASS || j.classLevel === String(ONLY_CLASS))
  .filter((j) => !ONLY_MATCH || j.rel.toLowerCase().includes(ONLY_MATCH.toLowerCase()))
  .slice(0, LIMIT);

console.log(`\ncorpus       : ${CORPUS}`);
console.log(`mapped files : ${jobs.length}   (skipped: ${skipped.hindi} Hindi (deferred), ${skipped.unmapped} unmapped, ${skipped.frontMatter} front-matter, ${skipped.unknownClass} unknown-class)`);
if (skipped.unmappedFiles.length) {
  console.log('unmapped     :');
  for (const f of skipped.unmappedFiles) console.log(`   ${f}`);
}
console.log(`already done : ${done.size}`);
console.log(`to process   : ${queue.length}${ONLY_CLASS ? `   (filtered to Class ${ONLY_CLASS})` : ''}   concurrency=${CONCURRENCY}   figures=OFF`);

/* Grouped by class so the queue can be reviewed and run in class-sized batches,
 * and by book so a multi-book subject is visibly two lines rather than one
 * summed one — which is the whole point of the book dimension. */
const bySubject = {};
for (const j of queue.length ? queue : jobs) {
  const k = `Class ${j.classLevel} ${j.subject}${j.book ? ` / ${j.book}` : ''}`;
  bySubject[k] = (bySubject[k] ?? 0) + 1;
}
console.log(`\nbreakdown (${queue.length ? 'QUEUED' : 'all mapped'}):`);
let lastClass = null;
for (const [k, v] of Object.entries(bySubject).sort()) {
  const cls = k.split(' ').slice(0, 2).join(' ');
  if (cls !== lastClass) { console.log(`  ── ${cls}`); lastClass = cls; }
  console.log(`     ${k.replace(/^Class \d+ /, '').padEnd(56)} ${String(v).padStart(3)}`);
}

const wb = (queue.length ? queue : jobs).filter((j) => j.contentTypeOverride);
if (wb.length) {
  console.log(`\n  workbook files (content_type forced, chapters snapped to the reader): ${wb.length}`);
  for (const j of wb) console.log(`     ${basename(j.abs).padEnd(18)} unit "${j.forceUnit}" -> ${j.chapterCandidates.join(' | ')}`);
}

if (DRY_RUN) {
  console.log('\nDRY RUN — nothing fetched, nothing written.\n');
  process.exit(0);
}
if (!queue.length) { console.log('\nNothing to do.\n'); process.exit(0); }

// If the Vite dev server is down, every page.evaluate fails instantly with
// "Failed to fetch dynamically imported module" and the run burns the entire
// queue in seconds while reporting each file as a genuine failure — that cost
// 10 files in one slice before the cause (a dead server on the configured port)
// was visible. Check once, up front, and refuse to start rather than produce a
// queue-length list of misleading failures.
{
  const probe = `${BASE}/src/lib/pdfVision.js`;
  const res = await fetch(probe).catch((e) => ({ ok: false, status: e.code ?? 'unreachable' }));
  if (!res.ok) {
    console.error(`\nDev server not serving modules at ${probe} (${res.status}).`);
    console.error('Start it with `npm run dev` and pass the port it prints as BASE_URL.\n');
    process.exit(1);
  }
}

const corpusServer = await startCorpusServer();
const corpusOrigin = `http://127.0.0.1:${corpusServer.address().port}`;

let browser = await chromium.launch();

async function openPage() {
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function newPage() {
  // When the renderer dies it takes the whole browser process with it, not just
  // the tab — the first recovery attempt failed with "browser has been closed"
  // from newContext(). So reviving means relaunching Chromium, not reusing it.
  if (!browser.isConnected()) {
    console.log('        [browser] disconnected — relaunching Chromium');
    browser = await chromium.launch();
  }
  try {
    return await openPage();
  } catch (e) {
    // isConnected() is not sufficient. Chromium can still report itself
    // connected and then crash the very target it just handed out, so the guard
    // above never fires and newContext()/newPage() throws "Target crashed"
    // instead. That escaped the SCHEDULED recycle, which runs outside the
    // per-file try/catch, and so took the whole process down with an uncaught
    // exception 91 files in with 33 still queued -- every completed file was
    // checkpointed, but the run stopped dead. Relaunching and retrying once
    // turns that back into the recoverable condition the per-file path already
    // treats it as.
    if (!isPageDead(e)) throw e;
    console.log('        [browser] target crashed on open — relaunching Chromium');
    try { await browser.close(); } catch { /* already gone */ }
    browser = await chromium.launch();
    return await openPage();
  }
}

// Every file loads a whole PDF as an ArrayBuffer into the SAME renderer and
// leaves pdfjs document state behind it. Held across a hundred files that grows
// until Chromium's renderer dies with "Target crashed" — measured: it crashed
// 7 files into a 48-file slice and every remaining file then failed instantly
// against the dead page. Recycling the context on a fixed interval keeps the
// renderer's lifetime bounded instead of hoping it survives the queue.
const PAGE_RECYCLE = Number(arg('recycle', 8));
const isPageDead = (e) => /target crashed|target closed|page has been closed|browser has been closed|session closed/i.test(String(e?.message ?? e));

const pages = [];
for (let i = 0; i < CONCURRENCY; i++) pages.push(await newPage());

let cursor = 0, ok = 0, failed = 0, skippedRun = 0;
let totalRows = 0, totalTyped = 0, totalVision = 0, totalPages = 0;
const started = Date.now();
const failures = [];

async function worker(page, id) {
  let sinceRecycle = 0;

  // Closing the context tears down the renderer and everything it was holding.
  const recycle = async (why) => {
    console.log(`        [worker ${id}] ${why} — restarting browser context`);
    try { await page.context().close(); } catch { /* already gone */ }
    page = await newPage();
    sinceRecycle = 0;
  };

  while (true) {
    const i = cursor++;
    if (i >= queue.length) return;
    const job = queue[i];
    const label = `[${String(i + 1).padStart(3)}/${queue.length}]`;

    if (sinceRecycle >= PAGE_RECYCLE) await recycle(`${PAGE_RECYCLE} files processed`);

    try {
      // A 429 is a "come back later", not a failure — the file is perfectly
      // loadable, the budget just isn't free yet. Backing off and retrying is
      // the difference between a resumable load and one that burns through the
      // whole queue producing nothing.
      let r, attempt = 0, revived = false;
      for (;;) {
        try { r = await withDeadline(processFile(page, job, corpusOrigin), FILE_TIMEOUT_MS); break; }
        catch (e) {
          // The deadline fired, so the in-page call is still live — it would go
          // on spending quota and would race the next file scheduled onto this
          // page. Closing the context is the only thing that actually stops it.
          // The file is then failed loudly rather than retried: a stuck file is
          // usually stuck for a reason, and a retry costs another full deadline
          // of wall clock. It stays out of the checkpoint, so a later run picks
          // up exactly it while the queue keeps moving now.
          if (isFileTimeout(e)) {
            await recycle(TIMEOUT_MARK);
            throw e;
          }
          // A dead renderer is not this file's fault, and it does not heal on
          // its own — without this the loop below would run the entire rest of
          // the queue against a corpse, failing every file in milliseconds
          // (measured: 20 files "failed" that way in one slice). Rebuild the
          // page and give the file one honest retry.
          if (isPageDead(e)) {
            if (revived) throw e;
            revived = true;
            await recycle('renderer crashed');
            continue;
          }
          if (!isRateLimit(e) || ++attempt > MAX_RETRIES) throw e;
          const wait = Math.min(20000 * attempt, 90000);
          console.log(`${label} 429   ${job.rel}  — backing off ${wait / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
          await sleep(wait);
        }
      }
      sinceRecycle++;
      if (r.skipped) {
        skippedRun++;
        console.log(`${label} SKIP  ${job.rel}  (${r.skipped})`);
      } else {
        ok++; totalRows += r.rows; totalTyped += r.typed;
        totalVision += r.visionCalls; totalPages += r.pages;
        done.add(job.rel); saveDone(done);
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`${label} OK    ${job.rel}`);
        console.log(`        ${r.pages}pp  ${r.rows} rows  ${r.visionCalls} vision  "${r.chapters.slice(0, 2).join('", "')}"  [${mins}m elapsed]`);
      }
    } catch (e) {
      failed++;
      failures.push({ rel: job.rel, error: String(e.message ?? e).slice(0, 160) });
      console.log(`${label} FAIL  ${job.rel}\n        ${String(e.message ?? e).slice(0, 160)}`);
    }
  }
}

console.log('\n─── loading ──────────────────────────────────────────────\n');
// Stagger starts so workers don't all fire their first request in the same
// instant and trip the limit before any of them has returned.
await Promise.all(pages.map(async (p, i) => { await sleep(i * 8000); return worker(p, i); }));

await browser.close();
corpusServer.close();

const mins = ((Date.now() - started) / 60000).toFixed(1);
console.log('\n─── report ───────────────────────────────────────────────');
console.log(`  processed    : ${ok} ok, ${skippedRun} skipped, ${failed} failed`);
console.log(`  pages read   : ${totalPages}`);
console.log(`  vision calls : ${totalVision}`);
console.log(`  kb rows      : ${totalRows}  (${totalTyped} with a content_type)`);
console.log(`  wall clock   : ${mins} min`);
if (failures.length) {
  console.log('\n  failures:');
  failures.forEach((f) => console.log(`    ${f.rel}\n      ${f.error}`));
  console.log('\n  Re-run to retry only these (checkpoint keeps successes).');
}
console.log();
