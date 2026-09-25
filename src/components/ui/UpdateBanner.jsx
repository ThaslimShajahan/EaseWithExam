import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { startVersionChecks, isUpdateAvailable, reloadToLatest, UPDATE_EVENT } from '../../lib/versionCheck';

/** Top banner shown when a newer version of the site has been deployed. */
export default function UpdateBanner() {
  const [show, setShow] = useState(isUpdateAvailable);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    const stop = startVersionChecks();
    const onUpdate = () => setShow(true);
    window.addEventListener(UPDATE_EVENT, onUpdate);
    return () => { stop(); window.removeEventListener(UPDATE_EVENT, onUpdate); };
  }, []);

  if (!show) return null;
  return (
    <div role="status" className="fixed top-0 inset-x-0 z-[1100] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pointer-events-none">
      <button
        onClick={() => { setReloading(true); reloadToLatest(); }}
        disabled={reloading}
        className="pointer-events-auto flex items-center gap-2 min-h-[44px] max-w-md w-full sm:w-auto px-4 py-2.5 rounded-2xl bg-slate-900 text-white text-sm font-semibold shadow-2xl"
      >
        <RefreshCw size={15} className={reloading ? 'animate-spin shrink-0' : 'shrink-0'} />
        <span className="flex-1 text-left">A new version of EaseWithExam is available.</span>
        <span className="text-primary-300 shrink-0">{reloading ? 'Updating…' : 'Tap to reload'}</span>
      </button>
    </div>
  );
}
