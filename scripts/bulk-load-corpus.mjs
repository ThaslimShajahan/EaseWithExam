/**
 * Bulk-loads the local NCERT corpus into knowledge_base through the Phase 1
 * pipeline, as disposable dev data.
 *
 *   npm run dev                              (note the port)
 *   BASE_URL=http://localhost:5175 node scripts/bulk-load-corpus.mjs --dry-run
 *   BASE_URL=http://localhost:5175 node scripts/bulk-load-corpus.mjs
 *   ... --concurrency=4 --limit=5 --reset
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

const ROOT   = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = resolve(ROOT, 'easy with exam');
const BASE   = process.env.BASE_URL || 'http://localhost:5173';
const CHECKPOINT = resolve(ROOT, '.corpus-load-checkpoint.json');

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : dflt;
};
const DRY_RUN     = process.argv.includes('--dry-run');
const RESET       = process.argv.includes('--reset');
const LIMIT       = Number(arg('limit', Infinity));

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
function isFrontMatter(file) {
  const m = basename(file, extname(file)).match(NCERT_CODE);
  return !!m && !/^\d{2}$/.test(m[3]);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.pdf$/i.test(e)) out.push(f);
  }
  return out;
}

function buildQueue() {
  const jobs = [];
  const skipped = { nonStem: 0, frontMatter: 0, unknownClass: 0 };

  for (const abs of walk(CORPUS).sort()) {
    const rel   = relative(CORPUS, abs).replace(/\\/g, '/');
    const parts = rel.split('/');
    if (parts[0] === '_pilot') continue;

    const classLevel = CLASS_BY_TOP[parts[0].toLowerCase()];
    if (!classLevel) { skipped.unknownClass++; continue; }

    const subject = parts.length > 1 ? subjectForFolder(parts[1]) : null;
    if (!subject) { skipped.nonStem++; continue; }

    if (isFrontMatter(abs)) { skipped.frontMatter++; continue; }

    jobs.push({ rel, abs, subject, classLevel, examType: `CBSE Class ${classLevel}` });
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
  return page.evaluate(async ({ url, subject, examType, source }) => {
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
    const rows = lessons.flatMap((lesson) => ce.buildKbRows({
      lesson,
      chapterName: lesson.title || 'Untitled',
      unit, subject, examType, source,
      figures: [], equationsByPage: ex.equationsByPage,
    }));
    if (!rows.length) return { skipped: 'no chunks', pages: ex.pageCount };

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
  }, { url: `${corpusOrigin}/${job.rel}`, subject: job.subject, examType: job.examType, source: `corpus:${job.rel}` });
}

/* ── Main ───────────────────────────────────────────────────────────── */

const { jobs, skipped } = buildQueue();
const done  = loadDone();
const queue = jobs.filter((j) => !done.has(j.rel)).slice(0, LIMIT);

console.log(`\ncorpus       : ${CORPUS}`);
console.log(`STEM files   : ${jobs.length}   (skipped: ${skipped.nonStem} non-STEM, ${skipped.frontMatter} front-matter, ${skipped.unknownClass} unknown-class)`);
console.log(`already done : ${done.size}`);
console.log(`to process   : ${queue.length}   concurrency=${CONCURRENCY}   figures=OFF`);

const bySubject = {};
for (const j of jobs) {
  const k = `Class ${j.classLevel} ${j.subject}`;
  bySubject[k] = (bySubject[k] ?? 0) + 1;
}
console.log('\nbreakdown:');
for (const [k, v] of Object.entries(bySubject).sort()) console.log(`  ${k.padEnd(28)} ${v}`);

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

async function newPage() {
  // When the renderer dies it takes the whole browser process with it, not just
  // the tab — the first recovery attempt failed with "browser has been closed"
  // from newContext(). So reviving means relaunching Chromium, not reusing it.
  if (!browser.isConnected()) {
    console.log('        [browser] disconnected — relaunching Chromium');
    browser = await chromium.launch();
  }
  const ctx  = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  return page;
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
        try { r = await processFile(page, job, corpusOrigin); break; }
        catch (e) {
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
