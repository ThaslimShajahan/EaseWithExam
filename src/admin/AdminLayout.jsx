import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Inbox, FileText, BookOpenText, Users,
  Settings, FlaskConical, UserCog,
  ArrowLeft, Shield, Search, AlertTriangle, LogOut,
} from 'lucide-react';
import { ROLE_KEY } from './AdminGuard';
import AdminGlobalSearch from './AdminGlobalSearch';
import { supabase } from '../lib/supabase';

const isSuperAdmin = () => sessionStorage.getItem(ROLE_KEY) === 'superadmin';

// Each entry is a hub — the ~27 individual admin screens this used to list one-by-one
// are now grouped into a handful of hubs with tabs inside (see Admin*Hub.jsx).
const BASE_NAV = [
  { to: '/admin',          icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/admin/content',  icon: Inbox,           label: 'Content'   },
  { to: '/admin/publish',  icon: FileText,        label: 'Publish'   },
  { to: '/admin/academic', icon: BookOpenText,    label: 'Academic'  },
  { to: '/admin/students', icon: Users,           label: 'Students'  },
];

const SUPER_NAV = [
  { to: '/admin/platform', icon: Settings,      label: 'Platform'      },
  { to: '/admin/ops',      icon: FlaskConical,  label: 'Ops'           },
  { to: '/admin/people',   icon: UserCog,       label: 'People & Audit' },
];

function getAdminUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid ?? '' : '';
  } catch { return ''; }
}

export default function AdminLayout() {
  const navigate    = useNavigate();
  const superadmin  = isSuperAdmin();
  const [searchOpen,    setSearchOpen]    = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  const nav = superadmin ? [...BASE_NAV, ...SUPER_NAV] : BASE_NAV;

  /* ── Session guard: validate admin is still active every 5 min ── */
  const validateSession = useCallback(async () => {
    const uid = getAdminUid();
    if (!uid) return;
    const { data } = await supabase.rpc('get_admin_record', { p_uid: uid });
    const record = Array.isArray(data) ? data[0] : data;
    if (!record || record.is_active === false) {
      setSessionExpired(true);
    }
  }, []);

  useEffect(() => {
    validateSession();
    const interval = setInterval(validateSession, 5 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') validateSession(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [validateSession]);

  /* ── Global search keyboard shortcut ── */
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(s => !s);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  function handleForceLogout() {
    sessionStorage.clear();
    navigate('/admin/login', { replace: true });
  }

  return (
    <div className="portal-admin flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* Sidebar */}
      <motion.aside
        className="w-[220px] shrink-0 flex flex-col border-r border-white/5 bg-slate-900"
        initial={{ x: -20, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-white/5">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary-500 to-violet-600 flex items-center justify-center shrink-0">
            <Shield size={15} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none">Admin Portal</p>
            <p className="text-slate-500 text-[10px] mt-0.5">
              {superadmin ? '★ Superadmin' : 'EaseWithExam'}
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {/* Base nav */}
          {BASE_NAV.map((item, i) => {
            if (item.sectionLabel) {
              return (
                <div key={`sec-${i}`} className="pt-3 pb-0.5 px-3">
                  <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">{item.sectionLabel}</p>
                </div>
              );
            }
            const { to, icon: Icon, label, end } = item;
            return (
              <NavLink
                key={to} to={to} end={end}
                className={({ isActive }) => [
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  isActive ? 'bg-primary-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
                ].join(' ')}
              >
                <Icon size={16} className="shrink-0" />
                {label}
              </NavLink>
            );
          })}

          {/* Superadmin-only section */}
          {superadmin && (
            <>
              <div className="pt-3 pb-1 px-3">
                <p className="text-[9px] font-bold text-slate-600 uppercase tracking-wider">Superadmin</p>
              </div>
              {SUPER_NAV.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to} to={to}
                  className={({ isActive }) => [
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                    isActive ? 'bg-violet-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white',
                  ].join(' ')}
                >
                  <Icon size={16} className="shrink-0" />
                  {label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Back to app */}
        <div className="p-3 border-t border-white/5">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 text-sm transition-colors w-full"
          >
            <ArrowLeft size={15} />
            Back to App
          </button>
        </div>
      </motion.aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar with search trigger */}
        <div className="h-12 border-b border-white/5 bg-slate-900/50 flex items-center justify-end px-4 gap-3 shrink-0">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white text-xs transition-colors border border-white/5"
          >
            <Search size={12} />
            <span>Search…</span>
            <kbd className="text-[9px] font-mono bg-white/5 px-1.5 py-0.5 rounded text-slate-600">⌘K</kbd>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </div>
      </div>

      {/* Global search modal */}
      <AdminGlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* Session-expiry modal */}
      <AnimatePresence>
        {sessionExpired && (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
            <motion.div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            />
            <motion.div
              className="relative bg-slate-900 border border-red-500/30 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl"
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
            >
              <div className="h-14 w-14 rounded-full bg-red-900/30 border border-red-500/30 flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={24} className="text-red-400" />
              </div>
              <h3 className="text-white font-bold text-lg mb-2">Session Expired</h3>
              <p className="text-slate-400 text-sm mb-6">
                Your admin account has been deactivated or the session has expired. Please log in again.
              </p>
              <button
                onClick={handleForceLogout}
                className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                <LogOut size={16} /> Return to Login
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
