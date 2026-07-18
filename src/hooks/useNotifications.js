import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from '../lib/notifications';

export function useNotifications(firebaseUid) {
  const [notifications, setNotifications] = useState([]);
  const [loading,       setLoading]       = useState(true);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const refresh = useCallback(async () => {
    if (!firebaseUid) return;
    const data = await getNotifications(firebaseUid, 30);
    setNotifications(data);
  }, [firebaseUid]);

  // Initial load
  useEffect(() => {
    if (!firebaseUid) { setLoading(false); return; }
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [firebaseUid, refresh]);

  // Realtime: prepend new notifications instantly when they arrive
  useEffect(() => {
    if (!firebaseUid) return;
    const channel = supabase
      .channel(`notifs:${firebaseUid}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'user_notifications',
          filter: `user_id=eq.${firebaseUid}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new, ...prev].slice(0, 30));
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [firebaseUid]);

  const markRead = useCallback(async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    await markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    await markAllNotificationsRead(firebaseUid);
  }, [firebaseUid]);

  const remove = useCallback(async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await deleteNotification(id);
  }, []);

  return { notifications, unreadCount, loading, markRead, markAllRead, remove, refresh };
}
