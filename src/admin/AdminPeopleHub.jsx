import { lazy } from 'react';
import { UserCog, Search, Activity } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminAdmins        = lazy(() => import('./AdminAdmins'));
const AdminStudentLookup = lazy(() => import('./AdminStudentLookup'));
const AdminActivityLog   = lazy(() => import('./AdminActivityLog'));

export default function AdminPeopleHub() {
  return (
    <AdminHub
      title="People & Audit"
      subtitle="Admin accounts, student lookup, and the audit trail"
      defaultTab="admins"
      tabs={[
        { id: 'admins',   icon: UserCog,  label: 'Admins',         element: <AdminAdmins /> },
        { id: 'lookup',   icon: Search,   label: 'Student Lookup', element: <AdminStudentLookup /> },
        { id: 'activity', icon: Activity, label: 'Activity Log',   element: <AdminActivityLog /> },
      ]}
    />
  );
}
