import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, Link2, FileText, Loader2, CheckCircle2, AlertTriangle,
  X, Inbox, Info, BookOpen, ClipboardList, FolderSearch, Check, Circle,
  ChevronLeft, ImagePlus, ChevronDown, ChevronUp, Network, ArrowRight,
} from 'lucide-react';
import { chatComplete } from '../lib/aiProxy';
import { supabase, adminSaveKnowledgeChunks } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { getFeatureFlag, FLAGS } from '../lib/featureFlags';
import { fetchPdfBuffer } from '../lib/pdfAnalyzer';
import { extractPagesWithVision, MAX_VISION_PAGES } from '../lib/pdfVision';
import {
  runPYQExtraction, runNotesExtraction, buildKbRows, buildFigureRows, figuresForLesson,
} from '../lib/contentExtraction';
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
function matchSyllabusChapter(guess, chapterNames) {
  if (!guess || !chapterNames?.length) return guess;
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const g = norm(guess);
  const exact = chapterNames.find((c) => norm(c) === g);
  if (exact) return exact;
  const partial = chapterNames.find((c) => norm(c).includes(g) || g.includes(norm(c)));
  return partial || guess;
}

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

async function savePYQRows({ questions, examType, subject, year, source, isMixed, syllabusChapters }) {
  const reviewQueueOn = await getFeatureFlag(FLAGS.CONTENT_REVIEW_QUEUE);

  const rows = questions.map((q) => ({
    exam_type:      examType,
    subject:        isMixed ? (q.subject || 'Mixed') : subject,
    chapter:        matchSyllabusChapter(q.chapter, syllabusChapters) || null,
    question_text:  q.question_text,
    options:        q.options?.length ? q.options : null,
    correct_answer: q.correct_answer || null,
    explanation:    q.explanation || null,
    year:           year ? parseInt(year) : null,
    question_type:  q.type || 'MCQ',
    difficulty:     'Medium',
    marks:          q.marks ?? null,
    section:        q.section || null,
    has_diagram:    q.has_diagram ?? false,
    source,
    ...(reviewQueueOn && { status: 'in_review' }),
  }));

  const { data: saved, error } = await supabase
    .from('pyq_questions')
    .insert(rows)
    .select('id, question_text, has_diagram, section, marks, chapter');
  if (error) throw new Error(error.message);

  logChange(ENTITY.PYQ_QUESTION, 'bulk', ACTION.CREATE,
    { count: rows.length, examType, subject, source },
    `Content Intake: ${rows.length} PYQ questions from ${source}`);

  return saved ?? [];
}

// Saves to knowledge_base (AI doubt-tutor retrieval) AND upserts one study_notes
// row PER lesson/chapter (the curated notes library Content Map + the student-
// facing Study Notes screen both read from) — a single unit upload with 3

async function saveNoteChunks({
  unit, lessons, examType, subject, chapter, source, callerUid, syllabusChapters,
  figures = [], equationsByPage = {},
}) {
  const reviewQueueOn = await getFeatureFlag(FLAGS.CONTENT_REVIEW_QUEUE);

  let kbCount = 0;
  const chapterNames = [];

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i];
    const chunks = lesson.chunks ?? [];
    if (!chunks.length) continue;
    const chapterName = matchSyllabusChapter(lesson.title || chapter, syllabusChapters) || lesson.title || chapter || subject;
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
      const { error } = await supabase.from('pyq_questions').insert(rows);
      if (error) throw new Error(error.message);
      kbCount += rows.length;
    } else {
      const kbRows = buildKbRows({
        lesson, chapterName, unit, subject, examType, source, figures, equationsByPage,
      });

      const ids = await adminSaveKnowledgeChunks(kbRows);
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
      p_unit:         unit || null,
      p_page_start:   lesson.page_start ?? null,
      p_page_end:     lesson.page_end ?? null,
      p_sort_order:   i,
      p_source_text:  lesson.verbatimText || null,
    });
    if (noteErr) throw new Error(noteErr.message);
  }

  logChange(ENTITY.CONTENT_ITEM, 'bulk', ACTION.CREATE,
    { count: kbCount, examType, subject, source, unit, lessons: chapterNames },
    `Content Intake: ${kbCount} knowledge chunks across ${chapterNames.length} lesson(s)${unit ? ` in "${unit}"` : ''}`);

  return { kbCount, chapterName: chapterNames.join(', '), unit, lessonCount: chapterNames.length };
}

/* ── Diagram image enrichment (PYQ only) ─────────────────────────── */

async function uploadImageForPYQ(file, rowId) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `pyq-images/${Date.now()}-${rowId}.${ext}`;
  const { error: upErr } = await supabase.storage.from('question-papers').upload(path, file, { upsert: true });
  if (upErr) throw upErr;
  const { data } = supabase.storage.from('question-papers').getPublicUrl(path);
  const { error: updErr } = await supabase.from('pyq_questions').update({ image_url: data.publicUrl }).eq('id', rowId);
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

  const isBoard    = BOARDS.includes(examBase);
  const dbExamType = isBoard ? getDbExamType(examBase, classLevel) : examBase;
  const subjects   = getSubjectsForExam(dbExamType);
  const isMixed    = subject === 'Mixed';

  // Real syllabus chapters for this exam+subject — used to align AI-detected
  // chapter names so they register correctly in Content Map.
  const [syllabusChapters, setSyllabusChapters] = useState([]);
  useEffect(() => {
    if (!subject || step === 'type') { setSyllabusChapters([]); return; }
    let cancelled = false;
    getChapters(dbExamType, subject).then((chs) => { if (!cancelled) setSyllabusChapters(chs.map((c) => c.name)); });
    return () => { cancelled = true; };
  }, [dbExamType, subject, step]);

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

  async function getBytes(item) {
    if (item.source === 'file') return item.file.arrayBuffer();
    if (item.source === 'url')  return fetchPdfBuffer(resolveFetchUrl(item.url));
    return fetchDriveFileBytes(item.id, driveToken);
  }

  async function handleProcess() {
    const selected = items.filter((it) => it.selected);
    if (!selected.length) return;
    setStep('results');
    setBatchRunning(true);
    setBatchErr('');
    setBatchResults(selected.map((it) => ({ name: it.name, status: 'pending', message: 'Waiting…' })));

    for (let i = 0; i < selected.length; i++) {
      const it = selected[i];
      const setStepMsg = (patch) => setBatchResults((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
      setStepMsg({ status: 'processing', message: 'Fetching…' });
      try {
        const buf = await getBytes(it);
        setStepMsg({ message: 'Extracting text…' });

        // Text layer first; vision only repairs the pages that need it (or
        // every page when the admin forces it for a scan the gate missed).
        // Before this, a scanned PDF died on the length check below.
        const {
          pages, figures, equationsByPage, visionPageCount, skippedVisionPages,
        } = await extractPagesWithVision(
          buf,
          { subject, examType: dbExamType, chapter: it.chapter || chapterHint },
          { forceVision, onProgress: (msg) => setStepMsg({ message: msg }) },
        );

        if (skippedVisionPages > 0) {
          setStepMsg({ message: `${skippedVisionPages} page(s) over the ${MAX_VISION_PAGES}-page vision limit were left as-is — split the file to cover them.` });
        }

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
            rawText, examType: dbExamType, subject, year,
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
          setStepMsg({
            status: 'done',
            savedRows: rows,
            message: `${rows.length} questions saved`
              + (visionPageCount ? ` · ${visionPageCount} page(s) read by vision` : '')
              + (figures.length ? ` · ${figures.length} figure(s)` : ''),
          });
        } else {
          // Each page is prefixed with a [[PAGE N]] marker so the AI can point back
          // at exactly where a lesson's content lives — that marker range is then
          // used to slice the ORIGINAL `pages` array for a verbatim source_text,
          // instead of trusting the AI to reproduce the passage itself (it paraphrases
          // even when told not to). Needed for literature/language subjects, where
          // extract-based comprehension questions must quote the real textbook text.
          const markedText = pages.map((p, i) => `[[PAGE ${i + 1}]]\n${p}`).join('\n\n');
          const { unit, lessons } = await runNotesExtraction({
            rawText: markedText, pages, examType: dbExamType, subject,
            onProgress: (msg) => setStepMsg({ message: msg }),
          });
          setStepMsg({ message: `Saving ${lessons.length} lesson(s)…` });
          const { kbCount, chapterName, lessonCount } = await saveNoteChunks({
            unit, lessons, examType: dbExamType, subject, chapter: it.chapter || chapterHint,
            source: `${it.source}:${it.name}`, callerUid, syllabusChapters,
            figures, equationsByPage,
          });
          setStepMsg({
            status: 'done',
            message: `${kbCount} chunks saved across ${lessonCount} lesson${lessonCount !== 1 ? 's' : ''}${unit ? ` (${unit})` : ''} · "${chapterName}"`
              + (visionPageCount ? ` · ${visionPageCount} page(s) read by vision` : '')
              + (figures.length ? ` · ${figures.length} figure(s)` : ''),
          });
        }
        // Deselect on success so a stray re-click of Process can't duplicate-save.
        setItems((its) => its.map((x) => (x.source === it.source && x.name === it.name && x.id === it.id) ? { ...x, selected: false } : x));
      } catch (e) {
        setStepMsg({ status: 'error', message: e.message });
      }
    }
    setBatchRunning(false);
  }

  const doneCount    = batchResults.filter((r) => r.status === 'done').length;
  const errorCount   = batchResults.filter((r) => r.status === 'error').length;
  const allSavedRows = batchResults.flatMap((r) => r.savedRows ?? []);
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
            </div>

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

          {items.length > 0 && (
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
                    </div>
                    <button onClick={() => removeItem(i)} className="p-1 rounded-lg text-slate-600 hover:text-red-400 shrink-0"><X size={13} /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

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

          <div className="flex gap-3">
            <button onClick={goBack} className="px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-semibold flex items-center gap-1.5 transition-colors">
              <ChevronLeft size={14} /> Back
            </button>
            <button onClick={handleProcess} disabled={!canProceedInput}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2 transition-colors">
              <Inbox size={15} /> Process {items.filter((i) => i.selected).length || ''} File{items.filter((i) => i.selected).length === 1 ? '' : 's'}
            </button>
          </div>
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
                {r.status === 'error' && <AlertTriangle size={14} className="text-red-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">{r.name}</p>
                  <p className={`text-xs mt-0.5 truncate ${r.status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>{r.message}</p>
                </div>
              </div>
            ))}
          </div>

          {!batchRunning && batchResults.length > 0 && (
            <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${errorCount > 0 ? 'bg-amber-900/20 border border-amber-700/20 text-amber-300' : 'bg-emerald-900/20 border border-emerald-700/20 text-emerald-300'}`}>
              {errorCount > 0 ? <AlertTriangle size={16} className="shrink-0" /> : <CheckCircle2 size={16} className="shrink-0" />}
              {doneCount === 0 ? `All ${errorCount} file${errorCount === 1 ? '' : 's'} failed — see errors above.`
                : errorCount > 0 ? `Batch complete — ${doneCount} saved, ${errorCount} failed.`
                : `Batch complete — all ${doneCount} file${doneCount === 1 ? '' : 's'} saved.`}
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
              <button onClick={() => { setStep('type'); setContentType(''); setItems([]); setBatchResults([]); }}
                className="flex-1 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-bold transition-colors">
                Start New Upload
              </button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
