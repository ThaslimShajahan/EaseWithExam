import { lazy } from 'react';
import { UserCog, Search, Activity, DatabaseBackup } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminAdmins        = lazy(() => import('./AdminAdmins'));
const AdminStudentLookup = lazy(() => import('./AdminStudentLookup'));
const AdminActivityLog   = lazy(() => import('./AdminActivityLog'));
const AdminBackup        = lazy(() => import('./AdminBackup'));

export default function AdminPeopleHub() {
  return (
    <AdminHub
      title="People & Audit"
      subtitle="Admin accounts, student lookup, the audit trail, and full-data backup"
      defaultTab="admins"
      tabs={[
        { id: 'admins',   icon: UserCog,         label: 'Admins',         element: <AdminAdmins /> },
        { id: 'lookup',   icon: Search,          label: 'Student Lookup', element: <AdminStudentLookup /> },
        { id: 'activity', icon: Activity,        label: 'Activity Log',   element: <AdminActivityLog /> },
        { id: 'backup',   icon: DatabaseBackup,  label: 'Backup',         element: <AdminBackup /> },
      ]}
    />
  );
}
