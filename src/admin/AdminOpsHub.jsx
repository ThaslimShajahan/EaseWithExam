import { lazy } from 'react';
import { Database, Bell, MessageSquare } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminTestData   = lazy(() => import('./AdminTestData'));
const AdminDataViewer = lazy(() => import('./AdminDataViewer'));
const AdminExamWatch  = lazy(() => import('./AdminExamWatch'));
const AdminVeda       = lazy(() => import('./AdminVeda'));

export default function AdminOpsHub() {
  return (
    <AdminHub
      title="Ops"
      subtitle="Test data tooling, raw data access, exam-alert scraping, and EWE chat monitoring"
      defaultTab="data"
      tabs={[
        { id: 'testdata', icon: Database,     label: 'Test Data',   element: <AdminTestData /> },
        { id: 'data',     icon: Database,     label: 'Data Viewer', element: <AdminDataViewer /> },
        { id: 'examwatch',icon: Bell,         label: 'Exam Watch',  element: <AdminExamWatch /> },
        { id: 'veda',     icon: MessageSquare,label: 'EWE Chat',    element: <AdminVeda /> },
      ]}
    />
  );
}
