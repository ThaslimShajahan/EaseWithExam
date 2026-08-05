import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, X, CheckCheck, Trash2, Calendar,
  Trophy, Zap, Flame, Star, BookOpen, Crown,
  CheckCircle2, Sparkles, Info, AlertTriangle, ClipboardList,
} from 'lucide-react';
import { useNotificationsContext } from '../../context/NotificationsContext';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { NOTIF_TYPES } from '../../lib/notifications';

const TYPE_ICONS = {
  test_complete:       Trophy,
  practice_complete:   CheckCircle2,
  daily_challenge:     Zap,
  streak_milestone:    Flame,
  level_up:            Star,
  subscription_active: Crown,
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

/* ── Quick-glance dropdown — portaled to <body> so it's never clipped by a
 * scrollable/transformed ancestor. This is a preview of recent items only;
 * the real, full notifications experience (with an Exam Alerts tab too) is
 * the standalone /notifications page (src/pages/NotificationsPage.jsx) — the
 * footer link below jumps there. ── */
function NotificationPanel({ anchorRect, notifications, unreadCount, onClose, markRead, markAllRead, remove, loading }) {
  const navigate = useNavigate();
  if (!anchorRect) return null;

  const width = 320;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  let left = anchorRect.left;
  if (left + width > viewportW - 8) left = viewportW - width - 8;
  if (left < 8) left = 8;

  // Prefer opening below the trigger; flip above if there isn't room.
  const openBelow = anchorRect.bottom + 400 <= viewportH;
  const style = openBelow
    ? { left, top: anchorRect.bottom + 8, maxHeight: viewportH - anchorRect.bottom - 16 }
    : { left, bottom: viewportH - anchorRect.top + 8, maxHeight: anchorRect.top - 16 };

  return createPortal(
    <motion.div
      className="fixed w-80 bg-white rounded-2xl shadow-xl border border-slate-100 z-[100] overflow-hidden flex flex-col"
      style={style}
      initial={{ opacity: 0, y: openBelow ? -8 : 8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: openBelow ? -8 : 8, scale: 0.97 }}
      transition={{ duration: 0.15 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
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
      <div className="overflow-y-auto divide-y divide-slate-50">
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
      <div className="px-4 py-2.5 border-t border-slate-100 shrink-0">
        <button
          onClick={() => { onClose(); navigate('/notifications'); }}
          className="w-full text-xs text-primary-600 font-semibold hover:text-primary-700 flex items-center justify-center gap-1.5 py-1 transition-colors"
        >
          <Calendar size={11} /> View all notifications & exam alerts
        </button>
      </div>
    </motion.div>,
    document.body,
  );
}

/**
 * Top-header notification bell — trigger button + live unread badge +
 * quick-glance dropdown preview. Reads from the single shared
 * NotificationsProvider (see AppShell.jsx) so the Sidebar's own unread badge
 * (a plain NavLink to /notifications, not this component) stays in sync
 * without opening a second Supabase realtime channel of the same name.
 */
export default function NotificationBell() {
  const { notifications, unreadCount, loading, markRead, markAllRead, remove } =
    useNotificationsContext();

  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState(null);
  const triggerRef = useRef(null);
  useOnClickOutside(triggerRef, () => setOpen(false));

  // Recompute anchor position whenever opened (covers scroll/resize between opens).
  useEffect(() => {
    if (open && triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect());
    }
  }, [open]);

  return (
    <div ref={triggerRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
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
        {open && (
          <NotificationPanel
            anchorRect={anchorRect}
            notifications={notifications}
            unreadCount={unreadCount}
            loading={loading}
            markRead={markRead}
            markAllRead={markAllRead}
            remove={remove}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
