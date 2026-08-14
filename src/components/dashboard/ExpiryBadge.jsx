import { useEffect, useState } from 'react';
import { Sparkles, Crown, Clock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getExpiryInfo } from '../../lib/quota';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';

/**
 * Every student sees SOME statement about when their current standing ends —
 * a temporary grant, a paid subscription, or "free, nothing to expire" — not
 * just students who happen to have a special override. Owner requirement:
 * this must not be a special-case UI that only appears for the students an
 * admin has manually touched.
 */

/**
 * "3 days left" / "1 day left" / "4 hours left" — never rounds UP into the
 * wrong bucket.
 *
 * Found live (2026-08-14): the previous version used Math.ceil() on the raw
 * days figure, so a grant expiring in 13 MINUTES displayed "1 day left" —
 * any remainder above 0 got rounded up to a full day. Switched to floor()
 * days for >=1 day remaining (matching the cron job's own bucketing in
 * send_expiry_reminders(), so the badge and the reminder schedule agree on
 * what "1 day left" means), and drops to whole hours once under a day so an
 * imminent expiry reads as imminent instead of as "1 day" for anywhere from
 * 1 second to 23h59m remaining.
 */
export function formatCountdown(expiresAt) {
  const ms = new Date(expiresAt) - new Date();
  if (ms <= 0) return 'ending now';

  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} left`;

  const hours = Math.max(1, Math.floor(ms / 3_600_000));
  return `${hours} hour${hours === 1 ? '' : 's'} left`;
}

export default function ExpiryBadge({ className = '' }) {
  const { currentUser, subscription } = useAuth();
  const [info, setInfo] = useState(null);
  const { quota_grant_badge_label: grantLabel } = usePlatformSettings();

  useEffect(() => {
    let cancelled = false;
    if (!currentUser?.uid) { setInfo(null); return; }
    getExpiryInfo(currentUser.uid, subscription).then((r) => { if (!cancelled) setInfo(r); });
    return () => { cancelled = true; };
  }, [currentUser?.uid, subscription]);

  if (!info) return null;

  if (info.kind === 'grant') {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 ${className}`}>
        <Sparkles size={10} /> {grantLabel} — {formatCountdown(info.expiresAt)}
      </span>
    );
  }
  if (info.kind === 'subscription') {
    return (
      <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 ${className}`}>
        <Crown size={10} /> {formatCountdown(info.expiresAt)} on plan
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 ${className}`}>
      <Clock size={10} /> Free plan — no expiry
    </span>
  );
}
