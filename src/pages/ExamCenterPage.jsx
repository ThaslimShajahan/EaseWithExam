import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Sparkles, Play, Clock, FileText, Plus, Loader2, Trophy,
  Target, BookOpen, X, ChevronRight, Zap, GraduationCap, Printer, ClipboardList, Bell,
} from 'lucide-react';
import { getExamPattern, getMarkingLabel, getSubjectQuestionCount, getTestDurationMinutes, defaultQTypesFor } from '../lib/examPattern';
import { getExamLabel } from '../lib/categories';
import { getPublishedTests, getCompletedTestIds, supabase, publishPYQPaper } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { checkQuota } from '../lib/quota';
import { getFeatureFlag, FLAGS } from '../lib/featureFlags';
import PaywallModal from '../components/ui/PaywallModal';
import EweSpinner from '../components/ui/EweSpinner';
import { startBackgroundPaperGeneration, isGenerationInFlight } from '../lib/backgroundGeneration';
import { createNotification } from '../lib/notifications';

import { useSyllabusSubjects } from '../hooks/useSyllabusSubjects';
import { useSyllabusChapters } from '../hooks/useSyllabusChapters';
import { buildExamType, isRelevantToStudent } from '../lib/categories';

// Question types per exam (mirrors what the real paper uses)

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
function GenerateModal({ onClose, onStarted }) {
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
  const [error,      setError]      = useState('');
  const [showPaywall, setShowPaywall] = useState(false);

  // Keep the selected subject valid once the live subject list loads/changes.
  useEffect(() => {
    if (subjectList.length && !subjectList.includes(subject)) setSubject(subjectList[0]);
  }, [subjectList]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setChapters([]); }, [subject]);

  const examPat     = getExamPattern(examType);
  const questionCount = getSubjectQuestionCount(examPat);

  // Generation now runs in the background (startBackgroundPaperGeneration
  // is fire-and-forget, not tied to this component's lifecycle) — closing
  // this modal or navigating away no longer aborts anything, unlike the
  // previous blocking-modal flow. That's intentional: navigating away is
  // now the expected, supported path (Item 2), not an abandonment signal,
  // so there is deliberately no AbortController here any more.
  const handleGenerate = async () => {
    setError('');
    if (isGenerationInFlight(currentUser?.uid)) {
      setError('A paper is already generating — check back in a moment.');
      return;
    }
    // Charges the paper_generations bucket (1 unit per full paper), not
    // ai_questions_used — a full paper's question count (e.g. 45 for NEET)
    // would otherwise exceed the whole free daily AI-question allowance in
    // one generation, since that bucket is meant for individual practice
    // questions (Practice Generator/Flashcards/Study Plan), not full papers.
    const quota = await checkQuota(currentUser?.uid, 'paper_generations_used', isPremium);
    if (!quota.allowed) { setShowPaywall(true); return; }

    // Resolver, not a direct lookup: the map is keyed 'CBSE' / 'Class 10' but
    // examType is the combined 'CBSE Class 10', so a plain lookup missed and
    // silently fell back to ['MCQ']. Harmless while the generator ignored
    // qTypes for CBSE; now that it honours them, that miss would have made
    // every Exam Center CBSE paper MCQ-only.
    const examQTypes = defaultQTypesFor(examType);
    const duration    = getTestDurationMinutes(examPat);

    startBackgroundPaperGeneration({
      firebaseUid:     currentUser?.uid,
      subject,
      topics:          chapters.join(', '), // empty = full-syllabus spread across all chapters
      examType,
      difficulty,
      count:           questionCount,
      qTypes:          examQTypes,
      durationMinutes: duration,
    }).catch(() => {}); // failure already surfaced via in-app notification

    // Immediate feedback: transient toast + persisted in-app notification
    try {
      createNotification(currentUser?.uid, 'info', 'Paper generation started', `Generating ${examType} · ${subject} in background. We'll notify you when ready.`).catch(() => {});
    } catch (_) {}
    onStarted();
  };

  return (
    <motion.div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Bounded height + scrolling body + pinned footer.
          Previously this was a plain `p-6 space-y-5` block with no max-height,
          so on a short laptop screen the modal grew past the viewport and the
          "Start Generating" button at the bottom was simply unreachable —
          there was nothing to scroll, because the modal itself overflowed its
          fixed-position parent rather than scrolling internally. */}
      <motion.div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden"
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
      >
        <div className="p-6 pb-4 space-y-5 overflow-y-auto flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-lg">Generate New Paper</h3>
            <p className="text-xs text-slate-500 mt-0.5">AI creates {questionCount} questions based on your uploaded PYQs</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        {/* Locked exam badge */}
        <div className="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-xl px-3 py-2">
          <span className="text-xs text-primary-500 font-semibold uppercase tracking-wide">Exam</span>
          <span className="ml-auto text-xs font-bold text-primary-700 bg-primary-100 px-2 py-0.5 rounded-full">{getExamLabel(examType)}</span>
          <span className="text-[10px] text-primary-400">· locked to your profile</span>
        </div>

        {/* Subject — dynamic */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Subject</label>
          <div className="flex flex-wrap gap-2">
            {subjectList.map((s) => (
              <Chip key={s} label={s} selected={subject === s} onClick={() => setSubject(s)} />
            ))}
          </div>
        </div>

        {/* Chapters — live from Admin > Syllabus */}
        <ChapterPicker examType={examType} subject={subject} selected={chapters} onChange={setChapters} />

        {/* Difficulty */}
        <div>
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 block">Difficulty</label>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTIES.map((d) => (
              <Chip key={d} label={d} selected={difficulty === d} onClick={() => setDiff(d)} />
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

        <div className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[11px] text-slate-500">
          <Bell size={13} className="text-slate-400 shrink-0 mt-0.5" />
          Generates in the background — feel free to close this and keep using the app. We'll notify you the moment it's ready.
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-xs text-red-600">
            {error}
          </div>
        )}
        </div>

        {/* Pinned outside the scroll area so it's always reachable. */}
        <div className="p-6 pt-4 border-t border-slate-100 shrink-0">
          <button
            onClick={handleGenerate}
            className="w-full py-4 rounded-2xl bg-primary-600 text-white font-bold flex items-center justify-center gap-2 hover:bg-primary-700 transition-colors"
          >
            <Sparkles size={16} /> Start Generating
          </button>
        </div>
      </motion.div>

      {showPaywall && (
        <PaywallModal
          onClose={() => setShowPaywall(false)}
          feature="AI exam paper generation"
          firebaseUid={currentUser?.uid}
          email={currentUser?.email}
          name={userProfile?.display_name}
        />
      )}
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
    supabase.rpc('student_list_centre_tests', { p_uid: firebaseUid })
      .then(({ data }) => setTests(data ?? []))
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


/* ── Previous Year Papers (from uploaded PYQs) ─────────────── */
function PYQBankSection() {
  const navigate = useNavigate();
  // currentUser is used by handleLaunch below. It was missing from this
  // destructure while GenerateModal and ExamCenterPage both had it, so the
  // reference resolved to nothing in this scope and every "Start PYQ Practice"
  // click died with "currentUser is not defined" before the paper was created.
  const { userProfile, currentUser } = useAuth();
  const [groups,     setGroups]    = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [launching,  setLaunching] = useState(null); // group key being launched

  useEffect(() => {
    supabase
      .from('pyq_questions')
      .select('id, exam_type, subject, chapter, marks, section, question_type, question_text, options, correct_answer, explanation, year, image_url')
      // KB_NOTE rows are content-review chunks, not real questions — they
      // have no answerable options and were showing up as unanswerable
      // "questions" in published tests (e.g. a plain paragraph with no
      // input, no options, yet already marked "answered"). status must also
      // be 'published' — 'in_review' rows haven't been admin-approved yet.
      .neq('question_type', 'KB_NOTE')
      .eq('status', 'published')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const relevant = (data ?? []).filter((q) => isRelevantToStudent(q.exam_type, userProfile));
        if (!relevant.length) { setLoading(false); return; }
        // Group by exam_type + subject
        const map = {};
        relevant.forEach((q) => {
          const key = `${q.exam_type || 'General'}||${q.subject || 'Mixed'}`;
          if (!map[key]) map[key] = { examType: q.exam_type, subject: q.subject, rows: [] };
          map[key].rows.push(q);
        });
        setGroups(Object.values(map));
        setLoading(false);
      });
  }, [userProfile?.syllabus, userProfile?.class_level, userProfile?.target_exam]);

  const handleLaunch = async (group) => {
    const key = `${group.examType}||${group.subject}`;
    setLaunching(key);
    try {
      const title = `${group.examType || 'PYQ'} · ${group.subject} · Question Bank`;
      const dur   = Math.max(10, Math.ceil(group.rows.length * 1.5));
      const pub   = await publishPYQPaper({
        title,
        examType: group.examType || 'CBSE',
        subject:  group.subject  || 'Mixed',
        durationMinutes: dur,
        pyqRows: group.rows,
        // student context
        userId: currentUser?.uid,
      });
      navigate(`/test?id=${pub.id}`);
    } catch (e) {
      alert(`Launch failed: ${e.message}`);
    } finally {
      setLaunching(null);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
      <Loader2 size={14} className="animate-spin" /> Loading previous year papers…
    </div>
  );
  if (!groups.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ClipboardList size={16} className="text-violet-600" />
        <h3 className="font-bold text-slate-900 text-sm">Previous Year Question Papers</h3>
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
          {groups.length} set{groups.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {groups.map((g) => {
          const key        = `${g.examType}||${g.subject}`;
          const isLaunch   = launching === key;
          const chapters   = [...new Set(g.rows.map((r) => r.chapter).filter(Boolean))];
          const totalMarks = g.rows.reduce((s, r) => s + (r.marks ?? 1), 0);
          return (
            <motion.div
              key={key}
              className="card p-4 space-y-3 hover:shadow-md transition-shadow"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">{g.examType || 'General'}</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{g.subject || 'Mixed'}</span>
                  </div>
                  <h4 className="font-semibold text-slate-900 text-sm">{g.examType} {g.subject} PYQ Set</h4>
                </div>
              </div>

              <div className="flex gap-3 text-xs text-slate-500">
                <span className="flex items-center gap-1"><Target size={11} /> {g.rows.length} questions</span>
                <span className="flex items-center gap-1"><Clock size={11} /> ~{Math.ceil(g.rows.length * 1.5)} min</span>
                <span className="flex items-center gap-1">✦ {totalMarks} marks</span>
              </div>

              {chapters.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {chapters.slice(0, 4).map((ch) => (
                    <span key={ch} className="text-[10px] bg-slate-50 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-full">{ch}</span>
                  ))}
                  {chapters.length > 4 && (
                    <span className="text-[10px] text-slate-400">+{chapters.length - 4} more</span>
                  )}
                </div>
              )}

              <button
                onClick={() => handleLaunch(g)}
                disabled={!!launching}
                className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                {isLaunch
                  ? <><Loader2 size={13} className="animate-spin" /> Preparing test…</>
                  : <><Play size={13} /> Start PYQ Practice</>
                }
              </button>
            </motion.div>
          );
        })}
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
        getPublishedTests(currentUser?.uid),
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

  // Paper generation runs in the background and can finish while this page is
  // already open or backgrounded, so the new paper simply never appeared until
  // a manual reload. Refetch when the tab regains focus (covers "generate,
  // switch away, come back") and when the generator reports completion.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') loadPapers(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('ewe:paper-ready', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('ewe:paper-ready', refresh);
    };
  }, [currentUser?.uid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    getFeatureFlag(FLAGS.PAPER_MODE_V2).then(setPaperModeEnabled).catch(() => {});
  }, []);

  // Students only see papers for their own exam type
  // getPublishedTests() is shared with admin screens that need to see drafts
  // too, so it can't filter is_published itself — that check belongs here,
  // at the student-facing consumer. Without it, a draft/unpublished test was
  // fully visible and launchable by students exactly like a real one.
  const gradeFiltered = papers.filter((p) => p.is_published !== false && (!p.exam_type || p.exam_type === userExam));
  const examTypeChips = ['All', ...new Set(gradeFiltered.map((p) => p.exam_type).filter(Boolean))];
  const filtered = filter === 'All'
    ? gradeFiltered
    : gradeFiltered.filter((p) => p.exam_type === filter);

  const handleStart      = (id) => navigate(`/test?id=${id}`);
  const handleStartPaper = (id) => navigate(`/paper-mode?id=${id}`);

  // Generation now runs in the background (Item 2) — there's no synchronous
  // "done" moment from the modal's perspective any more, just "started".
  // The student gets notified (in-app toast + push) when it actually
  // finishes; loadPapers() re-runs naturally next time this page mounts
  // (e.g. via the notification's deep link), so the new paper just appears.
  const handleGenerationStarted = () => {
    setShowModal(false);
  };

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-3xl mx-auto">
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

      {/* Previous year question papers */}
      <PYQBankSection />

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-xs text-slate-400 font-medium">AI-Generated & Admin Papers</span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>

      {/* Filter chips — derived from the student's visible papers so no ghost
          chips appear. Hidden entirely when every paper shares one exam type:
          a Class 12 student saw "All | CBSE Class 12", which filters nothing
          and just restates what they already told us at signup. */}
      {examTypeChips.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {examTypeChips.map((f) => (
            <Chip key={f} label={f} selected={filter === f} onClick={() => setFilter(f)} />
          ))}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="card p-8 flex flex-col items-center justify-center gap-2 text-sm text-slate-500">
          <EweSpinner size="sm" />
          Loading papers…
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
            onStarted={handleGenerationStarted}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
