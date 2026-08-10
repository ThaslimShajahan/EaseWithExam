/**
 * Bulk-loads the NEET PYQ papers in `easy with exam/PYQ/` into pyq_questions,
 * through the real Phase 1 modules.
 *
 *   npm run dev                          (note the port)
 *   BASE_URL=http://localhost:5175 node scripts/bulk-load-pyq.mjs --dry-run
 *   BASE_URL=http://localhost:5175 node scripts/bulk-load-pyq.mjs
 *   ... --limit=1 --reset --only=2021-physics
 *
 * Same hardened shape as bulk-load-corpus.mjs: checkpointed and resumable, one
 * file at a time against the 30,000 TPM ceiling, retry with backoff on 429, and
 * a dev-server probe up front so a dead port fails once instead of burning the
 * whole queue into misleading per-file failures.
 *
 * Drives the REAL modules — pdfVision.extractPagesWithVision,
 * contentExtraction.runPYQExtraction and AdminContentIntake.savePYQRows — so
 * chapter snapping, row shape and the review-queue flag behave exactly as they
 * do for an admin upload. No parallel ingestion logic lives here.
 *
 * ── MANIFEST IS EXPLICIT, NOT GLOBBED ───────────────────────────────────────
 * The folder contains byte-identical duplicates and two combined papers that
 * supersede scanned per-subject files. Globbing would double-load. Every file
 * in the folder is listed below with an explicit decision; see AUDIT.
 *
 * ── NO INSTITUTE BRANDING ───────────────────────────────────────────────────
 * Several PDFs are coaching-institute releases (ALLEN, MOTION, PW). Only
 * exam_type NEET + subject + year are recorded. `source` is a synthetic
 * neutral key, never the filename, and stripBranding() removes brand tokens
 * from the raw text before it ever reaches the model.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PYQ  = resolve(ROOT, 'easy with exam/PYQ');
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const CHECKPOINT = resolve(ROOT, '.pyq-load-checkpoint.json');

const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };
const DRY_RUN = process.argv.includes('--dry-run');
const RESET   = process.argv.includes('--reset');
const LIMIT   = Number(arg('limit', Infinity));
const ONLY    = arg('only', null);

const MAX_RETRIES = Number(arg('retries', 5));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e) => /rate limit|429|TPM|tokens per min/i.test(String(e?.message ?? e));

/* ── AUDIT: every file in the folder, and what was decided ─────────────────
 *
 * Identified by OPENING each file, not by trusting its name. md5 for exact
 * duplicates; first/middle-page text for subject and year; chars-per-page for
 * whether the text layer is usable.
 *
 *  LOAD (9 source files -> 18 subject-year loads)
 *    2021 P/C/B, 2022 P/C/B, 2023 P/C/B      clearly named, one per subject
 *    2393a308-…                              NEET 2024, ALL subjects, 200 Qs,
 *                                            text layer OK (2715 ch/pg)
 *    c9b2c6eb-…                              NEET 2025 [Code-45], ALL subjects,
 *                                            180 Qs + solutions, 2781 ch/pg
 *    original (2)/(3)/(4)                    NEET 2026 P/C/B (held 3 May 2026)
 *
 *  SKIP — byte-identical duplicates (same md5 ac4a0bb1…)
 *    2393a308-… (1).pdf, 2393a308-… (2).pdf
 *
 *  SKIP — superseded by a combined paper that is ALSO a better source
 *    2024+Bio (78 ch/pg, scan)          -> covered by 2393a308 Botany+Zoology
 *    2024+Chemistry (311 ch/pg, sparse) -> covered by 2393a308 Chemistry
 *    Physics Paper…Code-45 (84 ch/pg)   -> covered by c9b2c6eb, same [Code-45]
 *    Chemistry Paper…Code-45 (42 ch/pg) -> covered by c9b2c6eb, same [Code-45]
 *    Each skipped file is a scan of the same exam the combined paper carries
 *    with a clean text layer, so skipping them avoids BOTH double-loading and
 *    ~28 needless vision calls. The combined papers additionally supply the
 *    2024 Physics and 2025 Biology sections, which have no named file at all.
 */

// forceVision: pages whose text layer is too thin to trust. Measured ch/pg is
// in the comment. Without it, a page carrying only a running header clears the
// 80-char needsVision gate, contributes no questions, and the loss is silent.
const JOBS = [
  { id: '2021-physics',   file: '2021+Physics-With+Answer+%26+Solution.pdf',            subject: 'Physics',   year: 2021 },
  { id: '2021-chemistry', file: '2021+Chemistry-With+Answer+%26+Solution.pdf',          subject: 'Chemistry', year: 2021 },
  { id: '2021-biology',   file: '2021+Biology-With+Answer+%26+Solution (1).pdf',        subject: 'Biology',   year: 2021 },

  { id: '2022-physics',   file: '2022+Physics Paper with+Answer+%26+Solutions.pdf',     subject: 'Physics',   year: 2022 },
  { id: '2022-chemistry', file: '2022+Chemistry Paper+with+Answer+%26+Solutions.pdf',   subject: 'Chemistry', year: 2022, forceVision: true }, //  71 ch/pg
  { id: '2022-biology',   file: '2022+Biology+Paper+with+Answer+%26+Solution (1).pdf',  subject: 'Biology',   year: 2022, forceVision: true }, //  27 ch/pg

  { id: '2023-physics',   file: '2023+PHYSICS+Paper+with+Solutions.pdf',                subject: 'Physics',   year: 2023 },
  { id: '2023-chemistry', file: '2023+CHEMISTRY+Paper+with+Solutions.pdf',              subject: 'Chemistry', year: 2023 },
  { id: '2023-biology',   file: '2023+BIOLOGY+Paper+with+Solutions (1).pdf',            subject: 'Biology',   year: 2023 },

  // Combined papers: subject 'Mixed' makes runPYQExtraction tag each question
  // with its own subject, so no PDF splitting is needed.
  { id: '2024-mixed',     file: '2393a308-e716-47d1-bbf2-38dc08760f8b.pdf',             subject: 'Mixed',     year: 2024 },
    // p1-25 questions, p26 a compact ANSWER KEY for all 180, p27-48 full
  // solutions. Loading all 48 pages made the solutions half read as a second
  // set of questions: 329 rows against a true 180 (71/81/177 vs 45/45/90).
  { id: '2025-mixed',     file: 'c9b2c6eb-e587-43e6-a0d7-b6a2ff93f247.pdf',             subject: 'Mixed',     year: 2025, pageRange: [1, 25], keyPage: 26 },

  { id: '2026-physics',   file: 'original (2).pdf',                                     subject: 'Physics',   year: 2026, forceVision: true }, // 119 ch/pg
  { id: '2026-chemistry', file: 'original (3).pdf',                                     subject: 'Chemistry', year: 2026, forceVision: true }, //  77 ch/pg
  { id: '2026-biology',   file: 'original (4).pdf',                                     subject: 'Biology',   year: 2026, forceVision: true }, //  27 ch/pg
];

/* ── Checkpoint ───────────────────────────────────────────────────────────── */
function loadDone() {
  if (RESET && existsSync(CHECKPOINT)) return {};
  try { return JSON.parse(readFileSync(CHECKPOINT, 'utf8')).done ?? {}; } catch { return {}; }
}
function saveDone(done) {
  writeFileSync(CHECKPOINT, JSON.stringify({ done, updatedAt: new Date().toISOString() }, null, 2));
}

/* ── PDF server (CORS-enabled, own origin) ────────────────────────────────── */
function startPyqServer() {
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(req.url.replace(/^\//, ''));
    const file = resolve(PYQ, rel);
    if (!file.startsWith(resolve(PYQ)) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Access-Control-Allow-Origin': '*' });
    res.end(readFileSync(file));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/* ── The per-file pipeline, run inside the browser ────────────────────────── */
async function processFile(page, job, origin) {
  return page.evaluate(async ({ url, subject, year, forceVision, pageRange, keyPage, source }) => {
    const [{ extractPagesWithVision }, ce, { getChapters }, { savePYQRows }] = await Promise.all([
      import('/src/lib/pdfVision.js'),
      import('/src/lib/contentExtraction.js'),
      import('/src/lib/syllabus.js'),
      import('/src/admin/AdminContentIntake.jsx'),
    ]);

    const isMixed = subject === 'Mixed';

    /* Institute branding must never reach the model or the stored rows. Applied
     * to the raw text rather than only to the output, so the model never sees a
     * brand to echo into an explanation in the first place.
     *
     * ONLY UNAMBIGUOUS BRAND TOKENS. An earlier version of this list included
     * MOTION and PW, which destroyed real content: "motion" is a core physics
     * word and the 2021 Physics load came back with ZERO questions containing
     * it, in a paper whose chapters include "Laws of Motion", "Motion in a
     * Plane" and "Motion in a Straight Line". A brand filter that eats the
     * subject matter is worse than branding. Anything that is also an ordinary
     * exam word stays out of this list; the two offenders are handled by the
     * footer patterns below, where they only match alongside app-store chrome.
     *
     * BANSAL is likewise dropped — it is a surname and could plausibly appear
     * in a question. */
    const BRAND = /\b(ALLEN|AAKASH|RESONANCE|FIITJEE|NARAYANA|BYJU'?S?|VEDANTU|UNACADEMY|PHYSICSWALLAH)\b/gi;
    const FOOTER = /\b(PW\s+(Website|App)|Motion\s+Education|Android\s+App|iOS\s+App)\b/gi;
    const stripBranding = (t) => t
      .replace(FOOTER, ' ')
      .replace(BRAND, ' ')
      .replace(/[ \t]{2,}/g, ' ');

    const buf = await (await fetch(url)).arrayBuffer();

    // extractFigures:false — a PYQ load wants question TEXT; figure cropping is
    // off by default anyway and would add a vision call per figure-bearing page.
    const ex = await extractPagesWithVision(buf, { subject: isMixed ? undefined : subject, examType: 'NEET' },
      { extractFigures: false, forceVision: !!forceVision });

    /* pageRange: some papers print the full solutions AFTER the questions. The
     * extractor batches sequentially with no cross-batch memory, so it reads the
     * solutions half as a second set of questions: the 2025 combined paper came
     * back with 329 "questions" against a true 180, at 71/81/177 per subject
     * versus the real 45/45/90. Duplicates are worse than missing rows here —
     * Blueprint V2 weights chapters by raw frequency, so a duplicated section
     * silently doubles its influence over every generated paper. */
    const picked = pageRange ? ex.pages.slice(pageRange[0] - 1, pageRange[1]) : ex.pages;
    const rawText = stripBranding(picked.join('\n\n')).trim();
    if (rawText.length < 500) return { skipped: 'no usable text', pages: ex.pageCount, visionCalls: ex.visionPageCount };

    // Closed chapter list, per subject. For a Mixed paper the model must be
    // able to pick from all three subjects' chapters at once.
    const subjects = isMixed ? ['Physics', 'Chemistry', 'Biology'] : [subject];
    const chapterSets = await Promise.all(subjects.map((s) => getChapters('NEET', s)));
    const syllabusChapters = [...new Set(chapterSets.flat().map((c) => c.name))];

    // A whole-paper answer key on its own page must reach every batch, not just
    // the batch it happens to fall in. See runPYQExtraction's `preamble`.
    const preamble = keyPage ? stripBranding(ex.pages[keyPage - 1] ?? '').trim() : '';

    const { questions, paperTitle, totalMarks } = await ce.runPYQExtraction({
      rawText, examType: 'NEET', subject, year, syllabusChapters, preamble, onProgress: () => {},
    });
    if (!questions?.length) return { skipped: 'no questions extracted', pages: ex.pageCount, visionCalls: ex.visionPageCount };

    const clean = questions.map((q) => ({
      ...q,
      question_text: stripBranding(q.question_text ?? ''),
      explanation:   q.explanation ? stripBranding(q.explanation) : q.explanation,
    }));

    const saved = await savePYQRows({
      questions: clean, examType: 'NEET', subject, year, source, isMixed, syllabusChapters,
    });

    // Measured, so max_tokens can be right-sized from data rather than guessed.
    const serialised = JSON.stringify(clean);
    const withAnswer = clean.filter((q) => q.correct_answer != null && String(q.correct_answer).trim() !== '').length;
    const snapped    = saved.filter((r) => r.chapter && syllabusChapters.includes(r.chapter)).length;

    return {
      pages: ex.pageCount,
      visionCalls: ex.visionPageCount,
      extracted: clean.length,
      saved: saved.length,
      withAnswer,
      snapped,
      syllabusSize: syllabusChapters.length,
      bytesPerQuestion: Math.round(serialised.length / clean.length),
      bySubject: clean.reduce((a, q) => { const k = isMixed ? (q.subject || 'Mixed') : subject; a[k] = (a[k] ?? 0) + 1; return a; }, {}),
      paperTitle, totalMarks,
    };
  }, { url: `${origin}/${encodeURIComponent(job.file)}`, subject: job.subject, year: job.year, forceVision: job.forceVision, pageRange: job.pageRange ?? null, keyPage: job.keyPage ?? null, source: `pyq:neet-${job.year}-${job.subject.toLowerCase()}` });
}

/* ── Main ─────────────────────────────────────────────────────────────────── */
const done  = loadDone();
let queue = JOBS.filter((j) => !done[j.id]);
if (ONLY) queue = queue.filter((j) => j.id === ONLY);
queue = queue.slice(0, LIMIT);

console.log(`\npyq folder   : ${PYQ}`);
console.log(`manifest     : ${JOBS.length} jobs  (6 folder files skipped: 2 exact dupes, 4 superseded scans)`);
console.log(`already done : ${Object.keys(done).length}`);
console.log(`to process   : ${queue.length}   concurrency=1 (30k TPM ceiling)`);
for (const j of queue) console.log(`   ${j.id.padEnd(16)} ${j.subject.padEnd(10)} ${j.year}  ${j.forceVision ? 'forceVision' : ''}`);

for (const j of JOBS.filter((x) => !!done[x.id])) {
  const d = done[j.id];
  console.log(`   [done] ${j.id.padEnd(16)} saved=${d.saved} withAnswer=${d.withAnswer}`);
}

if (DRY_RUN) { console.log('\nDRY RUN — nothing fetched, nothing written.\n'); process.exit(0); }
if (!queue.length) { console.log('\nNothing to do.\n'); process.exit(0); }

{
  const probe = `${BASE}/src/lib/pdfVision.js`;
  const res = await fetch(probe).catch((e) => ({ ok: false, status: e.code ?? 'unreachable' }));
  if (!res.ok) {
    console.error(`\nDev server not serving modules at ${probe} (${res.status}).`);
    console.error('Start it with `npm run dev` and pass the port it prints as BASE_URL.\n');
    process.exit(1);
  }
}

const server  = await startPyqServer();
const origin  = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page    = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log(`      [browser] ${m.text().slice(0, 160)}`); });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

let ok = 0, failed = 0;
const failures = [];

for (let i = 0; i < queue.length; i++) {
  const job = queue[i];
  const label = `[${String(i + 1).padStart(2)}/${queue.length}] ${job.id}`;
  let attempt = 0;

  for (;;) {
    attempt++;
    const t0 = Date.now();
    try {
      const r = await processFile(page, job, origin);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      if (r.skipped) {
        console.log(`${label}  SKIPPED (${r.skipped})  pages=${r.pages} vision=${r.visionCalls} ${secs}s`);
        failures.push({ id: job.id, error: `skipped: ${r.skipped}` });
        failed++;
      } else {
        console.log(`${label}  saved=${r.saved}/${r.extracted}  answers=${r.withAnswer}  snapped=${r.snapped}/${r.saved}  vision=${r.visionCalls}  ${secs}s`);
        if (r.bySubject && Object.keys(r.bySubject).length > 1) console.log(`      bySubject: ${JSON.stringify(r.bySubject)}`);
        console.log(`      bytes/question=${r.bytesPerQuestion}  syllabus=${r.syllabusSize} chapters`);
        done[job.id] = { ...r, at: new Date().toISOString() };
        saveDone(done);
        ok++;
      }
      break;
    } catch (e) {
      const msg = String(e?.message ?? e).slice(0, 200);
      if (isRateLimit(e) && attempt <= MAX_RETRIES) {
        const wait = Math.min(60, 2 ** attempt * 5);
        console.log(`${label}  rate-limited, retry ${attempt}/${MAX_RETRIES} in ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (attempt <= 2 && !isRateLimit(e)) {
        console.log(`${label}  error, retry ${attempt}/2: ${msg.slice(0, 120)}`);
        await sleep(5000);
        continue;
      }
      console.log(`${label}  FAILED: ${msg}`);
      failures.push({ id: job.id, error: msg });
      failed++;
      break;
    }
  }
}

await browser.close();
server.close();

console.log('\n─── report ───────────────────────────────────────────────');
console.log(`  jobs: ${ok} ok, ${failed} failed`);
const totals = Object.values(done);
console.log(`  questions saved (all runs): ${totals.reduce((s, d) => s + (d.saved ?? 0), 0)}`);
console.log(`  with answer key           : ${totals.reduce((s, d) => s + (d.withAnswer ?? 0), 0)}`);
if (failures.length) {
  console.log('\n  failures (re-run to retry only these):');
  failures.forEach((f) => console.log(`    ${f.id}: ${f.error}`));
}
console.log();
