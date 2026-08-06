import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

export default function NotificationToast() {
  const { currentUser } = useAuth();
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((t) => t.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) return;

    const channel = supabase
      .channel(`notif_toast_${currentUser.uid}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          // createNotification() (lib/notifications.js) inserts into
          // user_notifications keyed by user_id — this was previously
          // subscribed to a different table/column ('notifications' /
          // firebase_uid) that nothing in the app ever writes to, so this
          // toast has never actually fired for any real notification.
          table:  'user_notifications',
          filter: `user_id=eq.${currentUser.uid}`,
        },
        (payload) => {
          const n = payload.new;
          const toast = { id: n.id, title: n.title, body: n.body };
          setToasts((prev) => [...prev.slice(-2), toast]); // max 3 toasts
          setTimeout(() => dismiss(n.id), 5000);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [currentUser?.uid, dismiss]);

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
