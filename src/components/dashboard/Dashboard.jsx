import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FileText, MessageCircleQuestion, BarChart3,
  Target, Clock, ChevronRight,
  BookOpen, Flame, Crown, TrendingUp, Zap,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getTestSessions } from '../../lib/supabase';
import { getUserGamification } from '../../lib/gamification';
import Button from '../ui/Button';
import SkeletonLoader from '../ui/SkeletonLoader';
import StatCard from '../ui/StatCard';
import EmptyState from '../ui/EmptyState';
import { StudyingIllustration, AtomDoodle, StarDoodle, WaveDoodle } from '../ui/Illustrations';
import DailyChallenge from './DailyChallenge';
import StreakWidget from '../ui/StreakWidget';
import ScorePredictor from '../analytics/ScorePredictor';
import ProgressCertificate from '../ui/ProgressCertificate';
import TodayFocus from './TodayFocus';
import WeakTopicsWidget from './WeakTopicsWidget';
import QuotaWidget from './QuotaWidget';
import OnboardingChecklist from './OnboardingChecklist';

const QUICK_ACTIONS = [
  { label: 'Exam Center',    icon: FileText,             to: '/exams?tab=papers',      iconColor: 'text-primary-600',  iconBg: 'bg-primary-50',  desc: 'Full-length test papers'  },
  { label: 'Ask EWE',        icon: MessageCircleQuestion, to: '/doubt',                  iconColor: 'text-emerald-600',  iconBg: 'bg-emerald-50',  desc: 'Step-by-step evaluation' },
  { label: 'View Analytics', icon: BarChart3,             to: '/progress?tab=analytics', iconColor: 'text-amber-600',    iconBg: 'bg-amber-50',    desc: 'Strengths & gaps'         },
];

function RecentTestRow({ session, prevPct }) {
  const pct = session.total_marks > 0
    ? Math.round((session.score / session.total_marks) * 100)
    : 0;

  // Never red for student score — use progress framing below 40%
  const ringColor =
    pct >= 70 ? 'var(--clr-success)' :
    pct >= 50 ? 'var(--clr-warning)' :
                'var(--clr-warning)';

  const date = new Date(session.created_at).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short',
  });

  const trend = prevPct != null ? pct - prevPct : null;

  return (
    <div className="flex items-center gap-3">
      <svg width="44" height="44" viewBox="0 0 44 44" className="shrink-0">
        <circle cx="22" cy="22" r="17" fill="none" stroke="#E2E8F0" strokeWidth="5" />
        <circle
          cx="22" cy="22" r="17" fill="none"
          stroke={ringColor} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 17 * pct / 100} ${2 * Math.PI * 17}`}
          strokeDashoffset={2 * Math.PI * 17 / 4}
        />
        <text x="22" y="26" textAnchor="middle" fontSize="9" fontWeight="700" fill="#0F172A">
          {pct}%
        </text>
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800 truncate">
          {session.test_name || 'Mock Test'}
        </p>
        <p className="text-xs text-slate-400">
          {pct < 40 && trend !== null
            ? trend >= 0
              ? `+${trend}% from last test · Keep going!`
              : `${session.score}/${session.total_marks} marks · ${date}`
            : `${session.score}/${session.total_marks} marks · ${date}`
          }
        </p>
      </div>
      {trend !== null && trend > 0 && (
        <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
          +{trend}%
        </span>
      )}
      <ChevronRight size={15} className="text-slate-300 shrink-0" />
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function fmtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

export default function Dashboard() {
  const { currentUser, userProfile, isPremium, subscription } = useAuth();
  const navigate = useNavigate();
  const [sessions,      setSessions]      = useState([]);
  const [gamification,  setGamification]  = useState(null);
  const [loading,       setLoading]       = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    Promise.all([
      getTestSessions(currentUser.uid, 10, userProfile?.target_exam),
      getUserGamification(currentUser.uid),
    ])
      .then(([s, g]) => { setSessions(s); setGamification(g); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [currentUser, userProfile?.target_exam]);

  const name      = userProfile?.display_name || currentUser?.displayName || 'Student';
  const exam      = userProfile?.target_exam;
  const examLabel = exam === 'BOTH' ? 'NEET + JEE' : exam?.replace('_', ' ') || 'your exam';

  const EXAM_DATES = { NEET: '2026-05-03', JEE_MAIN: '2026-01-22', JEE_ADVANCED: '2026-05-18' };
  const targetDate = EXAM_DATES[exam] ? new Date(EXAM_DATES[exam]) : null;
  const days = targetDate ? Math.max(0, Math.ceil((targetDate - new Date()) / 86400000)) : null;

  const count    = sessions.length;
  const avgScore = count
    ? Math.round(sessions.reduce((a, s) => a + (s.total_marks ? (s.score / s.total_marks) * 100 : 0), 0) / count)
    : null;
  const totalSec = sessions.reduce((a, s) => a + (s.time_taken || 0), 0);
  const recent   = sessions.slice(0, 3);
  const streak   = gamification?.streak_days ?? null;
  const totalXP  = gamification?.total_xp ?? 0;

  // pct of each recent session (for trend calculation)
  const recentPcts = recent.map((s) =>
    s.total_marks > 0 ? Math.round((s.score / s.total_marks) * 100) : 0
  );


  if (loading) return <SkeletonLoader type="dashboard" />;

  const isNewUser = count === 0 && !gamification?.total_xp;

  return (
    <div className="space-y-6 p-4 lg:p-0">

      {/* Onboarding checklist — shown for new users until dismissed */}
      {isNewUser && (
        <OnboardingChecklist sessions={sessions} gamification={gamification} />
      )}

      {/* Welcome banner — the ONE gradient element on this page */}
      <motion.div
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 via-primary-700 to-primary-900 text-white p-5 border-0 shadow-card"
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      >
        <div className="absolute inset-0 pointer-events-none select-none">
          <div className="absolute top-2 right-4">   <AtomDoodle size={70} opacity={0.07} /></div>
          <div className="absolute top-4 right-24">  <StarDoodle size={12} opacity={0.12} /></div>
          <div className="absolute bottom-0 left-0 right-0"><WaveDoodle width={400} opacity={0.06} /></div>
        </div>

        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex-1">
            <p className="text-primary-200 text-sm font-medium">
              Good {getGreeting()}, {name.split(' ')[0]} 👋
            </p>
            <h1 className="text-xl font-bold mt-1">Ready to ace {examLabel}?</h1>
            <p className="text-primary-200 text-sm mt-1">
              {days !== null ? `${days} days to go · Stay consistent!` : 'Keep practising every day!'}
            </p>
            <div className="mt-4 flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={() => navigate('/test')}
                className="bg-white/20 border-white/30 text-white hover:bg-white/30 border"
              >
                Start Mock Test →
              </Button>
              {!isPremium && (
                <Button
                  size="sm"
                  onClick={() => navigate('/pricing')}
                  className="bg-amber-400/20 border-amber-300/40 text-amber-100 hover:bg-amber-400/30 border flex items-center gap-1.5"
                >
                  <Crown size={12} /> Upgrade
                </Button>
              )}
            </div>
            {/* Momentum pill — streak + XP */}
            {(streak > 0 || totalXP > 0) && (
              <div className="mt-3 inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-3 py-1">
                {streak > 0 && (
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-300">
                    <Flame size={12} /> {streak}d streak
                  </span>
                )}
                {streak > 0 && totalXP > 0 && <span className="text-white/30 text-xs">·</span>}
                {totalXP > 0 && (
                  <span className="flex items-center gap-1 text-xs font-bold text-primary-200">
                    <Zap size={12} /> {totalXP.toLocaleString()} XP
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="hidden sm:block shrink-0 opacity-90">
            <StudyingIllustration />
          </div>

          {days !== null && (
            <div className="sm:hidden text-right shrink-0">
              <p className="text-primary-200 text-[10px]">{examLabel}</p>
              <p className="text-3xl font-extrabold">{days}</p>
              <p className="text-primary-200 text-[10px]">days left</p>
            </div>
          )}
        </div>
      </motion.div>

      {/* Quick-glance summary strip */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1">
        <span className="text-2xl font-extrabold text-slate-900">{count}</span>
        <span className="text-sm text-slate-500 mr-3">Tests Taken</span>
        <span className="text-2xl font-extrabold text-slate-900">{avgScore != null ? `${avgScore}%` : '—'}</span>
        <span className="text-sm text-slate-500">Average Score</span>
      </div>

      {/* Stats row — dense instrument-panel tiles, one glance covers everything */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Tests Taken"     value={count || '—'}
          icon={FileText}          sub={count ? `${count} total` : 'None yet'}
          iconColor="text-primary-600" iconBg="bg-primary-50"
        />
        <StatCard
          label="Avg. Score"       value={avgScore != null ? `${avgScore}%` : '—'}
          icon={Target}            sub={avgScore != null ? 'All sessions' : 'Take a test first'}
          iconColor="text-success" iconBg="bg-success-light"
        />
        <StatCard
          label="Study Streak"     value={streak !== null ? `${streak}d` : '—'}
          icon={Flame}             sub={streak ? `${streak}-day streak!` : 'Start today'}
          iconColor="text-warning" iconBg="bg-warning-light"
        />
        <StatCard
          label="Time Practiced"   value={totalSec ? fmtTime(totalSec) : '—'}
          icon={Clock}             sub={totalSec ? 'Total in tests' : 'No sessions yet'}
          iconColor="text-primary-600" iconBg="bg-primary-50"
        />
      </div>

      {/* Quick actions — quiet icon cards, no gradients */}
      <div className="grid lg:grid-cols-3 gap-3">
        {QUICK_ACTIONS.map(({ label, icon: Icon, to, iconColor, iconBg, desc }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className="card card-interactive text-left flex items-center gap-4 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
          >
            <div className={`h-11 w-11 rounded-control ${iconBg} flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform`}>
              <Icon size={20} className={iconColor} />
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-sm">{label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
            </div>
            <ChevronRight size={14} className="text-slate-300 ml-auto shrink-0" />
          </button>
        ))}
      </div>

      {/* Daily Focus + Quota */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2"><TodayFocus /></div>
        <QuotaWidget />
      </div>

      {/* Daily Challenge */}
      <DailyChallenge />

      {/* Streak + Weak Topics */}
      <div className="grid lg:grid-cols-2 gap-4">
        <StreakWidget />
        <WeakTopicsWidget />
      </div>

      {/* Score predictor + Certificates — side by side on desktop */}
      <div className="grid lg:grid-cols-2 gap-4">
        <ScorePredictor />
        <ProgressCertificate
          sessions={sessions}
          studentName={name}
          examLabel={examLabel}
        />
      </div>

      {/* Recent tests */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-900">Recent Tests</h3>
          {recent.length > 0 && (
            <button className="text-xs text-primary-600 hover:underline" onClick={() => navigate('/analytics')}>
              View all
            </button>
          )}
        </div>

        {recent.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No tests taken yet"
            body="Your scores will appear here after your first mock test."
            action={{ label: 'Take First Test', onClick: () => navigate('/test') }}
            size="sm"
          />
        ) : (
          <div className="space-y-3">
            {recent.map((s, i) => (
              <RecentTestRow key={s.id} session={s} prevPct={recentPcts[i + 1] ?? null} />
            ))}
          </div>
        )}
      </div>

      {/* Error Notebook CTA */}
      <div className="card flex items-center gap-4">
        <div className="h-12 w-12 rounded-2xl bg-rose-50 flex items-center justify-center shrink-0">
          <BookOpen size={20} className="text-rose-500" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-slate-900 text-sm">Error Notebook</h3>
          <p className="text-xs text-slate-400 mt-0.5">All your wrong answers — reviewed at the perfect time via spaced repetition</p>
        </div>
        <button onClick={() => navigate('/notebook')}
          className="shrink-0 text-xs font-semibold text-primary-600 bg-primary-50 border border-primary-100 px-3 py-2 rounded-control hover:bg-primary-100 transition-colors flex items-center gap-1">
          Open <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
