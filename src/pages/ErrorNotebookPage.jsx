import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  BookMarked, ArrowLeft, RotateCcw, CheckCircle2, XCircle,
  Flame, Brain, Filter, ChevronRight, Sparkles, Clock,
  Target, TrendingUp, BookOpen, Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import {
  getErrorNotebook, getDueQuestions, getNotebookStats,
  recordReview, getWeakTopics,
} from '../lib/errorNotebook';
import MathText from '../components/ui/MathText';
import HubPageHeader from '../components/ui/HubPageHeader';
import StatCard from '../components/ui/StatCard';
import EmptyState from '../components/ui/EmptyState';

const OPT_LETTERS = ['A', 'B', 'C', 'D'];

const SUBJECT_COLORS = {
  Physics:     'bg-blue-100 text-blue-700',
  Chemistry:   'bg-emerald-100 text-emerald-700',
  Biology:     'bg-violet-100 text-violet-700',
  Mathematics: 'bg-orange-100 text-orange-700',
  General:     'bg-slate-100 text-slate-600',
};

/* ── Stats bar ─────────────────────────────────────────────── */
function StatsBar({ stats }) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard icon={BookMarked}   iconColor="text-slate-600"   iconBg="bg-slate-100" value={stats.total}    label="Total Errors" />
      <StatCard icon={Clock}        iconColor="text-amber-600"   iconBg="bg-amber-50"  value={stats.due}      label="Due Today" />
      <StatCard icon={CheckCircle2} iconColor="text-emerald-600" iconBg="bg-emerald-50" value={stats.mastered} label="Mastered" />
    </div>
  );
}

/* ── Review card (SRS flash card mode) ────────────────────── */
function ReviewSession({ questions, onDone }) {
  const [idx,      setIdx]      = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done,     setDone]     = useState(0);

  const q = questions[idx];

  const rate = async (grade) => {
    await recordReview(q.id, grade).catch(() => {});
    const next = idx + 1;
    if (next >= questions.length) { onDone(next); return; }
    setIdx(next);
    setRevealed(false);
    setDone((d) => d + 1);
  };

  if (!q) return null;

  const progress = ((idx) / questions.length) * 100;

  return (
    <div className="space-y-4">
      {/* Progress */}
      <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
        <span>{idx + 1} of {questions.length}</span>
        <span className="flex items-center gap-1"><CheckCircle2 size={11} className="text-emerald-500" />{done} reviewed</span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <motion.div className="h-full bg-primary-500 rounded-full" style={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
      </div>

      {/* Subject badge */}
      <span className={`inline-flex text-xs font-semibold px-2.5 py-1 rounded-full ${SUBJECT_COLORS[q.subject] || SUBJECT_COLORS.General}`}>
        {q.subject} · {q.topic}
      </span>

      {/* Question card */}
      <motion.div
        key={q.id}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="card border-l-4 border-l-primary-400 space-y-3"
      >
        <p className="text-sm font-medium text-slate-800 leading-relaxed">
          <MathText text={q.question_text} />
        </p>

        {/* Options — always show for MCQ */}
        {q.options && (
          <div className="space-y-1.5">
            {(typeof q.options === 'string' ? JSON.parse(q.options) : q.options).map((opt, i) => {
              const isCorrect  = i === q.correct_option;
              const wasWrong   = String(i) === q.user_answer;
              const showResult = revealed;
              const cls = showResult
                ? isCorrect  ? 'bg-emerald-50 border-emerald-400 text-emerald-800'
                : wasWrong   ? 'bg-red-50 border-red-400 text-red-700'
                : 'border-slate-200 text-slate-500'
                : 'border-slate-200 text-slate-700 hover:border-primary-300 hover:bg-primary-50 cursor-pointer';
              return (
                <div key={i} className={`text-xs px-3 py-2 rounded-xl border flex items-center gap-2 transition-all ${cls}`}>
                  <span className="font-bold shrink-0">{OPT_LETTERS[i]}.</span>
                  <span className="flex-1"><MathText text={opt} /></span>
                  {showResult && isCorrect  && <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />}
                  {showResult && wasWrong && !isCorrect && <XCircle size={13} className="text-red-500 shrink-0" />}
                </div>
              );
            })}
          </div>
        )}

        {/* Numerical answer display */}
        {q.question_type === 'Numerical' && revealed && (
          <div className="text-sm space-y-1">
            <span className="text-slate-500">Your answer: </span>
            <span className="font-bold text-red-600">{q.user_answer}</span>
            <span className="text-slate-400 mx-2">→ Correct: </span>
            <span className="font-bold text-emerald-700">{q.correct_answer}</span>
          </div>
        )}

        {/* Explanation */}
        {revealed && q.explanation && (
          <div className="bg-primary-50 rounded-xl p-3 text-xs text-slate-700 leading-relaxed border border-primary-100">
            <span className="font-semibold text-primary-700">Explanation: </span>
            <MathText text={q.explanation} />
          </div>
        )}
      </motion.div>

      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full py-3 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 transition-colors"
        >
          Reveal Answer
        </button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-center text-slate-500 mb-2">How well did you remember?</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { grade: 1, label: 'Forgot',  cls: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' },
              { grade: 3, label: 'Hard',    cls: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100' },
              { grade: 5, label: 'Easy',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
            ].map(({ grade, label, cls }) => (
              <button
                key={grade}
                onClick={() => rate(grade)}
                className={`py-2.5 rounded-xl border font-semibold text-sm transition-all ${cls}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Error list item ────────────────────────────────────────── */
function ErrorItem({ item, onExpand, isOpen }) {
  const opts = item.options ? (typeof item.options === 'string' ? JSON.parse(item.options) : item.options) : [];
  return (
    <div className="card border border-slate-100 overflow-hidden">
      <button
        onClick={onExpand}
        className="w-full text-left flex items-start gap-3 p-4 hover:bg-slate-50 transition-colors"
      >
        <div className={`h-6 w-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${item.is_mastered ? 'bg-emerald-100' : 'bg-red-100'}`}>
          {item.is_mastered
            ? <CheckCircle2 size={13} className="text-emerald-600" />
            : <XCircle size={13} className="text-red-500" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SUBJECT_COLORS[item.subject] || SUBJECT_COLORS.General}`}>
              {item.subject}
            </span>
            <span className="text-[10px] text-slate-400">{item.topic}</span>
            {item.is_mastered && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Mastered</span>}
          </div>
          <p className="text-sm text-slate-800 line-clamp-2 leading-snug">
            <MathText text={item.question_text} />
          </p>
        </div>
        <ChevronRight size={14} className={`text-slate-400 shrink-0 transition-transform mt-1 ${isOpen ? 'rotate-90' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
              {opts.length > 0 && (
                <div className="space-y-1.5 pt-3">
                  {opts.map((opt, i) => {
                    const isCorrect = i === item.correct_option;
                    const wasWrong  = String(i) === item.user_answer;
                    const cls = isCorrect
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                      : wasWrong ? 'bg-red-50 border-red-300 text-red-700'
                      : 'border-slate-100 text-slate-600';
                    return (
                      <div key={i} className={`text-xs px-3 py-2 rounded-xl border flex items-center gap-2 ${cls}`}>
                        <span className="font-bold shrink-0">{OPT_LETTERS[i]}.</span>
                        <span className="flex-1"><MathText text={opt} /></span>
                        {isCorrect && <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />}
                        {wasWrong && !isCorrect && <span className="text-red-500 text-[10px] shrink-0 font-bold">Your pick</span>}
                      </div>
                    );
                  })}
                </div>
              )}
              {item.explanation && (
                <div className="bg-slate-50 rounded-xl p-3 text-xs text-slate-600 leading-relaxed">
                  <span className="font-semibold">Explanation: </span>
                  <MathText text={item.explanation} />
                </div>
              )}
              <div className="flex items-center gap-3 text-[10px] text-slate-400">
                <span>Source: {item.source_name || item.source}</span>
                <span>Interval: {item.interval_days}d</span>
                <span>Next: {item.due_date}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function ErrorNotebookPage() {
  const { currentUser, userProfile, isPremium } = useAuth();
  const navigate = useNavigate();

  const [mode,        setMode]        = useState('list'); // list | review | done
  const [tab,         setTab]         = useState('due');  // due | all | weak
  const [filter,      setFilter]      = useState('All');
  const [loading,     setLoading]     = useState(true);
  const [loadError,   setLoadError]   = useState('');
  const [stats,       setStats]       = useState({ total: 0, due: 0, mastered: 0 });
  const [dueItems,    setDueItems]    = useState([]);
  const [allItems,    setAllItems]    = useState([]);
  const [weakTopics,  setWeakTopics]  = useState([]);
  const [expandedId,  setExpandedId]  = useState(null);
  const [reviewDone,  setReviewDone]  = useState(0);

  const uid = currentUser?.uid;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const [s, due, all, weak] = await Promise.all([
        getNotebookStats(uid),
        getDueQuestions(uid, 30),
        getErrorNotebook(uid, { limit: 50 }),
        getWeakTopics(uid, 8),
      ]);
      setStats(s);
      setDueItems(due);
      setAllItems(all);
      setWeakTopics(weak);
    } catch (e) { setLoadError(e.message || 'Failed to load error notebook.'); }
    finally { setLoading(false); }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const subjects = ['All', ...new Set(allItems.map(i => i.subject))];
  const filtered = tab === 'due' ? dueItems
    : allItems.filter(i => filter === 'All' || i.subject === filter);

  if (mode === 'review') {
    const reviewQ = dueItems.slice(0, 10);
    return (
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <button onClick={() => { setMode('list'); load(); }}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <ArrowLeft size={15} /> Back to Notebook
        </button>
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-primary-500" />
          <h2 className="text-lg font-bold text-slate-900">Spaced Revision</h2>
        </div>
        <ReviewSession questions={reviewQ} onDone={(n) => {
          setReviewDone(n);
          setMode('done');
          if (uid) {
            createNotification(
              uid,
              'review_complete',
              `Spaced review done! ${n} question${n !== 1 ? 's' : ''} revised`,
              'Great consistency — your error notebook is getting shorter every session.',
              '/notebook',
            ).catch(() => {});
          }
        }} />
      </div>
    );
  }

  if (mode === 'done') {
    return (
      <div className="max-w-lg mx-auto p-4 flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <CheckCircle2 size={36} className="text-emerald-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Session Complete!</h2>
        <p className="text-slate-500 text-sm">You reviewed {reviewDone} questions. See you next time — spaced repetition is working!</p>
        <button onClick={() => { setMode('list'); load(); }}
          className="px-6 py-2.5 bg-primary-600 text-white rounded-xl font-semibold text-sm hover:bg-primary-700 transition-colors">
          Back to Notebook
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-2xl">
      <HubPageHeader
        icon={BookMarked}
        title="Error Notebook"
        subtitle="Spaced repetition — review at the perfect moment"
        right={!isPremium && (
          <button onClick={() => navigate('/pricing')}
            className="shrink-0 flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full hover:bg-amber-100 transition-colors">
            <Zap size={11} /> Premium
          </button>
        )}
      />

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="card h-20 bg-slate-50 animate-pulse" />)}
        </div>
      ) : loadError ? (
        <div className="rounded-card bg-danger-light border border-danger/20 p-5 text-center">
          <p className="text-sm font-semibold text-danger">Failed to load your notebook</p>
          <p className="text-xs text-slate-500 mt-1">{loadError}</p>
          <button onClick={load} className="mt-3 text-xs font-semibold text-primary-600 hover:underline">Try again</button>
        </div>
      ) : (
        <>
          {/* Stats */}
          <StatsBar stats={stats} />

          {/* Review CTA */}
          {stats.due > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="card bg-gradient-to-r from-primary-500 to-primary-700 text-white border-0"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Flame size={16} className="text-amber-300" />
                    <span className="font-bold text-sm">{stats.due} questions due for review</span>
                  </div>
                  <p className="text-primary-200 text-xs">Don't let them slip from memory</p>
                </div>
                <button
                  onClick={() => setMode('review')}
                  className="shrink-0 bg-white/20 hover:bg-white/30 text-white font-semibold text-sm px-4 py-2 rounded-xl border border-white/30 transition-colors"
                >
                  Start Review
                </button>
              </div>
            </motion.div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {[
              { id: 'due',  label: `Due (${stats.due})` },
              { id: 'all',  label: `All (${stats.total})` },
              { id: 'weak', label: `Weak Topics` },
            ].map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Subject filter (all tab) */}
          {tab === 'all' && subjects.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {subjects.map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                    filter === s ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300'
                  }`}>{s}</button>
              ))}
            </div>
          )}

          {/* Weak Topics tab */}
          {tab === 'weak' && (
            <div className="space-y-2">
              {weakTopics.length === 0 ? (
                <div className="card">
                  <EmptyState icon={Target} title="No weak topics yet" body="Complete some practice sessions to identify your weak areas." size="sm" />
                </div>
              ) : weakTopics.map((t, i) => (
                <motion.div key={i}
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                  className="card flex items-center gap-4 p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${SUBJECT_COLORS[t.subject] || SUBJECT_COLORS.General}`}>{t.subject}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-800 truncate">{t.topic}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{t.total_attempts} attempts · {t.wrong_count} wrong</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-lg font-bold ${t.accuracy_pct < 40 ? 'text-red-500' : t.accuracy_pct < 60 ? 'text-amber-500' : 'text-emerald-600'}`}>
                      {t.accuracy_pct}%
                    </p>
                    <button
                      onClick={() => navigate(`/practice/generate?subject=${t.subject}&topic=${t.topic}`)}
                      className="text-[10px] text-primary-600 hover:underline mt-0.5 flex items-center gap-0.5 ml-auto"
                    >
                      Practice <ChevronRight size={10} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Question list */}
          {(tab === 'due' || tab === 'all') && (
            <div className="space-y-2">
              {filtered.length === 0 ? (
                <div className="card">
                  <EmptyState
                    icon={BookOpen}
                    title={tab === 'due' ? 'No questions due — check back tomorrow!' : 'No errors recorded yet.'}
                    body={tab === 'due' && stats.total === 0 ? 'Complete a practice session to start building your notebook.' : undefined}
                    size="sm"
                  />
                </div>
              ) : (
                filtered.map((item) => (
                  <ErrorItem
                    key={item.id}
                    item={item}
                    isOpen={expandedId === item.id}
                    onExpand={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  />
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
