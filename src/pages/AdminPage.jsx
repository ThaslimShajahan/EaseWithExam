import { Routes, Route } from 'react-router-dom';
import AdminGuard   from '../admin/AdminGuard';
import AdminLayout  from '../admin/AdminLayout';
import AdminOverview  from '../admin/AdminOverview';
import AdminCrawler   from '../admin/AdminCrawler';
import AdminPapers    from '../admin/AdminPapers';
import AdminStudents  from '../admin/AdminStudents';
import AdminVeda      from '../admin/AdminVeda';

export default function AdminPage() {
  return (
    <AdminGuard>
      <AdminLayout />
    </AdminGuard>
  );
}

/* Sub-routes rendered inside AdminLayout's <Outlet /> */
export { AdminOverview, AdminCrawler, AdminPapers, AdminStudents, AdminVeda };
