import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { boardLabel, studentDisplayName } from '../../lib/displayLabels';

export const ADMIN_POLL_MS = 30_000;

export function getAdminCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid ?? '' : '';
  } catch { return ''; }
}

/**
 * Calls `fn` now and every `ms` while the tab is visible (polling, not
 * Realtime: the admin RPCs check the caller in their body, which a Realtime
 * channel can't do). Returns nothing; `fn` owns its state.
 */
export function usePolling(fn, ms = ADMIN_POLL_MS) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let timer = null;
    const tick = () => { if (document.visibilityState === 'visible') fnRef.current(); };
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    tick();
    timer = setInterval(tick, ms);
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVis); };
  }, [ms]);
}

/** "Asha, Class 9 Kerala State" — name falls back to mobile, then email (admin-only data). */
export const registrationLabel = (r) => {
  const name = studentDisplayName(r);
  const cls = r?.class_level ? `Class ${r.class_level}` : '';
  return [name, [cls, boardLabel(r?.board)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
};

/**
 * Pure: which registrations are NEW since the previous poll (for toasts).
 * `known` is the Set of uids already onboarded at the previous poll, or null
 * on the very first poll (nothing toasts on page load — the bell covers what
 * happened while the admin was away).
 */
export function newlyOnboarded(items, known) {
  if (!known) return [];
  return (items ?? []).filter((r) => r.status === 'onboarded' && !r.backfilled && !known.has(r.uid));
}

/** Registration feed for the whole admin portal: bell count, list and toasts. */
export function useRegistrationFeed() {
  const [feed, setFeed] = useState({ items: [], unseen: 0, loaded: false, error: '' });
  const [toasts, setToasts] = useState([]);
  const known = useRef(null);

  const load = useCallback(async () => {
    const caller = getAdminCallerUid();
    if (!caller) return;
    const { data, error } = await supabase.rpc('admin_get_recent_registrations', { p_caller: caller, p_limit: 20 });
    if (error) { setFeed((f) => ({ ...f, loaded: true, error: error.message })); return; }
    const items = data?.items ?? [];
    const fresh = newlyOnboarded(items, known.current);
    known.current = new Set(items.filter((r) => r.status === 'onboarded').map((r) => r.uid));
    if (fresh.length) {
      setToasts((t) => [...t, ...fresh.map((r) => ({ id: `${r.uid}-${r.onboarded_at}`, text: `New student: ${registrationLabel(r)}` }))]);
    }
    setFeed({ items, unseen: data?.unseen_count ?? 0, loaded: true, error: '' });
  }, []);

  usePolling(load);

  const markSeen = useCallback(async () => {
    const caller = getAdminCallerUid();
    if (!caller) return;
    setFeed((f) => ({ ...f, unseen: 0 }));
    await supabase.rpc('admin_mark_registrations_seen', { p_caller: caller });
  }, []);

  const dismissToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return { ...feed, toasts, dismissToast, markSeen, reload: load };
}

export const AdminLiveFeedContext = createContext(null);
export const useAdminLiveFeed = () => useContext(AdminLiveFeedContext);

/** "just now" / "3 min ago" / "2 h ago" relative to the server clock. */
export function agoLabel(iso, serverNowMs) {
  if (!iso) return '';
  const diff = Math.max(0, (serverNowMs ?? Date.now()) - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
