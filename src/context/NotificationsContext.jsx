import { createContext, useContext } from 'react';
import { useAuth } from './AuthContext';
import { useNotifications } from '../hooks/useNotifications';

const NotificationsContext = createContext(null);

/**
 * Single shared notification feed for the whole authenticated app shell.
 *
 * NotificationBell now renders in two places at once on desktop (Sidebar's
 * nav row AND TopHeader) — each mounting its own useNotifications(uid) opened
 * a second Supabase realtime channel under the SAME hardcoded name
 * (`notifs:${uid}`). Supabase's client caches/returns the existing channel for
 * a repeated name, and that channel is already subscribed by the first mount,
 * so the second instance's `.on('postgres_changes', ...)` throws — you can't
 * add listeners to a channel after subscribe(). Fetching/subscribing once
 * here and sharing the result via context is the actual fix, not a workaround:
 * it also means both bells show identical, always-in-sync state instead of
 * two independent copies.
 */
export function NotificationsProvider({ children }) {
  const { currentUser } = useAuth();
  const value = useNotifications(currentUser?.uid);
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotificationsContext must be used within <NotificationsProvider>');
  return ctx;
}
