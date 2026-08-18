/**
 * Loads whole-unit Study Notes PDFs against an ALREADY-APPROVED chapter manifest.
 *
 * THREE MODES, one script:
 *
 *   1. IMMEDIATE (original, unchanged) — scan a folder and process it right now,
 *      in this one invocation, stopping dead on the first unexpected result:
 *
 *        ADMIN_UID=<uid> node scripts/bulk-load-unit-notes.mjs --dir="..." \
 *          --exam="CBSE Class 8" --subject=English --class=8 --dry-run
 *
 *   2. ENQUEUE (Tier 2) — scan a folder and add each file to the durable queue
 *      (content_jobs), then exit. Does NOT process anything — no AI calls.
 *
 *        ADMIN_UID=<uid> node scripts/bulk-load-unit-notes.mjs --enqueue \
 *          --dir="..." --exam="CBSE Class 8" --subject=English --class=8
 *
 *   3. WORK (Tier 2) — no --dir. Drains the shared queue: claims one job,
 *      processes it, records the result, claims the next, until the queue is
 *      empty. Safe to run later, on a different day, after the browser or the
 *      machine died mid-queue — a job left claimed past the staleness window
 *      (admin_claim_next_content_job's own reclaim) is picked up again by
 *      whichever invocation calls claim next. Add more with mode 2 while a
 *      worker is running; it just keeps draining.
 *
 *        ADMIN_UID=<uid> node scripts/bulk-load-unit-notes.mjs --work
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
 * changes with it or it breaks loudly — it cannot silently drift. Mode 3 reuses
 * the exact same per-file pipeline as mode 1 (processOneFile below), not a
 * parallel implementation.
 *
 * SAFETY PROPERTIES — modes 1 and 2
 * - ONE FILE AT A TIME, never concurrent. Same TPM-safety posture as the other
 *   loaders; the extraction is several AI calls per file (one per chapter).
 * - Mode 1 STOPS DEAD on the first unexpected result — "unexpected" checked
 *   against the manifest itself (chapter count, titles, order), not a hardcoded
 *   list. Right for an attended run where you're watching it.
 * - Refuses to start unless the manifest is approved and structurally valid.
 * - --dry-run does everything except the write, including the AI extraction, so
 *   the chapter split can be inspected before anything is persisted. Applies to
 *   mode 1 only — an enqueued job is a real, later, unattended write by design.
 *
 * SAFETY PROPERTIES — mode 3 (the actual point of Tier 2)
 * - Does NOT stop dead on one bad file. A background worker meant to be started
 *   and walked away from must not let one mismatched chapter halt every other
 *   queued file behind it — that ONE job is recorded 'failed' with the reason,
 *   and the worker claims the next. Check the Status tab for what needs a look.
 * - Crash-resilient without knowing why the worker died: a job stuck 'running'
 *   past admin_claim_next_content_job's staleness window gets reclaimed by the
 *   next claim call, from this or a different invocation. No manual cleanup.
 * - Same idempotency guard as mode 1 — a job whose expected chapter_keys are
 *   already in knowledge_base is recorded 'skipped', not reprocessed.
 *
 * WHAT NEITHER PROTECTS AGAINST
 * Re-running an already-loaded file OUTSIDE this script's own skip logic (e.g.
 * hand-editing content_jobs, or a second concurrent worker despite the
 * one-at-a-time posture) will write that content again. knowledge_base has no
 * natural key to collide on.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { join, extname, resolve as resolvePath } from 'node:path';
import { hostname } from 'node:os';
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
const ENQUEUE   = has('enqueue');
const WORK      = has('work');

if (ENQUEUE && WORK) { console.error('\n--enqueue and --work are mutually exclusive.\n'); process.exit(1); }
if (!ADMIN_UID) {
  console.error('\nADMIN_UID is required — every write goes through an RPC that calls');
  console.error('assert_verified_admin, which refuses an unauthenticated caller.\n');
  process.exit(1);
}
if (!WORK && !DIR) {
  console.error('\n--dir=<folder containing the unit PDFs> is required unless --work is given\n');
  process.exit(1);
}

/* ── Shared: sign in once, up front — a bad ADMIN_UID must fail before any AI spend or queue write. ── */
const browser = await chromium.launch();
const page    = await browser.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log(`      [browser] ${m.text().slice(0, 200)}`); });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

{
  const customToken = await getAuth().createCustomToken(ADMIN_UID);
  const signedInAs = await page.evaluate(async (t) => {
    const { signInWithMintedToken } = await import('/src/lib/devAuth.js');
    return signInWithMintedToken(t);
  }, customToken);
  if (signedInAs !== ADMIN_UID) {
    console.error(`\nSigned in as ${signedInAs}, expected ${ADMIN_UID} — aborting.\n`);
    await browser.close(); process.exit(1);
  }
  console.log(`Signed in as admin ${ADMIN_UID}`);
}

/* ── Shared: which files in a folder are real chapter files ──────────
 *
 * USED TO require the literal substring "unit" in the filename — a leftover
 * from when this script only ever loaded Poorvi-style "UNIT 1 WIT AND
 * WISDOM.pdf" files. Found live: it matches ZERO of a real book's files
 * named "1 How I Taught My Grandmother to Read.pdf", "2 The Pot Maker.pdf"
 * etc. — a completely ordinary numbered-chapter naming pattern outside a
 * "unit"-labelled book. It also would have wrongly MATCHED "full unit.pdf"
 * (that book's audio-transcripts appendix, not a chapter).
 *
 * Fixed by using the real signal the rest of the pipeline already trusts —
 * fileOrdinalFrom(), the same function candidatesForFile() uses to match an
 * uploaded file to a manifest entry. A file is a candidate chapter file if
 * and only if its name parses to a real ordinal; anything that doesn't
 * (front matter, indexes, appendices, answer keys) is excluded for the same
 * reason it would be refused at upload time anyway — this just moves that
 * refusal earlier, before any AI call, and reports it instead of silently
 * dropping the file. Runs through the page so it is the real module, not a
 * second copy of the regex. */
async function chapterFilesIn(dir) {
  const all = readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() === '.pdf')
    .filter((f) => !EXCLUDE.includes(f))
    .filter((f) => statSync(join(dir, f)).isFile());

  const withOrdinal = await page.evaluate(async (names) => {
    const { fileOrdinalFrom } = await import('/src/lib/chapterManifest.js');
    return names.map((name) => ({ name, ordinal: fileOrdinalFrom(name) }));
  }, all);

  const skipped = withOrdinal.filter((f) => f.ordinal == null).map((f) => f.name);
  if (skipped.length) {
    console.log(`Skipped ${skipped.length} file(s) with no parseable chapter number: ${skipped.join(', ')}`);
  }

  return withOrdinal
    .filter((f) => f.ordinal != null)
    .map((f) => ({ name: f.name, path: resolvePath(join(dir, f.name)) }));
}

/* ════════════════════════ MODE 2 — ENQUEUE ════════════════════════════ */
if (ENQUEUE) {
  const pdfs = await chapterFilesIn(DIR);

  if (!pdfs.length) { console.error(`\nNo files with a parseable chapter number found in ${DIR}\n`); await browser.close(); process.exit(1); }

  console.log(`Enqueuing ${pdfs.length} file(s) for ${EXAM} / ${SUBJECT}${BOOK ? ` / ${BOOK}` : ''}…\n`);

  const runId = randomUUID();
  let queued = 0, already = 0, failed = 0;
  for (const p of pdfs) {
    const { data, error } = await page.evaluate(async ({ uid, filePath, sourceFile, exam, subject, book, runId }) => {
      const { supabase } = await import('/src/lib/supabase.js');
      return supabase.rpc('admin_enqueue_content_job', {
        p_caller: uid, p_file_path: filePath, p_source_file: sourceFile,
        p_exam_type: exam, p_subject: subject, p_book: book, p_run_id: runId,
      });
    }, { uid: ADMIN_UID, filePath: p.path, sourceFile: p.name, exam: EXAM, subject: SUBJECT, book: BOOK, runId });

    if (error) {
      if (error.message?.includes('already queued or running')) { console.log(`  = ${p.name} — already queued/running, skipped`); already++; }
      else { console.log(`  ✗ ${p.name} — ${error.message}`); failed++; }
    } else {
      console.log(`  + ${p.name} — queued (${data})`);
      queued++;
    }
  }
  console.log(`\n${queued} queued, ${already} already pending, ${failed} failed. run_id ${runId}`);
  console.log(WORK ? '' : '\nStart a worker any time with: ADMIN_UID=... node scripts/bulk-load-unit-notes.mjs --work\n');
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

/* ── Shared: manifest lookup + validation for one (exam, subject, book). ── */
async function loadManifest(exam, subject, book) {
  return page.evaluate(async ({ exam, subject, book }) => {
    const { supabase } = await import('/src/lib/supabase.js');
    const { validateManifest } = await import('/src/lib/chapterManifest.js');
    let q = supabase.from('chapter_manifests').select('id, status, entries, book, key_prefix, file_structure')
      .eq('exam_type', exam).eq('subject', subject);
    q = book ? q.eq('book', book) : q.is('book', null);
    const { data, error } = await q.maybeSingle();
    if (error) return { error: error.message };
    if (!data)  return { error: 'no manifest found for this exam/subject/book' };
    if (data.status !== 'approved') return { error: `manifest is '${data.status}', not approved` };
    const v = validateManifest(data.entries, data.file_structure);
    if (!v.ok) return { error: `approved manifest failed validation: ${v.errors.join('; ')}` };
    return { entries: data.entries, keyPrefix: data.key_prefix ?? 'c', fileStructure: data.file_structure ?? 'combined' };
  }, { exam, subject, book });
}

/* ── Shared: the real per-file pipeline — extraction through save. Used by
 * both mode 1 (called from its own loop below) and mode 3 (called per claimed
 * job). Identical to what Content Intake and the original mode-1 script call;
 * see the file header for why that sameness is load-bearing. ── */
async function processOneFile({ url, filename, exam, subject, classLevel, book, keyPrefix, fileStructure, dryRun, callerUid }) {
  return page.evaluate(async ({ url, filename, exam, subject, classLevel, book, keyPrefix, fileStructure, dryRun, callerUid }) => {
    const [{ extractPagesWithVision }, ce, cm, intake, { supabase }] = await Promise.all([
      import('/src/lib/pdfVision.js'),
      import('/src/lib/contentExtraction.js'),
      import('/src/lib/chapterManifest.js'),
      import('/src/admin/AdminContentIntake.jsx'),
      import('/src/lib/supabase.js'),
    ]);

    let q = supabase.from('chapter_manifests').select('id, status, entries, book, file_structure')
      .eq('exam_type', exam).eq('subject', subject);
    q = book ? q.eq('book', book) : q.is('book', null);
    const { data: manifestRow } = await q.maybeSingle();

    const buf = await (await fetch(url)).arrayBuffer();

    const { pages, figures, equationsByPage, visionPageCount, failedPages } =
      await extractPagesWithVision(buf, { subject, examType: exam }, { });

    const fileOrdinal = cm.fileOrdinalFrom(filename);
    const covered = cm.candidatesForFile(manifestRow.entries, fileOrdinal, null);
    if (!covered.length) return { error: `"${filename}" matches no manifest entry (file ordinal ${fileOrdinal ?? 'unreadable'})`, fileOrdinal };

    const { unit, lessons } = await ce.extractNotesByManifest({
      pages, entries: covered, examType: exam, subject, fileStructure: manifestRow.file_structure ?? fileStructure,
    });

    if (dryRun) {
      return {
        dryRun: true, visionPageCount, failedPages: failedPages?.length ?? 0, fileOrdinal,
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
      fileOrdinal, visionPageCount, failedPages: failedPages?.length ?? 0,
      kbCount: saved.kbCount, lessonCount: saved.lessonCount, flagged: saved.flagged,
      chapters: lessons.map((l) => ({ title: l.title, chunks: l.chunks.length, unit: l.unit, p1: l.page_start, p2: l.page_end })),
    };
  }, { url, filename, exam, subject, classLevel, book, keyPrefix, fileStructure, dryRun, callerUid });
}

/* Already-loaded chapter_keys for one file, from the manifest's own idempotency
 * signal (same check mode 1 always ran up front, now per-file for mode 3). */
async function alreadyLoadedKeys({ entries, fileOrdinal, prefix, classLevel, book }) {
  return page.evaluate(async ({ entries, fileOrdinal, prefix, classLevel, book }) => {
    const { candidatesForFile } = await import('/src/lib/chapterManifest.js');
    const { chapterKeyFor } = await import('/src/lib/chapterIdentity.js');
    const { supabase } = await import('/src/lib/supabase.js');
    const covered = candidatesForFile(entries, fileOrdinal, null);
    const keys = covered.map((e) => chapterKeyFor({ prefix, classLevel, book, ordinal: e.ordinal }));
    if (!keys.length) return { titles: [], keys: [], loadedKeys: [] };
    const { data } = await supabase.from('knowledge_base').select('chapter_key').in('chapter_key', keys).limit(500);
    return { titles: covered.map((e) => e.title), keys, loadedKeys: [...new Set((data ?? []).map((r) => r.chapter_key))] };
  }, { entries, fileOrdinal, prefix, classLevel, book });
}

async function recordJob(fields) {
  try {
    return await page.evaluate(async (f) => {
      const { supabase } = await import('/src/lib/supabase.js');
      const { data, error } = await supabase.rpc('admin_record_content_job', f);
      if (error) throw new Error(error.message);
      return data;
    }, fields);
  } catch (e) {
    console.log(`      [content_jobs] could not record: ${e.message.slice(0, 120)}`);
    return null;
  }
}

/* ════════════════════════ MODE 3 — WORK (drain the queue) ═════════════ */
if (WORK) {
  const workerId = `${hostname()}-${process.pid}-${Date.now()}`;
  console.log(`Worker ${workerId} starting — draining the shared queue.\n`);

  // Generic local server: serves whatever absolute .pdf path is requested.
  // Deliberately unrestricted to one folder — queued jobs can come from
  // anywhere on disk, enqueued at different times by different --dir calls.
  // Loopback-only, dies with this process, same posture as mode 1's own
  // folder-scoped server.
  const fileServer = createServer((req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const requested = decodeURIComponent(req.url.slice(1));
    if (!requested.toLowerCase().endsWith('.pdf') || !existsSync(requested)) { res.writeHead(404, cors); res.end('no'); return; }
    const buf = readFileSync(requested);
    res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf', 'Content-Length': buf.length });
    res.end(buf);
  });
  await new Promise((r) => fileServer.listen(0, '127.0.0.1', r));
  const fileOrigin = `http://127.0.0.1:${fileServer.address().port}`;

  let done = 0, failed = 0, skipped = 0;
  for (;;) {
    const claim = await page.evaluate(async ({ uid, workerId }) => {
      const { supabase } = await import('/src/lib/supabase.js');
      const { data, error } = await supabase.rpc('admin_claim_next_content_job', {
        p_caller: uid, p_worker_id: workerId,
      });
      return { data, error: error?.message };
    }, { uid: ADMIN_UID, workerId });

    if (claim.error) { console.error(`\nclaim failed: ${claim.error}\n`); break; }
    if (!claim.data) { console.log(done + failed + skipped === 0 ? 'Queue is empty — nothing to do.' : '\nQueue drained.'); break; }

    const job = claim.data;
    const label = `[job ${job.id.slice(0, 8)}] ${job.source_file}`;
    console.log(`${label} — claimed (${job.exam_type} / ${job.subject}${job.book ? ` / ${job.book}` : ''})`);

    // exam_type is always "<board> Class <n>" for board exams (getDbExamType's
    // own construction) and has no class suffix for NEET/JEE — classLevel is
    // null there, matching what those subjects need.
    const classLevel = job.exam_type.match(/Class (\d+)$/)?.[1] ?? null;

    const manifest = await loadManifest(job.exam_type, job.subject, job.book);
    if (manifest.error) {
      await recordJob({ p_caller: ADMIN_UID, p_id: job.id, p_run_id: job.run_id, p_source_file: job.source_file,
        p_exam_type: job.exam_type, p_subject: job.subject, p_book: job.book, p_status: 'failed', p_error: `manifest: ${manifest.error}` });
      console.error(`  ✗ manifest: ${manifest.error}`);
      failed++; continue;
    }

    const fileOrdinal = job.file_ordinal; // may be null; re-derived by candidatesForFile via filename anyway
    const check = await alreadyLoadedKeys({
      entries: manifest.entries, fileOrdinal: null /* let candidatesForFile derive from filename inside */,
      prefix: manifest.keyPrefix, classLevel, book: job.book,
    });

    if (check.loadedKeys.length && !RELOAD) {
      await recordJob({ p_caller: ADMIN_UID, p_id: job.id, p_run_id: job.run_id, p_source_file: job.source_file,
        p_exam_type: job.exam_type, p_subject: job.subject, p_book: job.book, p_status: 'skipped',
        p_error: 'already loaded (chapter_keys present in knowledge_base)', p_chapters_expected: check.titles });
      console.log(`  = already loaded, skipped (${check.titles.join(' | ') || 'no matching entry'})`);
      skipped++; continue;
    }

    let out;
    try {
      out = await processOneFile({
        url: `${fileOrigin}/${encodeURIComponent(job.file_path)}`, filename: job.source_file,
        exam: job.exam_type, subject: job.subject, classLevel, book: job.book,
        keyPrefix: manifest.keyPrefix, fileStructure: manifest.fileStructure,
        dryRun: false, callerUid: ADMIN_UID,
      });
    } catch (e) {
      out = { error: `THREW: ${e.message}` };
    }

    if (out?.error) {
      await recordJob({ p_caller: ADMIN_UID, p_id: job.id, p_run_id: job.run_id, p_source_file: job.source_file,
        p_exam_type: job.exam_type, p_subject: job.subject, p_book: job.book, p_status: 'failed',
        p_error: out.error.slice(0, 2000), p_chapters_expected: check.titles });
      console.error(`  ✗ ${out.error}`);
      failed++; continue;
    }

    const produced = out.chapters.map((c) => c.title);
    const expected = check.titles;
    const mismatch = expected.length > 0 && (produced.length !== expected.length || produced.some((t, n) => t !== expected[n]));

    if (mismatch) {
      await recordJob({ p_caller: ADMIN_UID, p_id: job.id, p_run_id: job.run_id, p_source_file: job.source_file,
        p_exam_type: job.exam_type, p_subject: job.subject, p_book: job.book, p_status: 'failed',
        p_error: `chapter mismatch — expected [${expected.join(' | ')}], produced [${produced.join(' | ')}]`.slice(0, 2000),
        p_chapters_expected: expected, p_chapters_written: produced, p_chunk_count: out.kbCount ?? 0 });
      console.error(`  ✗ MISMATCH — expected [${expected.join(' | ')}], produced [${produced.join(' | ')}]`);
      failed++; continue;
    }

    await recordJob({ p_caller: ADMIN_UID, p_id: job.id, p_run_id: job.run_id, p_source_file: job.source_file,
      p_exam_type: job.exam_type, p_subject: job.subject, p_book: job.book, p_status: 'done',
      p_chapters_expected: expected, p_chapters_written: produced, p_chunk_count: out.kbCount ?? 0 });
    console.log(`  ✓ saved ${out.kbCount} chunks across ${out.lessonCount} chapter(s)${out.flagged ? ' (flagged: 2-of-3 signals)' : ''}`);
    done++;
  }

  console.log(`\n${done} done, ${failed} failed, ${skipped} skipped.`);
  fileServer.close();
  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
}

/* ════════════════════════ MODE 1 — IMMEDIATE (original) ════════════════ */

/* Files, in ordinal order. Sorting by the ordinal the MANIFEST will match on —
 * not by filename — so the run order matches the book's order regardless of how
 * the files happen to be named. */
const pdfs = await chapterFilesIn(DIR);

if (EXCLUDE.length) console.log(`Excluded by --exclude: ${EXCLUDE.join(', ')}`);

if (!pdfs.length) { console.error(`\nNo files with a parseable chapter number found in ${DIR}\n`); await browser.close(); process.exit(1); }

/* Serve the PDFs to the browser page. Reading them in Node and passing bytes
 * through page.evaluate would mean base64-ing multi-MB buffers across the CDP
 * bridge; a local origin the page can fetch() is what the other loaders do. */
const fileServer = createServer((req, res) => {
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

/* Load and gate the manifest before touching a single file. */
const manifest0 = await loadManifest(EXAM, SUBJECT, BOOK);
if (manifest0.error) { console.error(`\nManifest: ${manifest0.error}\n`); await browser.close(); fileServer.close(); process.exit(1); }
console.log(`Manifest approved, ${manifest0.entries.length} entries, valid.\n`);

/* Work out, in Node, exactly what each file SHOULD produce. */
async function expectedFor(filename) {
  const ord = await page.evaluate(async (filename) => {
    const { fileOrdinalFrom } = await import('/src/lib/chapterManifest.js');
    return fileOrdinalFrom(filename);
  }, filename);
  return { ord, ...(await alreadyLoadedKeys({ entries: manifest0.entries, fileOrdinal: ord, prefix: manifest0.keyPrefix, classLevel: CLASS_LVL, book: BOOK })) };
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

const skipped = queue.filter((j) => j.skip);
const toRun   = queue.filter((j) => !j.skip);
if (skipped.length) console.log(`\n${skipped.length} file(s) skipped as already loaded (pass --reload to force).`);
if (!toRun.length)  { console.log('\nNothing left to do.\n'); await browser.close(); fileServer.close(); process.exit(0); }
queue.length = 0; queue.push(...toRun);

console.log(DRY_RUN ? '\n--dry-run: extraction WILL run, writes will NOT.\n' : '\nWriting for real.\n');

const RUN_ID = randomUUID();
if (!DRY_RUN) console.log(`run_id ${RUN_ID}\n`);

const jobFields = (j, extra) => ({
  p_caller: ADMIN_UID, p_run_id: RUN_ID, p_source_file: j.name,
  p_exam_type: EXAM, p_subject: SUBJECT, p_book: BOOK, p_file_ordinal: j.ord ?? null,
  p_chapters_expected: j.titles ?? [], ...extra,
});

for (const j of skipped) {
  if (!DRY_RUN) await recordJob(jobFields(j, { p_id: null, p_status: 'skipped', p_error: 'already loaded (chapter_keys present in knowledge_base)' }));
}

let done = 0;
for (let i = 0; i < queue.length; i++) {
  const job = queue[i];
  const label = `[${i + 1}/${queue.length}] File #${job.ord} ${job.name}`;
  console.log(`${label} …`);

  const jobId = DRY_RUN ? null : await recordJob(jobFields(job, { p_id: null, p_status: 'running' }));

  let out;
  try {
    out = await processOneFile({
      url: `${fileOrigin}/${encodeURIComponent(job.name)}`, filename: job.name,
      exam: EXAM, subject: SUBJECT, classLevel: CLASS_LVL, book: BOOK,
      keyPrefix: manifest0.keyPrefix, fileStructure: manifest0.fileStructure,
      dryRun: DRY_RUN, callerUid: ADMIN_UID,
    });
  } catch (e) {
    if (!DRY_RUN) await recordJob(jobFields(job, { p_id: jobId, p_status: 'failed', p_error: `THREW: ${e.message}`.slice(0, 2000) }));
    console.error(`\n${label}\n  ✗ THREW: ${e.message}\n\nStopping — ${done} file(s) completed before this.\n`);
    await browser.close(); fileServer.close(); process.exit(1);
  }

  if (out?.error) {
    if (!DRY_RUN) await recordJob(jobFields(job, { p_id: jobId, p_status: 'failed', p_error: out.error.slice(0, 2000) }));
    console.error(`\n${label}\n  ✗ ${out.error}\n\nStopping — ${done} file(s) completed before this.\n`);
    await browser.close(); fileServer.close(); process.exit(1);
  }

  const produced = out.chapters.map((c) => c.title);

  const mismatch =
    produced.length !== job.titles.length ||
    produced.some((t, n) => t !== job.titles[n]);

  out.chapters.forEach((c) => console.log(`      ✓ "${c.title}"  pp${c.p1}-${c.p2}  ${c.chunks} chunks  [${c.unit ?? 'no unit'}]`));
  if (out.visionPageCount) console.log(`      ${out.visionPageCount} page(s) read by vision`);
  if (out.failedPages)     console.log(`      ⚠️  ${out.failedPages} page(s) failed to read`);

  if (mismatch) {
    if (!DRY_RUN) await recordJob(jobFields(job, {
      p_id: jobId, p_status: 'failed', p_chapters_written: produced, p_chunk_count: out.kbCount ?? 0,
      p_error: `chapter mismatch — expected [${job.titles.join(' | ')}], produced [${produced.join(' | ')}]`.slice(0, 2000),
    }));
    console.error(`\n  ✗ UNEXPECTED RESULT for ${job.name}`);
    console.error(`      expected (${job.titles.length}): ${job.titles.join(' | ')}`);
    console.error(`      produced (${produced.length}): ${produced.join(' | ')}`);
    console.error(`\nStopping. ${DRY_RUN ? 'Nothing was written (dry run).' : `${done} file(s) were written before this one; THIS file may be partially written — check knowledge_base.`}\n`);
    await browser.close(); fileServer.close(); process.exit(1);
  }

  if (!DRY_RUN) await recordJob(jobFields(job, {
    p_id: jobId, p_status: 'done', p_chapters_written: produced, p_chunk_count: out.kbCount ?? 0,
  }));

  if (!DRY_RUN) console.log(`      saved ${out.kbCount} chunks across ${out.lessonCount} chapter(s)${out.flagged ? ' (flagged: 2-of-3 signals)' : ''}`);
  done++;
  console.log('');
}

console.log(DRY_RUN
  ? `Dry run complete — ${done}/${queue.length} file(s) would load cleanly. Re-run without --dry-run to write.`
  : `Done — ${done}/${queue.length} file(s) loaded.`);

await browser.close();
fileServer.close();
