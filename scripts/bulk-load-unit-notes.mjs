/**
 * Loads whole-unit Study Notes PDFs against an ALREADY-APPROVED chapter manifest.
 *
 *   npm run dev                                    (note the port it prints)
 *   ADMIN_UID=<firebase-uid> BASE_URL=http://localhost:5173 \
 *     node scripts/bulk-load-unit-notes.mjs --dir="C:/Users/THASLIM/Downloads" \
 *       --exam="CBSE Class 8" --subject=English --class=8 --dry-run
 *
 * Drop --dry-run to actually write.
 *
 * WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
 * It is the Content Intake screen's own code path, driven from Node — the same
 * approach scripts/bulk-load-corpus.mjs and bulk-load-pyq.mjs already use. The
 * real modules run inside a Vite-served browser page, so `extractPagesWithVision`,
 * `extractNotesByManifest` and `saveNoteChunks` here are literally the functions
 * the UI calls, imported from /src/. There is NO ingestion logic in this file.
 *
 * That is not a stylistic preference. The bug that cost this project a night was
 * a protection that existed on one path and not another; a second copy of the
 * write path is how that happens again. If the UI's behaviour changes, this
 * changes with it or it breaks loudly — it cannot silently drift.
 *
 * SAFETY PROPERTIES
 * - ONE FILE AT A TIME, never concurrent. Same TPM-safety posture as the other
 *   loaders; the extraction is several AI calls per file (one per chapter).
 * - STOPS DEAD on the first unexpected result. "Unexpected" is checked against
 *   the manifest itself, not against a hardcoded list: the chapters produced must
 *   equal, in count and in title and in order, the entries the manifest says that
 *   file contains. A wrong count or a renamed chapter aborts the run rather than
 *   continuing into the next file.
 * - Refuses to start unless the manifest is approved and structurally valid.
 * - --dry-run does everything except the write, including the AI extraction, so
 *   the chapter split can be inspected before anything is persisted.
 *
 * WHAT IT DOES NOT PROTECT AGAINST
 * Re-running it for a file already loaded will write that content AGAIN.
 * knowledge_base has no natural key to collide on. Check before re-running.
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, basename } from 'node:path';
import { chromium } from 'playwright';
import { getAuth } from './firebaseAdmin.mjs';

const arg = (name, dflt = null) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const has = (name) => process.argv.includes(`--${name}`);

const DIR       = arg('dir');
const EXAM      = arg('exam', 'CBSE Class 8');
const SUBJECT   = arg('subject', 'English');
const CLASS_LVL = arg('class', '8');
const BOOK      = arg('book', null);          // null => matches book IS NULL
const DRY_RUN   = has('dry-run');
const RELOAD    = has('reload');              // process files already in the DB
const EXCLUDE   = (arg('exclude', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const BASE      = process.env.BASE_URL || 'http://localhost:5173';
const ADMIN_UID = process.env.ADMIN_UID;

if (!DIR)       { console.error('\n--dir=<folder containing the unit PDFs> is required\n'); process.exit(1); }
if (!ADMIN_UID) {
  console.error('\nADMIN_UID is required — every write goes through an RPC that calls');
  console.error('assert_verified_admin, which refuses an unauthenticated caller.\n');
  process.exit(1);
}

/* Files, in ordinal order. Sorting by the ordinal the MANIFEST will match on —
 * not by filename — so the run order matches the book's order regardless of how
 * the files happen to be named. */
const pdfs = readdirSync(DIR)
  .filter((f) => extname(f).toLowerCase() === '.pdf')
  .filter((f) => /unit/i.test(f))
  .filter((f) => !EXCLUDE.includes(f))
  .map((f) => ({ name: f, path: join(DIR, f) }))
  .filter((f) => statSync(f.path).isFile());

if (EXCLUDE.length) console.log(`Excluded by --exclude: ${EXCLUDE.join(', ')}`);

if (!pdfs.length) { console.error(`\nNo *unit*.pdf files found in ${DIR}\n`); process.exit(1); }

/* Serve the PDFs to the browser page. Reading them in Node and passing bytes
 * through page.evaluate would mean base64-ing multi-MB buffers across the CDP
 * bridge; a local origin the page can fetch() is what the other loaders do. */
const fileServer = createServer((req, res) => {
  // The page is served from the Vite origin (localhost:5173) and fetches from
  // this one (127.0.0.1:<random>) — a cross-origin request, so without these
  // headers the browser blocks the response and fetch() rejects with an opaque
  // "Failed to fetch". Wide-open is fine: this server binds to loopback, serves
  // only the PDFs already listed below, and dies with the script.
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }

  const wanted = decodeURIComponent(req.url.slice(1));
  const hit = pdfs.find((p) => p.name === wanted);
  if (!hit) { res.writeHead(404, cors); res.end('no'); return; }
  const buf = readFileSync(hit.path);
  res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf', 'Content-Length': buf.length });
  res.end(buf);
});
await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
const fileOrigin = `http://127.0.0.1:${fileServer.address().port}`;

const browser = await chromium.launch();
const page    = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log(`      [browser] ${m.text().slice(0, 200)}`); });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

/* Sign in ONCE, up front — a bad ADMIN_UID must fail before any AI spend. */
{
  const customToken = await getAuth().createCustomToken(ADMIN_UID);
  const signedInAs = await page.evaluate(async (t) => {
    const { signInWithMintedToken } = await import('/src/lib/devAuth.js');
    return signInWithMintedToken(t);
  }, customToken);
  if (signedInAs !== ADMIN_UID) {
    console.error(`\nSigned in as ${signedInAs}, expected ${ADMIN_UID} — aborting.\n`);
    await browser.close(); fileServer.close(); process.exit(1);
  }
  console.log(`Signed in as admin ${ADMIN_UID}`);
}

/* Load and gate the manifest before touching a single file. */
const manifest = await page.evaluate(async ({ exam, subject, book }) => {
  const { supabase } = await import('/src/lib/supabase.js');
  const { validateManifest } = await import('/src/lib/chapterManifest.js');
  let q = supabase.from('chapter_manifests').select('id, status, entries, book, key_prefix')
    .eq('exam_type', exam).eq('subject', subject);
  q = book ? q.eq('book', book) : q.is('book', null);
  const { data, error } = await q.maybeSingle();
  if (error) return { error: error.message };
  if (!data)  return { error: 'no manifest found for this exam/subject/book' };
  const v = validateManifest(data.entries);
  return { status: data.status, entries: data.entries, keyPrefix: data.key_prefix, valid: v.ok, errors: v.errors };
}, { exam: EXAM, subject: SUBJECT, book: BOOK });

if (manifest.error)      { console.error(`\nManifest: ${manifest.error}\n`); await browser.close(); fileServer.close(); process.exit(1); }
if (manifest.status !== 'approved') { console.error(`\nManifest is '${manifest.status}', not approved — refusing to load.\n`); await browser.close(); fileServer.close(); process.exit(1); }
if (!manifest.valid)     { console.error(`\nApproved manifest failed validation: ${manifest.errors.join('; ')}\n`); await browser.close(); fileServer.close(); process.exit(1); }

console.log(`Manifest approved, ${manifest.entries.length} entries, valid.\n`);

/* Work out, in Node, exactly what each file SHOULD produce. This is the
 * expectation the run is checked against — derived from the manifest, so it
 * cannot drift from what was approved. */
/* Resolved inside the page rather than imported into Node: src/ uses Vite-style
 * extensionless imports, which Node's ESM resolver rejects. The page already has
 * the modules loaded, so it is also the same copy the run will actually use. */
async function expectedFor(filename) {
  return page.evaluate(async ({ filename, entries, prefix, classLevel, book }) => {
    const { fileOrdinalFrom, candidatesForFile } = await import('/src/lib/chapterManifest.js');
    const { chapterKeyFor } = await import('/src/lib/chapterIdentity.js');
    const { supabase } = await import('/src/lib/supabase.js');

    const ord = fileOrdinalFrom(filename);
    const covered = candidatesForFile(entries, ord, null)
      .slice().sort((a, b) => a.pageStart - b.pageStart);

    // The exact chapter_keys this file would write, built by the same function
    // the write path uses — so the "already loaded?" check cannot disagree with
    // what actually lands.
    const keys = covered.map((e) => chapterKeyFor({ prefix, classLevel, book, ordinal: e.ordinal }));

    // Idempotency guard. knowledge_base has no natural key to collide on, so a
    // re-run would silently DOUBLE a chapter's content. Checking here means the
    // operator never has to remember which files are already in.
    let loadedKeys = [];
    if (keys.length) {
      const { data } = await supabase.from('knowledge_base')
        .select('chapter_key').in('chapter_key', keys).limit(500);
      loadedKeys = [...new Set((data ?? []).map((r) => r.chapter_key))];
    }
    return { ord, titles: covered.map((e) => e.title), keys, loadedKeys };
  }, {
    filename, entries: manifest.entries,
    prefix: manifest.keyPrefix ?? 'c', classLevel: CLASS_LVL, book: BOOK,
  });
}

const queue = [];
for (const p of pdfs) {
  const e = await expectedFor(p.name);
  queue.push({ ...p, ...e });
}
queue.sort((a, b) => (a.ord ?? 999) - (b.ord ?? 999));

console.log('Planned run:');
for (const j of queue) {
  const already = j.loadedKeys.length > 0;
  j.skip = already && !RELOAD;
  console.log(`  File #${j.ord ?? '?'}  ${j.name}${j.skip ? '   ← ALREADY LOADED, SKIPPING' : already ? '   ← ALREADY LOADED, --reload given' : ''}`);
  if (!j.titles.length) console.log('      ⚠️  matches NO manifest entries');
  else j.titles.forEach((t, i) => console.log(`      ${i + 1}. ${t}${j.loadedKeys.includes(j.keys[i]) ? `  (${j.keys[i]} present in knowledge_base)` : ''}`));
}

const unmatched = queue.filter((j) => !j.titles.length);
if (unmatched.length) {
  console.error(`\n${unmatched.length} file(s) match no manifest entry. Fix File # on the manifest, or remove those files. Aborting before any write.\n`);
  await browser.close(); fileServer.close(); process.exit(1);
}

/* Already-loaded files are dropped from the queue rather than merely warned
 * about. knowledge_base has no key to collide on, so processing one again
 * silently doubles that chapter's content — a failure mode with no error and no
 * obvious symptom, which is the worst kind. --reload opts back in deliberately. */
const skipped = queue.filter((j) => j.skip);
const toRun   = queue.filter((j) => !j.skip);
if (skipped.length) console.log(`\n${skipped.length} file(s) skipped as already loaded (pass --reload to force).`);
if (!toRun.length)  { console.log('\nNothing left to do.\n'); await browser.close(); fileServer.close(); process.exit(0); }
queue.length = 0; queue.push(...toRun);

console.log(DRY_RUN ? '\n--dry-run: extraction WILL run, writes will NOT.\n' : '\nWriting for real.\n');

/* ── The per-file pipeline, run inside the page, using the app's own modules ── */
async function processFile(job) {
  return page.evaluate(async ({ url, filename, exam, subject, classLevel, book, dryRun, callerUid }) => {
    const [{ extractPagesWithVision }, ce, cm, intake, { supabase }] = await Promise.all([
      import('/src/lib/pdfVision.js'),
      import('/src/lib/contentExtraction.js'),
      import('/src/lib/chapterManifest.js'),
      import('/src/admin/AdminContentIntake.jsx'),
      import('/src/lib/supabase.js'),
    ]);

    // Re-read the manifest row inside the page so the write is gated by the
    // same object saveNoteChunks will assert on — not by a stale copy from Node.
    let q = supabase.from('chapter_manifests').select('id, status, entries, book')
      .eq('exam_type', exam).eq('subject', subject);
    q = book ? q.eq('book', book) : q.is('book', null);
    const { data: manifestRow } = await q.maybeSingle();

    const buf = await (await fetch(url)).arrayBuffer();

    const { pages, figures, equationsByPage, visionPageCount, failedPages } =
      await extractPagesWithVision(buf, { subject, examType: exam }, { });

    const covered = cm.candidatesForFile(manifestRow.entries, cm.fileOrdinalFrom(filename), null);
    if (!covered.length) return { error: `no manifest entries matched ${filename}` };

    const { unit, lessons } = await ce.extractNotesByManifest({
      pages, entries: covered, examType: exam, subject,
    });

    if (dryRun) {
      return {
        dryRun: true, visionPageCount, failedPages: failedPages?.length ?? 0,
        chapters: lessons.map((l) => ({ title: l.title, chunks: l.chunks.length, unit: l.unit, p1: l.page_start, p2: l.page_end })),
      };
    }

    const saved = await intake.saveNoteChunks({
      unit, lessons, examType: exam, subject, chapter: null,
      source: `bulk-unit:${filename}`, callerUid, syllabusChapters: [],
      figures, equationsByPage,
      manifestRow, filename, book, classLevel,
    });

    return {
      visionPageCount, failedPages: failedPages?.length ?? 0,
      kbCount: saved.kbCount, lessonCount: saved.lessonCount, flagged: saved.flagged,
      chapters: lessons.map((l) => ({ title: l.title, chunks: l.chunks.length, unit: l.unit, p1: l.page_start, p2: l.page_end })),
    };
  }, {
    url: `${fileOrigin}/${encodeURIComponent(job.name)}`, filename: job.name,
    exam: EXAM, subject: SUBJECT, classLevel: CLASS_LVL, book: BOOK,
    dryRun: DRY_RUN, callerUid: ADMIN_UID,
  });
}

let done = 0;
for (let i = 0; i < queue.length; i++) {
  const job = queue[i];
  const label = `[${i + 1}/${queue.length}] File #${job.ord} ${job.name}`;
  console.log(`${label} …`);

  let out;
  try {
    out = await processFile(job);
  } catch (e) {
    console.error(`\n${label}\n  ✗ THREW: ${e.message}\n\nStopping — ${done} file(s) completed before this.\n`);
    await browser.close(); fileServer.close(); process.exit(1);
  }

  if (out?.error) {
    console.error(`\n${label}\n  ✗ ${out.error}\n\nStopping — ${done} file(s) completed before this.\n`);
    await browser.close(); fileServer.close(); process.exit(1);
  }

  const produced = out.chapters.map((c) => c.title);

  /* The stop condition. Count AND titles AND order must match what the approved
   * manifest says this file contains. Anything else is exactly the class of
   * silent wrongness this whole rebuild exists to prevent, so it aborts rather
   * than logging a warning and moving on. */
  const mismatch =
    produced.length !== job.titles.length ||
    produced.some((t, n) => t !== job.titles[n]);

  out.chapters.forEach((c) => console.log(`      ✓ "${c.title}"  pp${c.p1}-${c.p2}  ${c.chunks} chunks  [${c.unit ?? 'no unit'}]`));
  if (out.visionPageCount) console.log(`      ${out.visionPageCount} page(s) read by vision`);
  if (out.failedPages)     console.log(`      ⚠️  ${out.failedPages} page(s) failed to read`);

  if (mismatch) {
    console.error(`\n  ✗ UNEXPECTED RESULT for ${job.name}`);
    console.error(`      expected (${job.titles.length}): ${job.titles.join(' | ')}`);
    console.error(`      produced (${produced.length}): ${produced.join(' | ')}`);
    console.error(`\nStopping. ${DRY_RUN ? 'Nothing was written (dry run).' : `${done} file(s) were written before this one; THIS file may be partially written — check knowledge_base.`}\n`);
    await browser.close(); fileServer.close(); process.exit(1);
  }

  if (!DRY_RUN) console.log(`      saved ${out.kbCount} chunks across ${out.lessonCount} chapter(s)${out.flagged ? ' (flagged: 2-of-3 signals)' : ''}`);
  done++;
  console.log('');
}

console.log(DRY_RUN
  ? `Dry run complete — ${done}/${queue.length} file(s) would load cleanly. Re-run without --dry-run to write.`
  : `Done — ${done}/${queue.length} file(s) loaded.`);

await browser.close();
fileServer.close();
