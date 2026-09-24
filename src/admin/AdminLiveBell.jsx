import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bell, UserPlus, X } from 'lucide-react';
import { useAdminLiveFeed, registrationLabel, agoLabel } from './hooks/useAdminLiveFeed';

/** Top-bar bell: count of students who finished onboarding since this admin last looked. */
export function AdminLiveBell() {
  const feed = useAdminLiveFeed();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  if (!feed) return null;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && feed.unseen > 0) feed.markSeen();
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label={feed.unseen ? `${feed.unseen} new student registrations` : 'Student registrations'}
        className="relative h-11 w-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
      >
        <Bell size={17} />
        {feed.unseen > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            {feed.unseen > 99 ? '99+' : feed.unseen}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] bg-slate-900 border border-white/10 rounded-2xl shadow-2xl z-50 overflow-hidden">
          <p className="px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5">Recent registrations</p>
          <RegistrationList items={feed.items.slice(0, 10)} error={feed.error} />
        </div>
      )}
    </div>
  );
}

export function RegistrationList({ items, error, serverNowMs }) {
  if (error) return <p className="px-4 py-3 text-xs text-red-400">Couldn't load registrations: {error}</p>;
  if (!items?.length) return <p className="px-4 py-3 text-xs text-slate-500">No registrations yet.</p>;
  return (
    <ul className="divide-y divide-white/5 max-h-80 overflow-y-auto">
      {items.map((r) => (
        <li key={r.uid} className="px-4 py-2.5 min-h-[44px] flex items-center gap-3">
          <UserPlus size={14} className={r.status === 'onboarded' ? 'text-emerald-400 shrink-0' : 'text-amber-400 shrink-0'} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">{registrationLabel(r)}</p>
            <p className="text-[11px] text-slate-500">
              {r.status === 'onboarded' ? 'Onboarded' : 'Onboarding pending'} · signed up {agoLabel(r.registered_at, serverNowMs)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Bottom-right toasts for students who finish onboarding while an admin is looking. */
export function AdminLiveToasts() {
  const feed = useAdminLiveFeed();
  const toasts = feed?.toasts ?? [];
  useEffect(() => {
    if (!toasts.length) return undefined;
    const t = setTimeout(() => feed.dismissToast(toasts[0].id), 8000);
    return () => clearTimeout(t);
  }, [toasts, feed]);

  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[9000] flex flex-col gap-2 items-end pointer-events-none">
      <AnimatePresence>
        {toasts.slice(0, 3).map((t) => (
          <motion.div
            key={t.id} role="status"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
            className="pointer-events-auto w-full sm:w-80 flex items-center gap-3 bg-emerald-900/90 border border-emerald-500/30 text-emerald-50 rounded-2xl pl-4 pr-1 py-1 shadow-2xl"
          >
            <UserPlus size={16} className="shrink-0 text-emerald-300" />
            <p className="flex-1 text-sm py-2">{t.text}</p>
            <button onClick={() => feed.dismissToast(t.id)} aria-label="Dismiss" className="h-11 w-11 flex items-center justify-center rounded-xl hover:bg-white/10">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
