import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FlaskConical, Layers, PlayCircle, Target, BookOpen } from 'lucide-react';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import HubTabBar from '../components/ui/HubTabBar';

const PracticePage      = lazy(() => import('./PracticePage'));
const FlashcardsPage    = lazy(() => import('./FlashcardsPage'));
const VideoLearningPage = lazy(() => import('./VideoLearningPage'));
const StudyPlanPage     = lazy(() => import('./StudyPlanPage'));
const NotesBrowser      = lazy(() => import('../components/study/NotesBrowser'));

const TABS = [
  { key: 'practice',   label: 'Practice',   icon: FlaskConical },
  { key: 'flashcards', label: 'Flashcards', icon: Layers       },
  { key: 'notes',      label: 'Notes',      icon: BookOpen     },
  { key: 'videos',     label: 'Videos',     icon: PlayCircle   },
  { key: 'plan',       label: 'Study Plan', icon: Target       },
];

const PAGES = {
  practice:   <PracticePage />,
  flashcards: <FlashcardsPage />,
  notes:      <div className="p-4 lg:p-0"><NotesBrowser /></div>,
  videos:     <VideoLearningPage />,
  plan:       <StudyPlanPage />,
};

export default function StudyHubPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = TABS.some(t => t.key === raw) ? raw : 'practice';

  return (
    <>
      <HubTabBar layoutId="study-hub-underline" tabs={TABS} active={tab} onChange={(key) => setParams({ tab: key }, { replace: true })} />
      <Suspense fallback={<SkeletonLoader type="page" />}>
        {PAGES[tab]}
      </Suspense>
    </>
  );
}
