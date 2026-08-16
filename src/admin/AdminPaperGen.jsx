import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Printer, Eye, EyeOff,
  BookOpen, Loader2, RotateCcw, CheckCircle2, AlertTriangle, Send,
  Download, Database, Trash2, Info, ImagePlus, X, FileText, ChevronDown, ChevronUp, Wand2,
} from 'lucide-react';
import { generateImage as proxyGenerateImage, chatComplete } from '../lib/aiProxy';
import { generateQuestionPaper, toEngineFormat, extractPYQFromKB } from '../lib/questionGen';
import { getExamPattern, getMarkingLabel, getTestDurationMinutes } from '../lib/examPattern';
import { publishTest, getPYQCount, clearPYQQuestions, supabase } from '../lib/supabase';
import { broadcastNotification, createNotification } from '../lib/notifications';
import MathText from '../components/ui/MathText';
import { CATEGORIES, EXAM_TYPE_GROUPS, BOARDS, CLASS_LEVELS, getSubjectsForExam } from '../lib/categories';
import { useSyllabusSubjects } from '../hooks/useSyllabusSubjects';
import { useSyllabusChapters } from '../hooks/useSyllabusChapters';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

async function uploadQuestionImage(file, questionIndex) {
  const ext  = file.name.split('.').pop();
  const path = `question-images/${Date.now()}-q${questionIndex}.${ext}`;
  const { error } = await supabase.storage.from('question-papers').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('question-papers').getPublicUrl(path);
  return data.publicUrl;
}

async function generateDiagramImage(description, questionIndex) {
  const prompt = `Educational diagram for Indian school/entrance exam (NEET/JEE/CBSE style): ${description}. Style: clean black-and-white line diagram, clearly labelled parts, academic textbook illustration. No colour fills, no decorative backgrounds.`;
  const b64 = await proxyGenerateImage(prompt, { size: '1024x1024', quality: 'standard', n: 1, responseFormat: 'b64_json' });
  if (!b64) throw new Error('Image generation failed');
  const bytes = atob(b64);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob  = new Blob([arr], { type: 'image/png' });
  const path  = `question-images/gen-${Date.now()}-q${questionIndex}.png`;
  const { error } = await supabase.storage.from('question-papers').upload(path, blob, { contentType: 'image/png', upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('question-papers').getPublicUrl(path);
  return data.publicUrl;
}

/* ── Config options ─────────────────────────────────────── */
const DIFFS  = ['Easy', 'Medium', 'Hard', 'Mixed'];
const COUNTS = [10, 15, 20, 30, 35, 40, 50];

/* Question types available per exam group */
const isSchoolExam = (et) =>
  /^Class \d+$/.test(et) ||
  /^(CBSE|ICSE|State Board)( Class \d+)?$/.test(et);

const QTYPES_FOR = (examType) => isSchoolExam(examType)
  ? ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer']
  : ['MCQ', 'Assertion-Reason', 'Match the Following', 'Numerical'];

const DEFAULT_QTYPES_FOR = (examType) => isSchoolExam(examType)
  ? ['MCQ', 'Short Answer', 'Long Answer']
  : ['MCQ'];

/* Build the effective examType string from separate board + class selections */
function buildExam(competitive, board, cls) {
  if (competitive) return competitive;
  if (board && cls) return `${board} Class ${cls}`;
  if (cls)          return `Class ${cls}`;
  if (board)        return board;
  return 'NEET';
}

const TYPE_COLOR = {
  MCQ:                  'bg-blue-900   text-blue-300',
  'Assertion-Reason':   'bg-violet-900 text-violet-300',
  'Match the Following':'bg-amber-900  text-amber-300',
  Numerical:            'bg-teal-900   text-teal-300',
  'Short Answer':       'bg-emerald-900 text-emerald-300',
  'Long Answer':        'bg-orange-900  text-orange-300',
};

/* ── Single question card ───────────────────────────────── */
function QuestionCard({ q, index, showAnswer, onImageUpload, onRemoveImage }) {
  const [uploading,   setUploading]   = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [genError,    setGenError]    = useState('');
  const [imgBroken,   setImgBroken]   = useState(false);
  const fileRef = useRef(null);
  const badge   = TYPE_COLOR[q.type] || 'bg-slate-700 text-slate-300';

  useEffect(() => { setImgBroken(false); }, [q.image_url]);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadQuestionImage(file, index);
      onImageUpload?.(url);
    } catch (err) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleGenerate = async () => {
    if (!q.diagram_description) return;
    setGenerating(true);
    setGenError('');
    try {
      const url = await generateDiagramImage(q.diagram_description, index);
      onImageUpload?.(url);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-slate-800 border border-white/5 rounded-2xl p-5 space-y-3 print-question">
      {/* Number + type badge + image upload */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-white w-7 shrink-0">{index}.</span>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge}`}>{q.type}</span>
        <div className="flex-1" />
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title="Upload diagram/figure for this question"
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors disabled:opacity-40"
        >
          {uploading ? <Loader2 size={10} className="animate-spin" /> : <ImagePlus size={10} />}
          {q.image_url ? 'Replace' : 'Add image'}
        </button>
      </div>

      {/* Uploaded image preview */}
      {q.image_url && (
        <div className="ml-7 relative rounded-xl overflow-hidden border border-white/10">
          {imgBroken ? (
            <div className="flex items-center gap-2 px-3 py-3 bg-red-950/30 text-red-300 text-xs">
              <AlertTriangle size={13} className="shrink-0" /> Image failed to load — try replacing it.
            </div>
          ) : (
            <img
              src={q.image_url}
              alt="Question figure"
              className="w-full max-h-40 object-contain bg-white"
              onError={() => setImgBroken(true)}
            />
          )}
          <button
            onClick={() => onRemoveImage?.()}
            className="absolute top-1 right-1 p-1 rounded-full bg-black/60 hover:bg-red-900/80"
          >
            <X size={10} className="text-white" />
          </button>
        </div>
      )}

      {/* AI diagram description box (shown when no real image is uploaded) */}
      {!q.image_url && q.diagram_description && (
        <div className="ml-7 border border-dashed border-slate-600 rounded-xl bg-slate-900/50 px-3 py-2 space-y-2">
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Figure description</p>
          <p className="text-xs text-slate-400 italic leading-relaxed">{q.diagram_description}</p>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              onClick={handleGenerate}
              disabled={generating || uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-violet-700 hover:bg-violet-600 text-white transition-colors disabled:opacity-40"
            >
              {generating
                ? <><Loader2 size={11} className="animate-spin" /> Generating…</>
                : <><Wand2 size={11} /> Generate with AI</>}
            </button>
            <span className="text-[9px] text-slate-500">or upload manually →</span>
          </div>
          {genError && <p className="text-[10px] text-red-400">{genError}</p>}
        </div>
      )}

      {/* Question */}
      <div className="text-sm text-slate-100 leading-relaxed ml-7">
        <MathText text={q.question || q.question_text || ''} />
      </div>

      {/* Match the Following columns */}
      {q.type === 'Match the Following' && q.columnI && (
        <div className="ml-7 grid grid-cols-2 gap-4 bg-slate-900 rounded-xl p-3">
          <div>
            <p className="text-[10px] text-slate-500 font-semibold mb-1.5">Column I</p>
            {q.columnI.map((item, i) => (
              <p key={i} className="text-xs text-slate-300 py-0.5">{item}</p>
            ))}
          </div>
          <div>
            <p className="text-[10px] text-slate-500 font-semibold mb-1.5">Column II</p>
            {q.columnII?.map((item, i) => (
              <p key={i} className="text-xs text-slate-300 py-0.5">{item}</p>
            ))}
          </div>
        </div>
      )}

      {/* Options */}
      {q.options && (
        <div className="ml-7 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {q.options.map((opt, i) => {
            const letter  = String(opt).charAt(0);
            const isRight = showAnswer && String(q.answer ?? '').toUpperCase().startsWith(letter);
            return (
              <div key={i} className={[
                'text-xs px-3 py-2 rounded-xl border transition-colors',
                isRight
                  ? 'border-emerald-500 bg-emerald-900/30 text-emerald-300'
                  : 'border-white/5 text-slate-400',
              ].join(' ')}>
                <MathText text={String(opt)} />
              </div>
            );
          })}
        </div>
      )}

      {/* Numerical answer box placeholder */}
      {q.type === 'Numerical' && (
        <div className="ml-7 flex items-center gap-2">
          <div className="w-24 h-8 rounded-lg border border-white/10 bg-slate-900" />
          {showAnswer && (
            <span className="text-xs font-bold text-emerald-400">= {q.answer}</span>
          )}
        </div>
      )}

      {/* Answer + explanation */}
      <AnimatePresence>
        {showAnswer && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} className="overflow-hidden"
          >
            <div className="ml-7 mt-1 bg-slate-900 rounded-xl p-3 space-y-1 border border-emerald-800/30">
              {q.type !== 'Numerical' && (
                <p className="text-xs font-bold text-emerald-400">Answer: {q.answer}</p>
              )}
              <div className="text-xs text-slate-400 leading-relaxed">
                <MathText text={q.explanation || ''} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Print styles injected at runtime ───────────────────── */
/* ── Per-question marks (shared by on-screen display and print) ── */
function marksFor(q) {
  if (typeof q.marks === 'number') return q.marks;
  const sec = q.section;
  if (sec === 'A') return 1;
  if (sec === 'B') return 2;
  if (sec === 'C') return 3;
  if (sec === 'D' || sec === 'E') return 5;
  return 4; // NTA / unsectioned
}

function printPaper(questions, config) {
  const totalMarks = questions.reduce((s, q) => s + marksFor(q), 0);

  /* Build section-grouped question HTML */
  let prevSection = null;
  const qHtml = questions.map((q, i) => {
    const m    = marksFor(q);
    const opts = q.options
      ? `<div class="options">${q.options.map(o => `<div class="opt">${o}</div>`).join('')}</div>`
      : '';
    const cols = (q.type === 'Match the Following' && q.columnI)
      ? `<table class="cols"><tr><th>Column I</th><th>Column II</th></tr>${
          q.columnI.map((r, ri) => `<tr><td>${r}</td><td>${q.columnII?.[ri] || ''}</td></tr>`).join('')
        }</table>`
      : '';
    const writeBox = (q.type === 'Short Answer' || q.type === 'Long Answer')
      ? `<div class="writebox" style="height:${q.type === 'Long Answer' ? 120 : 56}px"></div>`
      : '';
    const numBox = q.type === 'Numerical' ? '<div class="numbox"></div>' : '';
    // onerror fallback: if the storage URL is unreachable at print time (deleted,
    // network hiccup), swap to the text description instead of a broken-image icon.
    const imgTag = q.image_url
      ? `<div class="diagram"><img src="${q.image_url}" alt="Figure" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'diagdesc',textContent:${JSON.stringify(`[Figure could not load: ${q.diagram_description || 'image unavailable'}]`)}}))" /></div>`
      : '';
    const diagDesc = (!q.image_url && q.diagram_description)
      ? `<div class="diagdesc">[Figure: ${q.diagram_description}]</div>`
      : '';

    let secHeader = '';
    if (q.section && q.section !== prevSection) {
      const sectionLabels = { A: 'Section A — Multiple Choice (1 mark each)', B: 'Section B — Very Short Answer (2 marks each)', C: 'Section C — Short Answer (3 marks each)', D: 'Section D — Long Answer (5 marks each)', E: 'Section E — Case-Based (5 marks each)' };
      secHeader = `<div class="sechdr">${sectionLabels[q.section] || `Section ${q.section}`}</div>`;
      prevSection = q.section;
    }
    return `${secHeader}<div class="q"><div class="qheader"><span class="qnum">Q.${i + 1}</span><span class="qtype">${q.type}</span><span class="qmarks">[${m} mark${m > 1 ? 's' : ''}]</span></div>${imgTag}${diagDesc}<p class="qtext">${q.question}</p>${cols}${opts}${numBox}${writeBox}</div>`;
  }).join('');

  /* Answer key table */
  const ansRows = questions.map((q, i) => {
    const m = marksFor(q);
    return `<tr><td>${i + 1}</td><td>${q.section || '—'}</td><td>${q.type}</td><td class="ans-cell">${q.answer ?? '—'}</td><td>${m}</td><td class="blank"></td></tr>`;
  }).join('');

  /* Section-wise marks summary */
  const sectionTotals = {};
  questions.forEach((q) => {
    const s = q.section || 'Unsectioned';
    sectionTotals[s] = (sectionTotals[s] || 0) + marksFor(q);
  });
  const secRows = Object.entries(sectionTotals).map(([s, m]) =>
    `<tr><td>Section ${s}</td><td>${m}</td><td class="blank"></td></tr>`
  ).join('');

  /* CBSE grade scale */
  const gradeRows = [
    ['A1','91–100'],['A2','81–90'],['B1','71–80'],['B2','61–70'],
    ['C1','51–60'],['C2','41–50'],['D','33–40'],['E1','21–32'],['E2','0–20'],
  ].map(([g, r]) => `<tr><td>${g}</td><td>${r}%</td></tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${config.examType} ${config.subject} Mock Paper</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', serif; font-size: 12pt; color: #000; margin: 1.5cm 2cm; }
  h1 { text-align: center; font-size: 18pt; margin: 0 0 4px; }
  .meta { text-align: center; font-size: 10pt; color: #333; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 6px; }
  .student-box { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; font-size: 10pt; margin-bottom: 16px; border: 1px solid #000; padding: 8px 12px; }
  .student-box label { font-size: 9pt; font-weight: bold; }
  .student-box .field { border-bottom: 1px solid #000; min-width: 120px; display: inline-block; width: 100%; }
  .sechdr { font-size: 11pt; font-weight: bold; background: #eee; border-top: 2px solid #000; border-bottom: 1px solid #aaa; padding: 4px 8px; margin: 18px 0 8px; }
  .q { margin-bottom: 16px; page-break-inside: avoid; }
  .qheader { display: flex; align-items: baseline; gap: 6px; margin-bottom: 3px; }
  .qnum { font-weight: bold; font-size: 11pt; }
  .qtype { font-size: 8pt; background: #ddd; padding: 1px 4px; border-radius: 2px; }
  .qmarks { font-size: 9pt; color: #555; margin-left: auto; }
  .qtext { margin: 0 0 4px 18px; }
  .options { margin: 6px 0 0 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 12px; }
  .opt { font-size: 11pt; }
  .numbox { margin: 8px 0 0 24px; border: 1px solid #999; width: 90px; height: 28px; display: inline-block; }
  .writebox { margin: 8px 0 0 24px; border: 1px solid #ccc; width: 100%; }
  .cols { margin: 6px 0 0 24px; border-collapse: collapse; font-size: 11pt; }
  .cols th, .cols td { border: 1px solid #aaa; padding: 3px 10px; }
  .cols th { background: #eee; }
  .diagram { margin: 6px 0 4px 24px; }
  .diagram img { max-width: 260px; max-height: 160px; object-fit: contain; border: 1px solid #ccc; }
  .diagdesc { margin: 4px 0 4px 24px; font-size: 9pt; font-style: italic; color: #666; }
  .answer-key { margin-top: 36px; border-top: 2px solid #000; padding-top: 14px; page-break-before: always; }
  .answer-key h2 { font-size: 14pt; margin: 0 0 10px; }
  table.anstable { border-collapse: collapse; width: 100%; font-size: 10pt; margin-bottom: 20px; }
  table.anstable th { background: #333; color: #fff; padding: 4px 8px; text-align: center; }
  table.anstable td { border: 1px solid #aaa; padding: 4px 8px; text-align: center; }
  table.anstable .ans-cell { font-weight: bold; background: #f5f5f5; }
  table.anstable .blank { background: #fff; min-width: 48px; }
  .grade-section { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 8px; }
  table.sectab { border-collapse: collapse; width: 100%; font-size: 10pt; }
  table.sectab th { background: #555; color: #fff; padding: 4px 8px; }
  table.sectab td { border: 1px solid #aaa; padding: 4px 8px; text-align: center; }
  table.sectab .blank { background: #fff; min-width: 48px; }
  table.gradetab { border-collapse: collapse; width: 100%; font-size: 9pt; }
  table.gradetab th { background: #555; color: #fff; padding: 3px 6px; text-align: center; }
  table.gradetab td { border: 1px solid #aaa; padding: 3px 6px; text-align: center; }
  .totals { margin-top: 14px; font-size: 11pt; }
  .totals table { border-collapse: collapse; }
  .totals td { padding: 4px 14px 4px 0; }
  .totals .tblank { border-bottom: 1px solid #000; min-width: 80px; display: inline-block; }
</style></head><body>
<h1>${config.examType} — ${config.subject} Mock Test</h1>
<div class="meta">Difficulty: ${config.difficulty} &nbsp;|&nbsp; Total Questions: ${questions.length} &nbsp;|&nbsp; Total Marks: ${totalMarks} &nbsp;|&nbsp; Time: ${getTestDurationMinutes(getExamPattern(config.examType))} min</div>
<div class="student-box">
  <div><label>Student Name: </label><span class="field">&nbsp;</span></div>
  <div><label>Roll No: </label><span class="field">&nbsp;</span></div>
  <div><label>Class / Section: </label><span class="field">&nbsp;</span></div>
  <div><label>Date: </label><span class="field">&nbsp;</span></div>
</div>
${qHtml}
<div class="answer-key">
  <h2>Answer Key &amp; Grade Sheet</h2>
  <table class="anstable">
    <tr><th>Q.No</th><th>Section</th><th>Type</th><th>Correct Answer</th><th>Max Marks</th><th>Marks Obtained</th></tr>
    ${ansRows}
  </table>
  <div class="grade-section">
    <div>
      <table class="sectab">
        <tr><th>Section</th><th>Max Marks</th><th>Marks Obtained</th></tr>
        ${secRows}
        <tr style="font-weight:bold;background:#eee"><td>Total</td><td>${totalMarks}</td><td class="blank"></td></tr>
      </table>
    </div>
    <div>
      <table class="gradetab">
        <tr><th>Grade</th><th>Percentage Range</th></tr>
        ${gradeRows}
      </table>
    </div>
  </div>
  <div class="totals">
    <table>
      <tr><td><b>Total Marks Obtained:</b></td><td><span class="tblank">&nbsp;</span> / ${totalMarks}</td></tr>
      <tr><td><b>Percentage:</b></td><td><span class="tblank">&nbsp;</span> %</td></tr>
      <tr><td><b>Grade:</b></td><td><span class="tblank">&nbsp;</span></td></tr>
      <tr><td><b>Remarks:</b></td><td><span class="tblank" style="min-width:200px">&nbsp;</span></td></tr>
    </table>
  </div>
</div>
</body></html>`;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

/* ── Config panel ───────────────────────────────────────── */
function Toggle({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
        active
          ? 'bg-primary-600 border-primary-500 text-white'
          : 'bg-slate-800 border-white/5 text-slate-400 hover:border-white/20',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

/* ── Chapter picker — live from Admin > Syllabus ──────────── */
function ChapterPicker({ examType, subject, classLevel, selected, onChange }) {
  const { chapters, loading } = useSyllabusChapters(examType, subject, classLevel);

  const toggle = (name) => {
    onChange(selected.includes(name) ? selected.filter((c) => c !== name) : [...selected, name]);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <label className="text-xs text-slate-400">Chapters</label>
        <p className="text-xs text-slate-600 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading chapters…</p>
      </div>
    );
  }

  if (!chapters.length) {
    return (
      <div className="space-y-2">
        <label className="text-xs text-slate-400">Chapters</label>
        <p className="text-xs text-slate-600">No chapters found in Admin &gt; Syllabus for {examType} / {subject} — generation will span the full subject.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-xs text-slate-400">
        Chapters <span className="text-slate-600">(optional — leave empty for full-syllabus spread)</span>
      </label>
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
        {chapters.map((c) => (
          <Toggle key={c.key ?? c.name} label={c.name} active={selected.includes(c.name)} onClick={() => toggle(c.name)} />
        ))}
      </div>
    </div>
  );
}

/* ── PYQ Extraction panel ───────────────────────────────── */
function PYQExtractPanel() {
  const [subject,    setSubj]    = useState('Biology');
  const [examType,   setExam]    = useState('NEET');
  const [extracting, setExtr]    = useState(false);
  const [progress,   setProgress]= useState('');
  const [result,     setResult]  = useState(null);
  const [error,      setError]   = useState('');
  const [count,      setCount]   = useState(null);
  const [open,       setOpen]    = useState(false);

  const loadCount = async () => {
    const c = await getPYQCount();
    setCount(c);
  };

  const handleExtract = async () => {
    setExtr(true); setError(''); setResult(null);
    try {
      const r = await extractPYQFromKB({
        subject, examType,
        onProgress: (msg) => setProgress(msg),
        callerUid: getCallerUid(),
      });
      setResult(r);
      loadCount();
    } catch (e) {
      setError(e.message);
    } finally {
      setExtr(false); setProgress('');
    }
  };

  const handleClear = async () => {
    if (!confirm('Delete all extracted PYQ questions?')) return;
    await clearPYQQuestions();
    setCount(0); setResult(null);
  };

  return (
    <div className="bg-slate-800 border border-white/5 rounded-2xl overflow-hidden">
      <button
        onClick={() => { setOpen((o) => !o); if (!open) loadCount(); }}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <Database size={15} className="text-primary-400" />
          <div>
            <p className="text-sm font-semibold text-white">PYQ Question Bank</p>
            <p className="text-xs text-slate-500 mt-0.5">Extract real questions from your knowledge base to improve generation quality</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {count !== null && (
            <span className="text-xs text-slate-400 bg-slate-700 px-2 py-0.5 rounded-full">{count} stored</span>
          )}
          <span className="text-slate-500 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-2 space-y-4 border-t border-white/5">
              <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-700/20 rounded-xl p-3">
                <Info size={12} className="text-blue-400 mt-0.5 shrink-0" />
                <p className="text-[10px] text-blue-300 leading-relaxed">
                  This scans your knowledge base for complete MCQ questions and stores them. Generation then uses these as style/difficulty examples to match real {examType} papers.
                  <span className="block mt-1 font-semibold">Requires <code className="bg-blue-900/40 px-1 rounded">pyq_questions</code> table — run the SQL migration first.</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase">Exam</label>
                  <div className="flex flex-wrap gap-1.5">
                    {(EXAM_TYPE_GROUPS.find((g) => g.label === 'Competitive')?.items ?? []).map((e) => (
                      <Toggle key={e} label={e} active={examType === e} onClick={() => setExam(e)} />
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-slate-500 uppercase">Subject</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[...getSubjectsForExam(examType), 'Mixed'].map((s) => (
                      <Toggle key={s} label={s} active={subject === s} onClick={() => setSubj(s)} />
                    ))}
                  </div>
                </div>
              </div>

              {error && (
                <div className="text-xs text-red-400 bg-red-900/20 rounded-xl px-3 py-2 border border-red-700/20">{error}</div>
              )}
              {result && (
                <div className="text-xs text-emerald-400 bg-emerald-900/20 rounded-xl px-3 py-2 border border-emerald-700/20">
                  Extracted {result.extracted} questions from knowledge base.
                </div>
              )}
              {progress && (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <Loader2 size={11} className="animate-spin" /> {progress}
                </p>
              )}

              <div className="flex gap-2">
                <button onClick={handleExtract} disabled={extracting}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 rounded-xl text-white text-xs font-semibold transition-colors">
                  {extracting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  {extracting ? 'Extracting…' : 'Extract PYQs from KB'}
                </button>
                {count > 0 && (
                  <button onClick={handleClear}
                    className="flex items-center gap-2 px-3 py-2 bg-slate-700 hover:bg-red-900/40 rounded-xl text-slate-400 hover:text-red-400 text-xs transition-colors">
                    <Trash2 size={12} /> Clear all
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── PYQ Template Preview ─────────────────────────────────── */
const SECTION_COLORS = {
  A: 'bg-violet-900/40 text-violet-300 border-violet-700/40',
  B: 'bg-blue-900/40   text-blue-300   border-blue-700/40',
  C: 'bg-teal-900/40   text-teal-300   border-teal-700/40',
  D: 'bg-orange-900/40 text-orange-300 border-orange-700/40',
  E: 'bg-rose-900/40   text-rose-300   border-rose-700/40',
};

function PYQTemplatePreview({ examType, subject }) {
  const [rows,    setRows]    = useState(null);  // null = not yet loaded
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(true);

  useEffect(() => {
    setRows(null);
    setLoading(true);
    supabase
      .from('pyq_questions')
      .select('id, section, question_type, marks, question_text, options, correct_answer, year')
      .eq('exam_type', examType)
      .eq('subject', subject)
      .order('section', { ascending: true })
      .limit(60)
      .then(({ data }) => { setRows(data ?? []); setLoading(false); });
  }, [examType, subject]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 bg-slate-800/60 border border-white/5 rounded-2xl p-5 text-slate-500 text-xs">
        <Loader2 size={12} className="animate-spin" /> Loading PYQ reference template…
      </div>
    );
  }

  if (!rows?.length) {
    return (
      <div className="flex items-start gap-3 bg-slate-800/60 border border-white/5 rounded-2xl p-5">
        <FileText size={16} className="text-slate-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-slate-400">No PYQ Papers Uploaded Yet</p>
          <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
            Upload {examType} {subject} question papers in <span className="text-slate-400 font-medium">Upload Content</span> → the AI will use them as style references to match real exam language.
          </p>
        </div>
      </div>
    );
  }

  // Group by section (or by type if no section)
  const bySection = {};
  rows.forEach((q) => {
    const key = q.section || (q.question_type === 'MCQ' ? 'A' : 'Other');
    if (!bySection[key]) bySection[key] = [];
    bySection[key].push(q);
  });

  const sectionKeys = Object.keys(bySection).sort();
  const totalMarks  = rows.reduce((s, q) => s + (q.marks ?? 0), 0);
  const years       = [...new Set(rows.map((r) => r.year).filter(Boolean))].sort().reverse();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/60 border border-white/5 rounded-2xl overflow-hidden"
    >
      {/* Header */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-700/30 transition-colors"
      >
        <FileText size={15} className="text-primary-400 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-bold text-white">Reference Paper Template</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {rows.length} uploaded PYQ questions · {totalMarks > 0 ? `${totalMarks} total marks · ` : ''}{years.length ? `${years[0]}${years.length > 1 ? `–${years[years.length - 1]}` : ''}` : ''} — AI will match this style
          </p>
        </div>
        {open ? <ChevronUp size={13} className="text-slate-500" /> : <ChevronDown size={13} className="text-slate-500" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
              {/* Section distribution chips */}
              <div className="flex flex-wrap gap-2">
                {sectionKeys.map((sec) => {
                  const qs = bySection[sec];
                  const secMarks = qs.reduce((s, q) => s + (q.marks ?? 0), 0);
                  const type = qs[0]?.question_type ?? 'Mixed';
                  return (
                    <div key={sec} className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold ${SECTION_COLORS[sec] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                      <span>Sec {sec}</span>
                      <span className="opacity-60">·</span>
                      <span>{qs.length}Q</span>
                      {secMarks > 0 && <><span className="opacity-60">·</span><span>{secMarks}m</span></>}
                      <span className="opacity-60">·</span>
                      <span className="font-normal opacity-80">{type}</span>
                    </div>
                  );
                })}
              </div>

              {/* Sample questions per section (max 2 per section) */}
              <div className="space-y-3">
                {sectionKeys.map((sec) => {
                  const samples = bySection[sec].slice(0, 2);
                  return (
                    <div key={sec} className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Section {sec} samples
                      </p>
                      {samples.map((q, i) => (
                        <div key={q.id} className="bg-slate-900/60 rounded-xl p-3 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            {q.marks && (
                              <span className="text-[10px] bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded font-semibold">
                                {q.marks}m
                              </span>
                            )}
                            {q.question_type && (
                              <span className="text-[10px] text-slate-500">{q.question_type}</span>
                            )}
                            {q.year && (
                              <span className="text-[10px] text-slate-600">{q.year}</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
                            {q.question_text}
                          </p>
                          {q.options?.length > 0 && (
                            <div className="grid grid-cols-2 gap-1 mt-1">
                              {q.options.slice(0, 4).map((opt, oi) => (
                                <p key={oi} className={`text-[10px] rounded-lg px-2 py-1 leading-relaxed truncate ${opt.startsWith(q.correct_answer) ? 'bg-emerald-900/40 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                                  {opt}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-600">
                The AI reads all {rows.length} uploaded questions as style reference — language, depth, difficulty, and section structure are matched automatically.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Template helpers ─────────────────────────────────── */
function deriveTemplates(rows) {
  // Group by year; fall back to grouping all as one template if no year data
  const byYear = {};
  rows.forEach((r) => {
    const key = r.year ? String(r.year) : 'all';
    if (!byYear[key]) byYear[key] = [];
    byYear[key].push(r);
  });

  return Object.entries(byYear)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 5) // show at most 5 templates
    .map(([year, qs]) => {
      const bySection = {};
      qs.forEach((q) => {
        const sec = q.section || (q.question_type === 'MCQ' ? 'A' : 'B');
        if (!bySection[sec]) bySection[sec] = { types: new Set(), count: 0, marksTotal: 0 };
        bySection[sec].count++;
        bySection[sec].marksTotal += q.marks ?? 0;
        bySection[sec].types.add(q.question_type ?? 'MCQ');
      });
      const sections = Object.entries(bySection).sort(([a], [b]) => a.localeCompare(b)).map(([sec, s]) => ({
        section:    sec,
        qType:      [...s.types][0] ?? 'MCQ',
        count:      s.count,
        marksEach:  s.count > 0 ? Math.round(s.marksTotal / s.count) : 0,
      }));
      const totalMarks = qs.reduce((s, q) => s + (q.marks ?? 0), 0);
      const allTypes   = [...new Set(qs.map((q) => q.question_type).filter(Boolean))];
      return {
        id:             `pyq-${year}`,
        label:          year === 'all' ? 'PYQ Bank' : `PYQ ${year}`,
        source:         'pyq',
        year:           year === 'all' ? null : Number(year),
        sections,
        totalQuestions: qs.length,
        totalMarks,
        qTypes:         allTypes.length ? allTypes : ['MCQ'],
      };
    });
}

async function fetchAITemplate(examType, subject) {
  const prompt = `You are an expert on Indian competitive and school exams.
Return the official ${examType} ${subject} question paper structure as JSON with this shape:
{
  "sections": [
    { "section": "A", "qType": "MCQ", "count": 35, "marksEach": 4 }
  ],
  "totalQuestions": 180,
  "totalMarks": 720,
  "duration": 180,
  "note": "e.g. NEET 2024 pattern"
}
Use only these qType values: MCQ, Assertion-Reason, Numerical, Match the Following, Short Answer, Long Answer.
Return ONLY valid JSON, no markdown.`;

  const resp = await chatComplete({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  }, { feature: 'admin-paper-gen' });
  const raw = resp.choices[0].message.content;
  const data = JSON.parse(raw);
  const allTypes = [...new Set((data.sections ?? []).map((s) => s.qType).filter(Boolean))];
  return {
    id:             'ai-official',
    label:          'Official Structure (AI)',
    source:         'ai',
    year:           null,
    sections:       data.sections ?? [],
    totalQuestions: data.totalQuestions ?? data.sections?.reduce((s, x) => s + x.count, 0) ?? 0,
    totalMarks:     data.totalMarks ?? 0,
    note:           data.note ?? '',
    qTypes:         allTypes.length ? allTypes : ['MCQ'],
  };
}

const SEC_COLORS = {
  A: 'bg-violet-900/30 text-violet-300 border-violet-700/30',
  B: 'bg-blue-900/30   text-blue-300   border-blue-700/30',
  C: 'bg-teal-900/30   text-teal-300   border-teal-700/30',
  D: 'bg-orange-900/30 text-orange-300 border-orange-700/30',
  E: 'bg-rose-900/30   text-rose-300   border-rose-700/30',
};

function TemplatePickerPanel({ examType, subject, onApply }) {
  const [templates, setTemplates] = useState(null); // null = not loaded
  const [loading,   setLoading]   = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [open,      setOpen]      = useState(true);

  // Re-fetch when exam/subject changes
  useEffect(() => {
    setTemplates(null);
    setSelected(null);
    setLoading(true);
    supabase
      .from('pyq_questions')
      .select('year, section, question_type, marks')
      .eq('exam_type', examType)
      .eq('subject', subject)
      .eq('status', 'published')
      .neq('question_type', 'KB_NOTE')
      .limit(300)
      .then(({ data }) => {
        const rows = data ?? [];
        setTemplates(rows.length ? deriveTemplates(rows) : []);
        setLoading(false);
      })
      .catch(() => { setTemplates([]); setLoading(false); });
  }, [examType, subject]);

  const handleFetchAI = async () => {
    setAiLoading(true);
    try {
      const t = await fetchAITemplate(examType, subject);
      setTemplates((prev) => [t, ...(prev ?? []).filter((x) => x.source !== 'ai')]);
    } catch (e) {
      alert(`AI fetch failed: ${e.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  const handleSelect = (t) => {
    setSelected(t.id);
    onApply({ count: t.totalQuestions, qTypes: t.qTypes });
  };

  return (
    <div className="bg-slate-800 border border-white/5 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <FileText size={15} className="text-primary-400" />
          <div>
            <p className="text-sm font-semibold text-white">Paper Template</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {selected ? 'Template applied — generation follows this structure' : 'Select a template to match the paper style & section distribution'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selected && (
            <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-900/30 px-2 py-0.5 rounded-full">Applied</span>
          )}
          {open ? <ChevronUp size={13} className="text-slate-500" /> : <ChevronDown size={13} className="text-slate-500" />}
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-3 border-t border-white/5 space-y-4">
              {loading && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Loader2 size={12} className="animate-spin" /> Loading PYQ templates…
                </div>
              )}

              {!loading && templates !== null && templates.length === 0 && (
                <div className="space-y-3">
                  <div className="flex items-start gap-3 bg-slate-900/50 rounded-xl p-4">
                    <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-amber-300">No PYQs uploaded yet for {examType} · {subject}</p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Upload question papers in Upload Content first. Until then, use the AI to fetch the official exam structure.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleFetchAI}
                    disabled={aiLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 rounded-xl text-white text-xs font-semibold transition-colors"
                  >
                    {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    {aiLoading ? 'Fetching official structure…' : 'Fetch Official Structure with AI'}
                  </button>
                </div>
              )}

              {!loading && templates !== null && templates.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {templates.filter((t) => t.source === 'pyq').length} PYQ template{templates.filter((t) => t.source === 'pyq').length !== 1 ? 's' : ''} found
                    </p>
                    {!templates.some((t) => t.source === 'ai') && (
                      <button
                        onClick={handleFetchAI}
                        disabled={aiLoading}
                        className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-violet-400 hover:text-violet-300 bg-violet-900/20 hover:bg-violet-900/40 rounded-lg transition-colors disabled:opacity-40"
                      >
                        {aiLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                        {aiLoading ? 'Fetching…' : 'AI Official'}
                      </button>
                    )}
                  </div>

                  <div className="grid gap-2">
                    {templates.map((t) => {
                      const isActive = selected === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => handleSelect(t)}
                          className={[
                            'w-full text-left rounded-xl border p-3.5 transition-all',
                            isActive
                              ? 'border-primary-500 bg-primary-900/20'
                              : 'border-white/5 bg-slate-900/40 hover:border-white/20 hover:bg-slate-900/60',
                          ].join(' ')}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-bold ${isActive ? 'text-primary-300' : 'text-white'}`}>
                                {t.label}
                              </span>
                              {t.source === 'ai' && (
                                <span className="text-[9px] font-bold bg-violet-800/50 text-violet-300 px-1.5 py-0.5 rounded">AI</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                              <span>{t.totalQuestions}Q</span>
                              {t.totalMarks > 0 && <span>· {t.totalMarks}m</span>}
                              {isActive && <CheckCircle2 size={12} className="text-primary-400" />}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {t.sections.map((sec) => (
                              <div
                                key={sec.section}
                                className={`flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${SEC_COLORS[sec.section] ?? 'bg-slate-700 text-slate-300 border-slate-600'}`}
                              >
                                {sec.section && <span>§{sec.section}</span>}
                                <span>{sec.count}×{sec.qType}</span>
                                {sec.marksEach > 0 && <span className="opacity-60">{sec.marksEach}m</span>}
                              </div>
                            ))}
                          </div>
                          {t.note && (
                            <p className="text-[10px] text-slate-500 mt-1.5">{t.note}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {selected && (
                    <div className="flex items-center gap-2 bg-primary-900/20 border border-primary-700/30 rounded-xl px-3 py-2">
                      <CheckCircle2 size={12} className="text-primary-400 shrink-0" />
                      <p className="text-[11px] text-primary-300 leading-relaxed">
                        Template applied — question count & types updated in config. AI will follow this section structure.
                      </p>
                      <button
                        onClick={() => { setSelected(null); onApply(null); }}
                        className="ml-auto text-slate-500 hover:text-slate-300 shrink-0"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────── */
export default function AdminPaperGen() {
  const navigate     = useNavigate();
  const [competitive, setCompetitive] = useState('NEET');
  const [selBoard,    setSelBoard]    = useState(null);
  const [selClass,    setSelClass]    = useState(null);
  const examType = buildExam(competitive, selBoard, selClass);

  const [subject,    setSubject]    = useState('Biology');
  const [difficulty, setDifficulty] = useState('Mixed');
  const [count,      setCount]      = useState(20);
  const [topics,     setTopics]     = useState('');
  const [chapters,   setChapters]   = useState([]); // selected chapter keys/names
  const [qTypes,     setQTypes]     = useState(() => DEFAULT_QTYPES_FOR('NEET'));

  const subs = useSyllabusSubjects(examType, selClass);

  // Whenever the live subject list changes (exam switched, or DB data loaded),
  // make sure the selected subject is still valid.
  useEffect(() => {
    if (subs.length && !subs.includes(subject)) setSubject(subs[0]);
  }, [subs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chapters reset whenever exam/subject changes — re-selected via the chapter picker below.
  useEffect(() => { setChapters([]); }, [examType, subject]);

  const pickCompetitive = (e) => {
    setCompetitive(e); setSelBoard(null); setSelClass(null);
    setQTypes(DEFAULT_QTYPES_FOR(e));
  };
  const pickBoard = (b) => {
    const next = selBoard === b ? null : b;
    setSelBoard(next); setCompetitive(null);
    const resolved = buildExam(null, next, selClass);
    setQTypes(DEFAULT_QTYPES_FOR(resolved));
  };
  const pickClass = (cl) => {
    const next = selClass === cl ? null : cl;
    setSelClass(next); setCompetitive(null);
    const resolved = buildExam(null, selBoard, next);
    setQTypes(DEFAULT_QTYPES_FOR(resolved));
  };
  const [questions,        setQuestions]        = useState([]);
  const [generating,       setGenerating]       = useState(false);
  const [error,            setError]            = useState(null);
  const [showAnswers,      setShowAnswers]       = useState(false);
  const [publishing,       setPublishing]        = useState(false);
  const [published,        setPublished]         = useState(false);
  const [pubTitle,         setPubTitle]          = useState('');
  const [showPubDlg,       setShowPubDlg]        = useState(false);
  const [sourceMeta,       setSourceMeta]        = useState(null); // { pyqCount, studyNotesCount }
  const [blueprintMatchPct, setBlueprintMatchPct] = useState(null);
  const [patternMatch,      setPatternMatch]      = useState(null);
  const paperRef = useRef(null);

  const toggleType = (t) =>
    setQTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

  const applyTemplate = (tpl) => {
    if (!tpl) return; // cleared
    if (tpl.totalQuestions > 0) setCount(tpl.totalQuestions);
    if (tpl.qTypes?.length)     setQTypes(tpl.qTypes);
  };

  const handleGenerate = async () => {
    if (generating) return;
    // Carried over from the abandoned AdminPaperGenCore split — generation can
    // take 1-2 min, so drop an in-app notification up front rather than relying
    // solely on the admin watching the spinner.
    try {
      createNotification(getCallerUid(), 'info', 'Paper generation started',
        `Generating ${examType} ${subject} — you'll be notified when it's ready.`);
    } catch { /* non-fatal */ }
    setGenerating(true);
    setError(null);
    setQuestions([]);
    setSourceMeta(null);
    setBlueprintMatchPct(null);
    setPatternMatch(null);
    setShowAnswers(false);
    setPublished(false);
    try {
      // Selected chapters (from Admin > Syllabus) scope generation; extra free-text topics narrow further within them.
      const scopedTopics = [...chapters, ...topics.split(',').map((t) => t.trim()).filter(Boolean)].join(', ');
      const result = await generateQuestionPaper({ subject, topics: scopedTopics, examType, difficulty, count, qTypes, rotationSlot: Math.floor(Math.random() * 5) });
      /* result is now { questions, meta, blueprint_match_pct?, allocation_table? } */
      let qs   = result?.questions ?? result;
      const meta = result?.meta ?? null;
      if (result?.blueprint_match_pct !== undefined) setBlueprintMatchPct(result.blueprint_match_pct);
      setPatternMatch(result?.pattern_match ?? null);
      if (!Array.isArray(qs)) {
        qs = qs?.questions ?? qs?.data ?? qs?.items ?? Object.values(qs ?? {}).find(Array.isArray) ?? [];
      }
      const SECTION_ORD = { A: 0, B: 1, C: 2, D: 3, E: 4 };
      qs = qs.map((q) => ({
        ...q,
        question: q.question ?? q.question_text ?? q.stem ?? '',
        type:     q.type ?? 'MCQ',
      })).filter((q) => q.question)
         .sort((a, b) => (SECTION_ORD[a.section] ?? 99) - (SECTION_ORD[b.section] ?? 99))
         .slice(0, count);
      setQuestions(qs);
      setSourceMeta(meta);
      setPubTitle(`${examType} ${subject} Main Test`);
    } catch (e) {
      setError(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!pubTitle.trim() || publishing) return;
    const engineQs = toEngineFormat(questions, subject, examType);
    if (engineQs.length === 0) {
      alert('None of the generated questions are in a publishable format (e.g. every "Match the Following" question came back without the required options) — nothing was published. Try regenerating.');
      return;
    }
    setPublishing(true);
    try {
      const durationMin = getTestDurationMinutes(getExamPattern(examType));
      await publishTest({
        title:              pubTitle.trim(),
        subject,
        examType,
        difficulty,
        questions:          engineQs,
        durationMinutes:    durationMin,
        blueprintMatchPct:  blueprintMatchPct ?? undefined,
        createdBy:          'admin',
      });
      setPublished(true);
      setShowPubDlg(false);
      // Notify all students in-app
      broadcastNotification(
        getCallerUid(),
        'new_paper',
        `New ${examType} ${subject} Test Available`,
        `${pubTitle.trim()} — ${engineQs.length} questions · ${durationMin} min`,
        '/exam-center',
      ).catch(() => {});
    } catch (e) {
      alert(`Publish failed: ${e.message}`);
    } finally {
      setPublishing(false);
    }
  };

  const config = { subject, examType, difficulty, count, qTypes };

  return (
    <div className="max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Question Paper Generator</h1>
          <p className="text-slate-400 text-sm mt-1">
            AI generates original questions using your knowledge base as style reference
          </p>
        </div>
        {questions.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setShowAnswers((v) => !v)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm transition-colors">
              {showAnswers ? <EyeOff size={14} /> : <Eye size={14} />}
              {showAnswers ? 'Hide Answers' : 'Show Answers'}
            </button>
            <button onClick={() => printPaper(questions, config)}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm transition-colors">
              <Printer size={14} /> Print
            </button>
            <button
              onClick={() => navigate('/paper-mode', { state: { questions: toEngineFormat(questions, subject, examType), title: pubTitle || `${examType} ${subject} Paper`, examType, subject } })}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 text-sm transition-colors">
              <FileText size={14} /> Paper Mode
            </button>
            {published ? (
              <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-emerald-400 text-sm font-semibold">
                <CheckCircle2 size={14} /> Published to Students
              </span>
            ) : (
              <button onClick={() => setShowPubDlg(true)}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-xl text-white text-sm font-semibold transition-colors">
                <Send size={14} /> Publish to Students
              </button>
            )}
          </div>
        )}

        {/* Publish dialog */}
        <AnimatePresence>
          {showPubDlg && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setShowPubDlg(false)}
            >
              <motion.div
                className="bg-slate-800 border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 space-y-4"
                initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                onClick={(e) => e.stopPropagation()}
              >
                <p className="text-white font-bold">Publish to Students</p>
                <p className="text-xs text-slate-400">Students will see this test in their Practice page and can take it as a timed main test.</p>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400">Test title</label>
                  <input
                    autoFocus
                    value={pubTitle}
                    onChange={(e) => setPubTitle(e.target.value)}
                    placeholder="e.g. NEET Biology Mock — Cell Division"
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-primary-500"
                  />
                </div>
                {(() => {
                  const compatCount = toEngineFormat(questions, subject, examType).length;
                  const dropped = questions.length - compatCount;
                  return (
                    <div className={`text-xs rounded-lg px-2.5 py-1.5 ${dropped > 0 ? 'bg-amber-900/20 text-amber-300 border border-amber-700/30' : 'text-slate-500'}`}>
                      {compatCount} of {questions.length} questions compatible with test engine (MCQ + A-R + Match)
                      {dropped > 0 && ` — ${dropped} will be dropped (usually malformed "Match the Following" questions missing options)`}
                      {compatCount === 0 && ' — publishing is blocked until at least one question is compatible'}
                    </div>
                  );
                })()}
                <div className="flex gap-2">
                  <button onClick={() => setShowPubDlg(false)}
                    className="flex-1 py-2 rounded-xl text-sm text-slate-400 hover:bg-slate-700 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handlePublish} disabled={!pubTitle.trim() || publishing}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white transition-colors">
                    {publishing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Publish
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* PYQ Bank panel */}
      <PYQExtractPanel />

      {/* Template picker — fetched from PYQs, AI fallback */}
      <TemplatePickerPanel examType={examType} subject={subject} onApply={applyTemplate} />

      <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-6 items-start">
        {/* ── Config panel ── */}
        <div className="bg-slate-800 border border-white/5 rounded-2xl p-5 space-y-5 xl:sticky xl:top-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Configuration</p>

          {/* Exam — pick ONE: a competitive exam, OR a board + class combo */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400">Exam</label>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Pick a competitive exam, <span className="italic">or</span> a board + class — not both.
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-primary-400 uppercase tracking-wider">🏆 Competitive exam</p>
              <div className="flex flex-wrap gap-1.5">
                {(EXAM_TYPE_GROUPS.find((g) => g.label === 'Competitive')?.items ?? []).map((e) => (
                  <Toggle key={e} label={e} active={competitive === e} onClick={() => pickCompetitive(e)} />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 py-0.5">
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-[9px] font-bold text-slate-600 uppercase">or</span>
              <div className="flex-1 h-px bg-white/10" />
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">🎓 Board</p>
              <div className="flex flex-wrap gap-1.5">
                {BOARDS.map((b) => (
                  <Toggle key={b} label={b} active={selBoard === b} onClick={() => pickBoard(b)} />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">📚 Class</p>
              <div className="flex flex-wrap gap-1.5">
                {CLASS_LEVELS.map((cl) => (
                  <Toggle key={cl} label={`Class ${cl}`} active={selClass === cl} onClick={() => pickClass(cl)} />
                ))}
              </div>
            </div>

            <p className="text-[11px] text-primary-300 font-semibold bg-primary-900/20 border border-primary-700/20 rounded-lg px-2.5 py-1.5">
              Generating for: <span className="font-bold text-white">{examType}</span>
            </p>
          </div>

          {/* Subject — dynamic based on selected exam, live from Admin > Syllabus */}
          <div className="space-y-2">
            <label className="text-xs text-slate-400">Subject</label>
            <div className="flex flex-wrap gap-1.5">
              {subs.map((s) => (
                <Toggle key={s} label={s} active={subject === s} onClick={() => setSubject(s)} />
              ))}
            </div>
          </div>

          {/* Chapters — live from Admin > Syllabus for the selected exam + subject */}
          <ChapterPicker
            examType={examType}
            subject={subject}
            classLevel={selClass}
            selected={chapters}
            onChange={setChapters}
          />

          {/* Topics */}
          <div className="space-y-2">
            <label className="text-xs text-slate-400">Extra topics (optional, comma-separated)</label>
            <input
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              placeholder="e.g. Cell Division, Mitosis, Meiosis"
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-primary-500 transition-colors"
            />
          </div>

          {/* Difficulty */}
          <div className="space-y-2">
            <label className="text-xs text-slate-400">Difficulty</label>
            <div className="flex flex-wrap gap-1.5">
              {DIFFS.map((d) => <Toggle key={d} label={d} active={difficulty === d} onClick={() => setDifficulty(d)} />)}
            </div>
          </div>

          {/* Question types */}
          <div className="space-y-2">
            <label className="text-xs text-slate-400">Question Types</label>
            <div className="flex flex-wrap gap-1.5">
              {QTYPES_FOR(examType).map((t) => (
                <Toggle key={t} label={t} active={qTypes.includes(t)} onClick={() => toggleType(t)} />
              ))}
            </div>
            {qTypes.length === 0 && (
              <p className="text-[10px] text-amber-400">Select at least one type</p>
            )}
          </div>

          {/* Count */}
          <div className="space-y-2">
            <label className="text-xs text-slate-400">Number of Questions</label>
            <div className="flex flex-wrap gap-1.5">
              {COUNTS.map((c) => <Toggle key={c} label={String(c)} active={count === c} onClick={() => setCount(c)} />)}
            </div>
            {isSchoolExam(examType) && (
              <p className="text-[10px] text-amber-400">
                Recommended: {getExamPattern(examType)?.totalQ ?? '30–40'} questions for a full {examType} paper. AI will split across sections automatically.
              </p>
            )}
            {(() => {
              const pat = getExamPattern(examType);
              if (!pat) return null;
              return (
                <p className="text-[10px] text-slate-500">
                  Pattern: {pat.totalQ}Q · {pat.totalMarks} marks · {pat.duration} min · {getMarkingLabel(pat)}
                </p>
              );
            })()}
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={generating || qTypes.length === 0}
            className="w-full flex items-center justify-center gap-2 py-3 bg-gradient-to-r from-primary-500 to-primary-700 hover:from-primary-600 hover:to-primary-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-white font-bold text-sm transition-all"
          >
            {generating
              ? <><Loader2 size={15} className="animate-spin" /> Generating…</>
              : <><Sparkles size={15} /> Generate {count} Questions</>
            }
          </button>

          {/* Image note */}
          <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/30 rounded-xl p-3">
            <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-300 leading-relaxed">
              Diagram-based questions get a text description by default — no action needed. If you want a real image instead, use "Generate with AI" (or upload one manually) on that question below.
            </p>
          </div>
        </div>

        {/* ── Paper preview ── */}
        <div ref={paperRef} className="space-y-3">
          {/* PYQ template preview — shown before generation so admin can see what uploaded papers look like */}
          {!generating && questions.length === 0 && (
            <PYQTemplatePreview examType={examType} subject={subject} />
          )}
          {generating && (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="relative">
                <div className="h-16 w-16 rounded-full border-2 border-slate-700 border-t-primary-500 animate-spin" />
                <Sparkles size={20} className="text-primary-400 absolute inset-0 m-auto" />
              </div>
              <p className="text-slate-400 text-sm">GPT-4o is crafting your questions…</p>
              <p className="text-slate-600 text-xs">This takes 20–40 seconds for large papers</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-3 bg-red-900/20 border border-red-700/30 rounded-2xl p-4">
              <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-300">Generation failed</p>
                <p className="text-xs text-red-400 mt-0.5">{error}</p>
                <button onClick={handleGenerate}
                  className="mt-2 flex items-center gap-1.5 text-xs text-red-300 hover:text-white transition-colors">
                  <RotateCcw size={11} /> Try again
                </button>
              </div>
            </div>
          )}

          {!generating && questions.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
              <BookOpen size={40} className="text-slate-700" />
              <p className="text-slate-400 font-medium">Configure and generate your paper</p>
              <p className="text-slate-600 text-sm max-w-xs">
                AI will create original {subject} questions in {examType} style, drawing on your knowledge base for difficulty cues.
              </p>
            </div>
          )}

          {questions.length > 0 && (
            <>
              {/* Paper header */}
              <div className="bg-gradient-to-r from-primary-900/40 to-violet-900/40 border border-primary-500/20 rounded-2xl p-5">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-lg font-bold text-white">{examType} Mock Test — {subject}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {questions.length} questions &nbsp;·&nbsp;
                      <span className="text-primary-400 font-semibold">
                        {questions.reduce((s, q) => s + marksFor(q), 0)} marks
                      </span>
                      &nbsp;·&nbsp; Difficulty: {difficulty} &nbsp;·&nbsp;
                      Est. time: {Math.round(questions.length * 1.5)} min
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    <span className="text-xs text-emerald-400 font-medium">AI-generated · 100% original</span>
                  </div>
                </div>
                {/* Type breakdown + sources used */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {Object.entries(
                    questions.reduce((acc, q) => { acc[q.type] = (acc[q.type] || 0) + 1; return acc; }, {})
                  ).map(([type, n]) => (
                    <span key={type} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_COLOR[type] || 'bg-slate-700 text-slate-300'}`}>
                      {type}: {n}
                    </span>
                  ))}
                </div>
                {(sourceMeta || blueprintMatchPct !== null || patternMatch) && (
                  <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t border-white/5">
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest self-center">Sources used:</span>
                    {sourceMeta && <>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sourceMeta.pyqCount >= 3 ? 'bg-emerald-900/60 text-emerald-300' : 'bg-slate-700 text-slate-400'}`}>
                        PYQ: {sourceMeta.pyqCount} questions {sourceMeta.pyqCount < 3 ? '(limited)' : '✓'}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${sourceMeta.studyNotesCount >= 2 ? 'bg-blue-900/60 text-blue-300' : 'bg-slate-700 text-slate-400'}`}>
                        Study notes: {sourceMeta.studyNotesCount} chunks {sourceMeta.studyNotesCount < 2 ? '(none found)' : '✓'}
                      </span>
                    </>}
                    {blueprintMatchPct !== null && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${blueprintMatchPct >= 80 ? 'bg-violet-900/60 text-violet-300' : 'bg-amber-900/40 text-amber-300'}`}>
                        {blueprintMatchPct}% blueprint-matched (chapter)
                      </span>
                    )}
                    {/* Measured against real past-year papers for this exam+subject.
                        hasData:false is rendered as "no baseline", never as 0% —
                        a paper cannot mismatch a pattern that does not exist. */}
                    {patternMatch?.hasData && (
                      <>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${patternMatch.overall >= 70 ? 'bg-emerald-900/60 text-emerald-300' : patternMatch.overall >= 45 ? 'bg-amber-900/40 text-amber-300' : 'bg-red-900/40 text-red-300'}`}
                              title={`Measured against ${patternMatch.basedOn.questions} real past-year questions across ${patternMatch.basedOn.chapters} chapters`}>
                          {patternMatch.overall}% PYQ-pattern match
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400"
                              title="How closely the generated paper's chapter / question-type / marks spread mirrors real past-year papers. Difficulty is derived from marks and shown for reference only.">
                          chapter {patternMatch.chapter}% · type {patternMatch.type}% · marks {patternMatch.marks}%
                        </span>
                      </>
                    )}
                    {patternMatch && !patternMatch.hasData && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-500"
                            title={patternMatch.reason}>
                        no PYQ baseline for this subject
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Questions — with section-break dividers */}
              {questions.map((q, i) => {
                const showSectionHeader = q.section && q.section !== questions[i - 1]?.section;
                return (
                  <div key={i}>
                    {showSectionHeader && (
                      <div className="flex items-center gap-3 mt-2 mb-1">
                        <div className="flex-1 h-px bg-white/10" />
                        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-2">
                          Section {q.section}
                        </span>
                        <div className="flex-1 h-px bg-white/10" />
                      </div>
                    )}
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.02 }}
                    >
                      <QuestionCard
                        q={q}
                        index={i + 1}
                        showAnswer={showAnswers}
                        onImageUpload={(url) =>
                          setQuestions((prev) => prev.map((item, idx) => idx === i ? { ...item, image_url: url } : item))
                        }
                        onRemoveImage={() =>
                          setQuestions((prev) => prev.map((item, idx) => idx === i ? { ...item, image_url: null } : item))
                        }
                      />
                    </motion.div>
                  </div>
                );
              })}

              {/* Bottom actions */}
              <div className="flex justify-end gap-2 pt-2 pb-8">
                <button onClick={handleGenerate} disabled={generating}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl text-slate-300 text-sm transition-colors">
                  <RotateCcw size={13} /> Regenerate
                </button>
                <button onClick={() => printPaper(questions, config)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-xl text-white text-sm font-semibold transition-colors">
                  <Printer size={13} /> Print / Export PDF
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
