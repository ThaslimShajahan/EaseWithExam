import { lazy } from 'react';
import { ToggleRight, Settings, Tag, Gauge, LayoutGrid } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminFeatureFlags     = lazy(() => import('./AdminFeatureFlags'));
const AdminPlatformSettings = lazy(() => import('./AdminPlatformSettings'));
const AdminPricing          = lazy(() => import('./AdminPricing'));
const AdminQuota            = lazy(() => import('./AdminQuota'));
const AdminCategorySettings = lazy(() => import('./AdminCategorySettings'));

export default function AdminPlatformHub() {
  return (
    <AdminHub
      title="Platform"
      subtitle="Feature flags, branding, pricing, quota limits, and categories"
      defaultTab="flags"
      tabs={[
        { id: 'flags',      icon: ToggleRight, label: 'Feature Flags', element: <AdminFeatureFlags /> },
        { id: 'settings',   icon: Settings,    label: 'Platform',      element: <AdminPlatformSettings /> },
        { id: 'categories', icon: LayoutGrid,  label: 'Categories',    element: <AdminCategorySettings /> },
        { id: 'pricing',    icon: Tag,         label: 'Pricing',       element: <AdminPricing /> },
        { id: 'quota',      icon: Gauge,       label: 'Quota',         element: <AdminQuota /> },
      ]}
    />
  );
}
