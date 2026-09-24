import { useEffect, useState, useCallback } from 'react';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteAllNotifications,
  NOTIF_CREATED_EVENT,
} from '../lib/notifications';

// user_notifications left the Realtime publication in 20260924000000 (a
// postgres_changes feed can't be proven to respect verified_uid() for a
// Firebase token), so the feed polls its own-rows RPC instead. Almost every
// notification is created by the student's own action, and those refresh
// instantly via NOTIF_CREATED_EVENT; only admin sends and server-side
// reminders wait for the next poll.
const POLL_MS = 30000;

export function useNotifications(firebaseUid) {
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(true);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const refresh = useCallback(async () => {
    if (!firebaseUid) return;
    const data = await getNotifications(firebaseUid, 30);
    if (data) setNotifications(data);  // null = fetch failed; keep what's shown
  }, [firebaseUid]);

  // Initial load
  useEffect(() => {
    if (!firebaseUid) { setNotifications([]); setLoading(false); return; }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [firebaseUid, refresh]);

  // Poll while the tab is visible; refresh on return and after local creates.
  useEffect(() => {
    if (!firebaseUid) return;
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(NOTIF_CREATED_EVENT, refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(NOTIF_CREATED_EVENT, refresh);
    };
  }, [firebaseUid, refresh]);

  const markRead = useCallback(async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    await markNotificationRead(firebaseUid, id);
  }, [firebaseUid]);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllNotificationsRead(firebaseUid);
  }, [firebaseUid]);

  const remove = useCallback(async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await deleteNotification(firebaseUid, id);
  }, [firebaseUid]);

  const clearAll = useCallback(async () => {
    setNotifications([]);
    await deleteAllNotifications(firebaseUid);
  }, [firebaseUid]);

  return { notifications, unreadCount, loading, markRead, markAllRead, remove, clearAll, refresh };
}
