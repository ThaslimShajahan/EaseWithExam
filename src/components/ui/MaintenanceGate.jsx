import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Wrench } from 'lucide-react';
import { getFeatureFlag, invalidateFlagCache, FLAGS } from '../../lib/featureFlags';

const POLL_MS = 20000;

/**
 * Full-screen gate shown to students while maintenance_mode_enabled is on
 * (toggle it in Admin > Platform > Feature Flags right before/after a
 * deploy). Admin routes are never gated — otherwise turning this on would
 * lock the admin out of the only place that can turn it back off.
 *
 * Polls every 20s (invalidating the shared flag cache first) so a tab left
 * open during a deploy picks up the change without needing a manual reload,
 * rather than only checking once at mount. Uses useLocation (not raw
 * window.location) so navigating client-side into/out of /admin is
 * reflected immediately rather than needing a full page reload.
 */
export default function MaintenanceGate({ children }) {
  const [maintenance, setMaintenance] = useState(false);
  const location = useLocation();
  const isAdminRoute = location.pathname.startsWith('/admin');

  useEffect(() => {
    if (isAdminRoute) return;
    let cancelled = false;

    const check = async () => {
      const on = await getFeatureFlag(FLAGS.MAINTENANCE_MODE);
      if (!cancelled) setMaintenance(on);
    };
    check();

    const interval = setInterval(() => {
      invalidateFlagCache();
      check();
    }, POLL_MS);

    return () => { cancelled = true; clearInterval(interval); };
  }, [isAdminRoute]);

  if (!isAdminRoute && maintenance) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-5 p-6 text-center">
        <div className="h-16 w-16 rounded-3xl bg-primary-600/20 border border-primary-500/30 flex items-center justify-center">
          <Wrench size={28} className="text-primary-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">We'll be right back</h1>
          <p className="text-slate-400 text-sm mt-2 max-w-sm">
            EaseWithExam is getting a quick update. This usually takes just a few minutes —
            please check back shortly.
          </p>
        </div>
      </div>
    );
  }

  return children;
}
