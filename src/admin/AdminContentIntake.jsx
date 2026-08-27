import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Link2, FileText, Loader2, CheckCircle2, AlertTriangle,
  X, Inbox, Info, BookOpen, ClipboardList, FolderSearch, Check, Circle,
  ChevronLeft, ImagePlus, ChevronDown, ChevronUp, Network, ArrowRight, Ban, MinusCircle,
} from 'lucide-react';
import { chatComplete, AI_REQUEST_TIMEOUT_MS } from '../lib/aiProxy';
import { supabase, adminSaveKnowledgeChunks } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { getFeatureFlag, FLAGS } from '../lib/featureFlags';
import { fetchPdfBuffer } from '../lib/pdfAnalyzer';
import { extractPagesWithVision, MAX_VISION_PAGES } from '../lib/pdfVision';
import {
  runPYQExtraction, extractNotesByManifest, buildKbRows, buildFigureRows, figuresForLesson,
  matchSyllabusChapterKeyed, normaliseMarks,
} from '../lib/contentExtraction';
import { fileOrdinalFrom, candidatesForFile } from '../lib/chapterManifest';
import { detectPrintedPageRange, matchFileToManifest } from '../lib/pageRangeMatch';
import { assignChapters, chapterKeyFor } from '../lib/chapterIdentity';
import { requireApprovedManifest } from '../lib/manifestExtraction';
import { getSubjectsForExam, BOARDS, CLASS_LEVELS, EXAM_TYPE_GROUPS } from '../lib/categories';
import { getChapters } from '../lib/syllabus';
import { listDriveFolderPdfs, fetchDriveFileBytes } from '../lib/driveFolder';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

/* ── Config ─────────────────────────────────────────────────────── */

// Live-derived from Admin > Categories — excludes the "Classes" group since
// class is picked contextually below a board pick, not as its own top group.
function getExamGroups() {
  return EXAM_TYPE_GROUPS.filter((g) => g.label !== 'Classes');
}

function getDbExamType(examBase, classLevel) {
  return BOARDS.includes(examBase) && classLevel ? `${examBase} Class ${classLevel}` : examBase;
}

function parseDriveFileId(input) {
  const m = input.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function resolveFetchUrl(rawUrl) {
  const driveId = parseDriveFileId(rawUrl);
  return driveId ? `https://drive.google.com/uc?export=download&id=${driveId}` : rawUrl;
}

// Best-effort chapter-name guess from a filename like "UNIT 1 WIT AND WISDOM.pdf" —
// only used as a starting hint; the real chapter comes from AI reading the content.
function cleanChapterGuess(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Align an AI-detected (or filename-guessed) chapter name to the admin's actual
// syllabus chapter list where possible, so it registers correctly in Content Map
// instead of showing up as an "unmapped" chapter with a slightly different name.
/* ── AI extraction ──────────────────────────────────────────────── */

// A single gpt-4o call has a fixed ~16K-token OUTPUT ceiling regardless of
// max_tokens requested — a full multi-chapter unit (e.g. a 48-page textbook
// unit, ~84K characters of source text) needs MORE output than that to
// return every chapter's chunks, so one giant call silently truncates mid-
// document (this is what previously cut a real upload off after page 23,
// even once the input-side slice was raised to 40000 — the real fix is to
// never ask a single call to process/emit that much at once). splitIntoBatches
// (from pdfAnalyzer.js) keeps each call's input+output comfortably inside the
// model's limits, cutting only at page boundaries; results are merged after.

/* ── Save helpers ───────────────────────────────────────────────── */

// Exported so scripts/bulk-load-pyq.mjs writes PYQ rows through the SAME
// function the admin screen uses, rather than keeping a second copy of the row
// shape. These rows feed Blueprint V2's chapter allocation, so a drifted
// duplicate would corrupt generation quietly.
/**
 * Content-engine rebuild, Phase 2 PYQ slice (docs/REBUILD_HANDOFF.md).
 *
 * `syllabusChapters` is now `{key, name}[]` (from getChapters()), not bare
 * names — chapter_key is resolved and written on a confident match via
 * matchSyllabusChapterKeyed(). On no match: REJECT THE INDIVIDUAL QUESTION,
 * not the whole paper (owner decision) — a 180-question NEET paper should not
 * be entirely blocked by one unmatched chapter, but silently writing an
 * unconstrained guess is exactly what this rebuild exists to prevent. Same
 * middle ground as the old pipeline was NOT: it always wrote every question,
 * unconstrained, on any miss.
 */
export async function savePYQRows({ questions, examType, subject, year, source, isMixed, syllabusChapters, callerUid = null }) {
  const reviewQueueOn = await getFeatureFlag(FLAGS.CONTENT_REVIEW_QUEUE);

  // A single-subject upload already has the right chapter list. A Mixed paper
  // (one file, multiple subjects — a combined NEET paper is Physics+Chemistry
  // +Biology at once) cannot be resolved from one subject's list, since each
  // question can belong to a different subject than whatever was selected at
  // upload time. Fetch per-subject lists for whichever subjects the
  // extraction actually produced — same per-subject getChapters() lookup
  // scripts/bulk-load-pyq.mjs already does, just discovered from the output
  // instead of a known subject list up front.
  let chaptersBySubject;
  if (isMixed) {
    const distinctSubjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))];
    const lists = await Promise.all(distinctSubjects.map((s) => getChapters(examType, s)));
    chaptersBySubject = new Map(distinctSubjects.map((s, i) => [s, lists[i].map((c) => ({ key: c.key, name: c.name }))]));
  } else {
    chaptersBySubject = new Map([[subject, syllabusChapters ?? []]]);
  }

  // Every adjustment normaliseMarks makes is collected so the operator sees it.
  // `marks` is an integer column and this used to be a raw `q.marks ?? null`
  // pass-through, so a single 0.5 from the model failed the whole multi-row
  // insert and lost every question in the file.
  const marksAdjusted = [];
  const rejected = [];

  const rows = [];
  questions.forEach((q, i) => {
    const marks = normaliseMarks(q.marks);
    if (marks.note) marksAdjusted.push(`Q${i + 1}: ${marks.note}`);

    const qSubject = isMixed ? (q.subject || 'General') : subject;
    const chapters = chaptersBySubject.get(qSubject) ?? [];
    const matched  = matchSyllabusChapterKeyed(q.chapter, chapters);

    if (!matched) {
      rejected.push(chapters.length === 0
        ? `Q${i + 1}: no syllabus exists yet for "${qSubject}" (${examType}) — upload Study Notes for this subject first`
        : `Q${i + 1}${q.chapter ? ` ("${q.chapter}")` : ''}: no confident match in ${qSubject}'s ${chapters.length}-chapter syllabus`);
      return; // reject THIS question only — the rest of the paper still saves
    }

    rows.push({
      exam_type:      examType,
      subject:        qSubject,
      chapter:        matched.name,
      chapter_key:    matched.key,
      question_text:  q.question_text,
      options:        q.options?.length ? q.options : null,
      correct_answer: q.correct_answer || null,
      explanation:    q.explanation || null,
      year:           year ? parseInt(year) : null,
      question_type:  q.type || 'MCQ',
      difficulty:     'Medium',
      marks:          marks.value,
      section:        q.section || null,
      has_diagram:    q.has_diagram ?? false,
      source,
      ...(reviewQueueOn && { status: 'in_review' }),
    });
  });

  // Direct table writes are closed (20260812020000) — pyq_questions was
  // ALL-writable by anyone holding the public anon key. Same returned shape as
  // the old .insert().select(), so callers are unaffected.
  const { data: saved, error } = rows.length
    ? await supabase.rpc('admin_insert_pyq_rows', { p_caller: callerUid || getCallerUid(), p_rows: rows })
    : { data: [], error: null };
  if (error) throw new Error(error.message);

  logChange(ENTITY.PYQ_QUESTION, 'bulk', ACTION.CREATE,
    { count: rows.length, rejected: rejected.length, examType, subject, source, marksAdjusted: marksAdjusted.length },
    `Content Intake: ${rows.length} PYQ questions from ${source}`
      + (rejected.length ? ` (${rejected.length} question(s) rejected — no confident chapter match)` : '')
      + (marksAdjusted.length ? ` (${marksAdjusted.length} marks value(s) adjusted)` : ''));

  // Carried as properties on the returned array rather than by changing the
  // return type, because scripts/bulk-load-pyq.mjs consumes this as an array.
  const out = saved ?? [];
  out.marksAdjusted = marksAdjusted;
  out.rejected = rejected;
  return out;
}

// Saves to knowledge_base (AI doubt-tutor retrieval) AND upserts one study_notes
// row PER lesson/chapter (the curated notes library Content Map + the student-
// facing Study Notes screen both read from) — a single unit upload with 3

/* Exported solely so scripts/bulk-load-unit-notes.mjs can drive the IDENTICAL
 * function this screen calls, rather than reimplementing the write path. A
 * second copy of this logic is exactly how the manifest gate came to be absent
 * from one path while present in another. Nothing else imports it. */
export async function saveNoteChunks({
  unit, lessons, examType, subject, chapter, source, callerUid, syllabusChapters,
  figures = [], equationsByPage = {},
  // `manifestRow` is the chapter_manifests row for this (examType, subject,
  // book) — the whole row, not just its entries, because requireApprovedManifest
  // needs `status` to tell "no manifest at all" apart from "a draft nobody has
  // approved yet". Those are different operator problems and deserve different
  // messages.
  //
  // FAIL-CLOSED since 2026-08-14. This used to accept null and fall through to
  // matchSyllabusChapter(), which is how a real upload silently produced a
  // chapter named "Poorvi" (the BOOK's title, read off a running header) and
  // merged two distinct texts into one lesson, while reporting success. The
  // engine was fully built and simply never reachable, because nothing could
  // create an approved manifest. An opt-in protection that defaults to off is
  // not a protection; see docs/REBUILD_HANDOFF.md.
  manifestRow = null, filename = null, book = null, classLevel = null,
  adminSelectedOrdinal = null,
}) {
  // Throws unless there is an approved, structurally valid manifest. Nothing
  // below this line runs — and so nothing is written — without one.
  requireApprovedManifest(manifestRow);
  const manifest = manifestRow.entries;

  const reviewQueueOn = await getFeatureFlag(FLAGS.CONTENT_REVIEW_QUEUE);

  let kbCount = 0;
  const chapterNames = [];
  let anyFlagged = false;
  // Deduped by chapter_key: several lessons in one file can resolve to the
  // same chapter (e.g. two chunks of the same prose chapter), and
  // admin_upsert_syllabus_node's own ON CONFLICT handles re-saves across
  // files, but there is no reason to call it twice for one file's own save.
  const syllabusEntriesToUpsert = new Map();

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    const chunks = lesson.chunks ?? [];
    if (!chunks.length) continue;

    // One representative page per LESSON, not per chunk — this pipeline's page
    // data is lesson-scoped (lesson.page_start/page_end), individual chunks
    // don't carry their own page number. That is exactly why the SPLIT is now
    // done from the manifest upstream (extractNotesByManifest) rather than
    // trusted from the model: once two chapters have been merged into one
    // lesson, no page information survives at this granularity to separate
    // them again. By the time we get here each lesson is already known to be
    // one manifest chapter; assignChapters CORROBORATES that, it no longer
    // has to discover it.
    const assigned = assignChapters({
      manifest, filename, classLevel, book,
      // A manifest-split lesson knows its own ordinal, which is a decisive
      // human-approved pick; fall back to the operator's choice otherwise.
      adminSelectedOrdinal: lesson.manifestOrdinal ?? adminSelectedOrdinal,
      chunks: [{ pageNo: lesson.page_start ?? null }],
    });
    if (!assigned.ok) {
      // REBUILD_HANDOFF.md's rule: disagree -> do not write, flag for review.
      // Blocking the WHOLE upload rather than silently falling back to a
      // model-guessed name is the entire point — a fallback here would just
      // rebuild the old failure mode one call site later.
      throw new Error(`Chapter assignment failed for "${lesson.title || '(untitled lesson)'}" in "${filename}": ${assigned.reason}`);
    }
    const chapterName = assigned.chunks[0].chapterName;
    const chapterKey  = assigned.chunks[0].chapterKey;
    // Per-chapter unit from the approved manifest, falling back to the
    // operator's single form field for books whose manifest has no units.
    const lessonUnit  = assigned.chunks[0].unit ?? unit ?? null;
    anyFlagged  = anyFlagged || assigned.flagged;
    for (const e of assigned.syllabusEntries) syllabusEntriesToUpsert.set(e.chapterKey, e);
    chapterNames.push(chapterName);

    if (reviewQueueOn) {
      const rows = chunks.map((c) => ({
        exam_type:     examType || null,
        subject,
        chapter:       chapterName,
        question_text: c.heading ? `${c.heading}\n\n${c.content}` : c.content,
        question_type: 'KB_NOTE',
        status:        'in_review',
        source,
      }));
      const { error } = await supabase.rpc('admin_insert_pyq_rows', {
        p_caller: callerUid || getCallerUid(),
        p_rows:   rows,
      });
      if (error) throw new Error(error.message);
      kbCount += rows.length;
    } else {
      const kbRows = buildKbRows({
        lesson, chapterName, chapterKey, book, unit: lessonUnit, subject, examType, source, figures, equationsByPage,
      });

      const ids = await adminSaveKnowledgeChunks(kbRows, callerUid || getCallerUid());
      kbCount += kbRows.length;

      const lessonFigures = figuresForLesson(lesson, figures);
      if (lessonFigures.length) {
        const { error: figErr } = await supabase.from('content_figures').insert(
          buildFigureRows(lessonFigures, {
            sourceId: ids?.[0]?.id ?? null, examType, subject, chapter: chapterName,
          }),
        );
        // A figure that fails to record must not lose the chapter's text.
        if (figErr) console.warn('[intake] content_figures insert failed:', figErr.message);
      }
    }

    // Curated study_notes row for this one lesson/chapter.
    const fullContent = chunks.map((c) => (c.heading ? `**${c.heading}**\n${c.content}` : c.content)).join('\n\n');
    const { error: noteErr } = await supabase.rpc('admin_upsert_study_note', {
      p_caller:       callerUid,
      p_id:           null,
      p_title:        chapterName,
      p_subject:      subject,
      p_exam_type:    examType || null,
      p_chapter:      chapterName,
      // study_notes.content is a Postgres `text` column (unbounded) — a long
      // lesson (e.g. a 19-page chapter's worth of chunks) legitimately runs
      // well past 12000 chars, and this cap was silently cutting it short.
      p_content:      fullContent,
      p_pdf_url:      null,
      p_centre_id:    null,
      p_is_published: !reviewQueueOn,
      p_tags:         chunks.flatMap((c) => c.keywords || []).slice(0, 10),
      p_unit:         lessonUnit,
      p_page_start:   lesson.page_start ?? null,
      p_page_end:     lesson.page_end ?? null,
      p_sort_order:   i,
      p_source_text:  lesson.verbatimText || null,
    });
    if (noteErr) throw new Error(noteErr.message);
  }

  // Single write path: the atomic syllabus_nodes upsert, in the same save as
  // the content it describes — never a separate manual seeding step. Runs
  // once per distinct chapter_key actually used in THIS file's save, after
  // every lesson's content already saved successfully, so a syllabus_nodes
  // failure can't orphan a chapter with real content pointing at it but no
  // syllabus entry to show for it. Reuses the existing, already-secure RPC —
  // this is not a new write surface.
  for (const entry of syllabusEntriesToUpsert.values()) {
    const { error: sylErr } = await supabase.rpc('admin_upsert_syllabus_node', {
      p_caller:      callerUid,
      p_exam_type:   examType,
      p_subject:     subject,
      p_chapter_name: entry.chapterName,
      p_chapter_key: entry.chapterKey,
      p_class_level: classLevel,
      p_sort_order:  entry.sortOrder,
      // 20260814040000 added this column so Syllabus and Content Map — the two
      // surfaces reading syllabus_nodes — can group the way the student notes
      // browser already does.
      p_unit:        entry.unit ?? unit ?? null,
    });
    if (sylErr) throw new Error(`syllabus_nodes upsert failed for "${entry.chapterName}" (${entry.chapterKey}): ${sylErr.message}`);
  }

  logChange(ENTITY.CONTENT_ITEM, 'bulk', ACTION.CREATE,
    { count: kbCount, examType, subject, source, unit, lessons: chapterNames, chapterKeysWritten: [...syllabusEntriesToUpsert.keys()] },
    `Content Intake: ${kbCount} knowledge chunks across ${chapterNames.length} lesson(s)${unit ? ` in "${unit}"` : ''}`);

  return {
    kbCount, chapterName: chapterNames.join(', '), unit, lessonCount: chapterNames.length,
    flagged: anyFlagged, chapterKeysWritten: [...syllabusEntriesToUpsert.keys()],
  };
}

/* ── Pre-upload duplicate check (notes only) ───────────────────────
 *
 * Same signal scripts/bulk-load-unit-notes.mjs's own alreadyLoadedKeys()
 * checks, run directly in-browser instead of through page.evaluate: does
 * knowledge_base already have chunks for the manifest entry/entries this
 * FILENAME resolves to? No AI call, no vision, no fetched bytes — just the
 * filename's ordinal against the approved manifest and one cheap select —
 * so this can run before extractPagesWithVision, not after paying for it.
 *
 * Assumes the default 'c' key prefix. saveNoteChunks/assignChapters on this
 * screen never thread the manifest's own (admin-editable) key_prefix through
 * to chapterKeyFor either — every real save from this screen writes under
 * the 'c' default regardless of what the manifest editor's Key Prefix field
 * says — so matching that same default here is what makes this check agree
 * with what a save would actually write, not a separate assumption of its
 * own. (A manifest saved under a non-default prefix is a pre-existing gap
 * outside this change's scope — flagged, not fixed, here.)
 *
 * MUST be scoped by (examType, subject), same as the real uniqueness the key
 * carries: chapterKeyFor() deliberately leaves subject out of the key string
 * (see chapterIdentity.js:36 — "book stays out of the UNIQUE index (exam_type,
 * subject, chapter_key)"), so 'c11_ch01' is only meaningful WITHIN one
 * (exam_type, subject) pair. Two unrelated single-book Class 11 subjects that
 * both leave book unset (e.g. Accountancy ch.1 and Biology ch.1) produce the
 * IDENTICAL string. Querying knowledge_base by chapter_key alone — across
 * every subject and exam_type — reported CBSE Class 11 Biology's "The Living
 * World" as already loaded because CBSE Class 11 Accountancy's "Introduction
 * to Accounting" happens to share key c11_ch01 and had real rows. Confirmed
 * live against knowledge_base 2026-08-20. Filtering by exam_type+subject here
 * makes this check agree with the DB's own uniqueness guarantee instead of a
 * looser one of its own.
 */
export async function checkAlreadyLoaded(entries, filename, classLevel, book, examType, subject) {
  const fileOrdinal = fileOrdinalFrom(filename);
  const covered = candidatesForFile(entries, fileOrdinal, null);
  if (!covered.length) return { titles: [], keys: [], loadedKeys: [] };
  const keys = covered.map((e) => chapterKeyFor({ classLevel, book, ordinal: e.ordinal }));
  const { data } = await supabase.from('knowledge_base').select('chapter_key')
    .eq('exam_type', examType).eq('subject', subject).in('chapter_key', keys).limit(500);
  return { titles: covered.map((e) => e.title), keys, loadedKeys: [...new Set((data ?? []).map((r) => r.chapter_key))] };
}

// Blocking prompt for the single-file/URL/Drive queue (handleProcess) — same
// interrupt-and-wait pattern as ManifestEntryPicker below. Default action is
// Skip (no API call); Load anyway is an explicit, separate button, never
// pre-selected.
function DuplicateLoadPrompt({ prompt, onSkip, onLoadAnyway }) {
  if (!prompt) return null;
  const { filename, titles, loadedCount, totalCount } = prompt;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
        className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">This chapter already has content loaded</p>
            <p className="text-xs text-slate-400 mt-1 break-words">
              <span className="font-mono text-slate-300">&quot;{filename}&quot;</span> matches{' '}
              {titles.length ? titles.map((t) => `"${t}"`).join(', ') : 'a chapter'} — {loadedCount} of {totalCount} chapter key(s)
              already have chunks in knowledge_base. Re-processing will add duplicates and cost real API spend again.
            </p>
          </div>
        </div>
        <div className="px-5 py-3.5 flex items-center justify-end gap-2">
          <button onClick={onSkip}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors">
            Skip — don&apos;t call the API
          </button>
          <button onClick={onLoadAnyway}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition-colors">
            Load anyway
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Diagram image enrichment (PYQ only) ─────────────────────────── */

async function uploadImageForPYQ(file, rowId) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `pyq-images/${Date.now()}-${rowId}.${ext}`;
  const { error: upErr } = await supabase.storage.from('question-papers').upload(path, file, { upsert: true });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('question-papers').getPublicUrl(path);
  const { error: updErr } = await supabase.rpc('admin_set_pyq_image', {
    p_caller: getCallerUid(), p_id: rowId, p_image_url: data.publicUrl,
  });
  if (updErr) throw updErr;
  logChange(ENTITY.PYQ_QUESTION, rowId, ACTION.UPDATE, { after: { image_url: data.publicUrl } }, 'Diagram image attached to PYQ question');
  return data.publicUrl;
}

function DiagramEnrichPanel({ savedRows }) {
  const [open,    setOpen]    = useState(true);
  const [images,  setImages]  = useState({});
  const [loading, setLoading] = useState({});
  const [errors,  setErrors]  = useState({});
  const fileRefs = useRef({});

  const diagramQs = savedRows.filter((r) => r.has_diagram);
  if (!diagramQs.length) return null;

  const handleFile = async (rowId, file) => {
    if (!file || !file.type.startsWith('image/')) return;
    setLoading((p) => ({ ...p, [rowId]: true }));
    setErrors((p) => ({ ...p, [rowId]: null }));
    try {
      const url = await uploadImageForPYQ(file, rowId);
      setImages((p) => ({ ...p, [rowId]: url }));
    } catch (e) {
      setErrors((p) => ({ ...p, [rowId]: e.message }));
    } finally {
      setLoading((p) => ({ ...p, [rowId]: false }));
    }
  };

  const done = Object.keys(images).length;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-amber-900/10 border border-amber-700/30 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-5 py-4 text-left">
        <ImagePlus size={16} className="text-amber-400 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-bold text-amber-300">Add Diagram Images</p>
          <p className="text-[11px] text-amber-600 mt-0.5">
            {diagramQs.length} question{diagramQs.length !== 1 ? 's' : ''} reference a figure · {done}/{diagramQs.length} added
          </p>
        </div>
        {done === diagramQs.length ? <CheckCircle2 size={16} className="text-emerald-400" /> : (open ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />)}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-5 pb-5 space-y-3 border-t border-amber-700/20 pt-3">
              {diagramQs.map((q) => {
                const imageUrl = images[q.id];
                const isLoading = loading[q.id];
                return (
                  <div key={q.id} className="bg-slate-900/60 rounded-xl p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      {q.section && <span className="text-[10px] font-bold bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded shrink-0">Sec {q.section}</span>}
                      <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">{q.question_text}</p>
                    </div>
                    {imageUrl ? (
                      <div className="relative rounded-lg overflow-hidden border border-emerald-700/40">
                        <img src={imageUrl} alt="Question diagram" className="w-full max-h-40 object-contain bg-white" />
                        <button onClick={() => fileRefs.current[q.id]?.click()} className="absolute top-1.5 right-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg px-2 py-1 text-[10px] font-semibold">Replace</button>
                      </div>
                    ) : (
                      <button onClick={() => fileRefs.current[q.id]?.click()} disabled={isLoading}
                        className="w-full flex items-center justify-center gap-2 border border-dashed border-amber-700/40 hover:border-amber-500 rounded-xl py-3 text-xs text-amber-500 hover:text-amber-300 transition-colors disabled:opacity-40">
                        {isLoading ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : <><ImagePlus size={13} /> Click to upload diagram image</>}
                      </button>
                    )}
                    {errors[q.id] && <p className="text-[10px] text-red-400">{errors[q.id]}</p>}
                    <input ref={(el) => { fileRefs.current[q.id] = el; }} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(q.id, e.target.files?.[0])} />
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Small UI helpers ─────────────────────────────────────────────── */

function Chip({ label, active, onClick }) {
  return (
    <button onClick={onClick} className={[
      'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
      active ? 'bg-primary-600 border-primary-600 text-white' : 'bg-slate-800 border-white/10 text-slate-400 hover:border-primary-500/50 hover:text-primary-300',
    ].join(' ')}>
      {label}
    </button>
  );
}

function StepDots({ steps, current }) {
  const idx = steps.indexOf(current);
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <div className={[
            'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors',
            i < idx ? 'bg-emerald-500 text-white' : i === idx ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-500 border border-white/10',
          ].join(' ')}>
            {i < idx ? <Check size={13} /> : i + 1}
          </div>
          {i < steps.length - 1 && <div className={`h-0.5 w-6 sm:w-10 ${i < idx ? 'bg-emerald-500' : 'bg-white/10'}`} />}
        </div>
      ))}
    </div>
  );
}

// Admin-override picker for a file that couldn't be auto-matched to a
// manifest entry. Same discipline as everywhere else in this pipeline: the
// admin picks from the manifest's own closed set (`entries`), never types a
// name — see chapterIdentity.js's note on why free text is how 'Poorvi' and
// 'Critical Reflection' got in. No entry is pre-selected; the admin must
// actively click one, or Cancel to leave the file unmatched.
function ManifestEntryPicker({ prompt, onSelect, onCancel }) {
  if (!prompt) return null;
  const { filename, reason, entries } = prompt;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
        className="bg-slate-900 border border-white/10 rounded-2xl max-w-lg w-full max-h-[80vh] flex flex-col overflow-hidden shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-start gap-3 shrink-0">
          <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Couldn&apos;t auto-match this file</p>
            <p className="text-xs text-slate-400 mt-1 break-words">
              <span className="font-mono text-slate-300">&quot;{filename}&quot;</span> — {reason}.
            </p>
          </div>
        </div>

        <div className="px-5 py-3 overflow-y-auto flex-1 space-y-1.5">
          <p className="text-[11px] text-slate-500 uppercase tracking-wide font-semibold mb-1.5">
            Which chapter does this file actually contain?
          </p>
          {entries.map((e) => (
            <button
              key={e.ordinal}
              onClick={() => onSelect(e)}
              className="w-full text-left px-3 py-2.5 rounded-xl bg-slate-800/60 hover:bg-primary-900/30 border border-white/5 hover:border-primary-500/50 transition-colors flex items-center justify-between gap-3 group"
            >
              <div className="min-w-0">
                <p className="text-sm text-white font-medium truncate">{e.title}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Chapter {e.ordinal}
                  {e.printedNumber != null ? ` · printed #${e.printedNumber}` : ''}
                  {e.fileOrdinal != null ? ` · File # ${e.fileOrdinal}` : ' · File # unset'}
                </p>
              </div>
              <ArrowRight size={14} className="text-slate-600 group-hover:text-primary-400 shrink-0" />
            </button>
          ))}
        </div>

        <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-slate-500">Nothing uploads until you pick one.</p>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          >
            Cancel — don&apos;t upload this file
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

const CONFIDENCE = {
  confirmed: { label: 'Content + filename agree', cls: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/30' },
  content:   { label: 'Matched by content',        cls: 'bg-blue-900/30 text-blue-300 border-blue-700/30' },
  filename:  { label: 'Matched by filename only',  cls: 'bg-slate-800 text-slate-300 border-white/10' },
  conflict:  { label: 'Conflict — pick manually',  cls: 'bg-red-900/30 text-red-300 border-red-700/30' },
  multiple:  { label: 'Spans multiple chapters',   cls: 'bg-amber-900/30 text-amber-300 border-amber-700/30' },
  none:      { label: 'No match — pick manually',  cls: 'bg-red-900/30 text-red-300 border-red-700/30' },
};

/**
 * Multi-file match & review — one row per uploaded file. A suggestion (from
 * pageRangeMatch.js) may pre-select a dropdown value, but `confirmed` is
 * always false until the admin explicitly says so, regardless of confidence
 * — "Confirm All" only confirms rows that already have a selection, it never
 * invents one. Nothing in this component ever calls a save path; onProcess is
 * the one function that does, and it only runs on click.
 */
function MatchReviewScreen({ rows, manifestEntries, onChoose, onConfirm, onUnconfirm, onConfirmAll, onCancel, onProcess, onLoadAnyway }) {
  // A unit container (isUnit: true) is a printed heading, not a pickable
  // chapter — a file's content is never "the whole Unit", so it must not
  // show up as an option here.
  const numbered = manifestEntries.filter((e) => e.numbered !== false && e.isUnit !== true);
  // Excludes needsLoadAnywayConfirm rows — those need a duplicate decision,
  // not a chapter pick, and must not be counted toward "need a manual pick".
  const usable = rows.filter((r) => !r.error && !r.needsLoadAnywayConfirm);
  const confirmedCount = usable.filter((r) => r.confirmed).length;
  const readyToConfirmCount = usable.filter((r) => !r.confirmed && r.chosenOrdinal != null).length;
  const needsPickCount = usable.filter((r) => r.chosenOrdinal == null).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 bg-slate-800/40 border border-white/8 rounded-xl p-3">
        <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400 leading-relaxed">
          Nothing has been saved yet. Every row below needs an explicit Confirm — even the ones the match found
          agreement on — before <b className="text-slate-300">Process</b> touches anything. Rows without a match
          require picking a chapter from the dropdown first.
        </p>
      </div>

      <div className="bg-slate-900/60 border border-white/8 rounded-2xl overflow-hidden">
        <div className="divide-y divide-white/5">
          {rows.map((r, i) => {
            if (r.error) {
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-300 truncate">{r.item.name}</p>
                    <p className="text-xs text-red-400">{r.error}</p>
                  </div>
                </div>
              );
            }
            // Duplicate detected from the filename alone, before extraction
            // ever ran — see checkAlreadyLoaded. No AI call has been made for
            // this row yet; "Load anyway" is what actually triggers it.
            if (r.needsLoadAnywayConfirm) {
              const dup = r.alreadyLoaded;
              return (
                <div key={i} className="flex items-start gap-3 px-4 py-3 bg-amber-900/10">
                  <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-200 truncate">{r.item.name}</p>
                    <p className="text-xs text-amber-300/90 mt-0.5">
                      {dup.titles.length ? dup.titles.map((t) => `"${t}"`).join(', ') : 'This chapter'} already has {dup.loadedKeys.length} of {dup.keys.length} chapter key(s)
                      loaded in knowledge_base. Re-processing will add duplicates and cost real API spend again.
                    </p>
                  </div>
                  <button
                    onClick={() => onLoadAnyway(i)}
                    disabled={r.loadingAnyway}
                    className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white transition-colors flex items-center gap-1.5"
                  >
                    {r.loadingAnyway ? <><Loader2 size={12} className="animate-spin" /> Reading…</> : 'Load anyway'}
                  </button>
                </div>
              );
            }
            const badge = CONFIDENCE[r.suggestion?.confidence] ?? CONFIDENCE.none;
            const range = r.detectedRange?.firstPage != null
              ? `pages ${r.detectedRange.firstPage}–${r.detectedRange.lastPage}`
              : 'no printed page numbers detected';
            return (
              <div key={i} className={`px-4 py-3 space-y-2 ${r.confirmed ? 'bg-emerald-900/5' : ''}`}>
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-200 truncate">{r.item.name}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">{range}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg border shrink-0 ${badge.cls}`}>{badge.label}</span>
                  {r.confirmed && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded-lg border shrink-0 bg-emerald-600/20 text-emerald-300 border-emerald-600/40 flex items-center gap-1">
                      <CheckCircle2 size={11} /> Confirmed
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">{r.suggestion?.reason}</p>
                <div className="flex items-center gap-2">
                  <select
                    value={r.chosenOrdinal ?? ''}
                    disabled={r.confirmed}
                    onChange={(e) => onChoose(i, e.target.value === '' ? null : Number(e.target.value))}
                    className="flex-1 bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    <option value="">— pick a chapter —</option>
                    {numbered.map((e) => (
                      <option key={e.ordinal} value={e.ordinal}>
                        Chapter {e.ordinal} — {e.title}{e.fileOrdinal != null ? ` (File #${e.fileOrdinal})` : ''}
                      </option>
                    ))}
                  </select>
                  {r.confirmed ? (
                    <button onClick={() => onUnconfirm(i)}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                      Unconfirm
                    </button>
                  ) : (
                    <button onClick={() => onConfirm(i)} disabled={r.chosenOrdinal == null}
                      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                      Confirm
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs text-slate-500">
          {confirmedCount} confirmed · {readyToConfirmCount} ready to confirm · {needsPickCount} need a manual pick
        </p>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
            Cancel, back to file list
          </button>
          <button onClick={onConfirmAll} disabled={readyToConfirmCount === 0}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 transition-colors">
            Confirm All ({readyToConfirmCount})
          </button>
          <button onClick={onProcess} disabled={confirmedCount === 0}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
            Process {confirmedCount} Confirmed File{confirmedCount === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────────── */

const WIZARD_STEPS = ['type', 'classify', 'input', 'results'];
const STEP_LABELS  = { type: 'Content Type', classify: 'Class & Subject', input: 'Source', results: 'Process & Review' };

export default function AdminContentIntake() {
  const navigate = useNavigate();
  const callerUid = getCallerUid();

  const [step, setStep] = useState('type');

  // Step 1
  const [contentType, setContentType] = useState(''); // 'pyq' | 'notes'

  // Step 2
  const [examBase,   setExamBase]   = useState('CBSE');
  // No default class. This used to be '10', and because the Class 10 chip then
  // rendered as already-selected it read as a deliberate choice rather than an
  // untouched default — a Class 8 upload sailed through and was stored as
  // "CBSE Class 10". Empty means the admin must pick, and the Continue button
  // below enforces it for board exam types.
  const [classLevel, setClassLevel] = useState('');
  const [subject,    setSubject]    = useState('');
  const [year,       setYear]       = useState('');
  const [chapterHint, setChapterHint] = useState('');
  // Content-engine rebuild Phase 2 (docs/REBUILD_HANDOFF.md). Only relevant to
  // multi-book subjects (CBSE English: Hornbill vs Woven Words) — chapter_key
  // stays book-scoped null for the majority of single-book subjects, matching
  // chapterKeyFor()'s own "keeps single-book subjects unscoped" design.
  // Empty string here means null, not "unset book".
  const [book, setBook] = useState('');

  const isBoard    = BOARDS.includes(examBase);
  const dbExamType = isBoard ? getDbExamType(examBase, classLevel) : examBase;
  const subjects   = getSubjectsForExam(dbExamType);
  const isMixed    = subject === 'Mixed';

  // Real syllabus chapters for this exam+subject — used to align AI-detected
  // chapter names so they register correctly in Content Map, and (Phase 2 PYQ
  // slice) to resolve a real chapter_key for PYQ questions. Kept as
  // {key, name}[] now, not bare names — matchSyllabusChapter (Notes' no-
  // manifest fallback) still gets plain names via syllabusChapterNames below,
  // unchanged; matchSyllabusChapterKeyed (PYQ) needs the key too.
  const [syllabusChapters, setSyllabusChapters] = useState([]);
  useEffect(() => {
    if (!subject || step === 'type') { setSyllabusChapters([]); return; }
    let cancelled = false;
    getChapters(dbExamType, subject).then((chs) => {
      if (!cancelled) setSyllabusChapters(chs.map((c) => ({ key: c.key, name: c.name })));
    });
    return () => { cancelled = true; };
  }, [dbExamType, subject, step]);
  const syllabusChapterNames = syllabusChapters.map((c) => c.name);

  // The chapter_manifests row for (dbExamType, subject, book) — WHOLE row, and
  // deliberately NOT filtered by status. requireApprovedManifest() needs to see
  // a draft in order to say "approve it first" instead of "none exists": those
  // are different operator problems with different fixes, and collapsing them
  // into one null was actively misleading.
  //
  // Read-open RLS (chapter_manifests_read), so this is a plain select.
  const [manifestRow, setManifestRow] = useState(null);
  useEffect(() => {
    if (!subject || step === 'type' || contentType !== 'notes') { setManifestRow(null); return; }
    let cancelled = false;
    // .is('book', null) rather than .eq('book', null) — PostgREST's `=`
    // operator never matches NULL (standard SQL), only `IS` does. Getting
    // this wrong would silently break every single-book subject's lookup,
    // which is most of them. Under fail-closed this now surfaces as a REFUSED
    // upload rather than a silently mis-filed one, which is the point.
    // Excludes 'superseded' explicitly, then picks in JS rather than trusting
    // .maybeSingle() — 20260813020000 lets superseded revisions "pile up
    // freely", and a book mid-revision can briefly have BOTH a live approved
    // row and a new not-yet-approved draft. Either shape returns more than
    // one row for this combo, which .maybeSingle() treats as an error and
    // silently resolves to null here — the upload gate below reads that as
    // "no manifest", wrongly blocking uploads against a manifest that's
    // still perfectly approved. Preferring 'approved' over 'draft' keeps
    // uploads working off the live manifest while a revision is in flight.
    let q = supabase.from('chapter_manifests').select('id, status, entries, book, file_structure')
      .eq('exam_type', dbExamType).eq('subject', subject).in('status', ['draft', 'approved']);
    q = book ? q.eq('book', book) : q.is('book', null);
    q.then(({ data }) => {
      if (cancelled) return;
      const rows = data ?? [];
      setManifestRow(rows.find((r) => r.status === 'approved') ?? rows.find((r) => r.status === 'draft') ?? null);
    });
    return () => { cancelled = true; };
  }, [dbExamType, subject, book, step, contentType]);

  // Approved-and-usable is what the upload gate actually cares about; the raw
  // row is kept for the banner so it can distinguish draft from missing.
  const approvedManifest = manifestRow?.status === 'approved' ? manifestRow.entries : null;

  // Admin-override picker — shown when a file's filename can't be auto-matched
  // to a manifest entry (unparseable, or parses to an ordinal no entry has).
  // Rather than a hard refusal with no path forward, the admin picks the real
  // entry from the manifest's own closed set (never free text — see
  // chapterIdentity.js's adminSelectedOrdinal, which this feeds into via
  // extractNotesByManifest's `covered` list). promptForManifestEntry() blocks
  // the CURRENT file only — handleProcess's loop is a plain `for`, and this
  // resolver-per-prompt pattern lets it await one decision without touching
  // the other files in the batch.
  const [manifestPrompt, setManifestPrompt] = useState(null); // { filename, reason, entries } | null
  const manifestPromptResolveRef = useRef(null);
  function promptForManifestEntry(filename, reason, entries) {
    return new Promise((resolve) => {
      manifestPromptResolveRef.current = resolve;
      setManifestPrompt({ filename, reason, entries });
    });
  }
  function resolveManifestPrompt(entry) {
    manifestPromptResolveRef.current?.(entry ?? null);
    manifestPromptResolveRef.current = null;
    setManifestPrompt(null);
  }

  // Duplicate-upload override — blocks the CURRENT file only, same
  // resolver-per-prompt pattern as the manifest-entry picker above. Resolves
  // to `true` (Load anyway) or `false` (Skip, the default action — no API
  // call is made for this file).
  const [dupPrompt, setDupPrompt] = useState(null); // { filename, titles, loadedCount, totalCount } | null
  const dupPromptResolveRef = useRef(null);
  function promptDuplicateLoad(filename, dup) {
    return new Promise((resolve) => {
      dupPromptResolveRef.current = resolve;
      setDupPrompt({ filename, titles: dup.titles, loadedCount: dup.loadedKeys.length, totalCount: dup.keys.length });
    });
  }
  function resolveDupPrompt(loadAnyway) {
    dupPromptResolveRef.current?.(loadAnyway);
    dupPromptResolveRef.current = null;
    setDupPrompt(null);
  }

  // Step 3 — items to process, regardless of source
  const [inputTab,  setInputTab]  = useState('file'); // file | url | folder
  const [items,     setItems]     = useState([]);     // [{ source, file?, url?, id?, name, path?, chapter, selected }]
  const [urlInput,  setUrlInput]  = useState('');
  const [folderUrl, setFolderUrl] = useState('');
  const [driveToken, setDriveToken] = useState('');
  const [scanningFolder, setScanningFolder] = useState(false);
  const [folderErr, setFolderErr] = useState('');
  // Escape hatch for a scan whose text layer is just above the 80-char gate —
  // a page of OCR garbage from a bad prior scan can read as "has text" while
  // being unusable.
  const [forceVision, setForceVision] = useState(false);
  const fileInputRef = useRef(null);

  // Step 4
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchResults, setBatchResults] = useState([]); // [{ name, status, message, savedRows? }]
  const [batchErr,     setBatchErr]     = useState('');
  // Cancels the in-flight run. The abort plumbing already existed all the way
  // down through extractPagesWithVision/visionExtractPage — this screen simply
  // never created a controller, so it was dead wiring and an operator watching
  // a stuck page had nothing to press.
  const abortRef = useRef(null);

  // Multi-file match & review — notes uploads against an approved manifest
  // only. Extraction (extractPagesWithVision) runs ONCE per file here, during
  // matching; Process below reuses the same `pages` rather than re-fetching
  // and re-extracting, so confirming a match costs no extra AI call. Detection
  // itself (pageRangeMatch.js) is deliberately NOT an AI call either — see
  // that file's header for why running the model here would reintroduce the
  // exact un-anchored chapter-boundary guess this whole pipeline exists to
  // prevent.
  const [matchPhase, setMatchPhase] = useState('idle'); // 'idle' | 'matching' | 'review'
  const [matchRows,  setMatchRows]  = useState([]);
  // [{ item, pages, figures, equationsByPage, visionPageCount, failedPages,
  //    detectedRange, suggestion, chosenOrdinal, confirmed, error }]
  const [matchErr, setMatchErr] = useState('');

  function changeExamBase(e) {
    setExamBase(e);
    // No `|| '10'` fallback here either — it would quietly reinstate the very
    // default the empty initial state exists to remove.
    const next = BOARDS.includes(e) ? getDbExamType(e, classLevel) : e;
    setSubject(getSubjectsForExam(next)[0] ?? 'General');
  }
  function changeClassLevel(cl) {
    setClassLevel(cl);
    setSubject(getSubjectsForExam(getDbExamType(examBase, cl))[0] ?? 'General');
  }

  function goBack() {
    const i = WIZARD_STEPS.indexOf(step);
    if (i > 0) setStep(WIZARD_STEPS[i - 1]);
  }

  function addFiles(fileList) {
    const newItems = Array.from(fileList).map((file) => ({
      source: 'file', file, name: file.name, chapter: cleanChapterGuess(file.name), selected: true,
    }));
    setItems((its) => [...its, ...newItems]);
  }
  function removeItem(i) {
    setItems((its) => its.filter((_, idx) => idx !== i));
  }
  function toggleItem(i) {
    setItems((its) => its.map((it, idx) => idx === i ? { ...it, selected: !it.selected } : it));
  }
  function updateItemChapter(i, val) {
    setItems((its) => its.map((it, idx) => idx === i ? { ...it, chapter: val } : it));
  }

  function addUrlItem() {
    const raw = urlInput.trim();
    if (!raw) return;
    const name = raw.split('/').filter(Boolean).pop() || 'Linked PDF';
    setItems((its) => [...its, { source: 'url', url: raw, name, chapter: cleanChapterGuess(name), selected: true }]);
    setUrlInput('');
  }

  async function handleScanFolder() {
    setFolderErr('');
    if (!folderUrl.trim()) { setFolderErr('Paste a Drive folder link first.'); return; }
    setScanningFolder(true);
    try {
      const { files, token } = await listDriveFolderPdfs(folderUrl.trim());
      setDriveToken(token);
      setItems((its) => [
        ...its,
        ...files.map((f) => ({ source: 'drive', id: f.id, name: f.name, path: f.path, chapter: cleanChapterGuess(f.name), selected: true })),
      ]);
    } catch (e) {
      setFolderErr(e.message);
    } finally {
      setScanningFolder(false);
    }
  }

  // A File object from <input type=file> is a live browser handle, not a
  // stored copy — if it sits selected for several minutes (e.g. across an
  // attempt that timed out retrying) the browser can invalidate it, and
  // reading it then throws the raw DOMException
  // "A requested file or directory could not be found at the time an
  // operation was processed." A retry that reuses the SAME item (nothing
  // upstream forces a fresh file pick — see the deselect-on-success-only
  // note in handleProcess) hits this on the very next read. Surfacing the
  // browser's cryptic message as-is left an admin with a real, unsaved
  // upload and no idea the fix was simply "remove this file and re-add it".
  async function getBytes(item) {
    if (item.source === 'file') {
      try {
        return await item.file.arrayBuffer();
      } catch (e) {
        const err = new Error(
          `"${item.name}" can't be read anymore — its browser file selection expired (this happens after it's `
          + `sat selected for several minutes, e.g. across a timed-out attempt). Remove it from the list below `
          + `and re-select the file from disk, then try again. (browser said: ${e.message})`,
        );
        err.staleFile = true;
        throw err;
      }
    }
    if (item.source === 'url')  return fetchPdfBuffer(resolveFetchUrl(item.url));
    return fetchDriveFileBytes(item.id, driveToken);
  }

  // Retrying in place after a staleFile error would just hit the same dead
  // handle again — deselect it (same signal as the success path) so nothing
  // reprocesses it silently, and mark it so the file list can tell the admin
  // to remove and re-add rather than leaving them to guess why Process keeps
  // no-op'ing on this row.
  function markItemStale(it) {
    setItems((its) => its.map((x) => (x.source === it.source && x.name === it.name && x.id === it.id)
      ? { ...x, selected: false, staleFile: true } : x));
  }

  function handleCancel() {
    abortRef.current?.abort(new DOMException('Cancelled by operator', 'AbortError'));
  }

  /* ── Multi-file match & review (notes + approved manifest only) ──────
   *
   * Runs extraction ONCE per file (extractPagesWithVision, identical to what
   * handleProcess already does for a single file) and a cheap, deterministic
   * page-range detection — no second AI call, no model-guessed chapter
   * boundaries. Produces a SUGGESTION per file; nothing is written here.
   */
  async function handleMatchFiles() {
    const selected = items.filter((it) => it.selected);
    if (!selected.length || !approvedManifest) return;
    setMatchErr(''); setMatchPhase('matching');

    const rows = [];
    for (const it of selected) {
      try {
        // Duplicate check FIRST, from the filename alone — no bytes fetched,
        // no extractPagesWithVision call, no API spend — so a re-review of an
        // already-loaded chapter costs nothing by default. See
        // checkAlreadyLoaded's own header for why 'c' is the right prefix to
        // check against.
        const dup = await checkAlreadyLoaded(approvedManifest, it.name, classLevel, book || null, dbExamType, subject);
        if (dup.loadedKeys.length) {
          rows.push({
            item: it, alreadyLoaded: dup, needsLoadAnywayConfirm: true, loadingAnyway: false,
            pages: null, figures: null, equationsByPage: null, visionPageCount: 0, failedPages: [],
            detectedRange: null, suggestion: null, chosenOrdinal: null, confirmed: false, error: null,
          });
          continue;
        }

        const buf = await getBytes(it);
        const { pages, figures, equationsByPage, visionPageCount, failedPages } = await extractPagesWithVision(
          buf, { subject, examType: dbExamType, chapter: it.chapter || chapterHint }, { forceVision },
        );
        const rawText = pages.join('\n\n').trim();
        if (!rawText || rawText.length < 100) {
          rows.push({ item: it, error: 'No extractable text found in this file.' });
          continue;
        }
        const detectedRange = detectPrintedPageRange(pages);
        const suggestion = matchFileToManifest({ detectedRange, filename: it.name, entries: approvedManifest });
        rows.push({
          item: it, pages, figures, equationsByPage, visionPageCount, failedPages,
          detectedRange, suggestion, alreadyLoaded: null, needsLoadAnywayConfirm: false,
          // Pre-selected ONLY when the suggestion resolved to exactly one
          // candidate — 'multiple' and 'conflict' and 'none' all leave this
          // null, forcing an explicit pick. `confirmed` starts false even
          // when pre-selected: no confidence tier ever auto-confirms.
          chosenOrdinal: suggestion.suggested.length === 1 ? suggestion.suggested[0].ordinal : null,
          confirmed: false, error: null,
        });
      } catch (e) {
        if (e.staleFile) markItemStale(it);
        rows.push({ item: it, error: e.message });
      }
    }
    setMatchRows(rows);
    setMatchPhase('review');
  }

  /* Explicit override for a row checkAlreadyLoaded flagged — runs the SAME
   * extraction + detection handleMatchFiles skipped for this row, now that
   * the admin has deliberately chosen to re-process it. */
  async function loadAnywayForRow(i) {
    const row = matchRows[i];
    if (!row) return;
    const it = row.item;
    setMatchRows((rs) => rs.map((r, n) => n === i ? { ...r, loadingAnyway: true } : r));
    try {
      const buf = await getBytes(it);
      const { pages, figures, equationsByPage, visionPageCount, failedPages } = await extractPagesWithVision(
        buf, { subject, examType: dbExamType, chapter: it.chapter || chapterHint }, { forceVision },
      );
      const rawText = pages.join('\n\n').trim();
      if (!rawText || rawText.length < 100) {
        setMatchRows((rs) => rs.map((r, n) => n === i
          ? { ...r, error: 'No extractable text found in this file.', needsLoadAnywayConfirm: false, loadingAnyway: false }
          : r));
        return;
      }
      const detectedRange = detectPrintedPageRange(pages);
      const suggestion = matchFileToManifest({ detectedRange, filename: it.name, entries: approvedManifest });
      setMatchRows((rs) => rs.map((r, n) => n === i ? {
        ...r, pages, figures, equationsByPage, visionPageCount, failedPages, detectedRange, suggestion,
        chosenOrdinal: suggestion.suggested.length === 1 ? suggestion.suggested[0].ordinal : null,
        confirmed: false, error: null, needsLoadAnywayConfirm: false, loadingAnyway: false,
      } : r));
    } catch (e) {
      if (e.staleFile) markItemStale(it);
      setMatchRows((rs) => rs.map((r, n) => n === i
        ? { ...r, error: e.message, needsLoadAnywayConfirm: false, loadingAnyway: false }
        : r));
    }
  }

  function chooseOrdinalForRow(i, ordinal) {
    setMatchRows((rs) => rs.map((r, n) => n === i ? { ...r, chosenOrdinal: ordinal, confirmed: false } : r));
  }
  function confirmRow(i) {
    setMatchRows((rs) => rs.map((r, n) => n === i && r.chosenOrdinal != null ? { ...r, confirmed: true } : r));
  }
  function unconfirmRow(i) {
    setMatchRows((rs) => rs.map((r, n) => n === i ? { ...r, confirmed: false } : r));
  }
  // Convenience only — confirms whatever is CURRENTLY selected per row. A row
  // with no selection (ambiguous/conflict/none) has nothing to confirm and
  // stays exactly as unconfirmed as it was; there is no selection this could
  // silently invent.
  function confirmAllRows() {
    setMatchRows((rs) => rs.map((r) => r.chosenOrdinal != null && !r.error ? { ...r, confirmed: true } : r));
  }
  function cancelMatchReview() {
    setMatchPhase('idle'); setMatchRows([]); setMatchErr('');
  }

  /* Processes only CONFIRMED rows. Reuses the `pages` already extracted
   * during matching — no second extraction, no second AI-cost pass. Rows
   * left unconfirmed simply aren't touched and stay in the review list for a
   * later round; this is the one save path for the whole feature — same
   * saveNoteChunks call handleProcess's notes branch already makes. */
  async function handleProcessConfirmed() {
    const toRun = matchRows.filter((r) => r.confirmed && r.chosenOrdinal != null);
    if (!toRun.length) return;
    setStep('results');
    setBatchRunning(true);
    setBatchErr('');
    setBatchResults(toRun.map((r) => ({ name: r.item.name, status: 'pending', message: 'Waiting…' })));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    for (let i = 0; i < toRun.length; i++) {
      const row = toRun[i];
      const it = row.item;
      const setStepMsg = (patch) => setBatchResults((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

      if (ctrl.signal.aborted) { setStepMsg({ status: 'cancelled', message: 'Cancelled before it started' }); continue; }
      setStepMsg({ status: 'processing', message: 'Structuring…' });

      try {
        const entry = approvedManifest.find((e) => e.ordinal === row.chosenOrdinal);
        const covered = [entry];

        // Same traceability as the reactive picker — which file went to
        // which entry, by whom, and whether the match screen suggested it or
        // the admin overrode it, independent of confidence tier.
        logChange(ENTITY.CONTENT_ITEM, it.name, ACTION.UPDATE, {
          before: { detectedRange: row.detectedRange, confidence: row.suggestion?.confidence ?? null },
          after:  { chosenOrdinal: entry.ordinal, chosenTitle: entry.title },
        }, `Multi-file review: "${it.name}" confirmed for "${entry.title}" (chapter ${entry.ordinal}), `
          + `match confidence was "${row.suggestion?.confidence ?? 'n/a'}".`);

        const { unit, lessons, warnings: structureWarnings } = await extractNotesByManifest({
          pages: row.pages, entries: covered, examType: dbExamType, subject,
          onProgress: (msg) => setStepMsg({ message: msg }),
          fileStructure: manifestRow?.file_structure ?? 'combined',
        });
        setStepMsg({ message: `Saving ${lessons.length} chapter(s)…` });
        const { kbCount, chapterName, lessonCount, flagged } = await saveNoteChunks({
          unit, lessons, examType: dbExamType, subject, chapter: it.chapter || chapterHint,
          source: `${it.source}:${it.name}`, callerUid, syllabusChapters: syllabusChapterNames,
          figures: row.figures, equationsByPage: row.equationsByPage,
          manifestRow, filename: it.name, book: book || null, classLevel,
        });
        const structureNote = structureWarnings?.length ? ` · ⚠ ${structureWarnings.join('; ')}` : '';
        const failNote = row.failedPages?.length
          ? ` · ${row.failedPages.length} page(s) FAILED to read`
          : '';
        setStepMsg({
          status: row.failedPages?.length ? 'partial' : 'done',
          message: `${kbCount} chunks saved across ${lessonCount} lesson${lessonCount !== 1 ? 's' : ''}${unit ? ` (${unit})` : ''} · "${chapterName}"`
            + (row.visionPageCount ? ` · ${row.visionPageCount} page(s) read by vision` : '')
            + (flagged ? ' · chapter accepted with 2 of 3 signals' : '')
            + failNote + structureNote,
        });
      } catch (e) {
        if (e?.name === 'AbortError' || ctrl.signal.aborted) {
          setStepMsg({ status: 'cancelled', message: 'Cancelled — nothing was saved for this file' });
        } else {
          if (e.staleFile) markItemStale(it);
          setStepMsg({ status: 'error', message: e.message });
        }
      }
    }

    abortRef.current = null;
    setBatchRunning(false);
    // Drop only the rows that actually ran — anything left unconfirmed stays
    // available if the admin wants to come back to it in this same session.
    setMatchRows((rs) => rs.filter((r) => !(r.confirmed && r.chosenOrdinal != null)));
    if (!matchRows.some((r) => !(r.confirmed && r.chosenOrdinal != null))) setMatchPhase('idle');
  }

  async function handleProcess() {
    const selected = items.filter((it) => it.selected);
    if (!selected.length) return;
    setStep('results');
    setBatchRunning(true);
    setBatchErr('');
    setBatchResults(selected.map((it) => ({ name: it.name, status: 'pending', message: 'Waiting…' })));

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    for (let i = 0; i < selected.length; i++) {
      const it = selected[i];
      const setStepMsg = (patch) => setBatchResults((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));

      // Cancelling mid-batch stops the queue too, not just the current file.
      if (ctrl.signal.aborted) {
        setStepMsg({ status: 'cancelled', message: 'Cancelled before it started' });
        continue;
      }

      setStepMsg({ status: 'processing', message: 'Fetching…' });
      try {
        // Duplicate check first — filename-only, no bytes fetched yet, no API
        // call. Notes only: PYQ uploads have no manifest chapter_key to check
        // against. See checkAlreadyLoaded's header for the key-prefix note.
        if (contentType === 'notes' && approvedManifest) {
          const dup = await checkAlreadyLoaded(approvedManifest, it.name, classLevel, book || null, dbExamType, subject);
          if (dup.loadedKeys.length > 0) {
            const loadAnyway = await promptDuplicateLoad(it.name, dup);
            if (!loadAnyway) {
              setStepMsg({
                status: 'skipped',
                message: `Already loaded — ${dup.titles.join(', ') || 'this chapter'} has ${dup.loadedKeys.length} of ${dup.keys.length} chapter key(s) in knowledge_base. Skipped, no API call made.`,
              });
              continue;
            }
          }
        }

        const buf = await getBytes(it);
        setStepMsg({ message: 'Extracting text…' });

        // Text layer first; vision only repairs the pages that need it (or
        // every page when the admin forces it for a scan the gate missed).
        // Before this, a scanned PDF died on the length check below.
        const {
          pages, figures, equationsByPage, visionPageCount, skippedVisionPages, failedPages,
        } = await extractPagesWithVision(
          buf,
          { subject, examType: dbExamType, chapter: it.chapter || chapterHint },
          { forceVision, onProgress: (msg) => setStepMsg({ message: msg }), signal: ctrl.signal },
        );

        if (skippedVisionPages > 0) {
          setStepMsg({ message: `${skippedVisionPages} page(s) over the ${MAX_VISION_PAGES}-page vision limit were left as-is — split the file to cover them.` });
        }

        // Pages that were attempted and failed keep their original (thin) text
        // layer, so the upload can still succeed — but the operator has to be
        // told which pages are degraded and why, or a partially-read document
        // is indistinguishable from a clean one.
        const failNote = failedPages?.length
          ? ` · ${failedPages.length} page(s) FAILED to read (${failedPages.slice(0, 3).map((f) => `p${f.pageNo}: ${f.reason}`).join('; ')}${failedPages.length > 3 ? `; +${failedPages.length - 3} more` : ''})`
          : '';

        const rawText = pages.join('\n\n').trim();
        if (!rawText || rawText.length < 100) {
          throw new Error(
            visionPageCount > 0
              ? 'Vision ran but returned no readable text — the pages may be blank or too low-resolution.'
              : 'No extractable text, and no page was thin enough to trigger vision. Tick "Force vision" if this is a scan.',
          );
        }

        if (contentType === 'pyq') {
          const { questions } = await runPYQExtraction({
            rawText, examType: dbExamType, subject, year, syllabusChapters: syllabusChapterNames,
            onProgress: (msg) => setStepMsg({ message: msg }),
          });
          setStepMsg({ message: `Saving ${questions.length} questions…` });
          const rows = await savePYQRows({
            questions, examType: dbExamType, subject, year, source: `${it.source}:${it.name}`, isMixed, syllabusChapters,
          });
          // Figures found on a question paper are recorded per page rather than
          // bound to a specific question — the extractor returns questions, not
          // page positions, so there's nothing reliable to bind them to yet.
          if (figures.length) {
            const { error: figErr } = await supabase.from('content_figures').insert(
              buildFigureRows(figures, {
                sourceTable: 'pyq_questions',
                examType: dbExamType, subject, chapter: it.chapter || chapterHint,
              }),
            );
            if (figErr) console.warn('[intake] content_figures insert failed:', figErr.message);
          }
          // An adjusted mark means the stored data differs from the paper, so
          // the file is flagged for a human even though every row saved.
          const adjusted  = rows.marksAdjusted ?? [];
          const marksNote = adjusted.length
            ? ` · ${adjusted.length} marks value(s) ADJUSTED (${adjusted.slice(0, 3).join('; ')}${adjusted.length > 3 ? `; +${adjusted.length - 3} more` : ''})`
            : '';
          // Phase 2 PYQ slice: questions rejected for no confident chapter
          // match — saved alongside the successes, never silent.
          const rejectedQs  = rows.rejected ?? [];
          const rejectNote  = rejectedQs.length
            ? ` · ${rejectedQs.length} question(s) REJECTED — no chapter match (${rejectedQs.slice(0, 3).join('; ')}${rejectedQs.length > 3 ? `; +${rejectedQs.length - 3} more` : ''})`
            : '';

          setStepMsg({
            status: (failedPages?.length || adjusted.length || rejectedQs.length) ? 'partial' : 'done',
            savedRows: rows,
            message: `${rows.length} of ${questions.length} questions saved`
              + (visionPageCount ? ` · ${visionPageCount} page(s) read by vision` : '')
              + (figures.length ? ` · ${figures.length} figure(s)` : '')
              + rejectNote
              + failNote
              + marksNote,
          });
        } else {
          // Each page is prefixed with a [[PAGE N]] marker so the AI can point back
          // at exactly where a lesson's content lives — that marker range is then
          // used to slice the ORIGINAL `pages` array for a verbatim source_text,
          // instead of trusting the AI to reproduce the passage itself (it paraphrases
          // even when told not to). Needed for literature/language subjects, where
          // extract-based comprehension questions must quote the real textbook text.
          // Which approved manifest entries does THIS file cover? Resolved from
          // the filename's ordinal against the manifest's File # values.
          //
          // There USED TO be no operator-pick fallback here — an earlier version
          // referenced a nonexistent `adminSelectedOrdinal` and threw a
          // ReferenceError on the first real upload, so it was removed rather
          // than back-filled with invented state. The real feature (a picker,
          // never free text — see chapterIdentity.js's own note on why) now
          // exists: on a failed auto-match, the admin is shown the manifest's
          // full entry list and picks explicitly, or cancels and nothing is
          // uploaded. Same fail-closed guarantee, with a supervised path around
          // the dead end instead of just the dead end.
          const fileOrdinal = fileOrdinalFrom(it.name);
          let covered = candidatesForFile(approvedManifest, fileOrdinal, null);
          if (!covered.length) {
            // Fail closed. Guessing which chapters a file holds is precisely
            // the guess that produced "Poorvi" — so this never guesses. It asks.
            const reason = fileOrdinal == null
              ? 'no chapter number could be read from its filename'
              : `file ordinal ${fileOrdinal} (parsed from the filename) does not match any manifest entry`;
            const numberedEntries = approvedManifest.filter((e) => e.numbered !== false && e.isUnit !== true);
            const picked = await promptForManifestEntry(it.name, reason, numberedEntries);

            if (!picked) {
              // Cancel — unchanged fail-closed behaviour, nothing written.
              throw new Error(
                `"${it.name}" matches no entry in the approved manifest`
                + (fileOrdinal == null
                  ? ' and no chapter number could be read from its filename. Set this file\'s chapter explicitly, or give the manifest entries a File # that matches.'
                  : ` (file ordinal ${fileOrdinal}). Set File # on the manifest entries this file contains.`),
              );
            }

            // A decisive human pick, not a guess — narrows to exactly the
            // chosen entry, same as extractNotesByManifest expects from
            // candidatesForFile's own `own` match.
            covered = [picked];

            // Traceable now: which file went to which entry, by whom, when.
            // This is also what closes the "book field untraceable" gap —
            // the override itself is the record, independent of any UI form
            // state that was or wasn't filled in at upload time.
            logChange(ENTITY.CONTENT_ITEM, it.name, ACTION.UPDATE, {
              before: { autoMatched: false, parsedFileOrdinal: fileOrdinal, reason },
              after:  { chosenOrdinal: picked.ordinal, chosenTitle: picked.title, chosenFileOrdinal: picked.fileOrdinal ?? null },
            }, `Admin override at upload: "${it.name}" could not be auto-matched (${reason}) — manually assigned to "${picked.title}" (chapter ${picked.ordinal}).`);
          }

          // Manifest-driven split: N covered entries produce exactly N chapters.
          // The model never decides a chapter boundary — see
          // extractNotesByManifest's header for the failure this replaces.
          const { unit, lessons, warnings: structureWarnings } = await extractNotesByManifest({
            pages, entries: covered, examType: dbExamType, subject,
            onProgress: (msg) => setStepMsg({ message: msg }),
            fileStructure: manifestRow?.file_structure ?? 'combined',
          });
          setStepMsg({ message: `Saving ${lessons.length} chapter(s)…` });
          const { kbCount, chapterName, lessonCount, flagged } = await saveNoteChunks({
            unit, lessons, examType: dbExamType, subject, chapter: it.chapter || chapterHint,
            source: `${it.source}:${it.name}`, callerUid, syllabusChapters: syllabusChapterNames,
            figures, equationsByPage,
            manifestRow, filename: it.name, book: book || null, classLevel,
          });
          // Non-blocking page-count sanity flag from extractNotesByManifest
          // (per_chapter books only) — a chapter was written, this is a
          // "worth a glance" note, not a failure.
          const structureNote = structureWarnings?.length ? ` · ⚠ ${structureWarnings.join('; ')}` : '';
          setStepMsg({
            status: failedPages?.length ? 'partial' : 'done',
            message: `${kbCount} chunks saved across ${lessonCount} lesson${lessonCount !== 1 ? 's' : ''}${unit ? ` (${unit})` : ''} · "${chapterName}"`
              + (visionPageCount ? ` · ${visionPageCount} page(s) read by vision` : '')
              + (figures.length ? ` · ${figures.length} figure(s)` : '')
              // flagged: the chapter was written but the printed-page-header
              // signal wasn't read in this slice (see chapterIdentity.js
              // assignChapters' own note) — expected, not a defect, surfaced
              // so an admin knows the corroboration was partial, not absent.
              + (flagged ? ' · chapter accepted with 2 of 3 signals (no printed-header check yet)' : '')
              + failNote
              + structureNote,
          });
        }
        // Deselect on success so a stray re-click of Process can't duplicate-save.
        setItems((its) => its.map((x) => (x.source === it.source && x.name === it.name && x.id === it.id) ? { ...x, selected: false } : x));
      } catch (e) {
        // A cancel is an operator decision, not a failure — it must not be
        // filed under "3 files failed" alongside real errors.
        if (e?.name === 'AbortError' || ctrl.signal.aborted) {
          setStepMsg({ status: 'cancelled', message: 'Cancelled — nothing was saved for this file' });
        } else {
          if (e.staleFile) markItemStale(it);
          setStepMsg({ status: 'error', message: e.message });
        }
      }
    }

    abortRef.current = null;
    setBatchRunning(false);
  }

  // 'partial' saved its rows too — it just could not read every page — so it
  // counts as done for "did anything land?" purposes while still being called
  // out separately in the summary.
  const doneCount      = batchResults.filter((r) => r.status === 'done' || r.status === 'partial').length;
  const savedCount     = batchResults.filter((r) => r.status === 'done').length;
  const partialCount   = batchResults.filter((r) => r.status === 'partial').length;
  const errorCount     = batchResults.filter((r) => r.status === 'error').length;
  const cancelledCount = batchResults.filter((r) => r.status === 'cancelled').length;
  const skippedCount   = batchResults.filter((r) => r.status === 'skipped').length;
  const allSavedRows   = batchResults.flatMap((r) => r.savedRows ?? []);
  const canProceedInput = items.some((it) => it.selected);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0">
          <Inbox size={18} className="text-white" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Content Intake</h1>
          <p className="text-sm text-slate-400">Upload PYQs or study material from a file, a URL, or a whole Drive folder — AI reads, tags, and saves it.</p>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <StepDots steps={WIZARD_STEPS} current={step} />
      </div>

      {/* ── Step 1: content type ─────────────────────────────────── */}
      {step === 'type' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { id: 'pyq', icon: <ClipboardList size={22} className="text-violet-400" />, title: 'Question Paper / PYQ', desc: 'AI extracts each question with marks, section, type, and answer key. Diagram questions get flagged for a follow-up image upload.', ring: 'border-violet-500 bg-violet-900/20' },
            { id: 'notes', icon: <BookOpen size={22} className="text-emerald-400" />, title: 'Study Notes', desc: 'Textbook chapters, teacher notes, or reference material. AI chunks it for the AI tutor\'s knowledge base and saves a curated note others can browse — this also feeds Content Map.', ring: 'border-emerald-500 bg-emerald-900/20' },
          ].map(({ id, icon, title, desc, ring }) => (
            <button key={id} onClick={() => { setContentType(id); setStep('classify'); }}
              className={`text-left p-5 rounded-2xl border-2 transition-all space-y-3 ${contentType === id ? ring : 'bg-slate-900/60 border-white/8 hover:border-white/20'}`}>
              <div className="flex items-center gap-3">{icon}<p className="font-bold text-white text-sm">{title}</p></div>
              <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
            </button>
          ))}
        </motion.div>
      )}

      {/* ── Step 2: classify ─────────────────────────────────────── */}
      {step === 'classify' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="bg-slate-900/60 border border-white/8 rounded-2xl p-5 space-y-5">
            <p className="text-sm font-bold text-slate-200">{contentType === 'pyq' ? 'Which exam is this question paper for?' : 'Which subject is this material for?'}</p>

            <div className="space-y-3">
              {getExamGroups().map((g) => (
                <div key={g.label}>
                  <p className="text-[10px] text-slate-500 font-bold uppercase mb-1.5">{g.label}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((e) => <Chip key={e} label={e} active={examBase === e} onClick={() => changeExamBase(e)} />)}
                  </div>
                </div>
              ))}
              {isBoard && (
                <div className={`rounded-xl px-3 py-2.5 space-y-1.5 border ${classLevel ? 'bg-slate-800/60 border-white/5' : 'bg-amber-900/20 border-amber-600/40'}`}>
                  <p className="text-[10px] font-bold uppercase text-slate-500">
                    Class {!classLevel && <span className="text-amber-400">· required</span>}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {CLASS_LEVELS.map((cl) => <Chip key={cl} label={`Class ${cl}`} active={classLevel === cl} onClick={() => changeClassLevel(cl)} />)}
                  </div>
                  {classLevel ? (
                    <p className="text-[10px] text-primary-400">Will be saved as <span className="font-bold">{dbExamType}</span></p>
                  ) : (
                    <p className="text-[10px] text-amber-300">Pick the class this material belongs to — nothing is assumed.</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Subject</label>
              <div className="flex flex-wrap gap-1.5">
                {subjects.map((s) => <Chip key={s} label={s} active={subject === s} onClick={() => setSubject(s)} />)}
              </div>
            </div>

            <div className="flex gap-3">
              {contentType === 'pyq' && (
                <div className="flex-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Year (optional)</label>
                  <input type="number" placeholder="e.g. 2023" value={year} onChange={(e) => setYear(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              )}
              <div className="flex-1">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Chapter hint (optional)</label>
                <input type="text" placeholder="AI detects this automatically — only needed as a fallback" value={chapterHint} onChange={(e) => setChapterHint(e.target.value)}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
              {contentType === 'notes' && (
                <div className="flex-1">
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Book (only if this subject has more than one)</label>
                  <input type="text" placeholder="e.g. Hornbill — leave blank for single-book subjects" value={book} onChange={(e) => setBook(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
              )}
            </div>

            {/* Three states, not two. "Draft exists but nobody approved it" and
                "no manifest at all" have different fixes, and both now BLOCK the
                upload rather than silently downgrading it. */}
            {contentType === 'notes' && subject && (
              approvedManifest
                ? (
                  <div className="flex items-start gap-2 bg-emerald-900/20 border border-emerald-700/20 rounded-xl p-3">
                    <CheckCircle2 size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-emerald-300">
                      Approved chapter manifest found ({approvedManifest.length} chapter{approvedManifest.length !== 1 ? 's' : ''}) —
                      the manifest decides the chapter split; the AI only structures content inside each chapter.
                    </p>
                  </div>
                ) : manifestRow ? (
                  <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/20 rounded-xl p-3">
                    <AlertTriangle size={13} className="text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-amber-300">
                      A chapter manifest exists for this book but is <b>{manifestRow.status}</b>, not approved.
                      Notes uploads are blocked until an admin reviews and approves it in
                      Content&nbsp;→&nbsp;Chapter Manifests.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/25 rounded-xl p-3">
                    <AlertTriangle size={13} className="text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-300">
                      <b>No chapter manifest for this book — notes uploads are blocked.</b> Create and approve
                      one in Content&nbsp;→&nbsp;Chapter Manifests first. Uploading without one is what
                      previously produced a chapter named after the book's running header and merged two
                      texts into one.
                    </p>
                  </div>
                )
            )}

            {isMixed && contentType === 'pyq' && (
              <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/20 rounded-xl p-3">
                <Info size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-300">AI will identify the subject (Physics/Chemistry/Biology) for each question individually — works best for full NEET papers.</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button onClick={goBack} className="px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-semibold flex items-center gap-1.5 transition-colors">
              <ChevronLeft size={14} /> Back
            </button>
            {/* A board exam type is meaningless without a class — blocking here
                is what stops an untouched default becoming the stored answer. */}
            <button onClick={() => setStep('input')} disabled={!subject || (isBoard && !classLevel)}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-bold transition-colors">
              Continue
            </button>
          </div>
        </motion.div>
      )}

      {/* ── Step 3: input method ─────────────────────────────────── */}
      {step === 'input' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="bg-slate-900/60 border border-white/8 rounded-2xl p-5 space-y-4">
            <div className="flex gap-1 p-1 bg-slate-800 rounded-xl w-fit">
              {[
                { key: 'file',   icon: Upload,       label: 'Upload File(s)'   },
                { key: 'url',    icon: Link2,        label: 'URL / Drive Link' },
                { key: 'folder', icon: FolderSearch, label: 'Drive Folder'     },
              ].map(({ key, icon: Icon, label }) => (
                <button key={key} onClick={() => setInputTab(key)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${inputTab === key ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            {inputTab === 'file' && (
              <div
                onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-primary-500 hover:bg-slate-900/40 rounded-2xl p-8 text-center cursor-pointer transition-colors"
              >
                <Upload size={22} className="mx-auto text-slate-500 mb-2" />
                <p className="text-sm font-medium text-slate-300">Drop PDFs here or click to select — multiple allowed</p>
                <input ref={fileInputRef} type="file" multiple accept=".pdf" className="hidden" onChange={(e) => e.target.files.length && addFiles(e.target.files)} />
              </div>
            )}

            {inputTab === 'url' && (
              <div className="flex gap-2">
                <input type="url" placeholder="https://drive.google.com/file/d/…  or any PDF URL" value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addUrlItem()}
                  className="flex-1 bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                <button onClick={addUrlItem} disabled={!urlInput.trim()} className="shrink-0 px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-semibold transition-colors">Add Link</button>
              </div>
            )}

            {inputTab === 'folder' && (
              <div className="space-y-3">
                <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-700/20 rounded-xl p-3">
                  <Info size={13} className="text-blue-400 mt-0.5 shrink-0" />
                  <p className="text-xs text-blue-300 leading-relaxed">
                    Point this at <strong>one subject's folder</strong> — every file found uses the exam/subject/class picked in the previous step. Scanning prompts a Google sign-in for read-only Drive access, and works for any folder your account can already see, including ones shared just with you.
                  </p>
                </div>
                <div className="flex gap-2">
                  <input type="url" placeholder="https://drive.google.com/drive/folders/…" value={folderUrl} onChange={(e) => setFolderUrl(e.target.value)}
                    className="flex-1 bg-slate-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                  <button onClick={handleScanFolder} disabled={scanningFolder || !folderUrl.trim()} className="shrink-0 px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition-colors">
                    {scanningFolder ? <Loader2 size={14} className="animate-spin" /> : <FolderSearch size={14} />} {scanningFolder ? 'Scanning…' : 'Scan Folder'}
                  </button>
                </div>
                {folderErr && <p className="text-xs text-red-300 bg-red-900/20 border border-red-700/20 rounded-xl px-3 py-2">{folderErr}</p>}
              </div>
            )}
          </div>

          {matchPhase !== 'review' && items.length > 0 && (
            <div className="bg-slate-900/60 border border-white/8 rounded-2xl p-5 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{items.filter((i) => i.selected).length} file(s) queued</p>
              <div className="border border-white/5 rounded-xl divide-y divide-white/5 max-h-72 overflow-y-auto">
                {items.map((it, i) => (
                  <div key={`${it.source}-${it.name}-${i}`} className="flex items-center gap-3 px-3 py-2.5">
                    <button onClick={() => toggleItem(i)} className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 ${it.selected ? 'bg-primary-600 border-primary-600' : 'border-white/20'}`}>
                      {it.selected && <Check size={12} className="text-white" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <input value={it.chapter} onChange={(e) => updateItemChapter(i, e.target.value)}
                        className="w-full text-sm font-medium text-slate-200 bg-transparent border-b border-transparent hover:border-white/10 focus:border-primary-500 focus:outline-none" />
                      <p className="text-[10px] text-slate-500 truncate">{it.path ? `${it.path} · ` : ''}{it.name}</p>
                      {it.staleFile && (
                        <p className="text-[10px] text-amber-400 mt-0.5">Expired — remove and re-select this file from disk before retrying.</p>
                      )}
                    </div>
                    <button onClick={() => removeItem(i)} className="p-1 rounded-lg text-slate-600 hover:text-red-400 shrink-0"><X size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {matchPhase !== 'review' && (
          <>
          {/* Restates the destination immediately above Process. The exam type
              is chosen two steps earlier and persists across uploads, so
              without this the only place it appears is a screen the admin has
              already left — which is how a batch of Class 8 chapters was filed
              under Class 10. */}
          <div className="flex items-center gap-2 p-3 rounded-xl bg-primary-900/20 border border-primary-600/30">
            <Info size={14} className="text-primary-400 shrink-0" />
            <p className="text-xs text-slate-300">
              Saving as <span className="font-bold text-primary-300">{dbExamType}</span>
              {subject ? <> · <span className="font-bold text-primary-300">{subject}</span></> : null}
              {' '}—{' '}
              <button onClick={() => setStep('classify')} className="underline hover:text-white transition-colors">change</button>
            </p>
          </div>

          {/* Vision is normally automatic — this only exists for scans the
              80-character gate can't see, e.g. a page carrying a thin layer of
              garbage OCR from whoever scanned it first. */}
          <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-900/60 border border-white/8 cursor-pointer">
            <input
              type="checkbox"
              checked={forceVision}
              onChange={(e) => setForceVision(e.target.checked)}
              className="mt-0.5 accent-primary-500"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-200">Force vision on every page</span>
              <span className="block text-[11px] text-slate-500 leading-relaxed">
                Only for scanned PDFs that still slip through — pages are read as images with an AI
                call each, capped at {MAX_VISION_PAGES} per file. Leave off for normal PDFs.
              </span>
            </span>
          </label>

          {matchErr && <p className="text-sm text-red-300 bg-red-900/20 border border-red-700/20 rounded-xl px-4 py-3">{matchErr}</p>}

          <div className="flex gap-3">
            <button onClick={goBack} className="px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-semibold flex items-center gap-1.5 transition-colors">
              <ChevronLeft size={14} /> Back
            </button>
            {contentType === 'notes' && approvedManifest ? (
              <button onClick={handleMatchFiles} disabled={!canProceedInput || matchPhase === 'matching'}
                className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                {matchPhase === 'matching' ? <Loader2 size={15} className="animate-spin" /> : <Network size={15} />}
                {matchPhase === 'matching' ? 'Matching…' : `Match ${items.filter((i) => i.selected).length || ''} File${items.filter((i) => i.selected).length === 1 ? '' : 's'} to Chapters`}
              </button>
            ) : (
              <button onClick={handleProcess} disabled={!canProceedInput}
                className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors">
                <Inbox size={15} /> Process {items.filter((i) => i.selected).length || ''} File{items.filter((i) => i.selected).length === 1 ? '' : 's'}
              </button>
            )}
          </div>
          </>
          )}

          {/* ── Match & review screen — notes + approved manifest only.
              Nothing above this line has saved anything; nothing below saves
              anything either until a row is explicitly confirmed. ── */}
          {matchPhase === 'review' && (
            <MatchReviewScreen
              rows={matchRows}
              manifestEntries={approvedManifest ?? []}
              onChoose={chooseOrdinalForRow}
              onConfirm={confirmRow}
              onUnconfirm={unconfirmRow}
              onConfirmAll={confirmAllRows}
              onCancel={cancelMatchReview}
              onProcess={handleProcessConfirmed}
              onLoadAnyway={loadAnywayForRow}
            />
          )}
        </motion.div>
      )}

      {/* ── Step 4: process + results ────────────────────────────── */}
      {step === 'results' && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
          <div className="bg-slate-900/60 border border-white/8 rounded-2xl divide-y divide-white/5 overflow-hidden">
            {batchResults.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                {r.status === 'pending' && <Circle size={14} className="text-slate-600 shrink-0" />}
                {r.status === 'processing' && <Loader2 size={14} className="animate-spin text-primary-400 shrink-0" />}
                {r.status === 'done' && <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />}
                {r.status === 'partial' && <AlertTriangle size={14} className="text-amber-400 shrink-0" />}
                {r.status === 'cancelled' && <MinusCircle size={14} className="text-slate-500 shrink-0" />}
                {r.status === 'skipped' && <MinusCircle size={14} className="text-amber-500 shrink-0" />}
                {r.status === 'error' && <AlertTriangle size={14} className="text-red-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{r.name}</p>
                  {/* Not truncated for partial/error/skipped: the whole point
                      of the note is the reason text at the end of it. */}
                  <p className={[
                    'text-xs mt-0.5',
                    r.status === 'error' ? 'text-red-400' : r.status === 'partial' ? 'text-amber-300' : r.status === 'skipped' ? 'text-amber-400/90' : 'text-slate-500',
                    (r.status === 'partial' || r.status === 'error' || r.status === 'skipped') ? 'break-words' : 'truncate',
                  ].join(' ')}>{r.message}</p>
                </div>
              </div>
            ))}
          </div>

          {batchRunning && (
            <div className="flex items-center gap-3 rounded-xl px-4 py-3 bg-slate-900/60 border border-white/8">
              <p className="flex-1 text-xs text-slate-400 leading-relaxed">
                Each page is given {Math.round(AI_REQUEST_TIMEOUT_MS / 1000)}s and retried twice before it is marked failed — a stuck
                page no longer blocks the rest of the document. Cancel stops after the current page; nothing is saved for a cancelled file.
              </p>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-900/30 hover:bg-red-900/50 border border-red-700/30 text-red-300 text-xs font-bold transition-colors shrink-0"
              >
                <Ban size={13} /> Cancel
              </button>
            </div>
          )}

          {!batchRunning && batchResults.length > 0 && (
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${errorCount > 0 || partialCount > 0 ? 'bg-amber-900/20 border border-amber-700/20 text-amber-300' : cancelledCount > 0 || skippedCount > 0 ? 'bg-slate-800/60 border border-white/10 text-slate-300' : 'bg-emerald-900/20 border border-emerald-700/20 text-emerald-300'}`}>
              {errorCount > 0 || partialCount > 0 ? <AlertTriangle size={16} className="shrink-0" /> : cancelledCount > 0 || skippedCount > 0 ? <MinusCircle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
              {[
                savedCount > 0 && `${savedCount} saved`,
                partialCount > 0 && `${partialCount} saved with unread pages`,
                errorCount > 0 && `${errorCount} failed`,
                cancelledCount > 0 && `${cancelledCount} cancelled`,
                skippedCount > 0 && `${skippedCount} skipped (already loaded)`,
              ].filter(Boolean).join(' · ') || 'Nothing processed.'}
            </div>
          )}

          {batchErr && <p className="text-sm text-red-300 bg-red-900/20 border border-red-700/20 rounded-xl px-4 py-3">{batchErr}</p>}

          {!batchRunning && contentType === 'pyq' && allSavedRows.length > 0 && (
            <DiagramEnrichPanel savedRows={allSavedRows} />
          )}

          {!batchRunning && batchResults.length > 0 && (
            <div className="flex flex-col sm:flex-row gap-3">
              {doneCount > 0 && (
                <button onClick={() => navigate('/admin/content?tab=map')}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border border-primary-700/40 bg-primary-900/20 hover:bg-primary-900/40 text-primary-300 text-sm font-bold transition-colors">
                  <Network size={15} /> View in Content Map <ArrowRight size={13} />
                </button>
              )}
              <button onClick={() => {
                setStep('type'); setContentType(''); setItems([]); setBatchResults([]);
                setMatchPhase('idle'); setMatchRows([]); setMatchErr('');
              }}
                className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold transition-colors">
                Start New Upload
              </button>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {manifestPrompt && (
          <ManifestEntryPicker
            prompt={manifestPrompt}
            onSelect={(entry) => resolveManifestPrompt(entry)}
            onCancel={() => resolveManifestPrompt(null)}
          />
        )}
        {dupPrompt && (
          <DuplicateLoadPrompt
            prompt={dupPrompt}
            onSkip={() => resolveDupPrompt(false)}
            onLoadAnyway={() => resolveDupPrompt(true)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
