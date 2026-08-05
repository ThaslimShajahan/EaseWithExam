import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LogOut, User, ChevronDown, Crown, Users, HelpCircle, Bell,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { StreakPill } from '../ui/StreakWidget';
import NotificationBell from '../ui/NotificationBell';

/* ── Main header ───────────────────────────────────────── */

export default function TopHeader({ mobile = false }) {
  const { currentUser, userProfile, isPremium, signOut } = useAuth();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useOnClickOutside(menuRef, () => setMenuOpen(false));

  const name   = userProfile?.display_name || currentUser?.displayName || 'Student';
  const avatar = userProfile?.photo_url    || currentUser?.photoURL;

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <header className="sticky top-0 z-40">
      <div className="h-[3px] bg-gradient-to-r from-primary-500 via-violet-500 to-primary-500" />
      <div className={`bg-gradient-to-r from-primary-50/50 via-white/90 to-violet-50/50 backdrop-blur-xl border-b border-primary-100/50 shadow-header flex items-center gap-3 px-4 lg:px-6 ${mobile ? 'h-14' : 'h-16'}`}>

        {/* Mobile logo */}
        {mobile && (
          <div className="flex items-center mr-auto">
            <img src="/ewe_nav_icon.svg" alt="EaseWithExam" className="h-8 w-auto" />
          </div>
        )}

        {/* Desktop: spacer */}
        {!mobile && <div className="flex-1" />}

        <div className="flex items-center gap-1">

          {/* Streak pill */}
          <StreakPill />

          {/* Upgrade / Premium badge (desktop) */}
          {!mobile && (
            isPremium ? (
              <span className="hidden lg:flex items-center gap-1.5 text-xs font-semibold bg-violet-50 border border-violet-200 text-violet-700 px-3 py-1.5 rounded-full">
                <Crown size={11} /> Premium
              </span>
            ) : (
              <button
                onClick={() => navigate('/pricing')}
                className="hidden lg:flex items-center gap-1.5 text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 px-3 py-1.5 rounded-full transition-colors"
              >
                <Crown size={11} /> Upgrade
              </button>
            )
          )}

          {/* Notification bell — shared with Sidebar's nav-row variant */}
          <NotificationBell />

          {/* Profile dropdown */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-2 h-9 px-2 rounded-xl hover:bg-slate-100 transition-colors"
            >
              {avatar ? (
                <img src={avatar} alt={name} className="h-7 w-7 rounded-full object-cover" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-primary-600 flex items-center justify-center text-white text-xs font-bold">
                  {(name[0] || 'S').toUpperCase()}
                </div>
              )}
              {!mobile && (
                <>
                  <span className="text-sm font-medium text-slate-700 max-w-[100px] truncate">{name}</span>
                  <ChevronDown size={14} className="text-slate-400" />
                </>
              )}
            </button>

            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  className="absolute right-0 top-12 w-48 bg-white rounded-2xl shadow-lg border border-slate-100 py-2 z-50"
                  initial={{ opacity: 0, y: -8, scale: 0.96 }}
                  animate={{ opacity: 1,  y: 0,  scale: 1    }}
                  exit={{ opacity: 0,  y: -8,  scale: 0.96 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="px-4 py-2 border-b border-slate-100">
                    <p className="text-xs font-semibold text-slate-900 truncate">{name}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {userProfile?.email || currentUser?.email}
                    </p>
                  </div>
                  <button
                    onClick={() => { navigate('/profile'); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <User size={14} /> My Profile
                  </button>
                  <button
                    onClick={() => { navigate('/profile#notifications'); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Bell size={14} /> Notification Settings
                  </button>
                  {isPremium ? (
                    <div className="flex items-center gap-2 px-4 py-2.5 text-sm text-violet-600">
                      <Crown size={14} /> Premium Active
                    </div>
                  ) : (
                    <button
                      onClick={() => { navigate('/pricing'); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-amber-600 hover:bg-amber-50 transition-colors"
                    >
                      <Crown size={14} /> Upgrade Plan
                    </button>
                  )}
                  <button
                    onClick={() => { navigate('/parent'); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <Users size={14} /> Share with Parent
                  </button>
                  <button
                    onClick={() => { navigate('/help'); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <HelpCircle size={14} /> Help & Guide
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
