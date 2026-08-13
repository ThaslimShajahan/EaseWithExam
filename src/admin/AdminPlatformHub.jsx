import { lazy } from 'react';
import { ToggleRight, Settings, Tag, Gauge, LayoutGrid, Compass, Mail, Layers } from 'lucide-react';
import AdminHub from './AdminHub';

const AdminFeatureFlags      = lazy(() => import('./AdminFeatureFlags'));
const AdminPlatformSettings  = lazy(() => import('./AdminPlatformSettings'));
const AdminPricing           = lazy(() => import('./AdminPricing'));
const AdminQuota             = lazy(() => import('./AdminQuota'));
const AdminCategorySettings  = lazy(() => import('./AdminCategorySettings'));
const AdminOnboardingOptions = lazy(() => import('./AdminOnboardingOptions'));
const AdminEmailTemplates    = lazy(() => import('./AdminEmailTemplates'));
const AdminStreamConfig      = lazy(() => import('./AdminStreamConfig'));

export default function AdminPlatformHub() {
  return (
    <AdminHub
      title="Platform"
      subtitle="Feature flags, branding, pricing, quota limits, categories, onboarding, streams, and email templates"
      defaultTab="flags"
      tabs={[
        { id: 'flags',      icon: ToggleRight, label: 'Feature Flags', element: <AdminFeatureFlags /> },
        { id: 'settings',   icon: Settings,    label: 'Platform',      element: <AdminPlatformSettings /> },
        { id: 'categories', icon: LayoutGrid,  label: 'Categories',    element: <AdminCategorySettings /> },
        { id: 'onboarding', icon: Compass,     label: 'Onboarding',    element: <AdminOnboardingOptions /> },
        { id: 'streams',    icon: Layers,      label: 'Streams',       element: <AdminStreamConfig /> },
        { id: 'emails',     icon: Mail,        label: 'Email Templates', element: <AdminEmailTemplates /> },
        { id: 'pricing',    icon: Tag,         label: 'Pricing',       element: <AdminPricing /> },
        { id: 'quota',      icon: Gauge,       label: 'Quota',         element: <AdminQuota /> },
      ]}
    />
  );
}
