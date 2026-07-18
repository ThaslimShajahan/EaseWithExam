import { lazy } from 'react';
import { FileText, Wand2, ClipboardList } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminPapers        = lazy(() => import('./AdminPapers'));
const AdminPaperGen      = lazy(() => import('./AdminPaperGen'));
const AdminPublishedTests= lazy(() => import('./AdminPublishedTests'));

export default function AdminPublishHub() {
  return (
    <AdminHub
      title="Publish"
      subtitle="Generate question papers and manage what's published to students"
      defaultTab="papers"
      tabs={[
        { id: 'papers',   icon: FileText,      label: 'Papers',          element: <AdminPapers /> },
        { id: 'papergen', icon: Wand2,         label: 'Paper Gen',       element: <AdminPaperGen /> },
        { id: 'tests',    icon: ClipboardList, label: 'Published Tests', element: <AdminPublishedTests /> },
      ]}
    />
  );
}
