import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import EweLogo from '../ui/EweLogo';
import {
  LayoutDashboard, FlaskConical, GraduationCap,
  MessageCircleQuestion, BarChart3, Target, Bell,
  User, LogOut, ShieldCheck, Crown, Users, HelpCircle, CreditCard, Gauge,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { getQuotaSnapshot, FIELD_LABELS } from '../../lib/quota';
import { useNotificationsContext } from '../../context/NotificationsContext';

const NAV_ITEMS = [
  { to: '/dashboard', icon: LayoutDashboard,      label: 'Dashboard' },
  { to: '/study',     icon: FlaskConical,          label: 'Study'     },
  { to: '/exams',     icon: GraduationCap,         label: 'Exams'     },
  { to: '/doubt',     icon: MessageCircleQuestion, label: 'Ask EWE'   },
  { to: '/progress',  icon: BarChart3,             label: 'Progress'  },
];

function useIsAdmin(uid) {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!uid) return;
    const cached = sessionStorage.getItem(`edu_admin_rec_${uid}`);
    if (cached) { setIsAdmin(true); return; }
    supabase.rpc('get_admin_record', { p_uid: uid })
      .then(({ data }) => { if (data) setIsAdmin(true); });
  }, [uid]);
  return isAdmin;
}

function useQuotaSummary(uid, isPremium) {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    if (!uid) return;

    const fields = Object.keys(FIELD_LABELS);
    const refresh = () => {
      Promise.all(fields.map((f) => getQuotaSnapshot(uid, f, isPremium)))
        .then((results) => {
          const byField = {};
          fields.forEach((f, i) => { byField[f] = results[i]; });
          setUsage(byField);
        })
        .catch(() => {});
    };

    refresh();
    // incrementQuota() (src/lib/quota.js) fires this after every AI/mock-test/
    // paper-eval action so this panel reflects usage right away instead of
    // only on the next full page load.
    window.addEventListener('ewe:quota-updated', refresh);
    return () => window.removeEventListener('ewe:quota-updated', refresh);
  }, [uid, isPremium]);

  return usage;
}

export default function Sidebar() {
  const { currentUser, userProfile, isPremium, signOut } = useAuth();
  const navigate  = useNavigate();
  const isAdmin   = useIsAdmin(currentUser?.uid);
  const quotaUsage = useQuotaSummary(currentUser?.uid, isPremium);
  const { unreadCount } = useNotificationsContext();
  const [open, setOpen] = useState(false);
  const menuRef   = useRef(null);
  useOnClickOutside(menuRef, () => setOpen(false));

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate('/auth');
  };

  const go = (path) => { setOpen(false); navigate(path); };

  const avatar = userProfile?.photo_url || currentUser?.photoURL;
  const name   = userProfile?.display_name || currentUser?.displayName || 'Student';
  const exam   = userProfile?.target_exam;

  return (
    <motion.aside
      className="hidden lg:flex flex-col w-[220px] shrink-0 h-screen bg-slate-900
                 shadow-sidebar overflow-y-auto scrollbar-hide"
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0,   opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/10">
        <EweLogo variant="light" className="h-10 w-auto max-w-[160px]" />
      </div>

      {/* Exam badge */}
      {exam && exam !== 'NONE' && (
        <div className="mx-4 mt-4">
          <span className="badge bg-primary-900 text-primary-300 border border-primary-700 flex items-center gap-1.5">
            <Target size={11} />
            {exam === 'BOTH' ? 'NEET + JEE' : exam.replace(/_/g, ' ')}
          </span>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Icon size={18} className="shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
        <NavLink
          to="/notifications"
          className={({ isActive }) => `nav-link justify-between ${isActive ? 'active' : ''}`}
        >
          <span className="flex items-center gap-3">
            <Bell size={18} className="shrink-0" />
            <span>Notifications</span>
          </span>
          {unreadCount > 0 && (
            <span className="h-5 min-w-[20px] px-1.5 bg-primary-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </NavLink>
      </nav>

      {/* Usage & Limits — compact teaser, full breakdown lives on /profile */}
      {quotaUsage && (
        <div className="mx-3 mb-3 px-3 py-3 rounded-xl bg-white/5 border border-white/5">
          <button
            onClick={() => navigate('/profile')}
            className="w-full flex items-center justify-between mb-2 group"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider group-hover:text-slate-300">
              <Gauge size={11} /> Usage
            </span>
            {isPremium && (
              <span className="text-[9px] font-bold text-violet-400 flex items-center gap-0.5">
                <Crown size={9} /> Unlimited
              </span>
            )}
          </button>

          {isPremium ? (
            <p className="text-[10px] text-slate-500">All features unlimited today</p>
          ) : (
            <div className="space-y-1.5">
              {Object.entries(FIELD_LABELS).map(([field, label]) => {
                const q = quotaUsage[field];
                if (!q) return null;
                const pct = q.unlimited ? 0 : Math.min(100, Math.round((q.used / Math.max(q.limit, 1)) * 100));
                return (
                  <div key={field}>
                    <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                      <span className="truncate">{label}</span>
                      <span>{q.unlimited ? '∞' : `${q.used}/${q.limit}`}</span>
                    </div>
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pct >= 100 ? 'bg-red-400' : 'bg-primary-400'}`}
                        style={{ width: q.unlimited ? '100%' : `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Avatar menu */}
      <div ref={menuRef} className="p-3 border-t border-white/10">
        <button
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors group"
        >
          {avatar ? (
            <img src={avatar} alt={name} className="h-8 w-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-primary-700 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {(name[0] || 'S').toUpperCase()}
            </div>
          )}
          <div className="min-w-0 text-left flex-1">
            <p className="text-white text-xs font-semibold truncate">{name}</p>
            <p className="text-slate-500 text-xs truncate">
              {userProfile?.email || currentUser?.email}
            </p>
          </div>
        </button>

        <AnimatePresence>
          {open && (
            <motion.div
              className="absolute bottom-[68px] left-3 w-52 bg-slate-800 border border-white/10
                         rounded-2xl shadow-xl py-1.5 z-50"
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1    }}
              exit={{ opacity: 0,    y: 8, scale: 0.97 }}
              transition={{ duration: 0.15 }}
            >
              <div className="px-4 py-2 border-b border-white/10 mb-1">
                <p className="text-xs font-semibold text-white truncate">{name}</p>
                {isPremium && (
                  <p className="text-[10px] text-violet-400 font-semibold mt-0.5 flex items-center gap-1">
                    <Crown size={9} /> Premium
                  </p>
                )}
              </div>

              {[
                // "Notifications" itself (the live alert feed) now lives as its
                // own nav-bar item above, with a real unread badge — this entry
                // is specifically the preferences screen (In-App / Exam Alerts
                // toggles), a different destination from the feed.
                { icon: User,        label: 'Profile',               path: '/profile'                },
                { icon: Bell,        label: 'Notification Settings', path: '/profile#notifications'  },
                { icon: CreditCard,  label: 'Plans & Billing',       path: '/pricing'                },
                { icon: Users,       label: 'Share with Parent',     path: '/parent'                 },
                { icon: HelpCircle,  label: 'Help & Guide',          path: '/help'                   },
              ].map(({ icon: Icon, label, path }) => (
                <button
                  key={path}
                  onClick={() => go(path)}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300
                             hover:bg-white/5 hover:text-white transition-colors"
                >
                  <Icon size={14} className="shrink-0" />
                  {label}
                </button>
              ))}

              {isAdmin && (
                <button
                  onClick={() => go('/admin')}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-amber-400
                             hover:bg-amber-500/10 transition-colors"
                >
                  <ShieldCheck size={14} className="shrink-0" />
                  Admin Panel
                </button>
              )}

              <div className="border-t border-white/10 mt-1 pt-1">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400
                             hover:bg-red-500/10 transition-colors"
                >
                  <LogOut size={14} className="shrink-0" />
                  Sign out
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
