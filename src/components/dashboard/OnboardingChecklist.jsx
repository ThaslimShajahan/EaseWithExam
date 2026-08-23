import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Circle, ChevronRight, X, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

const DISMISS_KEY = (uid) => `edu_onboarding_done_${uid}`;

function Step({ done, label, hint, action, route, navigate }) {
  return (
    <div className={`flex items-start gap-3 py-2.5 ${done ? 'opacity-60' : ''}`}>
      {done
        ? <CheckCircle2 size={18} className="text-emerald-500 shrink-0 mt-0.5" />
        : <Circle size={18} className="text-slate-300 shrink-0 mt-0.5" />}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${done ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
          {label}
        </p>
        {!done && hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
      {!done && route && (
        <button
          onClick={() => navigate(route)}
          className="flex items-center gap-1 text-[11px] font-bold text-primary-600 hover:text-primary-700 shrink-0 p-3.5 -m-3.5 mt-0"
        >
          {action ?? 'Start'} <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

export default function OnboardingChecklist({ sessions = [], gamification = null }) {
  const { currentUser } = useAuth();
  const navigate        = useNavigate();
  const [dismissed, setDismissed] = useState(
    () => !!localStorage.getItem(DISMISS_KEY(currentUser?.uid))
  );

  if (dismissed) return null;

  const hasTakenTest = sessions.length > 0;
  const hasPracticed = (gamification?.total_questions_answered ?? 0) > 0;
  // Use localStorage to track flashcard usage (no DB column for this)
  const hasFlashcards = !!localStorage.getItem(`edu_flashcard_used_${currentUser?.uid}`);

  const steps = [
    {
      label:  'Complete your profile',
      hint:   'Your exam type and class are set during onboarding',
      done:   true,
    },
    {
      label:  'Take your first practice session',
      hint:   'Generate 5 questions on any subject',
      done:   hasPracticed,
      route:  '/practice/generate',
      action: 'Practice now',
    },
    {
      label:  'Try AI flashcards',
      hint:   'Pick a chapter and start a flashcard session',
      done:   hasFlashcards,
      route:  '/flashcards',
      action: 'Open flashcards',
    },
    {
      label:  'Complete a full mock test',
      hint:   'See your baseline NEET / JEE score',
      done:   hasTakenTest,
      route:  '/exam-center',
      action: 'Go to Exam Center',
    },
    {
      label:  'Maintain a 3-day streak',
      hint:   'Study every day to build the habit',
      done:   (gamification?.streak_days ?? 0) >= 3,
      route:  '/dashboard',
      action: 'Keep going',
    },
  ];

  const completed = steps.filter(s => s.done).length;
  const total     = steps.length;
  const allDone   = completed === total;
  const pct       = Math.round((completed / total) * 100);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY(currentUser?.uid), '1');
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        className="bg-white rounded-2xl border border-slate-100 overflow-hidden"
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary-600" />
            <div>
              <p className="text-sm font-bold text-slate-900">Getting started</p>
              <p className="text-[10px] text-slate-400">{completed}/{total} steps complete</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-4 -m-3 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors"
            title={allDone ? 'Dismiss' : 'Dismiss checklist'}
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="px-4 pb-1">
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary-500 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
        </div>

        {/* Steps */}
        <div className="px-4 pb-4 divide-y divide-slate-50">
          {steps.map((s) => (
            <Step key={s.label} {...s} navigate={navigate} />
          ))}
        </div>

        {allDone && (
          <div className="px-4 pb-4 text-center">
            <p className="text-xs text-emerald-600 font-semibold">
              🎉 All done! You&apos;re all set — keep the momentum going!
            </p>
            <button onClick={handleDismiss} className="mt-2 text-xs text-slate-400 hover:text-slate-600">
              Dismiss
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
