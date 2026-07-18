import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, ArrowLeft, Check,
  Dna, Atom, FlaskConical, Rocket, BookOpen, GraduationCap,
  BookMarked, Sprout, Landmark, ClipboardList, School, Trophy,
  BookOpenCheck, TreePalm, Building2, MinusCircle, RotateCcw,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import Button from '../components/ui/Button';

const EXAM_OPTIONS = [
  { id: 'NEET',         label: 'NEET UG',        desc: 'Medical entrance — PCB',        icon: Dna,          color: 'rose'    },
  { id: 'JEE_MAIN',     label: 'JEE Main',       desc: 'Engineering entrance — PCM',    icon: Atom,         color: 'blue'    },
  { id: 'JEE_ADVANCED', label: 'JEE Advanced',   desc: 'IIT entrance — advanced PCM',   icon: FlaskConical, color: 'violet'  },
  { id: 'BOTH',         label: 'NEET + JEE',     desc: 'Double preparation',            icon: Rocket,       color: 'amber'   },
  { id: 'CLASS_10',     label: 'Class 10 Boards', desc: 'CBSE / ICSE / State Board',    icon: BookOpen,     color: 'sky'     },
  { id: 'CLASS_12',     label: 'Class 12 Boards', desc: 'CBSE / ICSE / State Board',    icon: GraduationCap, color: 'emerald' },
  { id: 'CLASS_8_9',    label: 'Class 8-9',      desc: 'Foundation level',              icon: BookMarked,   color: 'teal'    },
  { id: 'CLASS_11',     label: 'Class 11',       desc: 'Junior college / Senior school', icon: Sprout,      color: 'green'   },
  { id: 'UPSC',         label: 'UPSC CSE',       desc: 'Civil Services Exam',           icon: Landmark,     color: 'indigo'  },
  { id: 'SSC',          label: 'SSC CGL / CHSL', desc: 'Staff Selection Commission',    icon: ClipboardList, color: 'slate'  },
  { id: 'CUET',         label: 'CUET',           desc: 'Central University Entrance',   icon: School,       color: 'purple'  },
  { id: 'OLYMPIAD',     label: 'Olympiad',       desc: 'Science / Math Olympiads',      icon: Trophy,       color: 'amber'   },
];

const BOARD_OPTIONS = [
  { id: 'CBSE',         label: 'CBSE',              desc: 'Central Board of Secondary Education', icon: BookOpen,      color: 'blue'  },
  { id: 'ICSE',         label: 'ICSE / ISC',        desc: 'Council for Indian School Certificate', icon: BookOpenCheck, color: 'emerald' },
  { id: 'KERALA_STATE', label: 'Kerala State',      desc: 'SCERT Kerala',                          icon: TreePalm,      color: 'teal'  },
  { id: 'OTHER_STATE',  label: 'Other State Board', desc: 'Maharashtra, Tamil Nadu, etc.',         icon: Building2,     color: 'slate' },
  { id: 'NA',           label: 'Not applicable',    desc: 'Competitive exam only',                  icon: MinusCircle,   color: 'slate' },
];

const CLASS_OPTIONS = [
  { id: '8',        label: 'Class 8',           desc: '', icon: BookOpen,      color: 'sky'    },
  { id: '9',        label: 'Class 9',           desc: '', icon: BookOpen,      color: 'sky'    },
  { id: '10',       label: 'Class 10',          desc: '', icon: BookOpen,      color: 'blue'   },
  { id: '11',       label: 'Class 11',          desc: '', icon: Sprout,        color: 'green'  },
  { id: '12',       label: 'Class 12',          desc: '', icon: GraduationCap, color: 'emerald' },
  { id: 'REPEATER', label: 'Repeater / Dropper', desc: 'Gap year / second attempt', icon: RotateCcw, color: 'amber' },
];

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

function getSteps(targetExam) {
  const needsBoard  = ['CLASS_10', 'CLASS_12', 'CLASS_8_9', 'CLASS_11', 'NEET', 'JEE_MAIN', 'JEE_ADVANCED', 'BOTH'].includes(targetExam);
  const needsClass  = ['NEET', 'JEE_MAIN', 'JEE_ADVANCED', 'BOTH', 'CLASS_10', 'CLASS_12', 'CLASS_8_9', 'CLASS_11'].includes(targetExam);

  return [
    { id: 'exam',  title: 'What are you preparing for?', field: 'targetExam', options: EXAM_OPTIONS },
    ...(needsBoard ? [{ id: 'board', title: 'Which board or syllabus?',    field: 'syllabus',    options: BOARD_OPTIONS }] : []),
    ...(needsClass ? [{ id: 'class', title: 'Which class or year?',         field: 'classLevel',  options: CLASS_OPTIONS }] : []),
  ];
}

function getDefaultClass(targetExam) {
  if (['CLASS_8_9'].includes(targetExam))  return '9';
  if (['CLASS_10'].includes(targetExam))   return '10';
  if (['CLASS_11'].includes(targetExam))   return '11';
  if (['CLASS_12'].includes(targetExam))   return '12';
  return '12';
}

function OptionCard({ option, selected, onSelect }) {
  const c = COLOR_MAP[option.color] ?? COLOR_MAP.slate;
  const Icon = option.icon;
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={() => onSelect(option.id)}
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
        <p className="font-semibold text-slate-900">{option.label}</p>
        {option.desc && <p className="text-xs text-slate-500 mt-0.5">{option.desc}</p>}
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
  const [profile, setProfile] = useState({ targetExam: '', syllabus: 'CBSE', classLevel: '12' });

  const steps   = getSteps(profile.targetExam);
  const current = steps[step];
  const isLast  = step === steps.length - 1;
  const selected = profile[current?.field];

  const handleSelect   = (id) => setProfile((p) => ({ ...p, [current.field]: id }));

  const handleExamSelect = (id) => {
    setProfile({ targetExam: id, syllabus: 'CBSE', classLevel: getDefaultClass(id) });
  };

  const handleNext = async () => {
    if (!selected) return;
    if (isLast) {
      setLoading(true);
      try {
        await completeOnboarding({
          targetExam:  profile.targetExam,
          syllabus:    profile.syllabus   || 'NA',
          classLevel:  profile.classLevel || null,
        });
        if (currentUser) {
          createNotification(
            currentUser.uid,
            'welcome',
            'Welcome to EaseWithExam! 🎉',
            'Your study journey starts now. Try the daily challenge or take a mock test.',
            '/dashboard',
          ).catch(() => {});
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
                    key={opt.id}
                    option={opt}
                    selected={selected === opt.id}
                    onSelect={current.field === 'targetExam' ? handleExamSelect : handleSelect}
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
