import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Activity, Loader2, AlertTriangle, RefreshCw, User, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const ACTION_COLORS = {
  create:  'bg-emerald-900/40 text-emerald-400 border-emerald-700/30',
  update:  'bg-blue-900/40   text-blue-400   border-blue-700/30',
  delete:  'bg-red-900/40    text-red-400    border-red-700/30',
  approve: 'bg-teal-900/40   text-teal-400   border-teal-700/30',
  archive: 'bg-slate-700     text-slate-400  border-slate-600',
  grant:   'bg-violet-900/40 text-violet-400 border-violet-700/30',
  revoke:  'bg-amber-900/40  text-amber-400  border-amber-700/30',
};

function formatRelative(iso) {
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)  return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function LogRow({ entry }) {
  const cls = ACTION_COLORS[entry.action?.toLowerCase()] || ACTION_COLORS.update;

  return (
    <motion.div
      className="flex items-start gap-3 px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      <div className="h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
        <Activity size={13} className="text-slate-500" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cls}`}>
            {entry.action?.toUpperCase() ?? '—'}
          </span>
          <span className="text-xs font-semibold text-white">{entry.entity_type ?? '—'}</span>
          {entry.entity_id && (
            <code className="text-[10px] text-slate-500 font-mono truncate max-w-[120px]">{entry.entity_id}</code>
          )}
        </div>
        {entry.note && (
          <p className="text-xs text-slate-400 mt-1 leading-snug">{entry.note}</p>
        )}
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1 text-[10px] text-slate-500 font-medium" title={entry.actor_uid || ''}>
            <User size={9} />
            {entry.actor_name || entry.actor_email || (entry.actor_uid ? entry.actor_uid.slice(0, 12) + '…' : 'System')}
          </span>
          <span className="text-[10px] text-slate-600">{formatRelative(entry.created_at)}</span>
        </div>
      </div>
    </motion.div>
  );
}

export default function AdminActivityLog() {
  const callerUid   = getCallerUid();
  const [entries,   setEntries]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error: e } = await supabase.rpc('admin_get_activity_log', {
        p_caller: callerUid, p_limit: 200, p_offset: 0,
      });
      if (e) throw e;
      setEntries(data ?? []);
    } catch (e) {
      setError(e.message || 'Failed to load activity log. Ensure migration 0012 is applied.');
    } finally {
      setLoading(false);
    }
  }, [callerUid]);

  useEffect(() => { load(); }, [load]);

  const visible = search.trim()
    ? entries.filter((e) =>
        e.entity_type?.toLowerCase().includes(search.toLowerCase()) ||
        e.action?.toLowerCase().includes(search.toLowerCase()) ||
        e.note?.toLowerCase().includes(search.toLowerCase()) ||
        e.actor_uid?.toLowerCase().includes(search.toLowerCase()) ||
        e.actor_name?.toLowerCase().includes(search.toLowerCase()) ||
        e.actor_email?.toLowerCase().includes(search.toLowerCase())
      )
    : entries;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Activity size={22} className="text-primary-400" /> Activity Log
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Immutable audit trail of all admin and coaching mutations.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 text-xs font-semibold transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-slate-800/60 border border-white/5 rounded-xl px-3 py-2">
        <Search size={14} className="text-slate-500 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by action, entity, actor UID…"
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Events', value: entries.length, color: 'text-slate-400' },
          { label: 'Shown',        value: visible.length, color: 'text-primary-400' },
          { label: 'Actors',       value: new Set(entries.map((e) => e.actor_uid)).size, color: 'text-violet-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-800 border border-white/5 rounded-2xl p-4 text-center">
            <p className={`text-3xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-xs text-red-400">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Activity size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="font-medium">No activity yet</p>
          <p className="text-xs mt-1">Admin and coaching mutations will appear here.</p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
          {visible.slice(0, 200).map((entry) => (
            <LogRow key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
