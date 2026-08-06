import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Target, BookOpen, BookMarked, Sparkles, Headphones, Star } from 'lucide-react';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import HubTabBar from '../components/ui/HubTabBar';

const StudyPlanPage     = lazy(() => import('./StudyPlanPage'));
const NotesBrowser      = lazy(() => import('../components/study/NotesBrowser'));
const ImportantQAPage   = lazy(() => import('../components/study/ImportantQAPage'));
const ErrorNotebookPage = lazy(() => import('./ErrorNotebookPage'));
const SummarizerPage    = lazy(() => import('./SummarizerPage'));
const PodcastPage       = lazy(() => import('./PodcastPage'));

// Practice/exam papers live under Exams Hub (/exams) — Study is content-only,
// to avoid two competing "practice" surfaces. Flashcards and Videos are hidden
// for now (not removed — FlashcardsPage/VideoLearningPage still exist) pending
// content/UX rework. Error Notebook moved here from Progress Hub — it's
// revision material (a student's own past mistakes), same category as
// Notes/Study Plan, not a progress metric.
const TABS = [
  { key: 'notes',      label: 'Notes',          icon: BookOpen   },
  { key: 'important',  label: 'Important Q&A',  icon: Star       },
  { key: 'notebook',   label: 'Error Notebook', icon: BookMarked },
  { key: 'plan',       label: 'Study Plan',     icon: Target     },
  { key: 'summarizer', label: 'Summarizer',     icon: Sparkles   },
  { key: 'podcast',    label: 'Podcast',        icon: Headphones },
];

const PAGES = {
  notes:      <div className="p-4 lg:p-0"><NotesBrowser /></div>,
  important:  <div className="p-4 lg:p-0"><ImportantQAPage /></div>,
  notebook:   <ErrorNotebookPage />,
  plan:       <StudyPlanPage />,
  summarizer: <SummarizerPage />,
  podcast:    <PodcastPage />,
};

export default function StudyHubPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = TABS.some(t => t.key === raw) ? raw : 'notes';

  return (
    <>
      <HubTabBar layoutId="study-hub-underline" tabs={TABS} active={tab} onChange={(key) => setParams({ tab: key }, { replace: true })} />
      <div className="pt-4 lg:pt-6">
        <Suspense fallback={<SkeletonLoader type="page" />}>
          {PAGES[tab]}
        </Suspense>
      </div>
    </>
  );
}
