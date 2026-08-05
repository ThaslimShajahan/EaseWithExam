import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Sparkles, Loader2, CheckCircle2, XCircle,
  RotateCcw, Trophy, BookOpen, ChevronDown, ChevronUp, FileText,
  AlertTriangle, Lightbulb, TrendingUp, Zap, Star, FlaskConical,
  Sigma, BookMarked, Atom, Brain, Printer,
} from 'lucide-react';
import { generateQuestionPaper, toEngineFormat, generateChapterNotes } from '../lib/questionGen';
import { saveTestSession, supabase } from '../lib/supabase';
import { getChapters } from '../lib/syllabus';
import { useAuth } from '../context/AuthContext';
import { checkQuota, incrementQuota } from '../lib/quota';
import { awardXP } from '../lib/gamification';
import { createNotification } from '../lib/notifications';
import MathText from '../components/ui/MathText';
import PaywallModal from '../components/ui/PaywallModal';
import { getSubjectsForExam, normalizeExamType, buildExamType, EXAM_TYPE_GROUPS, BOARDS, CLASS_LEVELS, EXAM_TAG_RE, examTypeToTag } from '../lib/categories';
import { useSyllabusSubjects } from '../hooks/useSyllabusSubjects';
import { getFeatureFlag, FLAGS } from '../lib/featureFlags';
import { saveWrongAnswers, saveCorrectAnswers } from '../lib/errorNotebook';

/* ── Config ──────────────────────────────────────────────── */
const DIFFS       = ['Easy', 'Medium', 'Hard', 'Mixed'];
const COUNTS      = [5, 10, 20, 30, 45, 90];

// Board / school exam detection — covers both "CBSE" and "CBSE Class 8" formats
const isSchoolExam = (et) =>
  !et || /^(CBSE|ICSE|State Board|Kerala State|Kerala_State)(\s+Class\s+\d+)?$/.test(et) ||
  /^Class\s+\d+$/i.test(et);

const Q_TYPE_OPTIONS_COMPETITIVE = [
  { id: 'MCQ',                 label: 'MCQ',    desc: 'Single correct, 4 options'    },
  { id: 'Assertion-Reason',    label: 'A/R',    desc: 'Classic A/R format'           },
  { id: 'Numerical',           label: 'Numerical', desc: 'Integer / decimal answer'  },
  { id: 'Match the Following', label: 'Match',  desc: 'Column I ↔ Column II'         },
];
const Q_TYPE_OPTIONS_SCHOOL = [
  { id: 'MCQ',          label: 'MCQ (1m)',         desc: 'Section A — 1 mark'         },
  { id: 'Short Answer', label: 'Short Ans (2–3m)',  desc: 'Section B/C — written'      },
  { id: 'Long Answer',  label: 'Long Ans (5m)',     desc: 'Section D — detailed answer' },
];
const OPT_LETTERS = ['A', 'B', 'C', 'D'];

const SUBJECT_ICONS = {
  Physics:     <Atom size={14} />,
  Chemistry:   <FlaskConical size={14} />,
  Biology:     <Brain size={14} />,
  Mathematics: <Sigma size={14} />,
  Mixed:       <Sparkles size={14} />,
};

// Pass exam type directly — DB stores 'CBSE Class 8', 'NEET', 'JEE Main' etc. as-is
function toSyllabusExamType(examType) { return examType; }

/* ── Chip ─────────────────────────────────────────────────── */
function Chip({ label, selected, onClick, icon }) {
  return (
    <button onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all',
        selected
          ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
          : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300 hover:text-primary-700',
      ].join(' ')}>
      {icon && <span className="opacity-70">{icon}</span>}
      {label}
    </button>
  );
}

/* ── Chapter browser ─────────────────────────────────────────
 * Merges the official syllabus (Admin > Syllabus) with chapters/topics seen in
 * actually-uploaded PYQs and knowledge-base notes into ONE list, scoped tightly
 * to the current examType (which already encodes the student's own class/board
 * when locked) + subject — was previously two separate "browse chapters"
 * affordances, and the uploaded-content one had no class filter on its
 * knowledge_base query at all, leaking other classes' topics into the list. */
function ChapterBrowser({ examType, classLevel, subject, onSelect }) {
  const [open,     setOpen]     = useState(false);
  const [chapters, setChapters] = useState([]);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setChapters([]);
    const examTag = examTypeToTag(examType);
    Promise.all([
      getChapters(toSyllabusExamType(examType), subject, classLevel).catch(() => []),
      supabase.from('pyq_questions')
        .select('chapter')
        .eq('exam_type', examType)
        .eq('subject', subject)
        .not('chapter', 'is', null)
        .limit(200),
      supabase.from('knowledge_base')
        .select('tags')
        .eq('subject', subject)
        .contains('tags', examTag ? [examTag] : [])
        .limit(200),
    ]).then(([syllabus, pyq, kb]) => {
      const fromSyllabus = (syllabus ?? []).map((c) => c.name);
      const fromPYQ       = (pyq.data ?? []).map((r) => r.chapter).filter(Boolean);
      // tags mix real topic tags with exam/class classification tags (e.g.
      // "cbse_class_8") and the bare subject name — exclude both, keep topics only.
      const fromKB = (kb.data ?? []).flatMap((r) => r.tags ?? []).filter(
        (t) => t && t !== subject && !EXAM_TAG_RE.test(t)
      );
      const all = [...new Set([...fromSyllabus, ...fromPYQ, ...fromKB])].sort();
      setChapters(all);
      setLoading(false);
    });
  }, [open, examType, classLevel, subject]);

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-primary-600 font-medium hover:text-primary-700">
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {open ? 'Hide' : 'Browse'} chapters
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="flex flex-wrap gap-1.5 mt-2"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {loading && (
              <span className="flex items-center gap-1.5 text-xs text-slate-400 py-1">
                <Loader2 size={11} className="animate-spin" /> Loading chapters…
              </span>
            )}
            {!loading && chapters.length === 0 && (
              <span className="text-xs text-slate-400">No chapters found for {examType} {subject} yet.</span>
            )}
            {!loading && chapters.map((ch) => (
              <button key={ch} onClick={() => { onSelect(ch); setOpen(false); }}
                className="px-2 py-1 bg-slate-100 hover:bg-primary-50 hover:text-primary-700 text-slate-600 text-xs rounded-lg transition-colors">
                {ch}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Shared config form ───────────────────────────────────── */
// When `locked` is true the exam/class/board row is replaced by a read-only
// badge — students can still choose subject and type a topic.
function ConfigForm({ subject, setSubject, examType, setExamType, topic, setTopic, locked, children }) {
  // Parse incoming examType into its components (only used in unlocked mode)
  const parse = (et) => {
    const combo = et.match(/^(CBSE|ICSE|State Board) Class (\d+)$/);
    if (combo) return { competitive: null, board: combo[1], cls: combo[2] };
    const cls = et.match(/^Class (\d+)$/);
    if (cls) return { competitive: null, board: null, cls: cls[1] };
    if (BOARDS.includes(et)) return { competitive: null, board: et, cls: null };
    return { competitive: et, board: null, cls: null };
  };
  const init = parse(examType);
  const [competitive, setCompetitive] = useState(init.competitive);
  const [selBoard,    setSelBoard]    = useState(init.board);
  const [selClass,    setSelClass]    = useState(init.cls);

  const emit = (comp, board, cls) => {
    let resolved;
    if (comp)              resolved = comp;
    else if (board && cls) resolved = `${board} Class ${cls}`;
    else if (cls)          resolved = `Class ${cls}`;
    else if (board)        resolved = board;
    else                   resolved = 'NEET';
    setExamType(resolved);
  };

  const pickCompetitive = (e) => { setCompetitive(e); setSelBoard(null); setSelClass(null); emit(e, null, null); };
  const pickBoard = (b) => { const next = selBoard === b ? null : b; setSelBoard(next); setCompetitive(null); emit(null, next, selClass); };
  const pickClass = (cl) => { const next = selClass === cl ? null : cl; setSelClass(next); setCompetitive(null); emit(null, selBoard, next); };

  const resolved = competitive
    || (selBoard && selClass ? `${selBoard} Class ${selClass}` : selClass ? `Class ${selClass}` : selBoard ?? '');
  const liveSubjects = useSyllabusSubjects(examType, selClass ?? init.cls);
  const subjects = [...liveSubjects, 'Mixed'];

  // Keep the selected subject valid whenever the exam changes or the live list loads.
  useEffect(() => {
    if (liveSubjects.length && !liveSubjects.includes(subject) && subject !== 'Mixed') setSubject(liveSubjects[0]);
  }, [liveSubjects]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-5">
      {/* Exam type — locked to profile OR open selector */}
      {locked ? (
        <div className="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-xl px-3 py-2.5">
          <Star size={12} className="text-primary-500 shrink-0" />
          <div className="text-xs text-primary-700">
            <span className="font-semibold">Locked to your profile: </span>
            <span className="font-bold">{examType}</span>
          </div>
        </div>
      ) : (
        <div>
          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Exam / Class</label>
          <div className="space-y-2.5">
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">🏆 Competitive</p>
              <div className="flex flex-wrap gap-1.5">
                {(EXAM_TYPE_GROUPS.find((g) => g.label === 'Competitive')?.items ?? []).map((e) => (
                  <Chip key={e} label={e} selected={competitive === e} onClick={() => pickCompetitive(e)} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">📚 Class</p>
              <div className="flex flex-wrap gap-1.5">
                {CLASS_LEVELS.map((cl) => (
                  <Chip key={cl} label={`Class ${cl}`} selected={selClass === cl} onClick={() => pickClass(cl)} />
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] text-slate-400 font-bold uppercase mb-1">🎓 Board</p>
              <div className="flex flex-wrap gap-1.5">
                {BOARDS.map((b) => (
                  <Chip key={b} label={b} selected={selBoard === b} onClick={() => pickBoard(b)} />
                ))}
              </div>
            </div>
            {resolved && (
              <p className="text-[11px] text-primary-600 font-semibold">
                Generating for: <span className="font-bold">{resolved}</span>
              </p>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Subject</label>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => (
            <Chip key={s} label={s} icon={SUBJECT_ICONS[s]} selected={subject === s} onClick={() => setSubject(s)} />
          ))}
        </div>
      </div>
      <div>
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
          Chapter / Topic <span className="text-slate-400 font-normal normal-case">(optional)</span>
        </label>
        <input type="text"
          placeholder="e.g. Photosynthesis, Chemical Bonding, Thermodynamics…"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 placeholder:text-slate-300"
        />
        <div className="mt-2">
          <ChapterBrowser examType={examType} classLevel={selClass ?? init.cls} subject={subject} onSelect={setTopic} />
        </div>
      </div>
      {children}
    </div>
  );
}

/* ── Question card (inline quiz with MathText) ───────────── */
function QuestionCard({ question, qNum, total, onNext, isLast }) {
  const isNumerical   = question.type === 'Numerical';
  const isMatch       = question.type === 'Match the Following';
  const isDescriptive = question.type === 'Short Answer' || question.type === 'Long Answer';

  const [selected,  setSelected]  = useState(null);   // MCQ: index; non-numerical only
  const [numInput,  setNumInput]  = useState('');      // Numerical typed value
  const [revealed,  setReveal]    = useState(false);

  // MCQ/AR/Match: auto-reveal on click
  const handleOption = (oi) => {
    if (revealed) return;
    setSelected(oi);
    setReveal(true);
  };

  // Numerical: reveal on button click
  const handleCheckNum = () => {
    if (numInput.trim() === '') return;
    setReveal(true);
  };

  const numericalIsCorrect = () => {
    const u = parseFloat(numInput.trim());
    const c = parseFloat(String(question.correctAnswer ?? '').trim());
    return !isNaN(u) && !isNaN(c) && Math.abs(u - c) < 0.01;
  };

  // Descriptive questions are always "seen" — no right/wrong; model answer is revealed
  const wasCorrect = isDescriptive ? true : (isNumerical ? numericalIsCorrect() : selected === question.correctOption);

  return (
    <motion.div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4 shadow-sm"
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>

      {/* Progress bar */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400 font-medium">Q{qNum} of {total}</span>
        {question.type && question.type !== 'MCQ' && (
          <span className="text-[10px] bg-violet-50 text-violet-600 border border-violet-200 px-2 py-0.5 rounded-full font-semibold">
            {question.type}
          </span>
        )}
        <div className="flex gap-0.5">
          {Array.from({ length: Math.min(total, 20) }).map((_, i) => (
            <div key={i} className={[
              'h-1 rounded-full transition-colors',
              i < qNum - 1 ? 'bg-primary-500 w-4' : i === qNum - 1 ? 'bg-primary-300 w-4' : 'bg-slate-100 w-3',
            ].join(' ')} />
          ))}
        </div>
      </div>

      {/* Question */}
      <p className="text-sm font-medium text-slate-800 leading-relaxed">
        <MathText text={question.question} />
      </p>

      {/* Match columns */}
      {isMatch && question.columnI && question.columnII && (
        <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
          <div className="grid grid-cols-2 divide-x divide-slate-200">
            <div className="p-3 space-y-1 bg-blue-50">
              <p className="text-[10px] font-bold text-blue-400 uppercase mb-1.5">Column I</p>
              {question.columnI.map((item, i) => (
                <p key={i} className="text-slate-700"><MathText text={item} /></p>
              ))}
            </div>
            <div className="p-3 space-y-1 bg-emerald-50">
              <p className="text-[10px] font-bold text-emerald-400 uppercase mb-1.5">Column II</p>
              {question.columnII.map((item, i) => (
                <p key={i} className="text-slate-700"><MathText text={item} /></p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Descriptive — Short Answer / Long Answer */}
      {isDescriptive && !revealed && (
        <button
          onClick={() => setReveal(true)}
          className="w-full py-3.5 rounded-2xl border-2 border-dashed border-primary-200 text-primary-600 font-semibold text-sm hover:bg-primary-50 transition-colors"
        >
          Show Model Answer
        </button>
      )}
      {isDescriptive && revealed && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Model Answer</p>
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-line">
            <MathText text={question.correctAnswer ?? question.explanation ?? 'See explanation below.'} />
          </p>
        </div>
      )}

      {/* Numerical input */}
      {isNumerical && (
        <div className="space-y-2">
          <input
            type="number" step="any"
            value={numInput}
            onChange={(e) => !revealed && setNumInput(e.target.value)}
            disabled={revealed}
            placeholder="Enter your numerical answer…"
            className={[
              'w-full px-4 py-4 rounded-xl border-2 outline-none text-xl font-bold text-center transition-colors',
              revealed
                ? (wasCorrect ? 'border-emerald-400 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-700')
                : 'border-slate-200 focus:border-primary-500 bg-white text-slate-900',
            ].join(' ')}
          />
          {revealed && !wasCorrect && (
            <p className="text-xs text-center text-emerald-700 font-semibold">
              Correct answer: <MathText text={String(question.correctAnswer ?? '')} />
            </p>
          )}
          {!revealed && (
            <button
              onClick={handleCheckNum}
              disabled={numInput.trim() === ''}
              className="w-full py-3 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 disabled:opacity-40 transition-colors"
            >
              Check Answer
            </button>
          )}
        </div>
      )}

      {/* MCQ / AR / Match options */}
      {!isNumerical && !isDescriptive && (
        <div className="space-y-2">
          {(question.options || []).map((opt, oi) => {
            const isCorrect  = oi === question.correctOption;
            const isSelected = oi === selected;
            let cls = 'border-slate-200 text-slate-700 hover:border-primary-300 hover:bg-primary-50';
            if (revealed) {
              if (isCorrect)       cls = 'border-emerald-400 bg-emerald-50 text-emerald-800';
              else if (isSelected) cls = 'border-red-300 bg-red-50 text-red-700';
              else                 cls = 'border-slate-100 text-slate-400';
            } else if (isSelected) {
              cls = 'border-primary-500 bg-primary-50 text-primary-900';
            }
            return (
              <button key={oi} onClick={() => handleOption(oi)}
                className={`w-full text-left flex items-start gap-3 px-4 py-3 rounded-xl border text-sm transition-all ${cls}`}>
                <span className={[
                  'h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5',
                  revealed && isCorrect  ? 'bg-emerald-500 text-white' :
                  revealed && isSelected ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-600',
                ].join(' ')}>{OPT_LETTERS[oi]}</span>
                <span className="flex-1 leading-relaxed"><MathText text={opt} /></span>
                {revealed && isCorrect  && <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />}
                {revealed && isSelected && !isCorrect && <XCircle size={15} className="text-red-500 shrink-0 mt-0.5" />}
              </button>
            );
          })}
        </div>
      )}

      {/* Explanation */}
      <AnimatePresence>
        {revealed && question.explanation && (
          <motion.div className="bg-slate-50 rounded-xl p-3 border border-slate-100"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
            <p className="text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-700">Explanation: </span>
              <MathText text={question.explanation} />
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Next button */}
      {revealed && (
        <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          onClick={() => onNext(wasCorrect, isNumerical ? numInput : selected, question)}
          className={[
            'w-full py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-colors',
            isLast ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-primary-600 text-white hover:bg-primary-700',
          ].join(' ')}>
          {isLast ? <><Trophy size={16} /> See Results</> : <>Next Question <ArrowRight size={15} /></>}
        </motion.button>
      )}
    </motion.div>
  );
}

/* ── Quiz summary ─────────────────────────────────────────── */
function SummaryScreen({ total, correctCount, onRestart, onNew }) {
  const pct   = Math.round((correctCount / total) * 100);
  const grade = pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
  const msg   = pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Good job!' : pct >= 40 ? 'Keep practising.' : 'Review the concepts.';
  return (
    <motion.div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm space-y-5 text-center"
      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
      <div className="flex justify-center">
        <div className="h-20 w-20 rounded-full bg-slate-50 border-4 border-slate-100 flex items-center justify-center">
          <span className={`text-2xl font-extrabold ${grade}`}>{pct}%</span>
        </div>
      </div>
      <div>
        <p className="text-lg font-bold text-slate-900">{msg}</p>
        <p className="text-sm text-slate-500 mt-1">{correctCount} correct out of {total} questions</p>
      </div>
      <div className="flex gap-3">
        <button onClick={onRestart}
          className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-semibold text-sm flex items-center justify-center gap-1.5 hover:bg-slate-50">
          <RotateCcw size={14} /> Try Again
        </button>
        <button onClick={onNew}
          className="flex-1 py-3 rounded-2xl bg-primary-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-primary-700">
          <Sparkles size={14} /> New Set
        </button>
      </div>
    </motion.div>
  );
}

/* ── Collapsible section ──────────────────────────────────── */
function Section({ icon, title, badge, accentClass = 'border-slate-200', children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`bg-white rounded-2xl border ${accentClass} shadow-sm overflow-hidden`}>
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors text-left">
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-bold text-slate-900 text-sm">{title}</span>
          {badge && (
            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{badge}</span>
          )}
        </div>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden">
            <div className="px-5 pb-5 pt-0 space-y-4 border-t border-slate-100">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Study Notes display ─────────────────────────────────── */
function NotesDisplay({ notes, onReset }) {
  const isChem = notes.subject === 'Chemistry';
  const isPhys = notes.subject === 'Physics';
  const isMath = notes.subject === 'Mathematics';

  return (
    <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Hero card */}
      <div className="bg-gradient-to-br from-indigo-700 via-primary-600 to-violet-600 rounded-2xl p-5 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">{notes.examType}</span>
          <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-medium">{notes.subject}</span>
        </div>
        <h3 className="text-2xl font-extrabold mt-1">{notes.chapter}</h3>
        <p className="text-sm text-indigo-100 mt-2 leading-relaxed">{notes.overview}</p>
      </div>

      {/* PYQ Trend */}
      {notes.previousYearTrend && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
          <TrendingUp size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-800 mb-1">Previous Year Trend</p>
            <p className="text-xs text-amber-700 leading-relaxed">{notes.previousYearTrend}</p>
          </div>
        </div>
      )}

      {/* Key concepts */}
      {notes.keyConcepts?.length > 0 && (
        <Section icon={<Lightbulb size={15} className="text-primary-500" />} title="Key Concepts" defaultOpen={true}>
          <div className="space-y-5">
            {notes.keyConcepts.map((c, i) => (
              <div key={i} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="bg-primary-50 px-4 py-2.5 border-b border-primary-100">
                  <p className="text-sm font-bold text-primary-900">{i + 1}. {c.title}</p>
                </div>
                <div className="p-4 space-y-3">
                  {/* Main explanation */}
                  <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                    <MathText text={c.explanation} />
                  </p>

                  {/* Sub-points */}
                  {c.subpoints?.length > 0 && (
                    <div className="space-y-1.5 border-l-2 border-primary-200 pl-3">
                      {c.subpoints.map((sp, si) => (
                        <div key={si} className="flex items-start gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-primary-400 mt-2 shrink-0" />
                          <p className="text-xs text-slate-600 leading-relaxed">
                            <MathText text={sp} />
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Worked example */}
                  {c.worked_example && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <p className="text-[10px] font-bold text-slate-500 uppercase mb-1.5">Worked Example</p>
                      <p className="text-xs text-slate-700 leading-relaxed">
                        <MathText text={c.worked_example} />
                      </p>
                    </div>
                  )}

                  {/* Exam tip */}
                  {c.tip && (
                    <div className="flex items-start gap-2 bg-amber-50 rounded-xl p-2.5">
                      <Zap size={12} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-amber-800 font-medium leading-relaxed">
                        <MathText text={c.tip} />
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Chemistry: Reactions */}
      {isChem && notes.reactions?.length > 0 && (
        <Section icon={<FlaskConical size={15} className="text-emerald-600" />} title="Important Reactions" accentClass="border-emerald-100">
          <div className="space-y-4">
            {notes.reactions.map((r, i) => (
              <div key={i} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="bg-emerald-50 px-4 py-2.5 border-b border-emerald-100">
                  <p className="text-sm font-bold text-emerald-900">{r.name}</p>
                </div>
                <div className="p-4 space-y-2.5">
                  {/* Equation */}
                  <div className="bg-slate-900 rounded-xl px-4 py-3 overflow-x-auto">
                    <p className="text-white text-sm font-mono">
                      <MathText text={r.equation} />
                    </p>
                  </div>
                  {r.conditions && (
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0 mt-0.5 w-16">Conditions</span>
                      <p className="text-xs text-slate-600"><MathText text={r.conditions} /></p>
                    </div>
                  )}
                  {r.mechanism && (
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase shrink-0 mt-0.5 w-16">Mechanism</span>
                      <p className="text-xs text-slate-600"><MathText text={r.mechanism} /></p>
                    </div>
                  )}
                  {r.exceptions && (
                    <div className="flex items-start gap-2">
                      <span className="text-[10px] font-bold text-amber-600 uppercase shrink-0 mt-0.5 w-16">Exception</span>
                      <p className="text-xs text-amber-700"><MathText text={r.exceptions} /></p>
                    </div>
                  )}
                  {r.pyq_note && (
                    <div className="flex items-start gap-1.5 bg-violet-50 rounded-lg p-2">
                      <Star size={10} className="text-violet-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] text-violet-700"><MathText text={r.pyq_note} /></p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Physics: Derivations */}
      {isPhys && notes.derivations?.length > 0 && (
        <Section icon={<Sigma size={15} className="text-blue-600" />} title="Derivations" accentClass="border-blue-100">
          <div className="space-y-4">
            {notes.derivations.map((d, i) => (
              <div key={i} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="bg-blue-50 px-4 py-2.5 border-b border-blue-100">
                  <p className="text-sm font-bold text-blue-900">{d.title}</p>
                </div>
                <div className="p-4 space-y-2">
                  {d.assumptions && (
                    <p className="text-xs text-slate-500 italic"><MathText text={`Assumptions: ${d.assumptions}`} /></p>
                  )}
                  {d.steps?.map((step, si) => (
                    <div key={si} className="flex items-start gap-3">
                      <span className="h-5 w-5 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {si + 1}
                      </span>
                      <p className="text-xs text-slate-700 leading-relaxed flex-1">
                        <MathText text={step} />
                      </p>
                    </div>
                  ))}
                  {d.result && (
                    <div className="mt-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-center">
                      <p className="text-sm font-bold text-blue-800"><MathText text={d.result} /></p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Math: Worked problems */}
      {isMath && notes.worked_problems?.length > 0 && (
        <Section icon={<Sigma size={15} className="text-violet-600" />} title="Worked Problems" accentClass="border-violet-100">
          <div className="space-y-4">
            {notes.worked_problems.map((wp, i) => (
              <div key={i} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="bg-violet-50 px-4 py-2.5 border-b border-violet-100">
                  <p className="text-xs font-bold text-violet-700">Problem {i + 1}</p>
                  <p className="text-sm text-slate-800 mt-0.5"><MathText text={wp.problem} /></p>
                </div>
                <div className="p-4 space-y-2">
                  {wp.solution_steps?.map((step, si) => (
                    <div key={si} className="flex items-start gap-3">
                      <span className="h-5 w-5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {si + 1}
                      </span>
                      <p className="text-xs text-slate-700 flex-1 leading-relaxed"><MathText text={step} /></p>
                    </div>
                  ))}
                  {wp.answer && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2">
                      <p className="text-xs font-bold text-emerald-800">
                        Answer: <MathText text={wp.answer} />
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Formulas */}
      {notes.importantFormulas?.length > 0 && (
        <Section icon={<Star size={15} className="text-violet-500" />} title="Important Formulas" accentClass="border-violet-100">
          <div className="space-y-3">
            {notes.importantFormulas.map((f, i) => (
              <div key={i} className="border border-slate-100 rounded-xl overflow-hidden">
                <div className="bg-slate-900 px-4 py-3 flex items-center justify-center overflow-x-auto">
                  <span className="text-white text-base font-mono">
                    <MathText text={f.formula} />
                  </span>
                </div>
                <div className="px-4 py-3 space-y-1">
                  {f.variables && (
                    <p className="text-xs text-slate-600"><span className="font-semibold">Variables: </span><MathText text={f.variables} /></p>
                  )}
                  {f.conditions && (
                    <p className="text-xs text-slate-500"><span className="font-semibold">Apply when: </span><MathText text={f.conditions} /></p>
                  )}
                  {f.derivation_hint && (
                    <p className="text-xs text-primary-600 font-medium"><MathText text={`Tip: ${f.derivation_hint}`} /></p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* NCERT Highlights */}
      {notes.ncertHighlights?.length > 0 && (
        <Section icon={<BookMarked size={15} className="text-rose-500" />} title="NCERT Highlights" badge="Direct exam lines" accentClass="border-rose-100" defaultOpen={false}>
          <ul className="space-y-2">
            {notes.ncertHighlights.map((item, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="h-5 w-5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                <p className="text-xs text-slate-700 leading-relaxed flex-1"><MathText text={item} /></p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Must remember */}
      {notes.mustRemember?.length > 0 && (
        <Section icon={<CheckCircle2 size={15} className="text-emerald-600" />} title="Must Remember" accentClass="border-emerald-100" defaultOpen={false}>
          <ul className="space-y-2">
            {notes.mustRemember.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-emerald-800">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                <MathText text={item} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Mnemonics */}
      {notes.mnemonics?.length > 0 && (
        <Section icon={<Brain size={15} className="text-purple-500" />} title="Mnemonics & Memory Tricks" accentClass="border-purple-100" defaultOpen={false}>
          <div className="space-y-3">
            {notes.mnemonics.map((m, i) => (
              <div key={i} className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 flex items-start gap-2">
                <Zap size={12} className="text-purple-500 shrink-0 mt-0.5" />
                <p className="text-xs text-purple-800 leading-relaxed">{m}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Common mistakes */}
      {notes.commonMistakes?.length > 0 && (
        <Section icon={<AlertTriangle size={15} className="text-red-500" />} title="Common Mistakes" accentClass="border-red-100" defaultOpen={false}>
          <ul className="space-y-2">
            {notes.commonMistakes.map((item, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-red-700 leading-relaxed">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400 mt-1.5 shrink-0" />
                <MathText text={item} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <button onClick={onReset}
        className="w-full py-3 rounded-2xl border border-slate-200 text-slate-600 font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-50">
        <ArrowLeft size={14} /> Study Another Chapter
      </button>
    </motion.div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function PracticeGeneratorPage({ embedded = false }) {
  const navigate             = useNavigate();
  const { currentUser, userProfile, isPremium } = useAuth();

  const profileExam    = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const defaultSubject = getSubjectsForExam(profileExam)[0] ?? 'Biology';

  const [examType,    setExamType]  = useState(profileExam);
  const [subject,     setSubject]   = useState(defaultSubject);
  const [topic,       setTopic]     = useState('');
  const [mode,        setMode]      = useState('practice');

  const [difficulty,  setDiff]      = useState('Mixed');
  const [count,       setCount]     = useState(10);
  const [qTypes,      setQTypes]    = useState(() => isSchoolExam(profileExam) ? ['MCQ', 'Short Answer', 'Long Answer'] : ['MCQ']);
  const [phase,       setPhase]     = useState('form');
  const [questions,  setQs]     = useState([]);
  const [qIdx,       setQIdx]   = useState(0);
  const [correct,    setCorrect]= useState(0);
  const [practiceScore, setPracticeScore] = useState(0);
  const [genError,   setGenErr]     = useState('');
  const [showPaywall, setShowPaywall] = useState(false);

  const [notesPhase, setNotesPhase] = useState('form');
  const [notes,      setNotes]      = useState(null);
  const [notesError, setNotesError] = useState('');

  /* ── Reset question types when exam category switches ── */
  useEffect(() => {
    setQTypes(isSchoolExam(examType) ? ['MCQ', 'Short Answer', 'Long Answer'] : ['MCQ']);
  }, [examType]);

  /* ── Analytics: save session when practice is done ── */
  useEffect(() => {
    if (phase !== 'done' || !currentUser) return;
    const totalMarks = questions.reduce((s, q) => s + (typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4)), 0);
    const sessionName = `AI Practice: ${subject}${topic ? ' – ' + topic : ''}`;
    saveTestSession(currentUser.uid, {
      test_name:      sessionName,
      score:          practiceScore,
      total_marks:    totalMarks,
      correct,
      wrong:          questions.length - correct,
      skipped:        0,
      question_count: questions.length,
      exam_type:      userProfile?.target_exam || null,
    }).catch(console.error);
    createNotification(
      currentUser.uid,
      'practice_complete',
      `Practice done: ${subject}${topic ? ' – ' + topic : ''}`,
      `${correct}/${questions.length} correct · ${Math.round((correct / questions.length) * 100)}% accuracy`,
      '/analytics',
    ).catch(() => {});
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m) => {
    setMode(m); setPhase('form'); setNotesPhase('form');
    setGenErr(''); setNotesError('');
  };

  // Reset subject when exam type changes (can only happen if profile changes)
  const setSubjectSafe = (s) => setSubject(s);

  const toggleQType = (t) => setQTypes((prev) =>
    prev.includes(t) ? (prev.length > 1 ? prev.filter((x) => x !== t) : prev) : [...prev, t]
  );

  const generate = async () => {
    setGenErr(''); setPhase('loading');
    try {
      const quota = await checkQuota(currentUser?.uid, 'ai_questions_used', isPremium, undefined, count);
      if (!quota.allowed) {
        setPhase('form');
        setShowPaywall(true);
        return;
      }

      const raw       = await generateQuestionPaper({ subject, topics: topic, examType, difficulty, count, qTypes, rotationSlot: Math.floor(Math.random() * 5) });
      const formatted = toEngineFormat(raw, subject, examType);
      if (!formatted.length) throw new Error('No questions returned — try different settings.');
      setQs(formatted); setQIdx(0); setCorrect(0); setPhase('quiz');

      await incrementQuota(currentUser?.uid, 'ai_questions_used', formatted.length);
    } catch (e) {
      setGenErr(e.message || 'Generation failed.'); setPhase('form');
    }
  };

  const handleNext = (wasCorrect, selectedOption, q) => {
    if (wasCorrect) {
      setCorrect((c) => c + 1);
      const qMarks = typeof q?.marks === 'number' ? q.marks : (q?.marks?.correct ?? 4);
      setPracticeScore((s) => s + qMarks);
      awardXP(currentUser?.uid, 'practice_question').catch(() => {});
      // Weak-topics accuracy is wrong_count/total_attempts — without also
      // logging correct answers here, every topic practiced in this mode would
      // show as 0% accuracy (only the wrong side of the ratio would ever count).
      if (q && currentUser?.uid && selectedOption !== null) {
        saveCorrectAnswers(currentUser.uid, [q], { [q.id]: selectedOption }, 'practice').catch(() => {});
      }
    } else if (!wasCorrect && selectedOption !== null && q && currentUser?.uid) {
      // Log to Error Notebook — previously only Mock Test / Paper Mode did this,
      // so AI Chapter Practice (the most-used casual practice mode) never fed
      // the spaced-repetition notebook at all, no matter how much a student used it.
      saveWrongAnswers(
        currentUser.uid, [q], { [q.id]: selectedOption }, 'practice',
        `${subject}${topic ? ' · ' + topic : ''}`,
      ).catch(() => {});

      // Phase 5: log wrong answer as misconception (fire-and-forget)
      getFeatureFlag(FLAGS.MISCONCEPTION_ENGINE).then((on) => {
        if (!on) return;
        const distractorLabel = q.options?.[selectedOption] ?? String(selectedOption);
        const correctLabel    = q.options?.[q.correctOption] ?? q.correctAnswer ?? '';
        supabase.rpc('upsert_misconception', {
          p_user_id:       currentUser.uid,
          p_exam_type:     examType || '',
          p_subject:       subject  || '',
          p_chapter:       q.chapter || q.topic || '',
          p_question_id:   q.id || '',
          p_distractor:    distractorLabel,
          p_correct:       correctLabel,
          p_question_text: q.question?.slice(0, 500) ?? '',
        }).catch(() => {});
      }).catch(() => {});
    }
    if (qIdx + 1 >= questions.length) setPhase('done');
    else setQIdx((i) => i + 1);
  };

  const loadNotes = async () => {
    if (!topic.trim()) { setNotesError('Enter a chapter or topic first.'); return; }
    setNotesError(''); setNotesPhase('loading');
    try {
      const data = await generateChapterNotes({ subject, chapter: topic, examType });
      setNotes(data); setNotesPhase('done');
    } catch (e) {
      setNotesError(e.message || 'Notes generation failed.'); setNotesPhase('form');
    }
  };

  const showTabs = (phase === 'form' || phase === 'loading') && (notesPhase === 'form' || notesPhase === 'loading');

  const hasProfileExam = !!(userProfile?.target_exam || userProfile?.syllabus || userProfile?.class_level);

  return (
    <div className={`space-y-5 ${embedded ? '' : 'p-4 lg:p-0 max-w-xl mx-auto lg:mx-0'}`}>
      {showPaywall && (
        <PaywallModal
          onClose={() => setShowPaywall(false)}
          feature="AI practice questions"
          firebaseUid={currentUser?.uid}
          email={currentUser?.email}
          name={userProfile?.display_name || currentUser?.displayName}
          onSuccess={() => setShowPaywall(false)}
        />
      )}
      {/* Header — hidden when embedded in a hub */}
      {!embedded && (
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/practice')} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-slate-900">AI Practice</h2>
            <p className="text-xs text-slate-500 mt-0.5">Chapter-wise questions & AI concept notes</p>
          </div>
        </div>
      )}


      {/* Mode tabs */}
      {showTabs && (
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          <button onClick={() => switchMode('practice')}
            className={['flex-1 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
              mode === 'practice' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'].join(' ')}>
            <Sparkles size={13} /> Practice Questions
          </button>
          <button onClick={() => switchMode('notes')}
            className={['flex-1 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors',
              mode === 'notes' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'].join(' ')}>
            <BookOpen size={13} /> Concept Notes (AI)
          </button>
        </div>
      )}

      {/* ── PRACTICE MODE ── */}
      {mode === 'practice' && (
        <>
          {(phase === 'form' || phase === 'loading') && (
            <motion.div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <ConfigForm subject={subject} setSubject={setSubjectSafe} examType={examType} setExamType={setExamType} topic={topic} setTopic={setTopic} locked={hasProfileExam}>
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Difficulty</label>
                  <div className="flex flex-wrap gap-2">
                    {DIFFS.map((d) => <Chip key={d} label={d} selected={difficulty === d} onClick={() => setDiff(d)} />)}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Question Types</label>
                  <div className="flex flex-wrap gap-2">
                    {(isSchoolExam(examType) ? Q_TYPE_OPTIONS_SCHOOL : Q_TYPE_OPTIONS_COMPETITIVE).map(({ id, label, desc }) => (
                      <button key={id} onClick={() => toggleQType(id)}
                        title={desc}
                        className={[
                          'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all',
                          qTypes.includes(id)
                            ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300 hover:text-primary-700',
                        ].join(' ')}>
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">
                    {isSchoolExam(examType)
                      ? 'Short/Long Ans → type your answer mentally, then reveal model answer'
                      : 'Select multiple types — questions will be distributed evenly'}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">No. of Questions</label>
                  <div className="flex flex-wrap gap-2">
                    {COUNTS.map((n) => <Chip key={n} label={String(n)} selected={count === n} onClick={() => setCount(n)} />)}
                  </div>
                  {count > 30 && (
                    <p className="text-[10px] text-amber-600 mt-1.5">Larger sets take ~30–60 seconds to generate</p>
                  )}
                </div>
                {genError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{genError}</div>
                )}
                <button onClick={generate} disabled={phase === 'loading'}
                  className="w-full py-4 rounded-2xl bg-primary-600 text-white font-bold text-base flex items-center justify-center gap-2 hover:bg-primary-700 disabled:opacity-60 transition-colors shadow-sm">
                  {phase === 'loading'
                    ? <><Loader2 size={18} className="animate-spin" /> Generating {count} questions…</>
                    : <><Sparkles size={18} /> Generate Questions</>}
                </button>
                <p className="text-[10px] text-slate-400 text-center">Follows real {examType} paper pattern · equations rendered in LaTeX · ~15–25 sec</p>
              </ConfigForm>
            </motion.div>
          )}
          {phase === 'quiz' && questions[qIdx] && (
            <>
              {/* Paper Mode shortcut when quiz is in progress */}
              <div className="flex justify-end">
                <button
                  onClick={() => navigate('/paper-mode', { state: { questions, title: `AI Practice: ${subject}${topic ? ' – ' + topic : ''}`, examType, subject } })}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-semibold transition-colors"
                >
                  <Printer size={12} /> Switch to Paper Mode
                </button>
              </div>
              <QuestionCard key={qIdx} question={questions[qIdx]} qNum={qIdx + 1}
                total={questions.length} isLast={qIdx === questions.length - 1} onNext={handleNext} />
            </>
          )}
          {phase === 'done' && (
            <>
              <SummaryScreen total={questions.length} correctCount={correct}
                onRestart={() => { setQIdx(0); setCorrect(0); setPhase('quiz'); }}
                onNew={() => { setPhase('form'); setQs([]); setTopic(''); }} />
              <button
                onClick={() => navigate('/paper-mode', { state: { questions, title: `AI Practice: ${subject}${topic ? ' – ' + topic : ''}`, examType, subject } })}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-colors"
              >
                <Printer size={14} /> View as Paper / Upload Handwritten Answers
              </button>
            </>
          )}
        </>
      )}

      {/* ── STUDY NOTES MODE ── */}
      {mode === 'notes' && (
        <>
          {(notesPhase === 'form' || notesPhase === 'loading') && (
            <motion.div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5"
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <ConfigForm subject={subject} setSubject={setSubjectSafe} examType={examType} setExamType={setExamType} topic={topic} setTopic={setTopic} locked={hasProfileExam}>
                {notesError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600">{notesError}</div>
                )}
                <button onClick={loadNotes} disabled={notesPhase === 'loading'}
                  className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-base flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-60 transition-colors shadow-sm">
                  {notesPhase === 'loading'
                    ? <><Loader2 size={18} className="animate-spin" /> Generating in-depth notes…</>
                    : <><BookOpen size={18} /> Generate Concept Notes</>}
                </button>
                <div className="bg-indigo-50 rounded-xl p-3 border border-indigo-100 text-[11px] text-indigo-700 leading-relaxed space-y-1">
                  <p className="font-semibold text-indigo-900">What you get:</p>
                  <p>• Full concept explanations with mechanisms, derivations, worked examples</p>
                  <p>• Chemical reactions with conditions, mechanisms & exceptions</p>
                  <p>• Important formulas with LaTeX rendering</p>
                  <p>• NCERT highlights, mnemonics & PYQ trend analysis</p>
                </div>
              </ConfigForm>
            </motion.div>
          )}
          {notesPhase === 'done' && notes && (
            <NotesDisplay notes={notes} onReset={() => { setNotesPhase('form'); setNotes(null); }} />
          )}
        </>
      )}
    </div>
  );
}
