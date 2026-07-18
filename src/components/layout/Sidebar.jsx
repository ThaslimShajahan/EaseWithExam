import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import EweLogo from '../ui/EweLogo';
import {
  LayoutDashboard, FlaskConical, GraduationCap,
  MessageCircleQuestion, BarChart3, Target,
  User, LogOut, ShieldCheck, Crown, Users, HelpCircle, CreditCard,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';

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

export default function Sidebar() {
  const { currentUser, userProfile, isPremium, signOut } = useAuth();
  const navigate  = useNavigate();
  const isAdmin   = useIsAdmin(currentUser?.uid);
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
      </nav>

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
                { icon: User,        label: 'Profile',             path: '/profile'  },
                { icon: CreditCard,  label: 'Plans & Billing',     path: '/pricing'  },
                { icon: Users,       label: 'Share with Parent',   path: '/parent'   },
                { icon: HelpCircle,  label: 'Help & Guide',        path: '/help'     },
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
