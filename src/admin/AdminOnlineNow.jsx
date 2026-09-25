import { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Radio, Smartphone, Monitor, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { usePolling, getAdminCallerUid, agoLabel, useAdminLiveFeed } from './hooks/useAdminLiveFeed';
import { RegistrationList } from './AdminLiveBell';
import { boardLabel, examLabel, studentDisplayName } from '../lib/displayLabels';

/** Overview panel: students online now (last 2 min), active today / this week (IST), recent registrations. */
export default function AdminOnlineNow() {
  const [state, setState] = useState({ data: null, error: '', fetchedAt: 0, serverOffset: 0 });
  const feed = useAdminLiveFeed();

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_get_online_students', { p_caller: getAdminCallerUid(), p_window_minutes: 2 });
    if (error) { setState((s) => ({ ...s, error: error.message })); return; }
    const serverOffset = data?.server_now ? new Date(data.server_now).getTime() - Date.now() : 0;
    setState({ data, error: '', fetchedAt: Date.now(), serverOffset });
  }, []);
  usePolling(load);

  const d = state.data;
  const serverNowMs = Date.now() + state.serverOffset;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="bg-slate-800 rounded-2xl border border-white/5 overflow-hidden"
      >
        <div className="flex items-center gap-2 px-5 pt-4 pb-3">
          <span className="relative flex h-2.5 w-2.5">
            {d?.online_count > 0 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />}
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${d?.online_count > 0 ? 'bg-emerald-400' : 'bg-slate-600'}`} />
          </span>
          <p className="text-white font-semibold flex-1">Students Online Now</p>
          <button onClick={load} aria-label="Refresh" className="h-11 w-11 -mr-3 flex items-center justify-center rounded-xl text-slate-500 hover:text-white hover:bg-white/5">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 px-5 pb-4">
          {[
            ['Online now', d?.online_count],
            ['Active today', d?.active_today],
            ['This week', d?.active_week],
          ].map(([label, v]) => (
            <div key={label} className="bg-slate-900/60 rounded-xl px-3 py-2.5">
              <p className="text-xl font-bold text-white leading-none">{v ?? '—'}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 mt-1.5">{label}</p>
            </div>
          ))}
        </div>

        {state.error ? (
          <p className="px-5 pb-4 text-xs text-red-400">Couldn't load: {state.error}</p>
        ) : !d ? (
          <p className="px-5 pb-4 text-xs text-slate-500">Loading…</p>
        ) : d.online.length === 0 ? (
          <p className="px-5 pb-4 text-xs text-slate-500 flex items-center gap-2"><Radio size={12} /> No students online in the last {d.window_minutes} minutes.</p>
        ) : (
          <ul className="divide-y divide-white/5 border-t border-white/5 max-h-80 overflow-y-auto">
            {d.online.map((s) => (
              <li key={s.uid} className="px-5 py-2.5 min-h-[44px] flex items-center gap-3">
                {s.platform === 'android'
                  ? <Smartphone size={14} className="text-emerald-400 shrink-0" aria-label="Android app" />
                  : <Monitor size={14} className="text-sky-400 shrink-0" aria-label="Web" />}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{studentDisplayName(s)}</p>
                  <p className="text-[11px] text-slate-500 truncate">
                    {[s.class_level && `Class ${s.class_level}`, boardLabel(s.board), s.target_exam && s.target_exam !== 'NONE' && examLabel(s.target_exam)].filter(Boolean).join(' · ') || 'Profile incomplete'}
                  </p>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0">last active {agoLabel(s.last_seen_at, serverNowMs)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="px-5 py-2 text-[10px] text-slate-600 border-t border-white/5">
          Updates every 30 s · "today" and "this week" are India time (week starts Monday) · admins not counted
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="bg-slate-800 rounded-2xl border border-white/5 overflow-hidden"
      >
        <p className="px-5 pt-4 pb-3 text-white font-semibold">Recent registrations</p>
        <div className="border-t border-white/5">
          <RegistrationList items={feed?.items} error={feed?.error} serverNowMs={serverNowMs} />
        </div>
      </motion.div>
    </div>
  );
}
