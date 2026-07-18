import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Users, FileText, LogOut, ClipboardList, ClipboardCheck, Settings, Building2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCoaching } from './CoachingPortalGuard';

export default function CoachingPortalLayout() {
  const { signOut }  = useAuth();
  const { record }   = useCoaching();
  const navigate     = useNavigate();

  const brandColor = record?.centre_brand_color || '#6366f1';
  const logoUrl    = record?.centre_logo_url;

  const NAV = [
    { to: '/coaching/dashboard',    icon: <LayoutDashboard size={16} />, label: 'Dashboard'   },
    { to: '/coaching/students',     icon: <Users size={16} />,           label: 'Students'    },
    { to: '/coaching/assignments',  icon: <ClipboardList size={16} />,   label: 'Assignments' },
    { to: '/coaching/tests',        icon: <ClipboardCheck size={16} />,  label: 'Test Builder' },
    { to: '/coaching/notes',        icon: <FileText size={16} />,         label: 'Study Notes' },
  ];

  const handleSignOut = async () => { await signOut(); navigate('/auth', { replace: true }); };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* ── Top bar ── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          {/* Brand / logo */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {logoUrl ? (
              <img src={logoUrl} alt={record?.centre_name} className="h-8 w-auto max-w-[120px] object-contain rounded" />
            ) : (
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${brandColor}20` }}
              >
                <Building2 size={16} style={{ color: brandColor }} />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-bold text-slate-900 text-sm leading-tight truncate">
                {record?.centre_name ?? 'Coaching Portal'}
              </p>
              {(record?.centre_tagline || record?.centre_city) && (
                <p className="text-[10px] text-slate-400 leading-tight truncate">
                  {record?.centre_tagline || record.centre_city}
                </p>
              )}
            </div>
          </div>

          {/* Desktop nav */}
          <nav className="hidden sm:flex items-center gap-0.5">
            {NAV.map(({ to, icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => [
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                  isActive ? 'text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50',
                ].join(' ')}
                style={({ isActive }) => isActive ? { background: brandColor } : {}}
              >
                {icon} {label}
              </NavLink>
            ))}
          </nav>

          {/* User strip */}
          <div className="flex items-center gap-2 ml-2 shrink-0">
            <div className="hidden sm:block text-right">
              <p className="text-xs font-semibold text-slate-700 leading-tight">{record?.name}</p>
              <p className="text-[10px] text-slate-400 capitalize leading-tight">{record?.role?.replace('_', ' ')}</p>
            </div>
            {record?.role === 'centre_admin' && (
              <NavLink
                to="/coaching/settings"
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                title="Centre Settings"
              >
                <Settings size={15} />
              </NavLink>
            )}
            <button
              onClick={handleSignOut}
              className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
              title="Sign out"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>

        {/* Mobile bottom nav strip */}
        <div className="sm:hidden flex border-t border-slate-100">
          {NAV.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => [
                'flex-1 flex flex-col items-center gap-0.5 py-2 text-[9px] font-semibold transition-colors',
                isActive ? 'text-white' : 'text-slate-400',
              ].join(' ')}
              style={({ isActive }) => isActive ? { color: brandColor } : {}}
            >
              {icon} {label}
            </NavLink>
          ))}
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 max-w-6xl mx-auto w-full p-4 md:p-6">
        <Outlet />
      </main>
    </div>
  );
}
