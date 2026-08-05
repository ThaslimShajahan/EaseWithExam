import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Printer, Upload, ArrowLeft, CheckCircle2, XCircle,
  Loader2, AlertTriangle, Camera, FileImage, Trash2,
  ChevronDown, ChevronUp, Star, ZoomIn, X, BookOpen,
  ScanSearch, Pencil, RefreshCw, Download,
} from 'lucide-react';
import { getPublishedTest, saveTestSession } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import MathText from '../components/ui/MathText';
import { chatComplete } from '../lib/aiProxy';
import { saveWrongAnswers } from '../lib/errorNotebook';
import { awardXP } from '../lib/gamification';
import { checkQuota, incrementQuota } from '../lib/quota';
import PaywallModal from '../components/ui/PaywallModal';

/* ── Helpers ─────────────────────────────────────────────── */
const OPT_LETTERS = ['A', 'B', 'C', 'D', 'E'];

const SECTION_META = {
  A: { label: 'Section A', note: 'Attempt all questions' },
  B: { label: 'Section B', note: 'Attempt all questions' },
  C: { label: 'Section C', note: 'Attempt all questions' },
  D: { label: 'Section D', note: 'Attempt any / all — with internal choice' },
  E: { label: 'Section E', note: 'Case-Based — attempt all sub-parts' },
};

function totalMarks(questions) {
  return questions.reduce((s, q) => {
    const m = typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4);
    return s + m;
  }, 0);
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.readAsDataURL(file);
  });
}

// Downscale to max 1600px on longest side — keeps vision tokens manageable
function downscaleImage(dataUrl, maxPx = 1600) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      if (scale >= 1) { resolve(dataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.src = dataUrl;
  });
}

function groupBySection(questions) {
  const sections = {};
  questions.forEach((q, i) => {
    const key = q.section || '__unsectioned__';
    if (!sections[key]) sections[key] = [];
    sections[key].push({ ...q, _num: i + 1 });
  });
  return sections;
}

/* ── Printable question paper ───────────────────────────── */
function QuestionPaper({ questions, title, examType, subject }) {
  const sections = groupBySection(questions);
  // Show section headers whenever at least one question has a named section.
  // Previously "!sections['__unsectioned__']" was used, which hid all sectioned
  // questions the moment a single unsectioned question existed.
  const hasSections = Object.keys(sections).some(k => k !== '__unsectioned__');
  const tm = totalMarks(questions);

  const renderQuestion = (q, localNum) => {
    const qMarks = typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4);
    const isDescriptive = q.type === 'Short Answer' || q.type === 'Long Answer';
    const lineCount = q.type === 'Long Answer' ? 12 : q.type === 'Short Answer' ? 5 : 0;
    return (
      <div key={q.id ?? q._num} className="question-block">
        <div className="q-header">
          <span className="q-num">Q{q._num}.</span>
          <div className="q-body">
            <div className="q-text">
              <MathText text={q.question} />
            </div>
            {/* MCQ options */}
            {q.options && q.options.length > 0 && (
              <div className="options-grid">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="option-item">
                    <span className="option-letter">({OPT_LETTERS[oi]})</span>
                    <span><MathText text={opt} /></span>
                  </div>
                ))}
              </div>
            )}
            {/* Answer lines for descriptive */}
            {isDescriptive && (
              <div className="answer-lines">
                {Array.from({ length: lineCount }).map((_, li) => (
                  <div key={li} className="answer-line" />
                ))}
              </div>
            )}
          </div>
          <span className="q-marks">[{qMarks}M]</span>
        </div>
      </div>
    );
  };

  return (
    <div className="paper-page">
      {/* Header */}
      <div className="paper-header">
        <div className="paper-title">{title}</div>
        <div className="paper-meta">
          <span>{examType} · {subject}</span>
          <span>Total Marks: {tm}</span>
        </div>
        <div className="paper-instructions">
          <strong>General Instructions:</strong>
          <ul>
            <li>Read all questions carefully before answering.</li>
            <li>Write your name and roll number on your answer sheet.</li>
            <li>For MCQ: write the question number and the letter of your answer (e.g. Q1: B).</li>
            <li>For written answers: write the question number clearly before each answer.</li>
            <li>All the best!</li>
          </ul>
        </div>
      </div>

      {/* Questions */}
      {hasSections ? (
        <>
          {Object.entries(sections)
            .filter(([sec]) => sec !== '__unsectioned__')
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([sec, qs]) => (
              <div key={sec} className="section-block">
                <div className="section-header">
                  <span>{SECTION_META[sec]?.label ?? `Section ${sec}`}</span>
                  <span className="section-note">{SECTION_META[sec]?.note ?? ''}</span>
                  <span className="section-marks">{qs.reduce((s, q) => s + (typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4)), 0)} Marks</span>
                </div>
                {qs.map((q) => renderQuestion(q))}
              </div>
            ))}
          {/* Unsectioned questions at the end (if any co-exist with sectioned ones) */}
          {(sections['__unsectioned__'] ?? []).length > 0 && (
            <div className="section-block">
              {sections['__unsectioned__'].map((q) => renderQuestion(q))}
            </div>
          )}
        </>
      ) : (
        <div className="section-block">
          {(sections['__unsectioned__'] ?? []).map((q) => renderQuestion(q))}
        </div>
      )}

      <div className="paper-footer">*** End of Question Paper ***</div>
    </div>
  );
}

/* ── Upload answer sheet ─────────────────────────────────── */
function UploadPanel({ onEvaluate, loading }) {
  const [images, setImages] = useState([]);
  const [zoomed, setZoomed] = useState(null);
  const inputRef = useRef(null);

  const addFiles = async (files) => {
    const newImgs = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const raw = await fileToDataUrl(f);
      const url = await downscaleImage(raw);
      newImgs.push({ file: f, url, name: f.name });
    }
    setImages((p) => [...p, ...newImgs]);
  };

  const remove = (i) => setImages((p) => p.filter((_, j) => j !== i));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-bold text-white">Upload Your Answer Sheet</p>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Take a clear photo of each page of your handwritten answer sheet. Make sure question numbers are clearly visible.
          Multiple pages? Upload all of them.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-700 hover:border-primary-500 rounded-2xl p-8 flex flex-col items-center gap-3 cursor-pointer transition-colors bg-slate-900/40"
      >
        <div className="h-12 w-12 rounded-2xl bg-slate-800 flex items-center justify-center">
          <Camera size={22} className="text-primary-400" />
        </div>
        <p className="text-sm font-semibold text-white text-center">
          Drop photos or click to browse
        </p>
        <p className="text-xs text-slate-500">JPG, PNG — upload all pages of your answer sheet</p>
        <input ref={inputRef} type="file" multiple accept="image/*" capture="environment"
          className="hidden" onChange={(e) => addFiles(e.target.files)} />
      </div>

      {/* Thumbnails */}
      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative rounded-xl overflow-hidden border border-slate-700 bg-slate-900 group aspect-[3/4]">
              <img src={img.url} alt={`Page ${i + 1}`} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button onClick={(e) => { e.stopPropagation(); setZoomed(img.url); }}
                  className="p-1.5 bg-white/20 rounded-lg hover:bg-white/30">
                  <ZoomIn size={14} className="text-white" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); remove(i); }}
                  className="p-1.5 bg-red-500/80 rounded-lg hover:bg-red-600">
                  <Trash2 size={14} className="text-white" />
                </button>
              </div>
              <div className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                Page {i + 1}
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length > 0 && (
        <button
          onClick={() => onEvaluate(images.map((i) => i.url))}
          disabled={loading}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary-500 to-primary-700 hover:from-primary-600 hover:to-primary-800 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> AI is reading your answer sheet…</>
            : <><Star size={16} /> Evaluate Answer Sheet ({images.length} page{images.length > 1 ? 's' : ''})</>
          }
        </button>
      )}

      {/* Zoom overlay */}
      <AnimatePresence>
        {zoomed && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
            onClick={() => setZoomed(null)}
          >
            <button className="absolute top-4 right-4 text-white/80 hover:text-white">
              <X size={24} />
            </button>
            <img src={zoomed} alt="Full size" className="max-h-[90vh] max-w-[90vw] rounded-xl" onClick={(e) => e.stopPropagation()} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Per-question correction card ───────────────────────── */
function AnswerCard({ ans }) {
  const [showCorrection, setShowCorrection] = useState(false);
  const full       = ans.marks_awarded >= ans.max_marks;
  const partial    = ans.marks_awarded > 0 && !full;
  const illegible  = ans.verdict === 'illegible';
  const unattempted= ans.verdict === 'unattempted';
  const hasCorr    = ans.corrections && ans.corrections.trim().length > 0;

  const badgeCls = illegible || unattempted
    ? 'bg-slate-700 text-slate-400'
    : full    ? 'bg-emerald-900/60 text-emerald-300'
    : partial ? 'bg-amber-900/60  text-amber-300'
    :           'bg-red-900/60    text-red-300';

  const feedbackCls = illegible || unattempted
    ? 'text-slate-500 italic'
    : full    ? 'text-emerald-400'
    : partial ? 'text-amber-300'
    :           'text-red-300';

  return (
    <div className="px-5 py-3 space-y-2">
      {/* Row 1: Q badge + summary + marks */}
      <div className="flex items-start gap-3">
        <span className={`text-xs font-bold px-2 py-0.5 rounded-lg mt-0.5 shrink-0 ${badgeCls}`}>
          Q{ans.question_number}
        </span>
        <div className="flex-1 min-w-0 space-y-0.5">
          {ans.question_text && (
            <p className="text-[10px] text-slate-500 truncate">{ans.question_text}</p>
          )}
          {illegible && (
            <p className="text-[11px] text-slate-500 italic">Answer could not be read — check handwriting clarity</p>
          )}
          {unattempted && (
            <p className="text-[11px] text-slate-500 italic">Not attempted</p>
          )}
          {!illegible && !unattempted && ans.student_answer_read && (
            <p className="text-[11px] text-slate-400 leading-relaxed">
              <span className="text-slate-600 font-semibold">Student: </span>
              {ans.student_answer_read}
            </p>
          )}
          <p className={`text-[11px] leading-relaxed ${feedbackCls}`}>{ans.feedback}</p>
          {ans.misconception && !full && !illegible && !unattempted && (
            <p className="text-[10px] text-violet-400 leading-relaxed">
              <span className="font-semibold">Concept gap: </span>{ans.misconception}
            </p>
          )}
        </div>
        <div className="text-right shrink-0">
          <span className={`text-sm font-extrabold ${
            illegible || unattempted ? 'text-slate-500'
            : full    ? 'text-emerald-400'
            : partial ? 'text-amber-400'
            :           'text-red-400'
          }`}>
            {ans.marks_awarded}
          </span>
          <span className="text-[10px] text-slate-600">/{ans.max_marks}</span>
          {full    && <CheckCircle2 size={12} className="text-emerald-400 ml-1 inline" />}
          {!full && ans.marks_awarded === 0 && !illegible && !unattempted && <XCircle size={12} className="text-red-400 ml-1 inline" />}
        </div>
      </div>

      {/* Row 2: Corrections toggle */}
      {hasCorr && (
        <div className="ml-8">
          <button
            onClick={() => setShowCorrection((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-semibold text-violet-400 hover:text-violet-300 transition-colors"
          >
            <Pencil size={10} />
            {showCorrection ? 'Hide corrections' : 'Show step corrections'}
            {showCorrection ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
          </button>
          <AnimatePresence>
            {showCorrection && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }} className="overflow-hidden"
              >
                <div className="mt-2 bg-slate-900/70 border border-violet-800/30 rounded-xl px-4 py-3">
                  <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-2">Step-by-step Correction</p>
                  <pre className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap font-sans">{ans.corrections}</pre>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ── Results display ─────────────────────────────────────── */
function ResultsPanel({ result }) {
  const pct = result.total_possible > 0
    ? Math.round((result.total_awarded / result.total_possible) * 100) : 0;
  const grade = pct >= 90 ? { label: 'Outstanding!', color: 'text-emerald-400', bg: 'from-emerald-900/30 to-teal-900/30' }
    : pct >= 75 ? { label: 'Excellent!',    color: 'text-emerald-400', bg: 'from-emerald-900/20 to-slate-900' }
    : pct >= 50 ? { label: 'Good job.',     color: 'text-amber-400',   bg: 'from-amber-900/20  to-slate-900' }
    : pct >= 33 ? { label: 'Needs work.',   color: 'text-orange-400',  bg: 'from-orange-900/20 to-slate-900' }
    :             { label: 'Needs revision.',color: 'text-red-400',     bg: 'from-red-900/20    to-slate-900' };

  const corrCount = (result.answers ?? []).filter((a) => a.corrections?.trim()).length;

  return (
    <div className="space-y-4">
      {/* Score card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
        className={`bg-gradient-to-br ${grade.bg} border border-white/10 rounded-2xl p-6 text-center space-y-3`}
      >
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">AI Evaluation Complete</p>
        <div className="flex items-center justify-center gap-2">
          <span className={`text-6xl font-extrabold tabular-nums ${grade.color}`}>{result.total_awarded}</span>
          <span className="text-3xl text-slate-600 font-bold">/ {result.total_possible}</span>
        </div>
        <p className={`text-base font-bold ${grade.color}`}>{pct}% — {grade.label}</p>
        {result.paper_title && (
          <p className="text-[11px] text-slate-500">{result.paper_title}</p>
        )}
        {result.overall_feedback && (
          <p className="text-xs text-slate-400 leading-relaxed max-w-md mx-auto">{result.overall_feedback}</p>
        )}
        {corrCount > 0 && (
          <p className="text-[11px] text-violet-400">
            {corrCount} question{corrCount > 1 ? 's' : ''} have step-by-step corrections below ↓
          </p>
        )}
      </motion.div>

      {/* Per-question breakdown */}
      <div className="bg-slate-800 border border-white/5 rounded-2xl overflow-hidden divide-y divide-white/5">
        <div className="px-5 py-3 flex items-center justify-between">
          <p className="text-sm font-bold text-white">Question-wise Results &amp; Corrections</p>
          <span className="text-[10px] text-slate-500">{(result.answers ?? []).length} questions</span>
        </div>
        {(result.answers ?? []).map((ans, i) => (
          <AnswerCard key={i} ans={ans} />
        ))}
      </div>
    </div>
  );
}

/* ── AI evaluation ───────────────────────────────────────── */
async function evaluateAnswerSheet(questions, imageDataUrls) {
  const qList = questions.map((q, i) => {
    const marks = typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4);
    const correctAns = q.type === 'MCQ' && q.options
      ? `${OPT_LETTERS[q.correctOption] ?? '?'}. ${q.options[q.correctOption] ?? ''}`
      : (q.correctAnswer ?? q.explanation ?? '(model answer — evaluate for completeness)');
    const opts = q.options?.length
      ? `\n   Options: ${q.options.map((o, oi) => `${OPT_LETTERS[oi]}. ${o}`).join(' | ')}`
      : '';
    return `Q${i + 1} [${marks} marks, ${q.type ?? 'MCQ'}]: ${q.question}${opts}\n   Correct answer: ${correctAns}`;
  }).join('\n\n');

  const totalPossible = totalMarks(questions);

  const textContent = `You are an experienced examiner evaluating a student's handwritten answer sheet.

QUESTION PAPER (${questions.length} questions, ${totalPossible} marks total):
${qList}

INSTRUCTIONS FOR EVALUATION:
- The student's handwritten answer sheet is in the attached image(s).
- For MCQ: check if the student circled or wrote the correct option letter.
- For Short Answer (2–3 marks): award marks based on key points covered.
- For Long Answer (5 marks): award marks based on completeness, accuracy, and structure.
- If a question is not attempted, set verdict to "unattempted", marks_awarded to 0.
- If the answer is not legible / cannot be read, set verdict to "illegible", marks_awarded to 0.
- Otherwise set verdict to "correct", "partial", or "wrong" based on marks awarded vs max.
- For wrong or partial answers, set misconception to the core concept the student misunderstood (one concise phrase). For correct/illegible/unattempted, set it to "".
- For every question where the student made any error OR showed working steps, populate "corrections" with a clear step-by-step correction using ✓/✗ per step and a model answer at the end. Set to "" if fully correct.
- Identify which image page each answer is on (page: 1-indexed) and its vertical position (y_position: 0.0=top, 1.0=bottom).

Return ONLY valid JSON:
{
  "total_awarded": <number>,
  "total_possible": ${totalPossible},
  "overall_feedback": "<2–3 sentence summary of performance and key areas to improve>",
  "answers": [
    {
      "question_number": 1,
      "page": 1,
      "y_position": 0.25,
      "student_answer_read": "<what you read from the image, max 80 chars>",
      "marks_awarded": <number>,
      "max_marks": <number>,
      "verdict": "<correct | partial | wrong | illegible | unattempted>",
      "misconception": "<core concept misunderstood, or empty string>",
      "feedback": "<one line: Correct / Partially correct: missing X / Incorrect: expected Y>",
      "corrections": "<step-by-step correction with ✓/✗ per step and model answer, or empty string if fully correct>"
    }
  ]
}`;

  const imageMessages = imageDataUrls.map((url) => ({
    type: 'image_url',
    image_url: { url, detail: 'high' },
  }));

  const resp = await chatComplete({
    model:           'gpt-4o',
    max_tokens:      4000,
    temperature:     0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a strict but fair examiner. Evaluate handwritten answer sheets accurately. Return only valid JSON.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: textContent },
          ...imageMessages,
        ],
      },
    ],
  });

  return JSON.parse(resp.choices[0].message.content);
}

/* ── Image drop zone helper ─────────────────────────────── */
function ImageDropZone({ label, hint, images, setImages }) {
  const ref = useRef(null);
  const addFiles = async (files) => {
    const added = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith('image/')) continue;
      const raw = await fileToDataUrl(f);
      const url = await downscaleImage(raw);
      added.push({ url, name: f.name });
    }
    setImages((p) => [...p, ...added]);
  };
  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-white">{label}</p>
      <p className="text-[11px] text-slate-400">{hint}</p>
      <div
        onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => ref.current?.click()}
        className="border-2 border-dashed border-slate-700 hover:border-primary-500 rounded-xl p-5 flex flex-col items-center gap-2 cursor-pointer transition-colors"
      >
        <Camera size={18} className="text-primary-400" />
        <p className="text-xs text-slate-400 text-center">Drop or tap to add pages</p>
        <input ref={ref} type="file" multiple accept="image/*" capture="environment"
          className="hidden" onChange={(e) => addFiles(e.target.files)} />
      </div>
      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {images.map((img, i) => (
            <div key={i} className="relative w-16 h-20 rounded-lg overflow-hidden border border-slate-600 group">
              <img src={img.url} alt={`p${i+1}`} className="w-full h-full object-cover" />
              <button
                onClick={(e) => { e.stopPropagation(); setImages((p) => p.filter((_, j) => j !== i)); }}
                className="absolute top-0.5 right-0.5 bg-red-600/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={8} className="text-white" />
              </button>
              <span className="absolute bottom-0.5 left-0.5 text-[8px] bg-black/60 text-white px-1 rounded">p{i+1}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Standalone grading panel (upload ANY paper) ─────────── */
function SelfEvalPanel({ onEvaluate, loading }) {
  const [qImages, setQImages] = useState([]);
  const [aImages, setAImages] = useState([]);
  const ready = qImages.length > 0 && aImages.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 bg-violet-900/20 border border-violet-700/30 rounded-xl px-4 py-3">
        <ScanSearch size={13} className="text-violet-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-violet-300 leading-relaxed">
          Upload any printed question paper + your handwritten answer sheet. AI will read both, extract every question, grade your answers, and show step-by-step corrections.
        </p>
      </div>

      <ImageDropZone
        label="Question Paper"
        hint="Photos of the printed question paper (all pages)"
        images={qImages}
        setImages={setQImages}
      />
      <ImageDropZone
        label="Your Answer Sheet"
        hint="Photos of your handwritten answers (all pages)"
        images={aImages}
        setImages={setAImages}
      />

      {ready && (
        <button
          onClick={() => onEvaluate(qImages.map((i) => i.url), aImages.map((i) => i.url))}
          disabled={loading}
          className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary-700 to-primary-500 hover:from-primary-800 hover:to-primary-600 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all"
        >
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> AI is reading your paper…</>
            : <><ScanSearch size={16} /> Grade My Paper</>}
        </button>
      )}
    </div>
  );
}

/* ── Standalone evaluator — AI extracts questions + grades answers ── */
async function evaluateFromImages(questionImageUrls, answerImageUrls) {
  const qImgMsgs = questionImageUrls.map((url) => ({ type: 'image_url', image_url: { url, detail: 'high' } }));
  const aImgMsgs = answerImageUrls.map((url)  => ({ type: 'image_url', image_url: { url, detail: 'high' } }));

  const resp = await chatComplete({
    model:           'gpt-4o',
    max_tokens:      6000,
    temperature:     0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a strict examiner. Extract questions from the question paper and grade the student\'s handwritten answers. Return only valid JSON.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: `You will receive two sets of images:
1. QUESTION PAPER — one or more pages showing the printed questions, marks per question, and correct answers (if an answer key is shown).
2. ANSWER SHEET — one or more pages of the student's handwritten answers.

TASK:
a) Read every question from the question paper. Note the marks allocated.
b) Read the student's answer for each question from the answer sheet.
c) Award marks fairly (partial marks for partially correct working).
d) Set verdict: "correct" (full marks), "partial" (some marks), "wrong" (0 marks with attempt), "illegible" (can't read), or "unattempted" (blank).
e) For wrong/partial answers, set misconception to the core concept misunderstood (one phrase). For others set to "".
f) For wrong/partial: provide step-by-step corrections using ✓/✗ per step with a model answer at the end. Set corrections to "" if fully correct.

For each answer, note which answer sheet page it is on (page: 1-indexed) and its vertical position (y_position: 0.0=top, 1.0=bottom).

Return this exact JSON:
{
  "paper_title": "<detected exam name or 'Question Paper'>",
  "total_awarded": <number>,
  "total_possible": <number>,
  "overall_feedback": "<2-3 sentences on performance and areas to improve>",
  "answers": [
    {
      "question_number": <number>,
      "page": <integer, 1-indexed answer sheet page>,
      "y_position": <float 0.0-1.0>,
      "question_text": "<first 60 chars of the question>",
      "max_marks": <number>,
      "student_answer_read": "<what student wrote, max 80 chars>",
      "marks_awarded": <number>,
      "verdict": "<correct | partial | wrong | illegible | unattempted>",
      "misconception": "<core concept misunderstood, or empty string>",
      "feedback": "<one line verdict>",
      "corrections": "<step-by-step correction with ✓/✗ per step and model answer, or empty string if fully correct>"
    }
  ]
}` },
          ...qImgMsgs,
          { type: 'text', text: '--- ANSWER SHEET BELOW ---' },
          ...aImgMsgs,
        ],
      },
    ],
  });

  return JSON.parse(resp.choices[0].message.content);
}

/* ── Canvas: draw marks on the uploaded answer sheet ─────── */
function AnnotatedCanvas({ imageUrl, pageAnnotations }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !imageUrl) return;
    const img = new window.Image();
    img.onload = () => {
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      canvas.width  = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const fs  = Math.max(22, Math.round(W * 0.026));
      const sfs = Math.max(15, Math.round(W * 0.018));

      pageAnnotations.forEach((ann) => {
        const y   = Math.round((ann.y_position ?? 0.5) * H);
        const ok  = ann.marks_awarded >= ann.max_marks;
        const partial = ann.marks_awarded > 0 && !ok;
        const score   = `${ann.marks_awarded}/${ann.max_marks}`;

        /* Badge background */
        const rx = W * 0.875;
        ctx.font = `bold ${fs}px Arial`;
        const tw = ctx.measureText(score).width;
        const bw = tw + 18, bh = fs + 14;
        const bx = rx - 9,  by = y - fs - 7;

        ctx.fillStyle   = ok ? '#dcfce7' : partial ? '#fef3c7' : '#fee2e2';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = ok ? '#16a34a' : partial ? '#d97706' : '#dc2626';
        ctx.lineWidth   = Math.max(2, Math.round(W * 0.003));
        ctx.strokeRect(bx, by, bw, bh);

        /* Score text */
        ctx.fillStyle = ok ? '#166534' : partial ? '#92400e' : '#991b1b';
        ctx.fillText(score, rx, y);

        /* Q-number label above badge */
        ctx.font      = `bold ${sfs}px Arial`;
        ctx.fillStyle = '#374151';
        ctx.fillText(`Q${ann.question_number}`, bx, by - 4);

        /* Feedback on wrong/partial — drawn at left margin */
        if (!ok && ann.feedback) {
          ctx.font      = `${sfs}px Arial`;
          ctx.fillStyle = '#dc2626';
          const maxW  = W * 0.54;
          const words = ann.feedback.split(' ');
          let line = '';
          const lines = [];
          words.forEach((w) => {
            const test = line ? `${line} ${w}` : w;
            if (ctx.measureText(test).width > maxW) { lines.push(line); line = w; }
            else line = test;
          });
          if (line) lines.push(line);
          lines.slice(0, 2).forEach((l, li) => {
            ctx.fillText(l, W * 0.04, y - (lines.length - 1 - li) * (sfs + 4));
          });
        }
      });
    };
    img.src = imageUrl;
  }, [imageUrl, pageAnnotations]);

  return (
    <div className="rounded-xl overflow-hidden border border-white/10 bg-slate-900">
      <canvas ref={ref} style={{ width: '100%', display: 'block' }} />
    </div>
  );
}

/* ── Physical-style evaluation cover ──────────────────────── */
function EvaluatedCover({ result }) {
  const pct = result.total_possible > 0
    ? Math.round((result.total_awarded / result.total_possible) * 100) : 0;

  return (
    <div className="bg-white text-slate-900 rounded-2xl p-5 shadow-2xl font-serif space-y-4">
      {/* Stamp */}
      <div className="flex justify-center">
        <div style={{ transform: 'rotate(-3deg)' }}
          className="inline-flex items-center px-5 py-2 border-[3px] border-red-600 rounded">
          <span className="text-3xl font-black text-red-600 tracking-[0.12em] uppercase">Evaluated</span>
        </div>
      </div>

      {/* Score */}
      <div className="text-center space-y-0.5">
        <p className="text-2xl font-extrabold text-red-700">
          Total Score: {result.total_awarded}/{result.total_possible}
        </p>
        <p className="text-sm text-slate-500">{pct}%</p>
        {result.paper_title && (
          <p className="text-[11px] text-slate-400 mt-1">{result.paper_title}</p>
        )}
      </div>

      {/* Remarks */}
      {result.overall_feedback && (
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
          <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1">Remarks:</p>
          <p className="text-xs text-red-700 italic leading-relaxed">{result.overall_feedback}</p>
        </div>
      )}

      {/* Marks table */}
      <div className="overflow-x-auto">
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              {['Q. No.', 'Awarded', 'Max'].map((h) => (
                <th key={h} style={{ border: '1px solid #94a3b8', padding: '5px 8px',
                  textAlign: h === 'Q. No.' ? 'left' : 'center' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(result.answers ?? []).map((ans) => {
              const ok = ans.marks_awarded >= ans.max_marks;
              return (
                <tr key={ans.question_number} style={{ background: ok ? 'transparent' : '#fff1f2' }}>
                  <td style={{ border: '1px solid #94a3b8', padding: '4px 8px' }}>Q.{ans.question_number}</td>
                  <td style={{ border: '1px solid #94a3b8', padding: '4px 8px', textAlign: 'center',
                    fontWeight: 700, color: ok ? '#166534' : '#991b1b' }}>{ans.marks_awarded}</td>
                  <td style={{ border: '1px solid #94a3b8', padding: '4px 8px', textAlign: 'center' }}>{ans.max_marks}</td>
                </tr>
              );
            })}
            <tr style={{ background: '#f1f5f9', fontWeight: 700 }}>
              <td style={{ border: '1px solid #94a3b8', padding: '5px 8px' }}>Total</td>
              <td style={{ border: '1px solid #94a3b8', padding: '5px 8px', textAlign: 'center', color: '#991b1b' }}>
                {result.total_awarded}
              </td>
              <td style={{ border: '1px solid #94a3b8', padding: '5px 8px', textAlign: 'center' }}>
                {result.total_possible}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Full evaluated paper view ─────────────────────────────── */
function EvaluatedPaperView({ result, answerImages }) {
  const [showDetail, setShowDetail] = useState(false);

  const byPage = {};
  (result.answers ?? []).forEach((ans) => {
    const pg = Math.max(0, (ans.page ?? 1) - 1);
    if (!byPage[pg]) byPage[pg] = [];
    byPage[pg].push(ans);
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <EvaluatedCover result={result} />

        <div className="space-y-3">
          {answerImages.length > 0 ? (
            answerImages.map((url, i) => (
              <div key={i}>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1.5">
                  Answer Sheet · Page {i + 1}
                </p>
                <AnnotatedCanvas imageUrl={url} pageAnnotations={byPage[i] ?? []} />
              </div>
            ))
          ) : (
            <div className="bg-slate-800 border border-white/5 rounded-2xl p-8 text-center text-slate-400 text-sm">
              Answer sheet images not available
            </div>
          )}
        </div>
      </div>

      <button
        onClick={() => setShowDetail((v) => !v)}
        className="w-full py-2.5 rounded-xl border border-white/10 text-slate-400 text-xs font-semibold hover:border-white/20 hover:text-white transition-colors flex items-center justify-center gap-2"
      >
        {showDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showDetail ? 'Hide' : 'Show'} Detailed Question-wise Corrections
      </button>

      {showDetail && <ResultsPanel result={result} />}
    </div>
  );
}

/* ── Print styles injected into head ─────────────────────── */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .paper-print-area, .paper-print-area * { visibility: visible !important; }
  .paper-print-area { position: fixed; inset: 0; background: white; padding: 24px; }
  .no-print { display: none !important; }
}
.paper-page { font-family: 'Times New Roman', serif; color: #111; background: white; padding: 24px 28px; max-width: 800px; }
.paper-header { border-bottom: 3px double #111; padding-bottom: 12px; margin-bottom: 20px; text-align: center; }
.paper-title { font-size: 18px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
.paper-meta { display: flex; justify-content: space-between; font-size: 12px; margin-top: 6px; }
.paper-instructions { font-size: 11px; margin-top: 10px; text-align: left; }
.paper-instructions ul { margin: 4px 0 0 16px; }
.paper-instructions li { margin-bottom: 2px; }
.section-block { margin-bottom: 18px; }
.section-header { background: #f0f0f0; border: 1px solid #ccc; padding: 6px 12px; font-weight: 700; font-size: 12px; display: flex; justify-content: space-between; margin-bottom: 10px; }
.section-note { font-weight: 400; font-style: italic; }
.question-block { margin-bottom: 14px; page-break-inside: avoid; }
.q-header { display: flex; align-items: flex-start; gap: 8px; }
.q-num { font-weight: 700; font-size: 13px; min-width: 28px; shrink: 0; }
.q-body { flex: 1; font-size: 13px; line-height: 1.6; }
.q-text { margin-bottom: 6px; }
.q-marks { font-size: 11px; font-weight: 700; color: #444; white-space: nowrap; shrink: 0; }
.options-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 16px; margin-top: 4px; margin-left: 8px; }
.option-item { display: flex; gap: 6px; font-size: 12px; }
.option-letter { font-weight: 600; color: #555; }
.answer-lines { margin-top: 8px; }
.answer-line { border-bottom: 1px solid #bbb; margin-bottom: 12px; height: 0; }
.paper-footer { text-align: center; font-size: 11px; color: #666; margin-top: 24px; padding-top: 12px; border-top: 1px solid #ccc; }
`;

/* ── Main page ───────────────────────────────────────────── */
export default function PaperModePage() {
  const [searchParams] = useSearchParams();
  const location       = useLocation();
  const navigate       = useNavigate();
  const { currentUser, userProfile, isPremium } = useAuth();

  const testId = searchParams.get('id');

  const [questions,   setQuestions]  = useState([]);
  const [title,       setTitle]      = useState('');
  const [examType,    setExamType]   = useState('');
  const [subject,     setSubject]    = useState('');
  const [loadingTest, setLoadingTest]= useState(true);
  const [phase,       setPhase]      = useState('paper'); // paper | upload | evaluating | results | selfeval | selfevaluating
  const [evalResult,   setEvalResult]  = useState(null);
  const [evalError,    setEvalError]   = useState('');
  const [mainAImages,  setMainAImages] = useState([]);
  const [selfResult,   setSelfResult]  = useState(null);
  const [selfError,    setSelfError]   = useState('');
  const [selfAImages,  setSelfAImages] = useState([]);
  const [showPaywall,  setShowPaywall] = useState(false);
  const printAreaRef = useRef(null);

  // Inject print CSS once
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = PRINT_CSS;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  // Load questions from published test OR location state
  useEffect(() => {
    const stateQs = location.state?.questions;
    if (stateQs?.length) {
      setQuestions(stateQs);
      setTitle(location.state?.title ?? 'Practice Paper');
      setExamType(location.state?.examType ?? '');
      setSubject(location.state?.subject ?? '');
      setLoadingTest(false);
      return;
    }
    if (testId) {
      getPublishedTest(testId).then((test) => {
        if (test) {
          setQuestions(test.questions ?? []);
          setTitle(test.title ?? 'Question Paper');
          setExamType(test.exam_type ?? '');
          setSubject(test.subject ?? '');
        }
        setLoadingTest(false);
      });
    } else {
      setLoadingTest(false);
    }
  }, [testId]);

  const handleEvaluate = async (imageUrls) => {
    if (!imageUrls.length || !questions.length) return;

    // Quota gate — checked before changing phase so error shows in upload panel
    if (currentUser) {
      const quota = await checkQuota(currentUser.uid, 'paper_evaluations_used', isPremium);
      if (!quota.allowed) {
        setShowPaywall(true);
        return;
      }
    }

    setMainAImages(imageUrls);
    setPhase('evaluating');
    setEvalError('');
    try {
      const result = await evaluateAnswerSheet(questions, imageUrls);
      setEvalResult(result);
      setPhase('results');

      if (currentUser) {
        // Count quota
        incrementQuota(currentUser.uid, 'paper_evaluations_used').catch(() => {});

        // Analytics session
        saveTestSession(currentUser.uid, {
          test_name:      `Paper Mode: ${title}`,
          score:          result.total_awarded ?? 0,
          total_marks:    result.total_possible ?? totalMarks(questions),
          correct:        result.answers?.filter((a) => a.marks_awarded >= a.max_marks).length ?? 0,
          wrong:          result.answers?.filter((a) => a.marks_awarded === 0 && a.verdict !== 'unattempted' && a.verdict !== 'illegible').length ?? 0,
          skipped:        result.answers?.filter((a) => a.verdict === 'unattempted').length ?? 0,
          question_count: questions.length,
          source:         'paper_mode',
          exam_type:      userProfile?.target_exam || null,
        }).catch(() => {});

        // In-app notification
        createNotification(
          currentUser.uid,
          'test_complete',
          `Paper evaluated: ${title}`,
          `Score: ${result.total_awarded}/${result.total_possible} · AI-evaluated answer sheet`,
          '/analytics',
        ).catch(() => {});

        // Award XP
        awardXP(currentUser.uid, 'paper_mode_complete').catch(() => {});

        // Sync wrong/partial answers to Error Notebook + weak topics
        const adaptedQs      = [];
        const adaptedAnswers = {};
        const seenQNums      = new Set();
        result.answers?.forEach((ans) => {
          // The AI returns question_number as a bare index with no other identifying
          // field to cross-check against — validate it's a genuine in-range integer
          // and not a duplicate/hallucinated value before trusting it to index into
          // our own questions array (a wrong-but-in-range number would otherwise
          // silently misattribute the answer to a different real question).
          const qNum = Number(ans.question_number);
          if (!Number.isInteger(qNum) || qNum < 1 || qNum > questions.length || seenQNums.has(qNum)) return;
          seenQNums.add(qNum);
          const q = questions[qNum - 1];
          if (!q?.id || ans.verdict === 'illegible' || ans.verdict === 'unattempted') return;
          adaptedQs.push(q);
          if (ans.marks_awarded < ans.max_marks) {
            // Wrong or partial — any non-matching value marks it wrong in the notebook
            adaptedAnswers[q.id] = ans.student_answer_read || '__paper_wrong__';
          } else {
            // Correct — pass the correct answer value so saveWrongAnswers skips it
            adaptedAnswers[q.id] = q.correctOption ?? q.correctAnswer;
          }
        });
        if (adaptedQs.length > 0) {
          saveWrongAnswers(currentUser.uid, adaptedQs, adaptedAnswers, 'paper_mode', title).catch(() => {});
        }
      }
    } catch (e) {
      setEvalError(e.message || 'Evaluation failed — try uploading a clearer image.');
      setPhase('upload');
    }
  };

  const handleSelfEval = async (questionImageUrls, answerImageUrls) => {
    // Quota gate — same AI-vision evaluation cost as handleEvaluate, so it
    // shares the paper_evaluations_used bucket rather than going unmetered.
    if (currentUser) {
      const quota = await checkQuota(currentUser.uid, 'paper_evaluations_used', isPremium);
      if (!quota.allowed) {
        setShowPaywall(true);
        return;
      }
    }

    setSelfAImages(answerImageUrls);
    setPhase('selfevaluating');
    setSelfError('');
    try {
      const result = await evaluateFromImages(questionImageUrls, answerImageUrls);
      setSelfResult(result);
      setPhase('selfresults');
      if (currentUser) {
        incrementQuota(currentUser.uid, 'paper_evaluations_used').catch(() => {});

        saveTestSession(currentUser.uid, {
          test_name:      `Self-Graded Paper: ${result.paper_title ?? 'Uploaded Paper'}`,
          score:          result.total_awarded ?? 0,
          total_marks:    result.total_possible ?? 0,
          correct:        result.answers?.filter((a) => a.marks_awarded >= a.max_marks).length ?? 0,
          wrong:          result.answers?.filter((a) => a.marks_awarded === 0 && a.verdict !== 'unattempted' && a.verdict !== 'illegible').length ?? 0,
          skipped:        result.answers?.filter((a) => a.verdict === 'unattempted').length ?? 0,
          question_count: result.answers?.length ?? 0,
          source:         'paper_mode',
          exam_type:      userProfile?.target_exam || null,
        }).catch(() => {});
      }
    } catch (e) {
      setSelfError(e.message || 'Evaluation failed — try clearer images.');
      setPhase('selfeval');
    }
  };

  if (loadingTest) {
    return (
      <div className="flex items-center justify-center min-h-[50vh] gap-2 text-slate-400 text-sm">
        <Loader2 size={16} className="animate-spin" /> Loading question paper…
      </div>
    );
  }

  const hasQuestions = questions.length > 0;

  // No pre-loaded questions → jump straight to standalone grader
  if (!hasQuestions && phase === 'paper') { setPhase('selfeval'); }

  return (
    <div className="max-w-5xl space-y-5">
      {/* Top bar */}
      <div className="flex items-center gap-3 flex-wrap no-print">
        <button onClick={() => navigate(-1)}
          className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{title}</h1>
          <p className="text-xs text-slate-400 mt-0.5">{questions.length} questions · {totalMarks(questions)} marks · {examType} {subject}</p>
        </div>
        {/* Phase tabs */}
        <div className="flex gap-1 bg-slate-800 rounded-xl p-1 flex-wrap">
          {[
            { id: 'paper',       label: 'Question Paper',    icon: <BookOpen size={12} />,   hide: !hasQuestions },
            { id: 'upload',      label: 'Upload Answers',    icon: <Upload size={12} />,     hide: !hasQuestions },
            { id: 'results',     label: 'Results',           icon: <Star size={12} />,       hide: !hasQuestions, disabled: !evalResult },
            { id: 'selfeval',    label: 'Grade Any Paper',   icon: <ScanSearch size={12} /> },
            { id: 'selfresults', label: 'Grade Results',     icon: <RefreshCw size={12} />,  disabled: !selfResult },
          ].filter((t) => !t.hide).map(({ id, label, icon, disabled }) => (
            <button key={id}
              disabled={disabled}
              onClick={() => !disabled && setPhase(id)}
              className={[
                'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors',
                (phase === id || (phase === 'selfevaluating' && id === 'selfeval'))
                  ? 'bg-primary-600 text-white'
                  : disabled ? 'text-slate-600 cursor-not-allowed'
                  : 'text-slate-400 hover:text-white',
              ].join(' ')}
            >
              {icon} {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Paper view ── */}
      {phase === 'paper' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap no-print">
            <div className="flex items-start gap-2 flex-1 bg-blue-900/20 border border-blue-700/30 rounded-xl px-4 py-3">
              <BookOpen size={13} className="text-blue-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-300 leading-relaxed">
                <strong>Paper Mode:</strong> Print the paper or view it on screen. Write each answer on <em>your own plain paper</em> — number every answer clearly (e.g. Q1: B · Q5: Chlorophyll is…). Photograph all pages under good light, then click <strong>Upload Answers</strong>. AI reads your handwriting and grades every question instantly.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold transition-colors no-print"
                title="Print question paper"
              >
                <Printer size={14} /> Print
              </button>
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2.5 bg-slate-700 hover:bg-slate-600 text-white rounded-xl text-sm font-semibold transition-colors no-print"
                title="Save as PDF — select 'Save as PDF' in the print dialog"
              >
                <Download size={14} /> Download PDF
              </button>
            </div>
          </div>

          {/* Printable area */}
          <div ref={printAreaRef} className="paper-print-area bg-white rounded-2xl overflow-hidden shadow-lg">
            <QuestionPaper questions={questions} title={title} examType={examType} subject={subject} />
          </div>

          <button
            onClick={() => setPhase('upload')}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-primary-500 to-primary-700 hover:from-primary-600 hover:to-primary-800 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all no-print"
          >
            <Camera size={16} /> I've Written My Answers — Upload Answer Sheet
          </button>
        </motion.div>
      )}

      {/* ── Upload phase ── */}
      {(phase === 'upload' || phase === 'evaluating') && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-slate-800 border border-white/5 rounded-2xl p-6"
        >
          {evalError && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 mb-4 text-xs text-red-300">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {evalError}
            </div>
          )}
          <UploadPanel onEvaluate={handleEvaluate} loading={phase === 'evaluating'} />
        </motion.div>
      )}

      {/* ── Results (pre-loaded questions) ── */}
      {phase === 'results' && evalResult && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <EvaluatedPaperView result={evalResult} answerImages={mainAImages} />
          <div className="flex gap-3 flex-wrap">
            <button onClick={() => setPhase('paper')}
              className="flex-1 py-3 rounded-2xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm flex items-center justify-center gap-1.5 transition-colors">
              <BookOpen size={14} /> View Paper
            </button>
            <button onClick={() => { setPhase('upload'); setEvalResult(null); setEvalError(''); setMainAImages([]); }}
              className="flex-1 py-3 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-colors">
              <Camera size={14} /> Re-submit Answer Sheet
            </button>
          </div>
        </motion.div>
      )}

      {/* ── Standalone grader ── */}
      {(phase === 'selfeval' || phase === 'selfevaluating') && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-slate-800 border border-white/5 rounded-2xl p-6"
        >
          {selfError && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 mb-4 text-xs text-red-300">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {selfError}
            </div>
          )}
          <SelfEvalPanel onEvaluate={handleSelfEval} loading={phase === 'selfevaluating'} />
        </motion.div>
      )}

      {/* ── Standalone results ── */}
      {phase === 'selfresults' && selfResult && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
          <EvaluatedPaperView result={selfResult} answerImages={selfAImages} />
          <button onClick={() => { setPhase('selfeval'); setSelfResult(null); setSelfError(''); setSelfAImages([]); }}
            className="w-full py-3 rounded-2xl bg-violet-600 hover:bg-violet-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 transition-colors">
            <ScanSearch size={14} /> Grade Another Paper
          </button>
        </motion.div>
      )}

      {showPaywall && (
        <PaywallModal
          onClose={() => setShowPaywall(false)}
          feature="AI answer-sheet evaluation"
          firebaseUid={currentUser?.uid}
          email={currentUser?.email}
          name={userProfile?.display_name}
        />
      )}
    </div>
  );
}
