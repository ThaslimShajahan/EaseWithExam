import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Bookmark, Send, X,
  Trophy, CheckCircle2, XCircle, MinusCircle, RotateCcw, Clock,
  Zap, AlertCircle, TrendingUp, LayoutGrid, Loader2, BookOpen,
  FileImage, ChevronDown, ChevronUp,
} from 'lucide-react';
import { chatComplete } from '../../lib/aiProxy';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { SAMPLE_QUESTIONS, SAMPLE_NEET_TEST } from '../../data/sampleQuestions';
import { useAuth } from '../../context/AuthContext';
import { saveTestSession, clearExamAttemptMode, lockExamAttemptMode } from '../../lib/supabase';
import { awardXP, incrementActivityCount } from '../../lib/gamification';
import { saveWrongAnswers } from '../../lib/errorNotebook';
import { createNotification } from '../../lib/notifications';
import { checkQuota, incrementQuota } from '../../lib/quota';
import QuestionView from './QuestionView';
import QuestionPalette from './QuestionPalette';
import ProgressShareCard from './ProgressShareCard';
import Button from '../ui/Button';
import MathText from '../ui/MathText';

const OPT_LETTERS = ['A', 'B', 'C', 'D'];

/* ─── helpers ──────────────────────────────────────────────── */
function numericalCorrect(sel, correct) {
  const u = parseFloat(String(sel ?? '').trim());
  const c = parseFloat(String(correct ?? '').trim());
  return !isNaN(u) && !isNaN(c) && Math.abs(u - c) < 0.01;
}

function getAnswerValue(ans) {
  if (ans === undefined || ans === null || ans === '') return undefined;
  if (typeof ans === 'object') {
    return (ans.text?.trim() || ans.imageDataUrl) ? ans : undefined;
  }
  return ans;
}

function isDescriptiveType(type) {
  return type === 'Short Answer' || type === 'Long Answer';
}

/* ─── AI evaluation of descriptive answers ─────────────────── */
async function evaluateDescriptiveAnswers(questions, answers) {
  const toEvaluate = questions.filter(
    (q) => isDescriptiveType(q.type) && getAnswerValue(answers[q.id]) !== undefined
  );
  if (!toEvaluate.length) return {};

  const settled = await Promise.allSettled(
    toEvaluate.map(async (q) => {
      const ans     = answers[q.id] || {};
      const maxM    = typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 2);
      const chapter = q.chapter || q.topic || '';

      const textPart = {
        type: 'text',
        text: `You are an experienced school teacher evaluating a student's exam answer.

Question: ${q.question}
Subject: ${q.subject || ''}${chapter ? ' | Chapter: ' + chapter : ''}
Maximum marks: ${maxM}
${q.explanation ? 'Model answer / Key points: ' + q.explanation : ''}

Student's typed answer: "${ans.text || '(none)'}"
${ans.imageDataUrl ? 'The student has also uploaded a handwritten answer image — evaluate it as their primary answer.' : ''}

Evaluate fairly and award partial marks where the student shows partial understanding.
Return JSON only:
{
  "marksAwarded": <integer 0–${maxM}>,
  "feedback": "<2 sentences: what the student got right and what is missing>",
  "correctAnswer": "<brief model answer in 1-2 sentences>"
}`,
      };

      const msgContent = ans.imageDataUrl
        ? [textPart, { type: 'image_url', image_url: { url: ans.imageDataUrl, detail: 'high' } }]
        : [textPart];

      const resp = await chatComplete({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: msgContent }],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0,
      });

      const ev = JSON.parse(resp.choices[0].message.content);
      return { id: q.id, ...ev };
    })
  );

  const map = {};
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const { id, ...ev } = r.value;
      map[id] = ev;
    } else {
      map[toEvaluate[i].id] = {
        marksAwarded: 0,
        feedback: 'Could not evaluate automatically. Please review with your teacher.',
        correctAnswer: '',
      };
    }
  });
  return map;
}

/* ─── computeResults ────────────────────────────────────────── */
function computeResults(questions, answers, evaluations = {}) {
  let correct = 0, wrong = 0, skipped = 0, score = 0, totalMarks = 0;
  const bySubject = {};

  questions.forEach((q) => {
    const subj   = q.subject || 'General';
    const maxM   = typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4);
    // Integer marks = CBSE/board style → no negative marking
    const negM   = typeof q.marks === 'number' ? 0 : (q.marks?.incorrect ?? -1);
    if (!bySubject[subj]) bySubject[subj] = { correct: 0, wrong: 0, skipped: 0, total: 0, score: 0, maxScore: 0 };
    bySubject[subj].total++;
    bySubject[subj].maxScore += maxM;
    totalMarks += maxM;

    const sel = answers[q.id];

    if (isDescriptiveType(q.type)) {
      const ev = evaluations[q.id];
      const awarded = ev?.marksAwarded ?? 0;
      score += awarded;
      bySubject[subj].score += awarded;
      const hasAnswer = getAnswerValue(sel) !== undefined;
      if (!hasAnswer) { skipped++; bySubject[subj].skipped++; }
      else if (awarded >= maxM * 0.5) { correct++; bySubject[subj].correct++; }
      else { wrong++; bySubject[subj].wrong++; }
      return;
    }

    const isNum   = q.type === 'Numerical';
    const isRight = isNum
      ? numericalCorrect(sel, q.correctAnswer)
      : sel === q.correctOption;

    if (sel === undefined || sel === '') {
      skipped++; bySubject[subj].skipped++;
    } else if (isRight) {
      correct++; bySubject[subj].correct++;
      score += maxM;
      bySubject[subj].score += maxM;
    } else {
      wrong++; bySubject[subj].wrong++;
      if (!isNum) { score += negM; bySubject[subj].score += negM; }
    }
  });

  const pct = totalMarks > 0 ? Math.max(0, Math.round((score / totalMarks) * 100)) : 0;
  return { correct, wrong, skipped, score, totalMarks, pct, bySubject };
}

/* ─── Result screen ─────────────────────────────────────────── */
function ResultScreen({ questions, answers, results, evaluations, timeTaken, testTitle, onRetake, saveError, onRetrySave, gradingLimited }) {
  const navigate = useNavigate();
  const [showShare,  setShowShare]  = useState(false);
  const [expandedQ,  setExpandedQ]  = useState(new Set());
  const [reviewFilter, setReviewFilter] = useState('all'); // 'all' | 'wrong' | 'skipped' | 'correct'
  const { currentUser, userProfile } = useAuth();

  if (!results) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-slate-400 text-sm">Computing results…</div>
      </div>
    );
  }

  const { correct, wrong, skipped, score, totalMarks, pct, bySubject } = results;
  const grade   = pct >= 70 ? '#10B981' : pct >= 50 ? '#F59E0B' : '#EF4444';
  const mins    = Math.floor(timeTaken / 60);
  const secs    = timeTaken % 60;

  const toggleExpand = (id) =>
    setExpandedQ((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <motion.div className="min-h-screen bg-slate-50 pb-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Header */}
      <div className="bg-white/90 backdrop-blur-xl border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <button onClick={() => navigate('/practice')}
          className="flex items-center gap-1.5 text-sm text-slate-600 font-medium hover:text-slate-900">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-1.5">
          <Trophy size={16} className="text-amber-500" />
          <span className="font-bold text-slate-900 text-sm">Test Complete</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setShowShare(true)}
            className="flex items-center gap-1 text-xs text-violet-600 font-medium">
            <TrendingUp size={12} /> Share
          </button>
          <button onClick={onRetake}
            className="flex items-center gap-1 text-xs text-primary-600 font-medium">
            <RotateCcw size={12} /> Retake
          </button>
        </div>
      </div>

      {showShare && (
        <ProgressShareCard
          name={userProfile?.display_name || currentUser?.displayName}
          score={score} totalMarks={totalMarks} pct={pct} correct={correct}
          examType={userProfile?.target_exam || 'Exam'} streak={null}
          onClose={() => setShowShare(false)}
        />
      )}

      <div className="p-4 space-y-4 max-w-2xl mx-auto">
        {/* Save-failure warning — result is scored and shown below, but if this
            wasn't actually saved to your account, it won't show up in Analytics
            or history later. Previously this failed completely silently. */}
        {saveError && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">Result not saved yet</p>
              <p className="text-xs text-amber-700 mt-0.5">Your score is shown below, but it hasn't been saved to your account — it won't appear in Analytics until this succeeds. Check your connection and retry.</p>
            </div>
            <button
              onClick={onRetrySave}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {gradingLimited && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">Descriptive answers not AI-graded</p>
              <p className="text-xs text-amber-700 mt-0.5">You've reached today's AI evaluation limit, so your Short/Long Answer responses aren't scored below — your MCQ/objective score is still accurate. Upgrade to Premium for unlimited AI grading.</p>
            </div>
          </div>
        )}

        {/* Score card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 flex items-center gap-5">
          <div className="relative h-24 w-24 shrink-0">
            <svg viewBox="0 0 100 100" className="rotate-[-90deg] w-full h-full">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#E2E8F0" strokeWidth="12" />
              <motion.circle cx="50" cy="50" r="40" fill="none" stroke={grade} strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 40 * pct / 100} ${2 * Math.PI * 40}`}
                initial={{ strokeDasharray: `0 ${2 * Math.PI * 40}` }}
                animate={{ strokeDasharray: `${2 * Math.PI * 40 * pct / 100} ${2 * Math.PI * 40}` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold text-slate-900">{pct}%</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-slate-400 truncate mb-0.5">{testTitle}</p>
            <p className={`text-2xl font-extrabold ${score < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {score}<span className="text-sm font-normal text-slate-400"> / {totalMarks}</span>
            </p>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <Clock size={11} /> {mins}m {secs}s
            </p>
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { label: 'Correct', val: correct, icon: CheckCircle2, col: 'text-emerald-600' },
                { label: 'Wrong',   val: wrong,   icon: XCircle,      col: 'text-red-500'    },
                { label: 'Skipped', val: skipped, icon: MinusCircle,  col: 'text-slate-400'  },
              ].map(({ label, val, icon: Icon, col }) => (
                <div key={label} className="flex items-center gap-1">
                  <Icon size={13} className={col} />
                  <span className={`text-sm font-bold ${col}`}>{val}</span>
                  <span className="text-[10px] text-slate-400">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Subject breakdown */}
        {Object.keys(bySubject).length > 1 && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3">
            <h3 className="font-semibold text-slate-900 text-sm">Subject Breakdown</h3>
            {Object.entries(bySubject).map(([subj, s]) => {
              const sp  = s.maxScore > 0 ? Math.round((s.score / s.maxScore) * 100) : 0;
              const col = sp >= 70 ? '#10B981' : sp >= 50 ? '#F59E0B' : '#EF4444';
              return (
                <div key={subj}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-slate-700">{subj}</span>
                    <span className="text-slate-500">{s.score}/{s.maxScore} · {sp}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ backgroundColor: col }}
                      initial={{ width: 0 }} animate={{ width: `${sp}%` }} transition={{ duration: 0.7 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Question-by-question review ─────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <h3 className="text-sm font-bold text-slate-700">Question Review</h3>
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {[
              { key: 'all',     label: 'All' },
              { key: 'wrong',   label: `Wrong (${results.wrong})` },
              { key: 'skipped', label: `Skipped (${results.skipped})` },
              { key: 'correct', label: `Correct (${results.correct})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setReviewFilter(key)}
                className={[
                  'text-[10px] font-semibold px-2 py-1 rounded-lg transition-colors',
                  reviewFilter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {questions.map((q, i) => {
            const sel          = answers[q.id];
            const isDescr      = isDescriptiveType(q.type);
            const isNum        = q.type === 'Numerical';
            const ev           = evaluations[q.id];
            const maxM         = typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4);
            const chapter      = q.chapter || q.topic;

            let status;
            if (isDescr) {
              const hasAns = getAnswerValue(sel) !== undefined;
              status = !hasAns ? 'skipped' : (ev?.marksAwarded ?? 0) >= maxM * 0.5 ? 'correct' : 'partial';
            } else {
              const isRight = isNum ? numericalCorrect(sel, q.correctAnswer) : sel === q.correctOption;
              status = (sel === undefined || sel === '') ? 'skipped' : isRight ? 'correct' : 'wrong';
            }

            const borderCol  = status === 'correct' ? 'border-l-emerald-400' : status === 'partial' ? 'border-l-amber-400' : status === 'wrong' ? 'border-l-red-400' : 'border-l-slate-200';
            const StatusIcon = status === 'correct' ? CheckCircle2 : status === 'partial' ? AlertCircle : status === 'wrong' ? XCircle : MinusCircle;
            const iconCol    = status === 'correct' ? 'text-emerald-500' : status === 'partial' ? 'text-amber-500' : status === 'wrong' ? 'text-red-500' : 'text-slate-400';

            // Apply review filter — 'partial' counts as wrong bucket for filter
            const filterStatus = status === 'partial' ? 'wrong' : status;
            if (reviewFilter !== 'all' && filterStatus !== reviewFilter) return null;

            const expanded = expandedQ.has(q.id);

            return (
              <div key={q.id} className={`bg-white rounded-2xl border-l-4 ${borderCol} shadow-sm overflow-hidden`}>
                {/* Question header — always visible */}
                <button
                  className="w-full text-left p-4 space-y-2"
                  onClick={() => toggleExpand(q.id)}
                >
                  <div className="flex items-start gap-2">
                    <StatusIcon size={15} className={`${iconCol} shrink-0 mt-0.5`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-xs font-bold text-slate-500">Q{i + 1}</span>
                        {/* Chapter badge — prominent */}
                        {chapter && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-primary-700 bg-primary-50 border border-primary-100 px-2 py-0.5 rounded-full">
                            <BookOpen size={9} /> {chapter}
                          </span>
                        )}
                        {/* Marks badge */}
                        <span className="text-[10px] font-bold text-slate-500 ml-auto">
                          {isDescr && ev ? `${ev.marksAwarded}/${maxM} marks` : `[${maxM}]`}
                        </span>
                      </div>
                      <p className="text-sm text-slate-800 font-medium leading-snug line-clamp-2">
                        <MathText text={q.question} />
                      </p>
                    </div>
                    {expanded ? <ChevronUp size={14} className="text-slate-400 shrink-0" /> : <ChevronDown size={14} className="text-slate-400 shrink-0" />}
                  </div>
                </button>

                {/* Expanded detail */}
                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-3 border-t border-slate-50 pt-3">
                        {/* Numerical */}
                        {isNum && (
                          <div className="text-xs space-y-1">
                            <span className="text-slate-500">Your answer: </span>
                            <span className={status === 'correct' ? 'font-bold text-emerald-700' : 'font-bold text-red-600'}>
                              {sel ?? '—'}
                            </span>
                            {status !== 'correct' && (
                              <><span className="text-slate-400"> · Correct: </span>
                              <span className="font-bold text-emerald-700">{q.correctAnswer}</span></>
                            )}
                          </div>
                        )}

                        {/* MCQ options */}
                        {!isNum && !isDescr && q.options && (
                          <div className="space-y-1.5">
                            {q.options.map((opt, oi) => {
                              const isCorrect  = oi === q.correctOption;
                              const isSelected = oi === sel;
                              const cls = isCorrect
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                : isSelected ? 'bg-red-50 text-red-700 border-red-300'
                                : 'text-slate-500 border-transparent';
                              return (
                                <div key={oi} className={`text-xs px-2 py-1.5 rounded-lg border ${cls} flex items-start gap-1`}>
                                  <span className="font-bold shrink-0">{OPT_LETTERS[oi]}.</span>
                                  <span className="flex-1"><MathText text={opt} /></span>
                                  {isCorrect  && <span className="ml-1 font-bold text-emerald-700 shrink-0">✓ Correct</span>}
                                  {isSelected && !isCorrect && <span className="ml-1 font-bold text-red-600 shrink-0">✗ Your answer</span>}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Descriptive — student's answer + AI evaluation */}
                        {isDescr && (
                          <div className="space-y-3">
                            {/* Student's submitted answer */}
                            <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                              <p className="text-[10px] font-bold text-slate-400 uppercase">Your Answer</p>
                              {sel?.imageDataUrl && (
                                <img src={sel.imageDataUrl} alt="Your answer" className="w-full rounded-lg border border-slate-200 max-h-48 object-contain bg-white" />
                              )}
                              {sel?.text && <p className="text-xs text-slate-700 leading-relaxed">{sel.text}</p>}
                              {!sel?.imageDataUrl && !sel?.text && <p className="text-xs text-slate-400 italic">No answer submitted</p>}
                            </div>

                            {/* AI evaluation */}
                            {ev ? (
                              <div className={`rounded-xl p-3 space-y-2 ${ev.marksAwarded >= maxM * 0.5 ? 'bg-emerald-50 border border-emerald-100' : 'bg-amber-50 border border-amber-100'}`}>
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] font-bold text-slate-500 uppercase">AI Evaluation</p>
                                  <span className={`text-xs font-extrabold ${ev.marksAwarded >= maxM * 0.5 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                    {ev.marksAwarded}/{maxM} marks
                                  </span>
                                </div>
                                <p className="text-xs text-slate-700 leading-relaxed">{ev.feedback}</p>
                                {ev.correctAnswer && ev.marksAwarded < maxM && (
                                  <div className="border-t border-slate-100 pt-2">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Model Answer</p>
                                    <p className="text-xs text-slate-600 leading-relaxed">{ev.correctAnswer}</p>
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-400 italic">No evaluation available</p>
                            )}
                          </div>
                        )}

                        {/* Explanation — always shown for wrong/skipped MCQ */}
                        {!isDescr && q.explanation && (status === 'wrong' || status === 'skipped') && (
                          <div className="bg-primary-50 rounded-xl p-3 border border-primary-100">
                            <p className="text-[10px] font-bold text-primary-600 uppercase mb-1">Explanation</p>
                            <p className="text-xs text-slate-700 leading-relaxed">
                              <MathText text={q.explanation} />
                            </p>
                          </div>
                        )}

                        {/* For correct answers: show explanation only if user taps expand */}
                        {!isDescr && q.explanation && status === 'correct' && (
                          <details className="text-xs">
                            <summary className="text-primary-500 font-medium cursor-pointer">View explanation</summary>
                            <p className="mt-2 text-slate-600 leading-relaxed pl-2">
                              <MathText text={q.explanation} />
                            </p>
                          </details>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Exam start screen ─────────────────────────────────────── */
function ExamStartScreen({ testConfig, questions, hasSavedProgress, onBack, onStart, onResume }) {
  const [agreed, setAgreed] = useState(false);
  const navigate = useNavigate();

  const subjects = [...new Set(questions.map((q) => q.subject).filter(Boolean))];
  const totalMarks = questions.reduce((sum, q) => sum + (typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4)), 0);
  const hasDescriptive = questions.some((q) => isDescriptiveType(q.type));

  const bySubject = subjects.map((s) => ({
    subject: s,
    count: questions.filter((q) => q.subject === s).length,
    marks: questions.filter((q) => q.subject === s).reduce((sum, q) => sum + (typeof q.marks === 'number' ? q.marks : (q.marks?.correct ?? 4)), 0),
  }));

  return (
    <motion.div className="min-h-screen bg-slate-100 flex flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {/* Paper header */}
      <div className="bg-primary-700 text-white">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-4">
          <button onClick={onBack} className="p-2 rounded-lg hover:bg-white/10">
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <p className="text-[10px] text-primary-200 font-semibold uppercase tracking-widest">Online Examination</p>
            <h1 className="text-lg font-bold leading-tight">{testConfig.title}</h1>
          </div>
          <div className="hidden sm:grid grid-cols-3 gap-4 text-center">
            {[
              { label: 'Questions',  value: questions.length },
              { label: 'Duration',   value: `${testConfig.duration} min` },
              { label: 'Max Marks',  value: totalMarks },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xl font-extrabold">{value}</p>
                <p className="text-[10px] text-primary-300">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 space-y-4">
        {/* Section breakdown */}
        {bySubject.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
              <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Subject / Section Distribution</p>
            </div>
            <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
              {bySubject.map(({ subject, count, marks }) => (
                <div key={subject} className="px-4 py-3 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary-50 flex items-center justify-center text-xs font-extrabold text-primary-700 shrink-0">
                    {subject[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{subject}</p>
                    <p className="text-xs text-slate-400">{count} questions · {marks} marks</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resume banner */}
        {hasSavedProgress && (
          <div className="bg-violet-50 border border-violet-200 rounded-2xl p-4 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
              <RotateCcw size={18} className="text-violet-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-violet-900">Saved progress found</p>
              <p className="text-xs text-violet-600 mt-0.5">Resume where you left off, or start fresh below.</p>
            </div>
            <button
              onClick={onResume}
              className="shrink-0 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 transition-colors"
            >
              Resume →
            </button>
          </div>
        )}

        {/* Descriptive notice */}
        {hasDescriptive && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-start gap-3">
            <FileImage size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-amber-800">This paper has descriptive questions</p>
              <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                For Short Answer and Long Answer questions you can type your answer OR upload a photo of your handwritten work.
                AI will evaluate your descriptive answers when you submit.
              </p>
            </div>
          </div>
        )}

        {/* Instructions — use testConfig.instructions if provided, else sensible defaults */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-600 shrink-0" />
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">General Instructions</p>
          </div>
          <ul className="px-4 py-3 space-y-2">
            {(testConfig.instructions?.length
              ? testConfig.instructions
              : [
                  `Total: ${questions.length} questions · ${totalMarks} marks · ${testConfig.duration} minutes`,
                  'MCQ/Numerical: marks awarded automatically.',
                  'Short Answer / Long Answer: type or upload handwritten answer. AI evaluates on submit.',
                  'You may mark questions for review and come back later.',
                  'Timer auto-submits when time expires.',
                  'Progress is auto-saved — refresh will offer to resume.',
                ]
            ).map((ins, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                <span className="h-4 w-4 rounded-full bg-primary-100 text-primary-700 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {ins}
              </li>
            ))}
          </ul>
        </div>

        {/* Agree + Start */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
            <span className="text-sm text-slate-700 leading-relaxed">
              I have read all the instructions and agree to follow the examination rules.
            </span>
          </label>
          <Button variant="primary" size="lg" full onClick={onStart} disabled={!agreed}>
            {hasSavedProgress ? 'Start Fresh →' : 'Begin Examination →'}
          </Button>
          <button
            onClick={() => navigate('/paper-mode', {
              state: {
                questions,
                title:    testConfig.title,
                examType: testConfig.examType ?? '',
                subject:  questions[0]?.subject ?? '',
              },
            })}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 text-sm font-semibold hover:border-primary-300 hover:text-primary-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>
            Paper Mode — Print &amp; Write on Paper Instead
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ─── Main engine ───────────────────────────────────────────── */
export default function MockTestEngine({
  questions  = SAMPLE_QUESTIONS,
  testConfig = SAMPLE_NEET_TEST,
  testId     = null,
}) {
  const totalSeconds    = (testConfig.duration ?? 180) * 60;
  const { currentUser, userProfile, isPremium } = useAuth();
  const isDesktop       = useIsDesktop();
  const navigate        = useNavigate();

  const storageKey = `ewe_exam_${String(testConfig?.title || '').replace(/\W+/g, '_').slice(0, 40)}`;

  const [status,       setStatus]       = useState('not_started');
  const [currentIdx,   setCurrentIdx]   = useState(0);
  const [answers,      setAnswers]      = useState({});
  const [evaluations,  setEvaluations]  = useState({});
  const [marked,       setMarked]       = useState(new Set());
  const [visited,      setVisited]      = useState(new Set([0]));
  const [secondsLeft,  setSecondsLeft]  = useState(totalSeconds);
  const [direction,    setDirection]    = useState(1);
  const [paletteOpen,  setPaletteOpen]  = useState(false);
  const [submitOpen,   setSubmitOpen]   = useState(false);
  const [results,      setResults]      = useState(null);
  const [timeTaken,    setTimeTaken]    = useState(0);
  const [evalProgress, setEvalProgress] = useState('');
  const [gradingLimited, setGradingLimited] = useState(false);
  const [saveError,    setSaveError]    = useState('');
  const [hasSaved,     setHasSaved]     = useState(() => {
    try { return !!localStorage.getItem(storageKey); } catch { return false; }
  });

  const timerRef        = useRef(null);
  const touchStartX     = useRef(null);
  const qStartRef       = useRef(Date.now());
  const qTimesRef       = useRef({});
  const secondsLeftRef  = useRef(totalSeconds);
  const finishTestRef   = useRef(null); // always points to the latest finishTest closure

  const question   = questions[currentIdx];
  const isMarked   = marked.has(question?.id);
  const answered   = Object.values(answers).filter((a) => getAnswerValue(a) !== undefined).length;
  const isLast     = currentIdx === questions.length - 1;
  const isAnswered = question ? getAnswerValue(answers[question.id]) !== undefined : false;

  /* ── Timer ── */
  useEffect(() => {
    if (status !== 'in_progress') return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        const next = s - 1;
        secondsLeftRef.current = next;
        // Persist secondsLeft periodically (not just on answer/nav changes — see
        // the persist-on-change effect below). Without this, a student who sits
        // on one question for minutes without answering or navigating keeps a
        // STALE secondsLeft in localStorage; refreshing then resumes with more
        // time than actually remained, silently defeating the exam timer.
        if (next % 5 === 0) persistProgressRef.current?.();
        if (next <= 0) {
          clearInterval(timerRef.current);
          // Use ref so the callback always sees the latest finishTest closure (not a stale capture)
          finishTestRef.current?.(true);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [status]);

  /* ── Navigation ── */
  const goTo = useCallback((idx) => {
    if (idx < 0 || idx >= questions.length) return;
    if (status === 'in_progress') {
      const leaving = questions[currentIdx];
      if (leaving) {
        const spent = Date.now() - qStartRef.current;
        qTimesRef.current[leaving.id] = (qTimesRef.current[leaving.id] || 0) + spent;
      }
    }
    qStartRef.current = Date.now();
    setDirection(idx > currentIdx ? 1 : -1);
    setCurrentIdx(idx);
    setVisited((v) => new Set(v).add(idx));
  }, [currentIdx, questions, status]);

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd   = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 60) dx < 0 ? goTo(currentIdx + 1) : goTo(currentIdx - 1);
    touchStartX.current = null;
  };

  /* ── Answer handlers ── */
  const handleSelect = (optIdx) => {
    if (!question) return;
    const cbseStyle = typeof question.marks === 'number'; // CBSE: allow change; NTA: lock
    if (!cbseStyle && answers[question.id] !== undefined) return;
    setAnswers((a) => {
      const n = { ...a };
      if (cbseStyle && a[question.id] === optIdx) delete n[question.id]; // toggle off
      else n[question.id] = optIdx;
      return n;
    });
  };

  const handleNumericalInput = (val) => {
    if (!question) return;
    if (val === '' || val === null || val === undefined) {
      setAnswers((a) => { const n = { ...a }; delete n[question.id]; return n; });
      return;
    }
    setAnswers((a) => ({ ...a, [question.id]: val }));
  };

  const handleDescriptiveAnswer = (val) => {
    if (!question) return;
    setAnswers((a) => ({ ...a, [question.id]: val }));
  };

  const handleMark = () => setMarked((m) => {
    const n = new Set(m);
    if (question) n.has(question.id) ? n.delete(question.id) : n.add(question.id);
    return n;
  });

  /* ── Persist progress to localStorage while in-progress ──
   * persistProgressRef is refreshed on every render so the timer tick (which
   * only depends on `status`, not on answers/currentIdx/etc.) always calls
   * through to a fresh closure instead of a stale one. */
  const persistProgressRef = useRef(() => {});
  useEffect(() => {
    persistProgressRef.current = () => {
      if (status !== 'in_progress') return;
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          answers,
          currentIdx,
          marked:     [...marked],
          visited:    [...visited],
          secondsLeft: secondsLeftRef.current,
          savedAt:    Date.now(),
        }));
      } catch { /* storage full — non-fatal */ }
    };
  });

  useEffect(() => {
    if (status !== 'in_progress') return;
    persistProgressRef.current();
  }, [answers, currentIdx, marked, visited, status]);

  /* ── Resume saved session ── */
  const resumeExam = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) { setStatus('in_progress'); return; }
      const saved = JSON.parse(raw);
      // Discard if older than 4 hours
      if (Date.now() - (saved.savedAt || 0) > 4 * 60 * 60 * 1000) {
        localStorage.removeItem(storageKey);
        setStatus('in_progress');
        return;
      }
      setAnswers(saved.answers ?? {});
      setCurrentIdx(saved.currentIdx ?? 0);
      setMarked(new Set(saved.marked ?? []));
      setVisited(new Set(saved.visited ?? [0]));
      const restored = saved.secondsLeft ?? totalSeconds;
      setSecondsLeft(restored);
      secondsLeftRef.current = restored;
      qStartRef.current = Date.now();
      // `submitting: true` means the student had already submitted (or the
      // timer expired) and evaluation/save was interrupted mid-flight (tab
      // crash/close) — previously the local backup was deleted the instant
      // submission started, so this state was unrecoverable and the whole
      // attempt was simply lost. Re-run the finish flow with the recovered
      // answers instead of dropping them back into "keep answering."
      if (saved.submitting) {
        setStatus('in_progress');
        setTimeout(() => finishTestRef.current?.(false), 50);
        return;
      }
    } catch { /* ignore corrupt data */ }
    qStartRef.current = Date.now();
    setStatus('in_progress');
  };

  /* ── Reset exam (retake) ── */
  const resetExam = () => {
    clearInterval(timerRef.current);
    try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    setStatus('not_started');
    setCurrentIdx(0);
    setAnswers({});
    setEvaluations({});
    setMarked(new Set());
    setVisited(new Set([0]));
    setSecondsLeft(totalSeconds);
    secondsLeftRef.current = totalSeconds;
    setDirection(1);
    setPaletteOpen(false);
    setSubmitOpen(false);
    setResults(null);
    setTimeTaken(0);
    setEvalProgress('');
    setHasSaved(false);
    qTimesRef.current = {};
    qStartRef.current = Date.now();
  };

  /* ── Save the test session, surfacing failures instead of swallowing them ──
   * Previously fire-and-forget (`.catch(() => {})`) — a student would see the
   * full results screen with no indication their result was never persisted;
   * it just wouldn't show up later in analytics/history with no way to know
   * or retry. Now: on failure, keep the local backup (don't delete it) and
   * show a visible warning + retry option; on success, clear the backup. */
  const attemptSaveSession = async (res, evals, taken) => {
    if (!currentUser) return;
    try {
      await saveTestSession(currentUser.uid, {
        test_name:          testConfig.title,
        ...(testId ? { test_id: testId } : {}),
        score:              res.score,
        total_marks:        res.totalMarks,
        correct:            res.correct,
        wrong:              res.wrong,
        skipped:            res.skipped,
        question_count:     questions.length,
        time_taken_seconds: taken,
        subject_breakdown:  res.bySubject,
        exam_type:          userProfile?.target_exam || null,
        // `test_sessions` has no `evaluations` column — this insert silently
        // failed on every mock-test submission via PostgREST error PGRST204
        // (confirmed live), previously invisible because the caller swallowed
        // it with .catch(() => {}). The per-question AI evaluation data maps
        // onto the existing (otherwise-unused-by-this-insert) `answers` jsonb
        // column instead of a nonexistent one.
        answers:            evals,
      });
      setSaveError('');
      try { localStorage.removeItem(storageKey); } catch { /* ignore */ }
    } catch (e) {
      setSaveError(e?.message || 'Your result was scored but could not be saved.');
    }
  };

  const retrySaveSession = () => {
    if (!results) return;
    attemptSaveSession(results, evaluations, timeTaken);
  };

  /* ── Finish + evaluate ── */
  const finishTest = async (auto = false) => {
    // Re-entrancy guard — without this, a timer hitting 0 in the same tick as
    // a manual "Submit test" tap (or a double-tap before the confirm overlay
    // unmounts) could run this whole function twice: duplicate test_sessions
    // rows, double XP/activity-count awards, and a concurrent double insert
    // into the error notebook.
    if (status === 'evaluating' || status === 'submitted') return;
    clearInterval(timerRef.current);
    // Don't delete the local backup yet — mark it "submitting" instead. The AI
    // evaluation below can take ~15s; if the tab crashes or is closed during
    // that window, deleting the backup up-front would lose the attempt
    // entirely with no way to recover the answers. It's only removed once
    // saveTestSession actually succeeds, further down.
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw ? JSON.parse(raw) : {};
      localStorage.setItem(storageKey, JSON.stringify({ ...saved, submitting: true, savedAt: Date.now() }));
    } catch { /* ignore */ }
    const taken = totalSeconds - secondsLeftRef.current; // use ref, not stale state

    if (question) {
      const lastSpent = Date.now() - qStartRef.current;
      qTimesRef.current[question.id] = (qTimesRef.current[question.id] || 0) + lastSpent;
    }

    setSubmitOpen(false);
    setStatus('evaluating');
    setTimeTaken(taken);

    const descriptiveQs = questions.filter((q) => isDescriptiveType(q.type) && getAnswerValue(answers[q.id]));
    let evals = {};

    if (descriptiveQs.length > 0) {
      // AI-grading descriptive answers is the same cost/action as Paper Mode's
      // answer-sheet evaluation (an AI reads and scores a student's written
      // answers) — reuses that same quota bucket instead of running unmetered.
      // Checked once per submission (not once per question) since a single
      // test's worth of grading is one "evaluation", same as one uploaded paper.
      const quota = currentUser ? await checkQuota(currentUser.uid, 'paper_evaluations_used', isPremium) : { allowed: true };
      if (!quota.allowed) {
        setGradingLimited(true);
      } else {
        setEvalProgress(`Evaluating ${descriptiveQs.length} descriptive answer${descriptiveQs.length > 1 ? 's' : ''} with AI…`);
        try {
          evals = await evaluateDescriptiveAnswers(questions, answers);
          if (currentUser) incrementQuota(currentUser.uid, 'paper_evaluations_used').catch(() => {});
        } catch {
          // non-fatal — descriptive answers just won't show evaluations
        }
        setEvalProgress('');
      }
    }

    setEvaluations(evals);
    const res = computeResults(questions, answers, evals);
    setResults(res);
    setStatus('submitted');

    if (currentUser) {
      await attemptSaveSession(res, evals, taken);
      const xpAction = res.totalMarks > 0 && res.score / res.totalMarks >= 0.9 ? 'perfect_score' : 'mock_test';
      awardXP(currentUser.uid, xpAction).catch(() => {});
      incrementActivityCount(currentUser.uid, 'total_tests_taken').catch(() => {});
      // Descriptive (Short/Long Answer) questions are excluded here — the Error
      // Notebook's wrongness check compares against `correctOption`, which
      // descriptive questions don't have, so every attempted descriptive answer
      // was being logged as "wrong" regardless of the AI's actual evaluation,
      // and the answer object ({text, imageDataUrl}) was stringifying into the
      // literal text "[object Object]" in the stored user_answer.
      const objectiveQuestions = questions.filter((q) => !isDescriptiveType(q.type));
      saveWrongAnswers(currentUser.uid, objectiveQuestions, answers, 'mock_test', testConfig.title).catch(() => {});
      const pct = res.totalMarks > 0 ? Math.round((res.score / res.totalMarks) * 100) : 0;
      createNotification(
        currentUser.uid,
        'test_complete',
        `Test submitted: ${testConfig.title}`,
        `Score: ${res.score}/${res.totalMarks} (${pct}%) · ${res.correct} correct, ${res.wrong} wrong, ${res.skipped} skipped`,
        '/analytics',
      ).catch(() => {});
    }
  };

  // Keep finishTestRef always pointing to the latest closure so the timer callback is never stale
  useEffect(() => { finishTestRef.current = finishTest; });

  /* ── Start screen ── */
  if (status === 'not_started') {
    return (
      <ExamStartScreen
        testConfig={testConfig}
        questions={questions}
        hasSavedProgress={hasSaved}
        onBack={() => navigate(-1)}
        onStart={() => {
          // "Start Fresh" (hasSaved true) discards old progress and counts as a
          // genuinely new attempt — free the mode lock and re-take it for
          // online immediately, so a student who backs out to Exam Center
          // right after this click can still legitimately pick Paper Mode
          // instead, per Item 7's "start fresh can offer mode choice again".
          if (hasSaved && testId) {
            clearExamAttemptMode(currentUser?.uid, testId)
              .then(() => lockExamAttemptMode(currentUser?.uid, testId, 'online'))
              .catch(() => {});
          }
          qStartRef.current = Date.now();
          setStatus('in_progress');
        }}
        onResume={resumeExam}
      />
    );
  }

  /* ── Evaluating state ── */
  if (status === 'evaluating') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-5 p-6">
        <div className="h-16 w-16 rounded-2xl bg-primary-50 border border-primary-100 flex items-center justify-center">
          <Loader2 size={28} className="text-primary-500 animate-spin" />
        </div>
        <div className="text-center">
          <p className="font-bold text-slate-900 text-lg">Evaluating your answers</p>
          <p className="text-sm text-slate-500 mt-1">{evalProgress || 'Computing your results…'}</p>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl px-6 py-4 text-xs text-slate-400 max-w-sm text-center">
          AI is reading your handwritten answers and short answers. This usually takes 10–20 seconds.
        </div>
      </div>
    );
  }

  /* ── Result screen ── */
  if (status === 'submitted') {
    return (
      <ResultScreen
        questions={questions}
        answers={answers}
        results={results}
        evaluations={evaluations}
        timeTaken={timeTaken}
        testTitle={testConfig.title}
        onRetake={resetExam}
        saveError={saveError}
        onRetrySave={retrySaveSession}
        gradingLimited={gradingLimited}
      />
    );
  }

  /* ── In-progress helpers ── */
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timerCls = secondsLeft < 300 ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-700';

  const getSelectHandler = () => {
    if (!question) return () => {};
    if (question.type === 'Numerical') return handleNumericalInput;
    if (isDescriptiveType(question.type)) return handleDescriptiveAnswer;
    return handleSelect;
  };

  /* Submit overlay */
  const SubmitOverlay = (
    <AnimatePresence>
      {submitOpen && (
        <motion.div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setSubmitOpen(false)}
        >
          <motion.div
            className="bg-white w-full max-w-sm rounded-3xl p-6 space-y-4"
            initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-slate-900 text-lg">Submit test?</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                { label: 'Answered', value: answered,                    color: 'text-emerald-600' },
                { label: 'Skipped',  value: questions.length - answered, color: 'text-red-500'     },
                { label: 'Marked',   value: marked.size,                 color: 'text-violet-600'  },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-slate-50 rounded-xl p-3">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
            {questions.some((q) => isDescriptiveType(q.type)) && (
              <p className="text-xs text-amber-600 bg-amber-50 rounded-xl px-3 py-2">
                ✏️ Descriptive answers will be AI-evaluated after submission (~15 sec).
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => setSubmitOpen(false)}
                className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-semibold text-sm hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={() => finishTest()}
                className="flex-1 py-3 rounded-2xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700">
                Submit test
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* Palette bottom sheet */
  const PaletteSheet = (
    <AnimatePresence>
      {paletteOpen && (
        <motion.div
          className="fixed inset-0 bg-black/40 z-40 flex items-end"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => setPaletteOpen(false)}
        >
          <motion.div
            className="w-full bg-white rounded-t-3xl p-5 max-h-[70vh] overflow-y-auto"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Question Palette</h3>
              <button onClick={() => setPaletteOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                <X size={16} className="text-slate-500" />
              </button>
            </div>
            <QuestionPalette questions={questions} answers={answers} marked={marked} visited={visited}
              currentIdx={currentIdx} onJump={(i) => { goTo(i); setPaletteOpen(false); }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  /* ── Current question section info ── */
  const qSection = question?.section;
  const SECTION_LABELS = {
    A: 'Section A — Objective',
    B: 'Section B — Very Short Answer',
    C: 'Section C — Short Answer',
    D: 'Section D — Long Answer',
    E: 'Section E — Extended',
  };

  /* ── Desktop layout ── */
  if (isDesktop) {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top bar */}
          <div className="bg-white border-b border-slate-200 shrink-0">
            <div className="h-12 flex items-center gap-3 px-4 border-b border-slate-100">
              <button onClick={() => navigate(-1)} className="p-1.5 text-slate-400 hover:text-slate-700">
                <ArrowLeft size={16} />
              </button>
              <span className="text-sm font-bold text-slate-800 truncate flex-1">{testConfig.title}</span>
              <span className="text-xs text-slate-400 shrink-0">{answered}/{questions.length}</span>
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-lg shrink-0 font-mono text-sm font-bold ${timerCls}`}>
                <Clock size={14} />
                {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
              </div>
              <Button variant="primary" size="sm" onClick={() => setSubmitOpen(true)}>Submit test</Button>
            </div>
            {/* Section ribbon */}
            {qSection && (
              <div className="h-7 flex items-center px-4 bg-slate-50 border-b border-slate-100">
                <span className="text-[11px] font-semibold text-slate-500">
                  {SECTION_LABELS[qSection] ?? `Section ${qSection}`}
                </span>
              </div>
            )}
          </div>

          {/* Question */}
          <div className="flex-1 overflow-y-auto p-6">
            <QuestionView
              question={question}
              questionNumber={currentIdx + 1}
              selectedOption={answers[question?.id]}
              onSelect={getSelectHandler()}
              direction={direction}
              canChange={typeof question?.marks === 'number'}
            />
          </div>

          {/* Bottom bar */}
          <div className="h-16 bg-white border-t border-slate-100 flex items-center gap-3 px-6 shrink-0">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={15} />}
              onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}>Prev</Button>
            <Button variant={isMarked ? 'secondary' : 'ghost'} size="sm"
              icon={<Bookmark size={14} fill={isMarked ? 'currentColor' : 'none'} />}
              onClick={handleMark}>
              {isMarked ? 'Marked' : 'Mark'}
            </Button>
            <div className="flex-1" />
            {isLast ? (
              <Button variant="success" size="sm" icon={<Send size={14} />} onClick={() => setSubmitOpen(true)}>
                Submit test
              </Button>
            ) : (
              <Button variant="primary" size="sm" iconRight={<ArrowRight size={15} />} onClick={() => goTo(currentIdx + 1)}>
                {isAnswered ? 'Save & Next' : 'Skip & Next'}
              </Button>
            )}
          </div>
        </div>

        {/* Sidebar palette */}
        <div className="w-72 border-l border-slate-200 bg-white flex flex-col shrink-0 overflow-y-auto">
          <div className="p-4 border-b border-slate-100">
            <h3 className="font-semibold text-slate-800 text-sm">Question Palette</h3>
          </div>
          <div className="p-4 flex-1 overflow-y-auto">
            <QuestionPalette questions={questions} answers={answers} marked={marked} visited={visited}
              currentIdx={currentIdx} onJump={goTo} />
          </div>
        </div>

        {SubmitOverlay}
      </div>
    );
  }

  /* ── Mobile layout ── */
  return (
    <div
      className="flex flex-col h-screen bg-white select-none overflow-hidden"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Top bar */}
      <div className="shrink-0 bg-white/90 backdrop-blur-xl border-b border-slate-100 px-3 py-2.5 flex items-center gap-2 sticky top-0 z-10">
        <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-slate-900">Q{currentIdx + 1}</span>
            <span className="text-xs text-slate-400">/ {questions.length}</span>
            {qSection && (
              <span className="text-[9px] font-bold text-primary-600 bg-primary-50 px-1.5 py-0.5 rounded-full">
                Sec {qSection}
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 truncate leading-tight">{testConfig.title}</p>
        </div>
        <span className={`text-sm tabular-nums font-mono font-bold ${secondsLeft < 300 ? 'text-red-500' : 'text-slate-700'}`}>
          {String(mins).padStart(2,'0')}:{String(secs).padStart(2,'0')}
        </span>
        <button
          onClick={() => setPaletteOpen(true)}
          className="relative p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
        >
          <LayoutGrid size={18} />
          {answered > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary-600 text-white text-[9px] font-bold flex items-center justify-center leading-none">
              {answered}
            </span>
          )}
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-slate-100 shrink-0">
        <motion.div className="h-full bg-primary-500"
          animate={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
          transition={{ duration: 0.3 }} />
      </div>

      {/* Question area */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-3">
        <QuestionView
          question={question}
          questionNumber={currentIdx + 1}
          selectedOption={answers[question?.id]}
          onSelect={getSelectHandler()}
          direction={direction}
          canChange={typeof question?.marks === 'number'}
        />
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 bg-white border-t border-slate-100 px-4 pt-3 pb-4 space-y-2.5"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex gap-2">
          <button onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}
            className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-medium disabled:opacity-30">
            <ArrowLeft size={13} /> Prev
          </button>
          <button onClick={handleMark}
            className={['flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-colors',
              isMarked ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600'].join(' ')}>
            <Bookmark size={13} fill={isMarked ? 'currentColor' : 'none'} />
            {isMarked ? 'Marked' : 'Mark'}
          </button>
          <button onClick={() => goTo(currentIdx + 1)} disabled={isLast}
            className="flex-1 flex items-center justify-center gap-1 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-xs font-medium disabled:opacity-30">
            Next <ArrowRight size={13} />
          </button>
        </div>

        {isLast ? (
          <button onClick={() => setSubmitOpen(true)}
            className="w-full py-4 rounded-2xl bg-emerald-600 text-white font-bold text-base flex items-center justify-center gap-2 hover:bg-emerald-700 shadow-sm">
            <Send size={18} /> Submit test
          </button>
        ) : (
          <button onClick={() => goTo(currentIdx + 1)}
            className={['w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-sm',
              isAnswered ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'].join(' ')}>
            {isAnswered ? 'Save & Next' : 'Skip & Next'} <ArrowRight size={18} />
          </button>
        )}
      </div>

      {PaletteSheet}
      {SubmitOverlay}
    </div>
  );
}
