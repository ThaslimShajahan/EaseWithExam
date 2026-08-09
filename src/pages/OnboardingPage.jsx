import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import { sendTransactionalEmail } from '../lib/email';
import { applyPendingReferral } from '../lib/referral';
import { EXAM_OPTIONS, BOARD_OPTIONS, CLASS_OPTIONS } from '../lib/onboardingOptions';
import { resolveOnboardingIcon } from '../lib/onboardingIconRegistry';
import Button from '../components/ui/Button';

// Literal Tailwind classes per color — written out in full so Tailwind's
// content scanner can see them (dynamically building `bg-${color}-50` string
// at runtime would never get picked up at build time).
const COLOR_MAP = {
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-600',    ring: 'ring-rose-200'    },
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-600',    ring: 'ring-blue-200'    },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-600',  ring: 'ring-violet-200'  },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-200'   },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-600',     ring: 'ring-sky-200'     },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-200' },
  teal:    { bg: 'bg-teal-50',    text: 'text-teal-600',    ring: 'ring-teal-200'    },
  green:   { bg: 'bg-green-50',   text: 'text-green-600',   ring: 'ring-green-200'   },
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  ring: 'ring-indigo-200'  },
  slate:   { bg: 'bg-slate-100',  text: 'text-slate-600',   ring: 'ring-slate-200'   },
  purple:  { bg: 'bg-purple-50',  text: 'text-purple-600',  ring: 'ring-purple-200'  },
};

// Class and board are universal facts, so they're always asked and always
// first. The competitive exam is an optional add-on layered on top — a Class
// 12 CBSE student can be preparing for boards AND NEET, which the old
// "pick one target" step couldn't express.
//
// Class gates which competitive exams are offered (allowed_class_levels on the
// option row), so a Class 8 student is never shown NEET/JEE. An empty
// allowed_class_levels means "offer for every class".
function examOptionsForClass(classLevel) {
  if (!classLevel) return [];
  return EXAM_OPTIONS.filter((o) => {
    const allowed = o.allowed_class_levels ?? [];
    return allowed.length === 0 || allowed.includes(String(classLevel));
  });
}

// The competitive step is only worth showing when there's a real choice —
// if the only option left is the board-only default, it's auto-applied and
// the step is skipped entirely (classes 8-10 get a 2-step flow).
function getSteps(classLevel) {
  const examOpts = examOptionsForClass(classLevel);
  return [
    { id: 'class', title: 'Which class are you in?',            field: 'classLevel', options: CLASS_OPTIONS },
    { id: 'board', title: 'Which board or syllabus?',           field: 'syllabus',   options: BOARD_OPTIONS },
    ...(examOpts.length > 1
      ? [{ id: 'exam', title: 'Also preparing for a competitive exam?', field: 'targetExam', options: examOpts }]
      : []),
  ];
}

function OptionCard({ option, selected, onSelect }) {
  const c = COLOR_MAP[option.color] ?? COLOR_MAP.slate;
  const Icon = resolveOnboardingIcon(option.icon_name);
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(option.key)}
      className={[
        'relative w-full text-left flex items-center gap-4 p-4 rounded-2xl border-2 transition-all duration-200',
        selected
          ? `border-primary-500 bg-primary-50/60 shadow-md ring-4 ring-primary-100`
          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm',
      ].join(' ')}
    >
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${c.bg}`}>
        <Icon size={20} className={c.text} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900">{option.title}</p>
        {option.description && <p className="text-xs text-slate-500 mt-0.5">{option.description}</p>}
      </div>
      <div className={[
        'h-6 w-6 rounded-full flex items-center justify-center shrink-0 border-2 transition-all',
        selected ? 'bg-primary-600 border-primary-600' : 'border-slate-200',
      ].join(' ')}>
        <AnimatePresence>
          {selected && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 25 }}>
              <Check size={14} className="text-white" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.button>
  );
}

export default function OnboardingPage() {
  const { completeOnboarding, currentUser } = useAuth();
  const navigate = useNavigate();
  const [step,    setStep]    = useState(0);
  const [loading, setLoading] = useState(false);
  // targetExam defaults to the board-only sentinel, so a student whose class
  // has no competitive options (and therefore never sees step 3) still
  // completes onboarding with a valid, explicit value rather than ''.
  const [profile, setProfile] = useState({ targetExam: 'NONE', syllabus: '', classLevel: '' });

  const steps   = getSteps(profile.classLevel);
  const current = steps[step];
  const isLast  = step === steps.length - 1;
  const selected = profile[current?.field];

  const handleSelect = (id) => setProfile((p) => ({ ...p, [current.field]: id }));

  // Changing class re-gates step 3, so any competitive target that's no longer
  // offered for the new class has to be dropped — otherwise moving from
  // Class 12 back to Class 8 would silently keep a NEET target the student
  // can no longer see or change.
  const handleClassSelect = (id) => {
    setProfile((p) => {
      const stillAllowed = examOptionsForClass(id).some((o) => o.key === p.targetExam);
      return { ...p, classLevel: id, targetExam: stillAllowed ? p.targetExam : 'NONE' };
    });
  };

  const handleNext = async () => {
    if (!selected) return;
    if (isLast) {
      setLoading(true);
      try {
        await completeOnboarding({
          targetExam:  profile.targetExam || 'NONE',
          syllabus:    profile.syllabus,
          classLevel:  profile.classLevel,
        });
        if (currentUser) {
          // Redeem a code carried in from a referral link. Deliberately not
          // awaited and never fatal — a stale or already-used code must not
          // stand between a student and their dashboard.
          applyPendingReferral(currentUser.uid).catch(() => {});
          createNotification(
            currentUser.uid,
            'welcome',
            'Welcome to EaseWithExam! 🎉',
            'Your study journey starts now. Try the daily challenge or take a mock test.',
            '/dashboard',
          ).catch(() => {});
          const examTitle = EXAM_OPTIONS.find((o) => o.key === profile.targetExam)?.title ?? profile.targetExam;
          sendTransactionalEmail(currentUser.uid, 'welcome', {
            displayName: currentUser.displayName,
            targetExam:  examTitle,
          });
        }
        navigate('/dashboard');
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => { if (step > 0) setStep((s) => s - 1); };

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden flex items-center justify-center p-4 py-10">
      {/* Ambient background glow — subtle, premium depth without a loud gradient */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-primary-200/30 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-violet-200/30 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md lg:max-w-2xl">

        {/* Brand chip */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center font-bold text-white text-sm shadow-float">E</div>
          <span className="font-bold text-slate-800 text-lg">EaseWithExam</span>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step ? 'bg-primary-600 w-8' : i < step ? 'bg-primary-300 w-2' : 'bg-slate-200 w-2'
              }`}
            />
          ))}
        </div>

        <div className="bg-white/70 backdrop-blur-xl border border-white shadow-xl rounded-3xl p-5 sm:p-7">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0  }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25 }}
            >
              <div className="mb-5 text-center lg:text-left">
                <p className="text-xs text-primary-600 font-semibold uppercase tracking-wider">
                  Step {step + 1} of {steps.length}
                </p>
                <h1 className="text-2xl font-bold text-slate-900 mt-1">{current?.title}</h1>
              </div>

              <div className="grid sm:grid-cols-2 gap-2.5 max-h-[55vh] lg:max-h-[50vh] overflow-y-auto pr-1 scrollbar-hide">
                {current?.options.map((opt) => (
                  <OptionCard
                    key={opt.key}
                    option={opt}
                    selected={selected === opt.key}
                    onSelect={current.field === 'classLevel' ? handleClassSelect : handleSelect}
                  />
                ))}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="flex gap-3 mt-7">
            {step > 0 && (
              <Button variant="secondary" size="lg" icon={<ArrowLeft size={16} />} onClick={handleBack}>
                Back
              </Button>
            )}
            <Button
              variant="primary" size="lg" full
              disabled={!selected}
              loading={loading}
              iconRight={<ArrowRight size={16} />}
              onClick={handleNext}
            >
              {isLast ? 'Get Started' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
