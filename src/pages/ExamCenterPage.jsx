import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Play, Clock, FileText, Plus, Loader2, Trophy,
  Target, BookOpen, X, ChevronRight, Zap, GraduationCap, Printer,
} from 'lucide-react';
import { generateQuestionPaper, toEngineFormat } from '../lib/questionGen';
import { getExamPattern, getMarkingLabel, getSubjectQuestionCount, getTestDurationMinutes } from '../lib/examPattern';
import { publishTest, getPublishedTests, getCompletedTestIds, supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { checkQuota, incrementQuota } from '../lib/quota';
import { getFeatureFlag, FLAGS } from '../lib/featureFlags';

import { useSyllabusSubjects } from '../hooks/useSyllabusSubjects';
import { useSyllabusChapters } from '../hooks/useSyllabusChapters';
import { buildExamType } from '../lib/categories';

const EXAM_FILTERS = ['All', 'NEET', 'JEE Main', 'JEE Advanced', 'CBSE', 'Class 10', 'Class 12', 'UPSC', 'CUET'];

// Question types per exam (mirrors what the real paper uses)
const EXAM_QTYPES = {
  'NEET':         ['MCQ', 'Assertion-Reason'],
  'JEE Main':     ['MCQ', 'Numerical'],
  'JEE Advanced': ['MCQ', 'Numerical', 'Match the Following'],
  'CBSE':         ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'ICSE':         ['MCQ', 'Short Answer', 'Long Answer'],
  'State Board':  ['MCQ', 'Short Answer', 'Long Answer'],
  'Class 8':      ['MCQ', 'Short Answer', 'Long Answer'],
  'Class 9':      ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'Class 10':     ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'Class 11':     ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'Class 12':     ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
};

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Mixed'];

const DIFF_COLORS = {
  Easy:   'bg-emerald-100 text-emerald-700',
  Medium: 'bg-amber-100 text-amber-700',
  Hard:   'bg-red-100 text-red-700',
  Mixed:  'bg-purple-100 text-purple-700',
};

const EXAM_COLORS = {
  'NEET':         'bg-violet-100 text-violet-700',
  'JEE Main':     'bg-blue-100 text-blue-700',
  'JEE Advanced': 'bg-indigo-100 text-indigo-700',
};

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ── Chip ────────────────────────────────────────────────── */
function Chip({ label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all',
        selected
          ? 'bg-primary-600 text-white border-primary-600'
          : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

/* ── Chapter picker — live from Admin > Syllabus ──────────── */
function ChapterPicker({ examType, subject, selected, onChange, disabled }) {
  const { chapters, loading } = useSyllabusChapters(examType, subject);

  const toggle = (name) => {
    if (disabled) return;
    onChange(selected.includes(name) ? selected.filter((c) => c !== name) : [...selected, name]);
  };

  if (loading || !chapters.length) return null;

  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">
        Chapters <span className="normal-case text-slate-400 font-normal">(optional — leave empty for full-syllabus spread)</span>
      </label>
      <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
        {chapters.map((c) => (
          <Chip key={c.key ?? c.name} label={c.name} selected={selected.includes(c.name)} onClick={() => toggle(c.name)} />
        ))}
      </div>
    </div>
  );
}

/* ── Generate modal ──────────────────────────────────────── */
function GenerateModal({ onClose, onDone }) {
  const { currentUser, isPremium, userProfile } = useAuth();

  // Lock exam type to the student's registered target exam. userProfile.target_exam is
  // stored as the raw onboarding enum (e.g. 'CLASS_10', 'JEE_MAIN', 'BOTH') — must go
  // through buildExamType to get the normalized key (e.g. 'CBSE Class 10', 'JEE Main')
  // that syllabus_nodes actually uses, otherwise nothing ever matches.
  const examType = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);

  const subjectList = useSyllabusSubjects(examType);
  const [subject,    setSubject]    = useState(subjectList[0] || 'Physics');
  const [difficulty, setDiff]       = useState('Mixed');
  const [chapters,   setChapters]   = useState([]);
  const [status,     setStatus]     = useState('idle');
  const [error,      setError]      = useState('');

  // Keep the selected subject valid once the live subject list loads/changes.
  useEffect(() => {
    if (subjectList.length && !subjectList.includes(subject)) setSubject(subjectList[0]);
  }, [subjectList]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setChapters([]); }, [subject]);

  const examPat     = getExamPattern(examType);
  const questionCount = getSubjectQuestionCount(examPat);

  const handleGenerate = async () => {
    setError('');
    const quota = await checkQuota(currentUser?.uid, 'ai_questions_used', isPremium);
    if (!quota.allowed) { setError(quota.reason); return; }
    setStatus('generating');
    const examQTypes = EXAM_QTYPES[examType] || ['MCQ'];
    try {
      const raw = await generateQuestionPaper({
        subject,
        topics:        chapters.join(', '), // empty = full-syllabus spread across all chapters
        examType,
        difficulty,
        count:         questionCount,
        qTypes:        examQTypes,
        rotationSlot:  Math.floor(Math.random() * 5),
      });
      const formatted = toEngineFormat(raw?.questions ?? raw, subject, examType);
      if (!formatted.length) throw new Error('No questions returned. Try different settings.');

      setStatus('publishing');
      const duration    = getTestDurationMinutes(examPat);
      const published   = await publishTest({
        title:           `${examType} · ${subject} · ${difficulty}`,
        subject,
        examType,
        difficulty,
        questions:       formatted,
        durationMinutes: duration,
      });

      incrementQuota(currentUser?.uid, 'ai_questions_used', formatted.length).catch(() => {});
      onDone(published.id);
    } catch (e) {
      setError(e.message || 'Generation failed. Please try again.');
      setStatus('idle');
    }
  };

  const isRunning = status !== 'idle';

  return (
    <motion.div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget && !isRunning) onClose(); }}
    >
      <motion.div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5"
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Generate New Paper</h3>
            <p className="text-xs text-slate-500 mt-0.5">AI creates {questionCount} questions based on your uploaded PYQs</p>
          </div>
          {!isRunning && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Locked exam badge */}
        <div className="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-xl px-3 py-2">
          <span className="text-xs text-primary-500 font-semibold uppercase tracking-wide">Exam</span>
          <span className="ml-auto text-xs font-bold text-primary-700 bg-primary-100 px-2 py-0.5 rounded-full">{examType}</span>
          <span className="text-[10px] text-primary-400">· locked to your profile</span>
        </div>

        {/* Subject — dynamic */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Subject</label>
          <div className="flex flex-wrap gap-2">
            {subjectList.map((s) => (
              <Chip key={s} label={s} selected={subject === s} onClick={() => !isRunning && setSubject(s)} />
            ))}
          </div>
        </div>

        {/* Chapters — live from Admin > Syllabus */}
        <ChapterPicker examType={examType} subject={subject} selected={chapters} onChange={setChapters} disabled={isRunning} />

        {/* Difficulty */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Difficulty</label>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((d) => (
              <Chip key={d} label={d} selected={difficulty === d} onClick={() => !isRunning && setDiff(d)} />
            ))}
          </div>
        </div>

        {/* Info */}
        <div className="bg-primary-50 rounded-xl p-3 border border-primary-100 text-xs text-primary-700 leading-relaxed space-y-1">
          <p className="font-semibold text-primary-900">Paper details</p>
          <p>{questionCount} questions · {chapters.length ? `focused on: ${chapters.join(', ')}` : 'full-syllabus spread across all chapters'} · {getMarkingLabel(examPat) || 'standard marking'}</p>
          <p>Question types: {(EXAM_QTYPES[examType] || ['MCQ']).join(', ')}</p>
          <p>Estimated duration: {getTestDurationMinutes(examPat)} min · {examPat?.totalMarks ?? '—'} total marks</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* Status bar */}
        {isRunning && (
          <div className="flex items-center gap-2 text-sm text-primary-700 font-medium">
            <Loader2 size={16} className="animate-spin" />
            {status === 'generating' ? `Generating ${questionCount} questions… (~25 sec)` : 'Saving paper…'}
          </div>
        )}

        <button
          disabled={isRunning}
          onClick={handleGenerate}
          className="w-full py-4 rounded-2xl bg-primary-600 text-white font-bold flex items-center justify-center gap-2 hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {isRunning
            ? <><Loader2 size={16} className="animate-spin" /> Working…</>
            : <><Sparkles size={16} /> Generate &amp; Start Exam</>}
        </button>
      </motion.div>
    </motion.div>
  );
}

/* ── Paper card ──────────────────────────────────────────── */
function PaperCard({ paper, onStart, onStartPaper, attempt, paperModeEnabled }) {
  const qCount = paper.question_count ?? (Array.isArray(paper.questions) ? paper.questions.length : '—');
  const done   = !!attempt;
  const pct    = done && attempt.total_marks > 0
    ? Math.round((attempt.score / attempt.total_marks) * 100) : null;

  return (
    <motion.div
      className={`card p-4 space-y-3 hover:shadow-md transition-shadow ${done ? 'border-emerald-200 bg-emerald-50/40' : ''}`}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 text-sm leading-snug truncate">{paper.title}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(paper.created_at)}</p>
        </div>
        {done ? (
          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
            ✓ Done
          </span>
        ) : (
          <span className={`text-[10px] font-bold px-2 py-1 rounded-full shrink-0 ${DIFF_COLORS[paper.difficulty] || 'bg-slate-100 text-slate-600'}`}>
            {paper.difficulty}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${EXAM_COLORS[paper.exam_type] || 'bg-slate-100 text-slate-600'}`}>
          {paper.exam_type}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <FileText size={10} /> {qCount} questions
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-500">
          <Clock size={10} /> {paper.duration_minutes} min
        </span>
      </div>

      {done ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-emerald-800">
              {attempt.score}/{attempt.total_marks} · {pct}%
            </p>
            <p className="text-[10px] text-emerald-600 mt-0.5">
              {formatDate(attempt.created_at)}
            </p>
          </div>
          <button
            onClick={() => onStart(paper.id)}
            className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
          >
            View Results
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => onStart(paper.id)}
            className="w-full py-2.5 rounded-xl bg-primary-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 hover:bg-primary-700 transition-colors"
          >
            <Play size={13} /> Start Exam
            <ChevronRight size={13} />
          </button>
          {paperModeEnabled && (
            <button
              onClick={() => onStartPaper(paper.id)}
              className="w-full py-2 rounded-xl border border-slate-300 text-slate-600 text-xs font-semibold flex items-center justify-center gap-1.5 hover:border-primary-400 hover:text-primary-700 transition-colors"
            >
              <Printer size={12} /> Take on Paper
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/* ── Coaching centre tests ───────────────────────────────── */
function CoachingTestsSection({ firebaseUid, onStart, onStartPaper, paperModeEnabled }) {
  const [tests,   setTests]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseUid) { setLoading(false); return; }
    supabase
      .from('coaching_students')
      .select('centre_id')
      .eq('firebase_uid', firebaseUid)
      .maybeSingle()
      .then(({ data }) => {
        if (!data?.centre_id) { setLoading(false); return; }
        return supabase
          .from('centre_published_tests')
          .select('id, title, subject, exam_type, difficulty, questions, duration_minutes, created_at, centre_id')
          .eq('centre_id', data.centre_id)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(20);
      })
      .then((res) => { if (res) setTests(res.data ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [firebaseUid]);

  if (loading || tests.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GraduationCap size={16} className="text-violet-600" />
        <h3 className="font-bold text-slate-900 text-sm">From Your Coaching Centre</h3>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
          {tests.length} test{tests.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {tests.map((p) => (
          <PaperCard key={p.id} paper={{ ...p, question_count: Array.isArray(p.questions) ? p.questions.length : '—', exam_type: p.exam_type || '' }} onStart={onStart} onStartPaper={onStartPaper} attempt={null} paperModeEnabled={paperModeEnabled} />
        ))}
      </div>
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────── */
function EmptyState({ onGenerate }) {
  return (
    <motion.div
      className="card p-10 text-center space-y-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      <div className="flex justify-center">
        <div className="h-16 w-16 rounded-2xl bg-primary-50 border border-primary-100 flex items-center justify-center">
          <Trophy size={28} className="text-primary-500" />
        </div>
      </div>
      <div>
        <p className="font-bold text-slate-900 text-lg">No papers yet</p>
        <p className="text-sm text-slate-500 mt-1">Generate your first full exam paper with AI</p>
      </div>
      <button
        onClick={onGenerate}
        className="mx-auto px-6 py-3 rounded-2xl bg-primary-600 text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary-700 transition-colors"
      >
        <Plus size={15} /> Generate First Paper
      </button>
    </motion.div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function ExamCenterPage() {
  const navigate              = useNavigate();
  const { userProfile, currentUser } = useAuth();
  const userExam              = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const [papers,           setPapers]           = useState([]);
  const [loading,          setLoading]          = useState(true);
  const [filter,           setFilter]           = useState('All');
  const [showModal,        setShowModal]        = useState(false);
  const [completed,        setCompleted]        = useState({}); // { testId → attempt }
  const [paperModeEnabled, setPaperModeEnabled] = useState(false);

  const loadPapers = async () => {
    setLoading(true);
    try {
      const [data, done] = await Promise.all([
        getPublishedTests(),
        getCompletedTestIds(currentUser?.uid),
      ]);
      setPapers(data);
      setCompleted(done);
    } catch {
      /* silently ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadPapers(); }, [currentUser?.uid]);
  useEffect(() => {
    getFeatureFlag(FLAGS.PAPER_MODE_V2).then(setPaperModeEnabled).catch(() => {});
  }, []);

  // Students only see papers for their own exam type
  const gradeFiltered = papers.filter((p) => !p.exam_type || p.exam_type === userExam);
  const filtered = filter === 'All'
    ? gradeFiltered
    : gradeFiltered.filter((p) => p.exam_type === filter);

  const handleStart      = (id) => navigate(`/test?id=${id}`);
  const handleStartPaper = (id) => navigate(`/paper-mode?id=${id}`);

  const handleDone = (id) => {
    setShowModal(false);
    loadPapers();          // refresh list first
    navigate(`/test?id=${id}`);
  };

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-3xl mx-auto lg:mx-0">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Target size={20} className="text-primary-600" /> Exam Center
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Full-length AI-generated papers · based on uploaded PYQs</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors shadow-sm"
        >
          <Plus size={15} /> New Paper
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <FileText size={14} />, label: 'Total Papers',  value: papers.length },
          { icon: <BookOpen size={14} />, label: 'NEET Papers',   value: papers.filter((p) => p.exam_type === 'NEET').length },
          { icon: <Zap size={14} />,      label: 'JEE Papers',    value: papers.filter((p) => p.exam_type?.startsWith('JEE')).length },
        ].map(({ icon, label, value }) => (
          <div key={label} className="card p-3 text-center">
            <div className="flex justify-center text-primary-500 mb-1">{icon}</div>
            <p className="text-lg font-extrabold text-slate-900">{value}</p>
            <p className="text-[10px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Coaching centre tests */}
      <CoachingTestsSection firebaseUid={currentUser?.uid} onStart={handleStart} onStartPaper={handleStartPaper} paperModeEnabled={paperModeEnabled} />

      {/* Filter chips — derived from the student's visible papers so no ghost chips appear */}
      <div className="flex flex-wrap gap-2">
        {['All', ...new Set(gradeFiltered.map((p) => p.exam_type).filter(Boolean))].map((f) => (
          <Chip key={f} label={f} selected={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="card p-8 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Loader2 size={18} className="animate-spin" /> Loading papers…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onGenerate={() => setShowModal(true)} />
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map((p) => (
            <PaperCard key={p.id} paper={p} onStart={handleStart} onStartPaper={handleStartPaper} attempt={completed[p.id] ?? null} paperModeEnabled={paperModeEnabled} />
          ))}
        </div>
      )}

      {/* Generate modal */}
      <AnimatePresence>
        {showModal && (
          <GenerateModal
            onClose={() => setShowModal(false)}
            onDone={handleDone}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
