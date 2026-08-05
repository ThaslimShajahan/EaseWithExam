import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, CheckCircle2, XCircle, RefreshCw, Trophy,
  ArrowRight, ArrowLeft, BookOpen, Send,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  getTodayChallenge, generateDailyChallenge,
  saveChallengeAnswer, getTodayAttempt,
} from '../../lib/dailyChallenge';
import { awardXP } from '../../lib/gamification';
import { createNotification } from '../../lib/notifications';
import { buildExamType } from '../../lib/categories';
import MathText from '../ui/MathText';

const OPT_LETTERS = ['A', 'B', 'C', 'D'];

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-3 bg-amber-200/60 rounded w-2/3" />
      <div className="h-4 bg-amber-200/60 rounded w-full mt-2" />
      <div className="h-4 bg-amber-200/60 rounded w-5/6" />
      <div className="grid grid-cols-2 gap-2 mt-3">
        {[0,1,2,3].map(i => <div key={i} className="h-8 bg-amber-100 rounded-xl" />)}
      </div>
    </div>
  );
}

/* ── Single question view ─────────────────────────────── */
function QuestionSlide({ q, qNum, total, answer, onAnswer, revealed }) {
  const isNumerical = q.type === 'Numerical';
  const [numVal, setNumVal] = useState('');

  const correctLetter = (q.answer ?? '').toUpperCase().trim();

  return (
    <div className="space-y-3">
      {/* Badge row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full uppercase">
          Q{qNum}/{total}
        </span>
        {q.type !== 'MCQ' && (
          <span className="text-[10px] font-semibold text-violet-700 bg-violet-100 px-2 py-0.5 rounded-full">
            {q.type}
          </span>
        )}
      </div>

      {/* Question text */}
      <div className="text-sm text-slate-900 font-medium leading-relaxed whitespace-pre-line">
        <MathText text={q.q} />
      </div>

      {/* Numerical input */}
      {isNumerical ? (
        revealed ? (
          <div className="space-y-1 text-xs">
            <div className={`px-3 py-2 rounded-xl border font-bold ${
              String(answer) === String(q.answer)
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : 'border-red-300 bg-red-50 text-red-700'
            }`}>
              Your answer: {answer || '—'}
              {String(answer) !== String(q.answer) && (
                <span className="text-emerald-700 ml-2">· Correct: {q.answer}</span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="number" step="any"
              value={numVal}
              onChange={(e) => setNumVal(e.target.value)}
              placeholder="Enter numerical answer…"
              className="flex-1 px-3 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-center focus:border-primary-500 outline-none"
            />
            <button
              onClick={() => numVal.trim() && onAnswer(numVal.trim())}
              className="px-4 py-2 bg-primary-600 text-white rounded-xl text-xs font-bold hover:bg-primary-700 transition-colors"
            >
              Lock
            </button>
          </div>
        )
      ) : (
        /* MCQ / Assertion-Reason options */
        <div className="space-y-1.5">
          {(q.opts || []).map((opt, i) => {
            const letter = OPT_LETTERS[i] ?? String.fromCharCode(65 + i);
            const isSelected = answer === letter;
            const isCorrect  = revealed && letter === correctLetter;
            const isWrong    = revealed && isSelected && letter !== correctLetter;
            return (
              <button
                key={i}
                onClick={() => !revealed && onAnswer(letter)}
                disabled={revealed}
                className={[
                  'w-full text-left text-xs px-3 py-2.5 rounded-xl border-2 font-medium transition-all',
                  isCorrect  ? 'border-emerald-400 bg-emerald-50 text-emerald-800' :
                  isWrong    ? 'border-red-400 bg-red-50 text-red-700' :
                  isSelected ? 'border-primary-500 bg-primary-50 text-primary-800' :
                  revealed   ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-default' :
                               'border-slate-200 bg-white text-slate-700 hover:border-primary-300 hover:bg-primary-50/40',
                ].join(' ')}
              >
                <span className="font-bold mr-1.5">{letter}.</span>
                <MathText text={String(opt).replace(/^[A-D]\.\s*/, '')} />
                {isCorrect && <CheckCircle2 size={12} className="inline ml-1 text-emerald-500" />}
                {isWrong   && <XCircle      size={12} className="inline ml-1 text-red-400"     />}
              </button>
            );
          })}
        </div>
      )}

      {/* Explanation — shown after answer */}
      <AnimatePresence>
        {revealed && q.explanation && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} className="overflow-hidden"
          >
            <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-600 leading-relaxed">
              <span className="font-semibold text-slate-700">Explanation: </span>
              <MathText text={q.explanation} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Score summary ────────────────────────────────────── */
function ScoreSummary({ questions, answers, onRetake }) {
  let correct = 0;
  questions.forEach((q, i) => {
    const ans = answers[i];
    const isNum = q.type === 'Numerical';
    if (isNum) {
      if (Math.abs(parseFloat(ans) - parseFloat(q.answer)) < 0.01) correct++;
    } else {
      if ((ans ?? '').toUpperCase() === (q.answer ?? '').toUpperCase()) correct++;
    }
  });
  const pct   = Math.round((correct / questions.length) * 100);
  const grade = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
  const msg   = pct >= 80 ? 'Excellent!' : pct >= 60 ? 'Good effort!' : pct >= 40 ? 'Keep practising!' : 'Review this chapter.';

  return (
    <motion.div className="space-y-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <div className="flex items-center gap-4">
        <div className={`text-3xl font-extrabold ${grade}`}>{correct}/{questions.length}</div>
        <div>
          <p className="text-sm font-bold text-slate-900">{msg}</p>
          <p className="text-[10px] text-slate-500">{pct}% accuracy · {questions.length} questions</p>
        </div>
        <Trophy size={24} className="text-amber-400 ml-auto shrink-0" />
      </div>

      {/* Per-question breakdown */}
      <div className="space-y-1">
        {questions.map((q, i) => {
          const ans   = answers[i];
          const isNum = q.type === 'Numerical';
          const right = isNum
            ? Math.abs(parseFloat(ans) - parseFloat(q.answer)) < 0.01
            : (ans ?? '').toUpperCase() === (q.answer ?? '').toUpperCase();
          const skip  = ans === undefined || ans === '';
          return (
            <div key={i} className="flex items-center gap-2 text-xs">
              {skip ? <span className="h-4 w-4 rounded-full bg-slate-200 flex items-center justify-center text-[9px] text-slate-500">—</span>
                : right ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                : <XCircle size={14} className="text-red-400 shrink-0" />}
              <span className="text-slate-500 shrink-0">Q{i + 1}</span>
              <span className="text-slate-700 truncate flex-1"><MathText text={q.q.slice(0, 60)} /></span>
              {!right && !skip && <span className="text-emerald-600 font-bold shrink-0">→ {q.answer}</span>}
            </div>
          );
        })}
      </div>

      <button
        onClick={onRetake}
        className="w-full text-xs font-semibold text-primary-600 hover:text-primary-700 py-2 border border-primary-200 rounded-xl hover:bg-primary-50 transition-colors flex items-center justify-center gap-1"
      >
        <RefreshCw size={11} /> Generate new mini test
      </button>
    </motion.div>
  );
}

/* ── Main component ───────────────────────────────────── */
export default function DailyChallenge() {
  const { currentUser, userProfile } = useAuth();
  const [challenge,  setChallenge]  = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState('');
  const [curIdx,     setCurIdx]     = useState(0);
  const [answers,    setAnswers]    = useState({});   // { 0: 'A', 1: 'C', 2: '3.14' }
  const [revealed,   setRevealed]   = useState({});   // { 0: true, 1: true, ... }
  const [submitted,  setSubmitted]  = useState(false);

  const examType = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);

  const uid = currentUser?.uid;

  useEffect(() => { if (uid) loadChallenge(); }, [uid]); // eslint-disable-line

  const loadChallenge = async () => {
    setLoading(true); setError('');
    setCurIdx(0); setAnswers({}); setRevealed({}); setSubmitted(false);
    try {
      let c = await getTodayChallenge(uid, examType);
      if (!c) c = await generateDailyChallenge({ examType, userId: uid });
      setChallenge(c);

      // Restore previous attempt if any
      if (c) {
        const prev = await getTodayAttempt(c.id, uid);
        if (prev?.selected_option) {
          try {
            const saved = JSON.parse(prev.selected_option);
            if (typeof saved === 'object') {
              setAnswers(saved);
              const revMap = {};
              Object.keys(saved).forEach((k) => { revMap[k] = true; });
              setRevealed(revMap);
              setSubmitted(true);
            }
          } catch {}
        }
      }
    } catch (e) {
      const msg = e?.message || '';
      setError(msg.includes('does not exist') || msg.includes('42P01')
        ? 'setup_needed' : (msg || 'Failed to load'));
    } finally { setLoading(false); }
  };

  const genNew = async () => {
    setGenerating(true);
    setChallenge(null); setCurIdx(0); setAnswers({}); setRevealed({}); setSubmitted(false); setError('');
    try {
      const c = await generateDailyChallenge({ examType, userId: uid });
      setChallenge(c);
    } catch (e) { setError(e.message); }
    finally { setGenerating(false); }
  };

  /* Parse questions: mini-paper vs legacy single MCQ */
  const questions = (() => {
    if (!challenge) return [];
    if (challenge.correct_answer === 'paper' && Array.isArray(challenge.options)) {
      return challenge.options;
    }
    // Legacy single MCQ row
    return [{
      type: 'MCQ',
      q: challenge.question,
      opts: Array.isArray(challenge.options) ? challenge.options : [],
      answer: challenge.correct_answer,
      explanation: challenge.explanation,
    }];
  })();

  const total = questions.length;

  const handleAnswer = (val) => {
    if (revealed[curIdx]) return;
    setAnswers((a) => ({ ...a, [curIdx]: val }));
    setRevealed((r) => ({ ...r, [curIdx]: true }));
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    const allCorrect = questions.every((q, i) => {
      const ans = answers[i];
      if (q.type === 'Numerical')
        return Math.abs(parseFloat(ans) - parseFloat(q.answer)) < 0.01;
      return (ans ?? '').toUpperCase() === (q.answer ?? '').toUpperCase();
    });
    try {
      await saveChallengeAnswer(challenge.id, uid, JSON.stringify(answers), allCorrect);
      await awardXP(uid, 'daily_challenge');
      createNotification(
        uid,
        'daily_challenge',
        allCorrect ? 'Daily challenge — perfect score!' : 'Daily challenge completed',
        `You answered ${questions.length} question${questions.length > 1 ? 's' : ''} and earned 20 XP.`,
        '/dashboard',
      ).catch(() => {});
    } catch {}
  };

  const allAnswered = total > 0 && Object.keys(answers).length >= total;

  if (!uid) return null;

  return (
    <motion.div
      className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-5 space-y-4"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-amber-400 flex items-center justify-center">
            <Zap size={15} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-slate-900 text-sm">Daily Mini Test</p>
            <p className="text-[10px] text-slate-500">
              {challenge?.subject && `${challenge.exam_type} · ${challenge.subject}`}
              {challenge?.chapter && ` · ${challenge.chapter}`}
              {!challenge && new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </p>
          </div>
        </div>
        {!loading && !generating && (
          <button onClick={genNew}
            className="h-7 w-7 rounded-lg bg-amber-100 flex items-center justify-center text-amber-600 hover:bg-amber-200 transition-colors"
            title="New test">
            <RefreshCw size={12} />
          </button>
        )}
      </div>

      {/* Progress dots */}
      {!loading && !generating && total > 1 && (
        <div className="flex gap-1.5">
          {questions.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurIdx(i)}
              className={[
                'h-2 rounded-full transition-all',
                i === curIdx ? 'w-6 bg-amber-500' :
                answers[i] !== undefined ? 'w-2 bg-emerald-400' : 'w-2 bg-amber-200',
              ].join(' ')}
            />
          ))}
        </div>
      )}

      {/* Content */}
      {(loading || generating) ? (
        <Skeleton />
      ) : error === 'setup_needed' ? (
        <div className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5 border border-amber-200 font-medium">
          Daily challenge needs a one-time database setup. Run <code>daily_challenges.sql</code> in Supabase SQL Editor.
        </div>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-xs text-red-600 font-medium">{error}</p>
          <button onClick={loadChallenge} className="text-xs text-primary-600 font-semibold flex items-center gap-1">
            <RefreshCw size={11} /> Retry
          </button>
        </div>
      ) : submitted ? (
        <ScoreSummary questions={questions} answers={answers} onRetake={genNew} />
      ) : questions.length > 0 ? (
        <AnimatePresence mode="wait">
          <motion.div
            key={curIdx}
            initial={{ x: 30, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -30, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <QuestionSlide
              q={questions[curIdx]}
              qNum={curIdx + 1}
              total={total}
              answer={answers[curIdx]}
              onAnswer={handleAnswer}
              revealed={!!revealed[curIdx]}
            />
          </motion.div>
        </AnimatePresence>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <BookOpen size={28} className="text-amber-400" />
          <p className="text-sm text-slate-600 font-medium">No test yet for today</p>
          <button onClick={loadChallenge} className="text-xs text-primary-600 font-semibold hover:underline">
            Generate today's mini test
          </button>
        </div>
      )}

      {/* Navigation + Submit */}
      {!loading && !generating && !submitted && questions.length > 0 && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => setCurIdx((i) => Math.max(0, i - 1))}
            disabled={curIdx === 0}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-30 transition-colors"
          >
            <ArrowLeft size={12} /> Prev
          </button>

          <div className="flex-1" />

          {curIdx < total - 1 ? (
            <button
              onClick={() => setCurIdx((i) => Math.min(total - 1, i + 1))}
              className={[
                'flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors',
                answers[curIdx] !== undefined
                  ? 'bg-primary-600 text-white hover:bg-primary-700'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
              ].join(' ')}
            >
              Next <ArrowRight size={12} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!allAnswered}
              className="flex items-center gap-1 px-4 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors"
            >
              <Send size={11} /> Finish challenge
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
