import { lazy } from 'react';
import { Inbox, Library, ClipboardCheck, BookOpenText, BookOpen, Network, ShieldCheck, ListChecks } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminContentIntake  = lazy(() => import('./AdminContentIntake'));
const AdminContentLibrary = lazy(() => import('./AdminContentLibrary'));
const AdminContentReview  = lazy(() => import('./AdminContentReview'));
const AdminSyllabus       = lazy(() => import('./AdminSyllabus'));
const AdminStudyNotes     = lazy(() => import('./AdminStudyNotes'));
const AdminContentMap     = lazy(() => import('./AdminContentMap'));
const AdminChapterManifest = lazy(() => import('./AdminChapterManifest'));
const AdminContentJobs    = lazy(() => import('./AdminContentJobs'));

export default function AdminContentHub() {
  return (
    <AdminHub
      title="Content"
      subtitle="Upload, browse, and review question papers and study material"
      defaultTab="intake"
      tabs={[
        { id: 'intake',    icon: Inbox,           label: 'Content Intake',  element: <AdminContentIntake /> },
        // Sits immediately after Intake because it is now a PREREQUISITE for it:
        // a Study Notes upload is refused until this book's manifest is approved.
        { id: 'manifests', icon: ShieldCheck,     label: 'Chapter Manifests', element: <AdminChapterManifest /> },
        // Status view for the CLI queue (bulk-load-unit-notes.mjs --enqueue / --work)
        // — Tier 2 of the background job runner. Next to Manifests because a queued
        // job is only ever processable once its book's manifest is approved.
        { id: 'jobs',      icon: ListChecks,      label: 'Content Jobs',    element: <AdminContentJobs /> },
        { id: 'library',   icon: Library,         label: 'Content Library', element: <AdminContentLibrary /> },
        { id: 'review',    icon: ClipboardCheck,  label: 'Review Queue',    element: <AdminContentReview /> },
        { id: 'syllabus',  icon: BookOpenText,    label: 'Syllabus',        element: <AdminSyllabus /> },
        { id: 'notes',     icon: BookOpen,        label: 'Study Notes',     element: <AdminStudyNotes /> },
        { id: 'map',       icon: Network,         label: 'Content Map',     element: <AdminContentMap /> },
      ]}
    />
  );
}
