import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EweLogo from '../ui/EweLogo';
import {
  Bell, LogOut, User, ChevronDown, X, Crown,
  Trophy, Zap, Flame, Star, BookOpen, Crown as CrownIcon,
  CheckCircle2, Calendar, Sparkles, Trash2, CheckCheck,
  Info, AlertTriangle, ClipboardList,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { useNotifications } from '../../hooks/useNotifications';
import { StreakPill } from '../ui/StreakWidget';
import { NOTIF_TYPES } from '../../lib/notifications';

/* ── Icon map by notification type ────────────────────────── */
const TYPE_ICONS = {
  test_complete:       Trophy,
  practice_complete:   CheckCircle2,
  daily_challenge:     Zap,
  streak_milestone:    Flame,
  level_up:            Star,
  subscription_active: CrownIcon,
  errors_logged:       BookOpen,
  exam_reminder:       Calendar,
  welcome:             Sparkles,
  // Admin-composed broadcast types (AdminPushNotifications.jsx)
  info:                Info,
  success:             CheckCircle2,
  warning:             AlertTriangle,
  achievement:         Trophy,
  assignment:          ClipboardList,
};

/* ── Relative time ─────────────────────────────────────────── */
function relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* ── Notification panel ────────────────────────────────────── */
function NotificationPanel({ notifications, unreadCount, onClose, markRead, markAllRead, remove, loading }) {
  const navigate = useNavigate();

  return (
    <motion.div
      className="absolute right-0 top-12 w-80 bg-white rounded-2xl shadow-xl border border-slate-100 z-50 overflow-hidden"
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1,  y: 0,  scale: 1    }}
      exit={{ opacity: 0,  y: -8,  scale: 0.97 }}
      transition={{ duration: 0.15 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-slate-900 text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <span className="h-5 min-w-[20px] px-1.5 bg-primary-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              title="Mark all as read"
              className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-primary-600 transition-colors"
            >
              <CheckCheck size={13} />
            </button>
          )}
          <button onClick={onClose} className="h-6 w-6 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 transition-colors">
            <X size={13} />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="max-h-96 overflow-y-auto divide-y divide-slate-50">
        {loading && (
          <div className="px-4 py-8 text-center">
            <div className="h-5 w-5 rounded-full border-2 border-primary-600 border-t-transparent animate-spin mx-auto" />
          </div>
        )}

        {!loading && notifications.length === 0 && (
          <div className="px-4 py-10 text-center">
            <Bell size={28} className="text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400">No notifications yet</p>
            <p className="text-xs text-slate-300 mt-1">Events like test results and streaks will appear here.</p>
          </div>
        )}

        {notifications.map((n) => {
          const Icon  = TYPE_ICONS[n.type] ?? Bell;
          const meta  = NOTIF_TYPES[n.type] ?? { color: 'bg-slate-100 text-slate-600' };
          const isNew = !n.read;
          return (
            <div
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3 transition-colors cursor-default group ${isNew ? 'bg-primary-50/40' : 'hover:bg-slate-50'}`}
              onClick={() => { if (!n.read) markRead(n.id); if (n.link) { navigate(n.link); onClose(); } }}
            >
              <div className={`h-8 w-8 rounded-xl ${meta.color} flex items-center justify-center shrink-0 mt-0.5`}>
                <Icon size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-1">
                  <p className={`text-sm leading-snug ${isNew ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                    {n.title}
                  </p>
                  {isNew && <span className="h-1.5 w-1.5 rounded-full bg-primary-500 shrink-0 mt-1.5" />}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.body}</p>
                <p className="text-[10px] text-slate-400 mt-1">{relTime(n.created_at)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); remove(n.id); }}
                className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center text-slate-300 hover:text-red-400 transition-all shrink-0 mt-0.5"
              >
                <Trash2 size={11} />
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 border-t border-slate-100">
        <button
          onClick={() => { onClose(); navigate('/exams?tab=alerts'); }}
          className="w-full text-xs text-primary-600 font-semibold hover:text-primary-700 flex items-center justify-center gap-1.5 py-1 transition-colors"
        >
          <Calendar size={11} /> View Exam Alerts (NTA, CBSE, etc.)
        </button>
      </div>
    </motion.div>
  );
}

/* ── Main header ───────────────────────────────────────── */

export default function TopHeader({ mobile = false }) {
  const { currentUser, userProfile, isPremium, signOut } = useAuth();
  const navigate = useNavigate();
  const { notifications, unreadCount, loading, markRead, markAllRead, remove } =
    useNotifications(currentUser?.uid);

  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen,  setMenuOpen]  = useState(false);

  const notifRef = useRef(null);
  const menuRef  = useRef(null);
  useOnClickOutside(notifRef, () => setNotifOpen(false));
  useOnClickOutside(menuRef,  () => setMenuOpen(false));

  const name   = userProfile?.display_name || currentUser?.displayName || 'Student';
  const avatar = userProfile?.photo_url    || currentUser?.photoURL;

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  return (
    <header className={`sticky top-0 z-40 bg-white/85 backdrop-blur-xl border-b border-slate-100 shadow-header ${mobile ? 'h-14' : 'h-16'}`}>
      <div className="h-full flex items-center gap-3 px-4 lg:px-6">

        {/* Mobile logo */}
        {mobile && (
          <div className="flex items-center mr-auto">
            <EweLogo variant="color" className="h-7 w-auto max-w-[130px]" />
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

          {/* Notification bell */}
          <div ref={notifRef} className="relative">
            <button
              onClick={() => { setNotifOpen((v) => !v); setMenuOpen(false); }}
              className="relative h-9 w-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors"
            >
              <Bell size={18} className="text-slate-600" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 bg-primary-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {notifOpen && (
                <NotificationPanel
                  notifications={notifications}
                  unreadCount={unreadCount}
                  loading={loading}
                  markRead={markRead}
                  markAllRead={markAllRead}
                  remove={remove}
                  onClose={() => setNotifOpen(false)}
                />
              )}
            </AnimatePresence>
          </div>

          {/* Profile dropdown */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => { setMenuOpen((v) => !v); setNotifOpen(false); }}
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
