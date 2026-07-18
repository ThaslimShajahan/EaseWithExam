import { lazy } from 'react';
import { Inbox, Library, ClipboardCheck } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminContentIntake  = lazy(() => import('./AdminContentIntake'));
const AdminContentLibrary = lazy(() => import('./AdminContentLibrary'));
const AdminContentReview  = lazy(() => import('./AdminContentReview'));

export default function AdminContentHub() {
  return (
    <AdminHub
      title="Content"
      subtitle="Upload, browse, and review question papers and study material"
      defaultTab="intake"
      tabs={[
        { id: 'intake',    icon: Inbox,           label: 'Content Intake', element: <AdminContentIntake /> },
        { id: 'library',   icon: Library,         label: 'Content Library', element: <AdminContentLibrary /> },
        { id: 'review',    icon: ClipboardCheck,  label: 'Review Queue',   element: <AdminContentReview /> },
      ]}
    />
  );
}
