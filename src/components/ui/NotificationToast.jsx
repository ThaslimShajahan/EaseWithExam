import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import { useNotificationsContext } from '../../context/NotificationsContext';

export default function NotificationToast() {
  // Reads the shared, polled feed (NotificationsProvider) instead of its own
  // Realtime channel — user_notifications left the publication in
  // 20260924000000. A toast fires for any id that appears after the first
  // load; the first load itself is history, not news.
  const { notifications, loading } = useNotificationsContext();
  const [toasts, setToasts] = useState([]);
  const seenIds = useRef(null);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (seenIds.current === null) {
      seenIds.current = new Set(notifications.map((n) => n.id));
      return;
    }
    const fresh = notifications.filter((n) => !seenIds.current.has(n.id) && !n.read);
    notifications.forEach((n) => seenIds.current.add(n.id));
    if (!fresh.length) return;
    // Newest-first feed; show oldest of the new batch first, max 3 on screen.
    fresh.slice(0, 3).reverse().forEach((n) => {
      setToasts((prev) => [...prev.slice(-2), { id: n.id, title: n.title, body: n.body }]);
      setTimeout(() => dismiss(n.id), 5000);
    });
  }, [notifications, loading, dismiss]);

  return (
    <div className="fixed bottom-20 lg:bottom-6 right-4 z-50 space-y-2 pointer-events-none">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            className="pointer-events-auto flex items-start gap-3 bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-xl max-w-xs"
          >
            <div className="h-7 w-7 rounded-xl bg-primary-700 flex items-center justify-center shrink-0 mt-0.5">
              <Bell size={13} className="text-primary-200" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold leading-snug">{toast.title}</p>
              {toast.body && (
                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{toast.body}</p>
              )}
            </div>
            <button
              onClick={() => dismiss(toast.id)}
              className="text-slate-500 hover:text-white transition-colors shrink-0 mt-0.5"
            >
              <X size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
