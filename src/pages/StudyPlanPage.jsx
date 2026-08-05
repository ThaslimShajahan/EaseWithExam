import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Calendar, Clock, BookOpen, Target, Brain, Zap,
  CheckCircle2, TrendingUp, ChevronRight, Loader2, RotateCcw,
} from 'lucide-react';
import { generateStudyPlan } from '../lib/questionGen';
import { saveStudyGoal, getStudyGoal } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { checkQuota, incrementQuota } from '../lib/quota';
import { awardXP } from '../lib/gamification';
import { createNotification } from '../lib/notifications';
import { addManualTask } from '../lib/dailyTasks';
import { CATEGORIES, buildExamType } from '../lib/categories';
import { useSyllabusSubjects } from '../hooks/useSyllabusSubjects';
import HubPageHeader from '../components/ui/HubPageHeader';

const SUBJECT_PALETTE = {
  Physics:            'bg-blue-100    text-blue-800    border-blue-200',
  Chemistry:          'bg-emerald-100 text-emerald-800 border-emerald-200',
  Biology:            'bg-violet-100  text-violet-800  border-violet-200',
  Mathematics:        'bg-orange-100  text-orange-800  border-orange-200',
  Science:            'bg-teal-100    text-teal-800    border-teal-200',
  English:            'bg-rose-100    text-rose-800    border-rose-200',
  'Social Studies':   'bg-amber-100   text-amber-800   border-amber-200',
  Hindi:              'bg-pink-100    text-pink-800    border-pink-200',
  History:            'bg-yellow-100  text-yellow-800  border-yellow-200',
  Geography:          'bg-lime-100    text-lime-800    border-lime-200',
  Economics:          'bg-cyan-100    text-cyan-800    border-cyan-200',
  Polity:             'bg-sky-100     text-sky-800     border-sky-200',
};

const SUBJECT_BG = {
  Physics:            'bg-blue-50    border-blue-200',
  Chemistry:          'bg-emerald-50 border-emerald-200',
  Biology:            'bg-violet-50  border-violet-200',
  Mathematics:        'bg-orange-50  border-orange-200',
  Science:            'bg-teal-50    border-teal-200',
  English:            'bg-rose-50    border-rose-200',
  'Social Studies':   'bg-amber-50   border-amber-200',
};

/* ── Chip ────────────────────────────────────────────────── */
function Chip({ label, selected, onClick, small }) {
  return (
    <button
      onClick={onClick}
      className={[
        'rounded-xl font-semibold border transition-all',
        small ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm',
        selected
          ? 'bg-primary-600 text-white border-primary-600 shadow-sm'
          : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300 hover:text-primary-700',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

/* ── GoalForm ────────────────────────────────────────────── */
// Exam type is locked to the student's own onboarding profile — matches the
// same "locked to your profile" pattern used in Practice/Exam generation, so a
// student can no longer generate a plan for a different class/exam than their own.
function GoalForm({ onGenerate, defaultExamType = 'NEET' }) {
  const examType = defaultExamType;
  const [examDate,      setExamDate]      = useState('');
  const [dailyHours,    setDailyHours]    = useState(6);
  const [weakSubjects,  setWeakSubjects]  = useState([]);
  const [focusChapters, setFocusChapters] = useState('');

  const subjects = useSyllabusSubjects(examType);

  const toggleSubject = (s) =>
    setWeakSubjects((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );

  const today    = new Date().toISOString().split('T')[0];
  const canSubmit = examDate && examDate > today;

  return (
    <motion.div
      className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-6"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      {/* Target exam — locked to profile */}
      <div className="flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-xl px-3 py-2.5">
        <Target size={12} className="text-primary-500 shrink-0" />
        <div className="text-xs text-primary-700">
          <span className="font-semibold">Locked to your profile: </span>
          <span className="font-bold">{CATEGORIES[examType]?.label ?? examType}</span>
        </div>
      </div>

      {/* Exam date */}
      <div>
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block flex items-center gap-1.5">
          <Calendar size={12} /> Exam Date
        </label>
        <input
          type="date"
          min={today}
          value={examDate}
          onChange={(e) => setExamDate(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300"
        />
      </div>

      {/* Daily hours slider */}
      <div>
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block flex items-center gap-1.5">
          <Clock size={12} /> Daily Study Hours: <span className="text-primary-600 ml-1">{dailyHours}h</span>
        </label>
        <input
          type="range" min={2} max={12} step={1}
          value={dailyHours}
          onChange={(e) => setDailyHours(Number(e.target.value))}
          className="w-full accent-primary-600"
        />
        <div className="flex justify-between text-[10px] text-slate-400 mt-1">
          <span>2h</span><span>12h</span>
        </div>
      </div>

      {/* Focus subjects — dynamic per exam */}
      <div>
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-3 block">
          Focus Subjects <span className="text-slate-400 font-normal normal-case">(plan covers only selected; leave blank for all)</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {subjects.map((s) => {
            const sel = weakSubjects.includes(s);
            return (
              <button
                key={s}
                onClick={() => toggleSubject(s)}
                className={[
                  'flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border font-medium transition-all',
                  sel
                    ? 'bg-red-100 text-red-800 border-red-300'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-red-300',
                ].join(' ')}
              >
                {sel && <CheckCircle2 size={13} className="text-red-500" />}
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Priority chapters */}
      <div>
        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block flex items-center gap-1.5">
          <BookOpen size={12} /> Priority Chapters <span className="text-slate-400 font-normal normal-case ml-1">(optional)</span>
        </label>
        <textarea
          rows={3}
          placeholder="e.g. Genetics, Chemical Bonding, Kinematics, Thermodynamics…"
          value={focusChapters}
          onChange={(e) => setFocusChapters(e.target.value)}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-primary-300 placeholder:text-slate-300 resize-none"
        />
      </div>

      <button
        disabled={!canSubmit}
        onClick={() => onGenerate({ examType, examDate, dailyHours, weakSubjects, focusChapters })}
        className="w-full py-4 rounded-2xl bg-primary-600 text-white font-bold text-base flex items-center justify-center gap-2 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
      >
        <Brain size={18} /> Generate My Study Plan
      </button>

      {!canSubmit && examDate && (
        <p className="text-xs text-red-500 text-center -mt-3">Exam date must be in the future.</p>
      )}
      <p className="text-[10px] text-slate-400 text-center">AI-powered personalised plan · updates saved automatically</p>
    </motion.div>
  );
}

/* ── Loading screen ──────────────────────────────────────── */
function LoadingScreen() {
  const steps = [
    'Analyzing your exam timeline…',
    'Building phase-wise schedule…',
    'Crafting subject strategies…',
    'Finalizing daily routine…',
  ];
  const [step, setStep] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % steps.length), 1800);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      className="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 flex flex-col items-center gap-6"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      <div className="relative h-16 w-16">
        <div className="absolute inset-0 rounded-full border-4 border-primary-100" />
        <div className="absolute inset-0 rounded-full border-4 border-t-primary-600 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <Brain size={22} className="text-primary-600" />
        </div>
      </div>
      <div className="text-center space-y-1">
        <p className="font-bold text-slate-900">Building your plan…</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={step}
            className="text-sm text-slate-500"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
          >
            {steps[step]}
          </motion.p>
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/* ── Plan display ─────────────────────────────────────────── */
function PlanDisplay({ plan, goal, onReset, navigate, onSaveTasks }) {
  const daysLeft = Math.max(1, Math.ceil((new Date(goal.examDate) - new Date()) / 86400000));
  const week1    = plan.weeklyPlan?.[0];
  const [taskSaved, setTaskSaved] = useState(false);
  const [saving,    setSaving]    = useState(false);

  const handleSaveTasks = async () => {
    setSaving(true);
    try {
      await onSaveTasks(plan);
      setTaskSaved(true);
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  return (
    <motion.div className="space-y-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>

      {/* Hero overview card */}
      <div className="bg-gradient-to-br from-primary-700 via-primary-600 to-violet-600 rounded-2xl p-6 text-white shadow-lg">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="bg-white/20 backdrop-blur text-white text-xs font-semibold px-3 py-1 rounded-full">
            {CATEGORIES[goal.examType]?.label ?? goal.examType}
          </span>
          <span className="bg-amber-400/90 text-amber-900 text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1">
            <Calendar size={11} /> {daysLeft} days left
          </span>
          <span className="bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full flex items-center gap-1">
            <Clock size={11} /> {goal.dailyHours}h/day
          </span>
        </div>
        <h2 className="text-2xl font-extrabold">Your Study Plan</h2>
        <p className="text-sm text-primary-100 mt-2 leading-relaxed">{plan.overview}</p>
      </div>

      {/* Phase timeline */}
      {plan.phases?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">Study Phases</p>
          <div className="space-y-3">
            {plan.phases.map((ph, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-7 w-7 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-sm">{ph.phase}</span>
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{ph.weeks}</span>
                  </div>
                  <p className="text-xs text-slate-600 mt-0.5">{ph.goal}</p>
                  {ph.focus?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ph.focus.map((f, fi) => (
                        <span key={fi} className="text-[10px] bg-primary-50 text-primary-700 border border-primary-100 px-2 py-0.5 rounded-full">
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {i < plan.phases.length - 1 && (
                  <ChevronRight size={14} className="text-slate-300 shrink-0 mt-1.5" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subject strategies */}
      {plan.subjectStrategy && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4 flex items-center gap-1.5">
            <Target size={12} /> Subject Strategy
          </p>
          <div className="space-y-3">
            {Object.entries(plan.subjectStrategy).map(([subj, strat]) => (
              <div key={subj} className={`rounded-xl p-3 border ${SUBJECT_BG[subj] || 'bg-slate-50 border-slate-200'}`}>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${SUBJECT_PALETTE[subj] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                  {subj}
                </span>
                <p className="text-xs text-slate-700 mt-2 leading-relaxed">{strat}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Week 1 schedule */}
      {week1 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Week 1 Schedule</p>
          <p className="text-xs text-primary-600 font-semibold mb-4">{week1.theme}</p>
          <div className="space-y-2">
            {week1.days?.map((d, di) => (
              <div key={di} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="min-w-[52px]">
                  <p className="text-[10px] font-bold text-slate-500 uppercase">{d.day?.slice(0, 3)}</p>
                  <p className="text-xs font-semibold text-slate-900">{d.subject}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-700 leading-snug">{d.topics?.join(', ')}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">{d.task}</p>
                </div>
                <span className="text-[10px] font-bold text-primary-600 shrink-0">{d.hours}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily routine */}
      {plan.dailyRoutine && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4 flex items-center gap-1.5">
            <Clock size={12} /> Daily Routine
          </p>
          <div className="space-y-3">
            {[
              { label: 'Morning', key: 'morning', color: 'text-amber-600 bg-amber-50 border-amber-200' },
              { label: 'Evening', key: 'evening', color: 'text-blue-600 bg-blue-50 border-blue-200' },
              { label: 'Night',   key: 'night',   color: 'text-violet-600 bg-violet-50 border-violet-200' },
            ].map(({ label, key, color }) => (
              <div key={key} className={`rounded-xl p-3 border ${color}`}>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1">{label}</p>
                <p className="text-xs leading-relaxed">{plan.dailyRoutine[key]}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly targets */}
      {plan.weeklyTargets?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <TrendingUp size={12} /> Weekly Targets
          </p>
          <ul className="space-y-2">
            {plan.weeklyTargets.map((t, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Important tips */}
      {plan.importantTips?.length > 0 && (
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5">
          <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <Zap size={12} /> Important Tips
          </p>
          <div className="space-y-2">
            {plan.importantTips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="h-4 w-4 rounded-full bg-amber-200 text-amber-800 text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-amber-800 leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="space-y-2">
        {taskSaved ? (
          <div className="flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-semibold">
            <CheckCircle2 size={15} /> Today's tasks saved!
          </div>
        ) : (
          <button
            onClick={handleSaveTasks}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Save Today's Tasks
          </button>
        )}
        <div className="flex gap-3">
          <button
            onClick={onReset}
            className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-semibold text-sm flex items-center justify-center gap-1.5 hover:bg-slate-50"
          >
            <RotateCcw size={14} /> Regenerate
          </button>
          <button
            onClick={() => navigate('/practice/generate')}
            className="flex-1 py-3 rounded-2xl bg-primary-600 text-white font-bold text-sm flex items-center justify-center gap-1.5 hover:bg-primary-700"
          >
            <BookOpen size={14} /> Generate Practice
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function StudyPlanPage() {
  const navigate            = useNavigate();
  const { currentUser, userProfile, isPremium } = useAuth();
  const [phase, setPhase]   = useState('form');
  const [plan,  setPlan]    = useState(null);
  const [goal,  setGoal]    = useState(null);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (!currentUser) return;
    const profileExam = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
    getStudyGoal(currentUser.uid).then((saved) => {
      // A saved plan from a since-changed profile (different class/board/exam)
      // is stale — discard it and show a fresh form instead of old data.
      if (saved?.study_plan && saved.exam_type === profileExam) {
        setPlan(saved.study_plan);
        setGoal({
          examType:      saved.exam_type,
          examDate:      saved.exam_date,
          dailyHours:    saved.daily_hours,
          weakSubjects:  saved.weak_subjects ?? [],
          focusChapters: saved.focus_chapters ?? '',
        });
        setPhase('plan');
      }
    }).catch(() => {});
  }, [currentUser, userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level]);

  const handleGenerate = async (inputs) => {
    const quota = await checkQuota(currentUser?.uid, 'ai_questions_used', isPremium);
    if (!quota.allowed) { setError(quota.reason); return; }
    setGoal(inputs);
    setError('');
    setPhase('loading');
    try {
      const result = await generateStudyPlan(inputs);
      incrementQuota(currentUser?.uid, 'ai_questions_used').catch(() => {});
      setPlan(result);
      setPhase('plan');
      if (currentUser) {
        awardXP(currentUser.uid, 'study_plan_created').catch(() => {});
        createNotification(
          currentUser.uid,
          'study_plan_created',
          'Study plan created! +30 XP',
          `Your personalised ${inputs.examType} schedule is ready. Stay consistent!`,
          '/study?tab=plan',
        ).catch(() => {});
        saveStudyGoal(currentUser.uid, {
          exam_type:      inputs.examType,
          exam_date:      inputs.examDate,
          daily_hours:    inputs.dailyHours,
          weak_subjects:  inputs.weakSubjects,
          focus_chapters: inputs.focusChapters,
          study_plan:     result,
        }).catch(() => {});
      }
    } catch (e) {
      setError(e.message || 'Failed to generate plan. Please try again.');
      setPhase('form');
    }
  };

  const handleReset = () => { setPlan(null); setGoal(null); setPhase('form'); };

  const handleSaveTasks = async (planObj) => {
    if (!currentUser) return;
    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const week1 = planObj.weeklyPlan?.[0];
    if (!week1?.days?.length) return;
    const todayName = today.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' });
    const todayDay = week1.days.find(d => d.day?.toLowerCase() === todayName.toLowerCase())
      || week1.days[0];
    if (!todayDay) return;
    const topics = todayDay.topics || [todayDay.topic || todayDay.task || 'Study'];
    const hrs = todayDay.hours || 2;
    const durPerTopic = Math.round((hrs * 60) / topics.length);
    for (const topic of topics) {
      await addManualTask(currentUser.uid, {
        subject: todayDay.subject || 'Study',
        topic,
        duration_min: durPerTopic,
        task_type: /practice|questions/i.test(todayDay.task) ? 'practice'
          : /revision/i.test(todayDay.task) ? 'revision'
          : 'study',
      });
    }
  };

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-2xl mx-auto lg:mx-0">
      <HubPageHeader icon={Brain} title="Study Plan" subtitle="AI-personalised schedule for your exam" />

      <AnimatePresence>
        {error && (
          <motion.div
            className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-600"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {phase === 'form' && (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GoalForm onGenerate={handleGenerate} defaultExamType={buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level)} />
          </motion.div>
        )}
        {phase === 'loading' && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <LoadingScreen />
          </motion.div>
        )}
        {phase === 'plan' && plan && (
          <motion.div key="plan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <PlanDisplay plan={plan} goal={goal} onReset={handleReset} navigate={navigate} onSaveTasks={handleSaveTasks} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
