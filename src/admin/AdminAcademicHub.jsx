import { lazy } from 'react';
import { BookOpenText, BookOpen, Network } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminSyllabus   = lazy(() => import('./AdminSyllabus'));
const AdminStudyNotes = lazy(() => import('./AdminStudyNotes'));
const AdminContentMap = lazy(() => import('./AdminContentMap'));

export default function AdminAcademicHub() {
  return (
    <AdminHub
      title="Academic"
      subtitle="Syllabus structure, study notes, and content coverage"
      defaultTab="syllabus"
      tabs={[
        { id: 'syllabus', icon: BookOpenText, label: 'Syllabus',    element: <AdminSyllabus /> },
        { id: 'notes',    icon: BookOpen,     label: 'Study Notes', element: <AdminStudyNotes /> },
        { id: 'map',      icon: Network,      label: 'Content Map', element: <AdminContentMap /> },
      ]}
    />
  );
}
