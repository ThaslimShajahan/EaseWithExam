/**
 * Phase 1 pilot runner.
 *
 *   npm run dev                       (note the port)
 *   ADMIN_UID=<firebase-uid> BASE_URL=http://localhost:5175 node scripts/run-pilot.mjs A
 *   ADMIN_UID=<firebase-uid> BASE_URL=http://localhost:5175 node scripts/run-pilot.mjs B
 *
 * Drives the REAL production modules (src/lib/pdfVision.js and
 * src/lib/contentExtraction.js) inside a browser page served by Vite — not a
 * reimplementation. The admin UI itself needs a Firebase-authenticated admin
 * session; this used to run unauthenticated because none could be minted
 * headlessly. That's no longer true — src/lib/devAuth.js (2026-08-12) mints
 * one via a Firebase Admin SDK custom token, the same mechanism
 * scripts/bulk-load-pyq.mjs and scripts/bulk-load-corpus.mjs already use.
 * ADMIN_UID is now required: knowledge_base's RLS lockdown (20260815020000)
 * means adminSaveKnowledgeChunks refuses an unauthenticated caller, so an
 * unauthenticated run would fail at the one write this pilot exists to
 * exercise, and previously-"expected" denials (content_figures below) would
 * no longer be the interesting case — real auth end-to-end is a strictly
 * more representative test of the actual pipeline.
 *
 * Pilot A  = a real text-layer chapter with figures and equations.
 * Pilot B  = a REAL scanned paper (easy with exam/_pilot/scanned-paper.pdf).
 *            This is the one that proves OCR quality under skew, glare and
 *            contrast loss.
 * Pilot BS = the SYNTHETIC image-only fixture (see make-scanned-fixture.mjs).
 *            Kept as a committed, always-available regression fixture: it
 *            proves the gate and the plumbing without needing a real scan on
 *            hand, but it does NOT prove OCR quality.
 */
import { chromium } from 'playwright';
import { copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAuth } from './firebaseAdmin.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:5173';
const WHICH = (process.argv[2] || 'A').toUpperCase();
const ADMIN_UID = process.env.ADMIN_UID || '';
if (!ADMIN_UID) {
  console.error('\nADMIN_UID is required. knowledge_base writes go through');
  console.error('admin_insert_knowledge_chunks, which refuses an unauthenticated caller.');
  console.error('Usage: ADMIN_UID=<firebase-uid> node scripts/run-pilot.mjs A\n');
  process.exit(1);
}

const PILOTS = {
  A: {
    src: 'easy with exam/11 NCRT SC/PHYSICS 1/keph104.pdf',
    label: 'Pilot A — text-layer chapter (figures + equations)',
    subject: 'Physics', examType: 'CBSE Class 11', chapter: 'Motion in a Plane',
    synthetic: false,
  },
  B: {
    src: 'easy with exam/_pilot/scanned-paper.pdf',
    label: 'Pilot B — REAL scanned paper',
    subject: 'Mathematics', examType: 'CBSE Class 8', chapter: 'Understanding Quadrilaterals',
    synthetic: false,
  },
  BS: {
    src: 'test-fixtures/scanned-synthetic.pdf',
    label: 'Pilot BS — SYNTHETIC image-only scan (regression fixture)',
    subject: 'Physics', examType: 'CBSE Class 11', chapter: 'Motion in a Plane (scanned)',
    synthetic: true,
  },
};

const pilot = PILOTS[WHICH];
if (!pilot) { console.error(`Unknown pilot "${WHICH}" — use A, B or BS.`); process.exit(1); }

const srcPath = resolve(ROOT, pilot.src);
if (!existsSync(srcPath)) { console.error(`[pilot] Source not found: ${srcPath}`); process.exit(1); }

// Vite only serves files under the project root via HTTP; stage the PDF in
// public/ so the page can fetch it, then remove it again.
const stageDir = resolve(ROOT, 'public/_pilot');
mkdirSync(stageDir, { recursive: true });
const staged = resolve(stageDir, 'input.pdf');
copyFileSync(srcPath, staged);

console.log(`\n${pilot.label}`);
console.log(`  source: ${pilot.src}`);
if (pilot.synthetic) {
  console.log('  ⚠ SYNTHETIC FIXTURE — proves the gate and plumbing, not OCR quality on a real scan.');
}

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('  [console]', m.text().slice(0, 200)); });

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });

const customToken = await getAuth().createCustomToken(ADMIN_UID);
const signedInAs = await page.evaluate(async (token) => {
  const { signInWithMintedToken } = await import('/src/lib/devAuth.js');
  return signInWithMintedToken(token);
}, customToken);
if (signedInAs !== ADMIN_UID) {
  console.error(`\nSigned in as ${signedInAs}, expected ${ADMIN_UID} — aborting.\n`);
  await browser.close();
  process.exit(1);
}

const out = await page.evaluate(async (p) => {
  const [{ extractPagesWithVision, needsVision }, ce, { supabase, adminSaveKnowledgeChunks }] = await Promise.all([
    import('/src/lib/pdfVision.js'),
    import('/src/lib/contentExtraction.js'),
    import('/src/lib/supabase.js'),
  ]);

  const buf = await (await fetch('/_pilot/input.pdf')).arrayBuffer();
  const ctx = { subject: p.subject, examType: p.examType, chapter: p.chapter };

  const t0 = performance.now();
  const ex = await extractPagesWithVision(buf, ctx, {});
  const extractMs = Math.round(performance.now() - t0);

  const thinPages = ex.pages.filter((t) => needsVision(t)).length;
  const charsPerPage = ex.pages.map((t) => (t ?? '').trim().length);

  // Real structuring + classification pass.
  const marked = ex.pages.map((t, i) => `[[PAGE ${i + 1}]]\n${t}`).join('\n\n');
  const { unit, lessons } = await ce.runNotesExtraction({
    rawText: marked, pages: ex.pages, examType: p.examType, subject: p.subject,
    onProgress: () => {},
  });

  const rows = lessons.flatMap((lesson) => ce.buildKbRows({
    lesson,
    chapterName: lesson.title || p.chapter,
    unit, subject: p.subject, examType: p.examType,
    source: `pilot:${p.src}`,
    figures: ex.figures, equationsByPage: ex.equationsByPage,
  }));

  const inserted = await adminSaveKnowledgeChunks(rows, p.adminUid);

  // Same figure-row builder the intake screen uses.
  const figRows = lessons.flatMap((lesson) => ce.buildFigureRows(
    ce.figuresForLesson(lesson, ex.figures),
    { sourceId: inserted?.[0]?.id ?? null, examType: p.examType, subject: p.subject, chapter: lesson.title || p.chapter },
  ));
  // content_figures writes require a verified admin (see the RLS policy) —
  // now genuinely satisfied, since this pilot signs in for real (see the
  // header comment). A denial here would now mean something is actually
  // wrong, not the expected/documented outcome it used to be.
  let figInserted = 0;
  let figError = null;
  if (figRows.length) {
    const { error } = await supabase.from('content_figures').insert(figRows);
    if (error) { figError = error.message; } else { figInserted = figRows.length; }
  }

  // Read the rows back to prove the real columns actually persisted.
  const { data: byChapter } = await supabase
    .from('knowledge_base')
    .select('content_type, difficulty, has_equations, figure_url, page_no, techniques, latex, source_ref, chapter, exam_type, class_level')
    .eq('source_ref->>source', `pilot:${p.src}`);

  return {
    extractMs,
    pageCount: ex.pageCount,
    visionPageCount: ex.visionPageCount,
    repairedPageCount: ex.repairedPageCount,
    thinPageCount: ex.thinPageCount,
    figurePageCount: ex.figurePageCount,
    skippedVisionPages: ex.skippedVisionPages,
    figureCount: ex.figures.length,
    croppedFigures: ex.figures.filter((f) => f.cropped).length,
    equationCount: ex.equationCount,
    thinPagesAfter: thinPages,
    charsPerPage: charsPerPage.slice(0, 8),
    lessonCount: lessons.length,
    rowCount: rows.length,
    insertedCount: inserted?.length ?? 0,
    figureRows: figRows.length,
    figureRowsInserted: figInserted,
    figureError: figError,
    sampleRow: rows[0] ? {
      chapter: rows[0].chapter, exam_type: rows[0].exam_type, class_level: rows[0].class_level,
      content_type: rows[0].content_type, difficulty: rows[0].difficulty,
      techniques: rows[0].techniques, confidence: rows[0].confidence,
      has_equations: rows[0].has_equations, latexCount: rows[0].latex?.length ?? 0,
      figure_url: rows[0].figure_url, source_ref: rows[0].source_ref,
    } : null,
    typeHistogram: rows.reduce((a, r) => { a[r.content_type ?? 'null'] = (a[r.content_type ?? 'null'] ?? 0) + 1; return a; }, {}),
    diffHistogram: rows.reduce((a, r) => { a[r.difficulty ?? 'null'] = (a[r.difficulty ?? 'null'] ?? 0) + 1; return a; }, {}),
    readBack: byChapter?.length ?? 0,
    recoveredPages: ex.pages.map((t) => (t ?? '').slice(0, 3000)),
    figureDetail: ex.figures.map((f) => ({ page: f.page_no, kind: f.kind, cropped: f.cropped, caption: f.caption, url: f.image_url })),
    equationSamples: Object.entries(ex.equationsByPage).flatMap(([pg, list]) => list.slice(0, 12).map((l) => `p${pg}: ${l}`)),
  };
}, { ...pilot, src: pilot.src, adminUid: ADMIN_UID });

await browser.close();
rmSync(stageDir, { recursive: true, force: true });

const line = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`);
console.log('\n  ── extraction ─────────────────────────');
line('pages', out.pageCount);
line('thin-text pages (repair)', out.thinPageCount);
line('figure-bearing pages', out.figurePageCount);
line('vision calls made', out.visionPageCount);
line('pages text-repaired', out.repairedPageCount);
line('vision pages skipped (cap)', out.skippedVisionPages);
line('chars/page (first 8)', `[${out.charsPerPage.join(', ')}]`);
line('pages still thin after', out.thinPagesAfter);
line('figures found', `${out.figureCount} (${out.croppedFigures} bbox-cropped, ${out.figureCount - out.croppedFigures} full-page — cropping is off by default, see CROP_FROM_MODEL_BBOX)`);
line('equations captured', out.equationCount);
line('extraction time', `${out.extractMs} ms`);

console.log('\n  ── classification ─────────────────────');
line('lessons', out.lessonCount);
line('chunks -> kb rows', out.rowCount);
line('rows inserted', out.insertedCount);
line('content_type histogram', JSON.stringify(out.typeHistogram));
line('difficulty histogram', JSON.stringify(out.diffHistogram));
line('content_figures rows', out.figureError
  ? `${out.figureRows} built, 0 inserted — ${out.figureError} (unexpected now that this pilot authenticates for real — investigate)`
  : `${out.figureRowsInserted} inserted / ${out.figureRows} built`);
line('rows read back by source', out.readBack);

console.log('\n  ── sample row ─────────────────────────');
console.log(JSON.stringify(out.sampleRow, null, 2).split('\n').map((l) => '  ' + l).join('\n'));

// The transcription is dumped verbatim so it can be diffed against the actual
// page by eye. On a real scan this is the only way to catch OCR damage —
// character counts alone look identical whether or not the words are right.
if (process.env.DUMP_TEXT !== '0') {
  console.log('\n  ── recovered text (verbatim, for OCR spot-check) ──');
  out.recoveredPages.forEach((t, i) => {
    console.log(`\n  [page ${i + 1}] ${t.length} chars`);
    console.log(t.split('\n').map((l) => '   | ' + l).join('\n'));
  });

  if (out.figureDetail.length) {
    console.log('\n  ── figures ───────────────────────────');
    out.figureDetail.forEach((f, i) => {
      console.log(`  [${i + 1}] p${f.page}  kind=${f.kind}  cropped=${f.cropped}`);
      console.log(`      caption: ${f.caption}`);
      console.log(`      url:     ${f.url}`);
    });
  }

  if (out.equationSamples.length) {
    console.log('\n  ── equations ─────────────────────────');
    out.equationSamples.forEach((e) => console.log('   ' + e));
  }
}
console.log();
