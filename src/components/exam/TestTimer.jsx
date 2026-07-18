import { useEffect, useRef } from 'react';
import { Clock } from 'lucide-react';

export default function TestTimer({ secondsLeft, onExpire }) {
  const prevRef = useRef(secondsLeft);

  useEffect(() => {
    if (secondsLeft <= 0 && prevRef.current > 0) onExpire?.();
    prevRef.current = secondsLeft;
  }, [secondsLeft, onExpire]);

  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  const fmt = (n) => String(n).padStart(2, '0');

  const critical = secondsLeft <= 300;  // last 5 min
  const warning  = secondsLeft <= 900;  // last 15 min

  return (
    <div className={[
      'flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-semibold text-sm tabular-nums',
      critical ? 'bg-red-100 text-red-700 animate-pulse' :
      warning  ? 'bg-amber-100 text-amber-700' :
                 'bg-slate-100 text-slate-700',
    ].join(' ')}>
      <Clock size={14} />
      <span>{h > 0 ? `${fmt(h)}:` : ''}{fmt(m)}:{fmt(s)}</span>
    </div>
  );
}
