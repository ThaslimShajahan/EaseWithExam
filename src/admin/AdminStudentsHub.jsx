import { lazy } from 'react';
import { Users, CreditCard, Building2, Send, Gift, Receipt } from 'lucide-react';
import AdminHub from './AdminHub';
import { COACHING_MODULE_ENABLED } from '../lib/moduleStatus';

const AdminStudents      = lazy(() => import('./AdminStudents'));
const AdminSubscriptions = lazy(() => import('./AdminSubscriptions'));
const AdminBilling       = lazy(() => import('./AdminBilling'));
const AdminReferrals     = lazy(() => import('./AdminReferrals'));
const AdminCoaching      = lazy(() => import('./AdminCoaching'));
const AdminPushNotifications = lazy(() => import('./AdminPushNotifications'));

export default function AdminStudentsHub() {
  return (
    <AdminHub
      title="Students"
      subtitle="Student roster, subscriptions, billing, referrals, coaching centres, and push notifications"
      defaultTab="students"
      tabs={[
        { id: 'students',      icon: Users,      label: 'Students',      element: <AdminStudents /> },
        { id: 'subscriptions', icon: CreditCard, label: 'Subscriptions', element: <AdminSubscriptions /> },
        // Sits next to Subscriptions because they answer different questions from
        // different tables: Subscriptions is current entitlement (one row per
        // student), Billing is the payment ledger (one row per order, kept).
        { id: 'billing',       icon: Receipt,    label: 'Billing',       element: <AdminBilling /> },
        { id: 'referrals',     icon: Gift,       label: 'Referrals',     element: <AdminReferrals /> },
        // Coaching is paused (COACHING_MODULE_ENABLED) — flip that flag to bring the tab back.
        ...(COACHING_MODULE_ENABLED
          ? [{ id: 'coaching', icon: Building2, label: 'Coaching', element: <AdminCoaching /> }]
          : []),
        { id: 'push',          icon: Send,       label: 'Push Notif.',   element: <AdminPushNotifications /> },
      ]}
    />
  );
}
