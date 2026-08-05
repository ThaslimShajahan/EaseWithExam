import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, ListChecks, Trophy } from 'lucide-react';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import HubTabBar from '../components/ui/HubTabBar';

const AnalyticsPage     = lazy(() => import('./AnalyticsPage'));
const SyllabusPage      = lazy(() => import('./SyllabusTrackerPage'));
const LeaderboardPage   = lazy(() => import('./LeaderboardPage'));

// Error Notebook lives under Study Hub (/study?tab=notebook) — it's revision
// material tied to a student's own mistakes, same category as Notes/Study Plan.
const TABS = [
  { key: 'analytics', label: 'Analytics',     icon: BarChart3  },
  { key: 'syllabus',  label: 'Syllabus',       icon: ListChecks },
  { key: 'leaderboard', label: 'Leaderboard',  icon: Trophy     },
];

const PAGES = {
  analytics:   <AnalyticsPage />,
  syllabus:    <SyllabusPage />,
  leaderboard: <LeaderboardPage />,
};

export default function ProgressHubPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = TABS.some(t => t.key === raw) ? raw : 'analytics';

  return (
    <>
      <HubTabBar layoutId="progress-hub-underline" tabs={TABS} active={tab} onChange={(key) => setParams({ tab: key }, { replace: true })} />
      <div className="pt-4 lg:pt-6">
        <Suspense fallback={<SkeletonLoader type="page" />}>
          {PAGES[tab]}
        </Suspense>
      </div>
    </>
  );
}
