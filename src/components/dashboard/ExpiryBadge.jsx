import { useEffect, useState } from 'react';
import { Sparkles, Crown, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getExpiryInfo } from '../../lib/quota';

/**
 * Every student sees SOME statement about when their current standing ends —
 * a temporary grant, a paid subscription, or "free, nothing to expire" — not
 * just students who happen to have a special override. Owner requirement:
 * this must not be a special-case UI that only appears for the students an
 * admin has manually touched.
 */
export default function ExpiryBadge({ className = '' }) {
  const { currentUser, subscription } = useAuth();
  const [info, setInfo] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentUser?.uid) { setInfo(null); return; }
    getExpiryInfo(currentUser.uid, subscription).then((r) => { if (!cancelled) setInfo(r); });
    return () => { cancelled = true; };
  }, [currentUser?.uid, subscription]);

  if (!info) return null;

  const daysLeft = info.expiresAt
    ? Math.max(0, Math.ceil((new Date(info.expiresAt) - new Date()) / 86_400_000))
    : null;

  if (info.kind === 'grant') {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ${className}`}>
        <Sparkles size={10} /> Bonus access — {daysLeft} day{daysLeft === 1 ? '' : 's'} left
      </span>
    );
  }
  if (info.kind === 'subscription') {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 ${className}`}>
        <Crown size={10} /> {daysLeft} day{daysLeft === 1 ? '' : 's'} left on plan
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 ${className}`}>
      <Clock size={10} /> Free plan — no expiry
    </span>
  );
}
