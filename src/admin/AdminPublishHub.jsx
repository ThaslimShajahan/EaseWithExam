import { lazy } from 'react';
import { FileText, Wand2, ClipboardList, Ruler } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminPapers          = lazy(() => import('./AdminPapers'));
const AdminPaperGen        = lazy(() => import('./AdminPaperGen'));
const AdminPublishedTests  = lazy(() => import('./AdminPublishedTests'));
const AdminPaperTemplates  = lazy(() => import('./AdminPaperTemplates'));

export default function AdminPublishHub() {
  return (
    <AdminHub
      title="Publish"
      subtitle="Generate question papers and manage what's published to students"
      defaultTab="papergen"
      tabs={[
        { id: 'papergen',  icon: Wand2,         label: 'Paper Gen',       element: <AdminPaperGen /> },
        { id: 'papers',    icon: FileText,      label: 'Uploaded Papers', element: <AdminPapers /> },
        { id: 'tests',     icon: ClipboardList, label: 'Published Tests', element: <AdminPublishedTests /> },
        { id: 'templates', icon: Ruler,         label: 'Paper Templates', element: <AdminPaperTemplates /> },
      ]}
    />
  );
}
