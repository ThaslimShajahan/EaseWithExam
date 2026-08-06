import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Sparkles, Target, Bell, ScanSearch } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import { buildExamType } from '../lib/categories';

const ExamCenterPage        = lazy(() => import('./ExamCenterPage'));
const NotificationsPage     = lazy(() => import('./NotificationsPage'));
const PracticeGeneratorPage = lazy(() => import('./PracticeGeneratorPage'));
const PaperModePage         = lazy(() => import('./PaperModePage'));

const MODES = [
  { key: 'practice', label: 'Practice Mode', icon: Sparkles,    desc: 'Chapter-wise · instant feedback' },
  { key: 'papers',   label: 'Exam Mode',     icon: Target,      desc: 'Full papers · timed · scored'   },
  // Independent of any active exam attempt — upload and grade any paper,
  // any time. Previously bundled into the in-exam Paper Mode tab bar
  // (visible even mid-attempt regardless of context); now its own entry
  // point. Reuses PaperModePage with no ?id= — it already falls through to
  // this exact standalone grading flow when no paper is loaded.
  { key: 'grade',    label: 'Grade Paper',   icon: ScanSearch,  desc: 'Upload any answer sheet · instant AI grading' },
];

export default function ExamsHubPage() {
  const { userProfile } = useAuth();
  const exam    = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const isBoard = /^(CBSE|ICSE|Class \d+|State Board|Kerala State)/.test(exam);

  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? 'practice';
  const tab = ['practice', 'papers', 'grade', 'alerts'].includes(raw) ? raw : 'practice';

  const setTab = (key) => setParams({ tab: key }, { replace: true });

  return (
    <>
      {/* ── Mode bar ────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-white/85 backdrop-blur-xl border-b border-slate-100">
        <div className="flex items-center gap-3 px-4 py-3">
          {/* Practice / Exam / Grade pill toggle — labels collapse to
              icon-only below sm: now that a 3rd mode shares this row with
              the Alerts button, to avoid crowding on narrow phones. */}
          <div className="flex gap-1 bg-slate-100 rounded-2xl p-1 flex-1">
            {MODES.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                title={label}
                className={[
                  'flex-1 flex items-center justify-center gap-1.5 px-2 sm:px-3 py-2.5 rounded-xl text-xs font-bold transition-all',
                  tab === key
                    ? 'bg-white text-primary-700 shadow-sm ring-1 ring-slate-200'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                <Icon size={13} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Alerts button — competitive only */}
          {!isBoard && (
            <button
              onClick={() => setTab('alerts')}
              className={[
                'flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border transition-all shrink-0',
                tab === 'alerts'
                  ? 'bg-amber-50 border-amber-200 text-amber-700'
                  : 'border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600',
              ].join(' ')}
            >
              <Bell size={13} />
              Alerts
            </button>
          )}
        </div>

        {/* Mode subtitle */}
        {tab !== 'alerts' && (
          <div className="px-4 pb-2">
            <p className="text-[11px] text-slate-400">
              {MODES.find((m) => m.key === tab)?.desc}
            </p>
          </div>
        )}
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      <div className={`${tab === 'practice' ? 'p-4 lg:p-6 max-w-xl' : 'p-4 lg:p-6 max-w-3xl'}`}>
        <Suspense fallback={<SkeletonLoader type="page" />}>
          {tab === 'practice' && <PracticeGeneratorPage embedded />}
          {tab === 'papers'   && <ExamCenterPage />}
          {tab === 'grade'    && <PaperModePage />}
          {tab === 'alerts'   && <NotificationsPage />}
        </Suspense>
      </div>
    </>
  );
}
