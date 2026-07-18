import { lazy } from 'react';
import { FlaskConical, Database, Bell, Globe, MessageSquare } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminTestRunner = lazy(() => import('./AdminTestRunner'));
const AdminTestData   = lazy(() => import('./AdminTestData'));
const AdminDataViewer = lazy(() => import('./AdminDataViewer'));
const AdminExamWatch  = lazy(() => import('./AdminExamWatch'));
const AdminCrawler    = lazy(() => import('./AdminCrawler'));
const AdminVeda       = lazy(() => import('./AdminVeda'));

export default function AdminOpsHub() {
  return (
    <AdminHub
      title="Ops"
      subtitle="Test tooling, raw data access, exam-alert scraping, and EWE chat monitoring"
      defaultTab="testrun"
      tabs={[
        { id: 'testrun',  icon: FlaskConical, label: 'Test Runner', element: <AdminTestRunner /> },
        { id: 'testdata', icon: Database,     label: 'Test Data',   element: <AdminTestData /> },
        { id: 'data',     icon: Database,     label: 'Data Viewer', element: <AdminDataViewer /> },
        { id: 'examwatch',icon: Bell,         label: 'Exam Watch',  element: <AdminExamWatch /> },
        { id: 'crawler',  icon: Globe,        label: 'Web Crawler', element: <AdminCrawler /> },
        { id: 'veda',     icon: MessageSquare,label: 'EWE Chat',    element: <AdminVeda /> },
      ]}
    />
  );
}
