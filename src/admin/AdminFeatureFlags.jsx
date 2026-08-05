import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToggleLeft, ToggleRight, Loader2, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { invalidateFlagCache } from '../lib/featureFlags';
import { logChange, ENTITY, ACTION } from '../lib/changelog';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const FLAG_DOCS = {
  syllabus_graph_enabled:       'Deprecated — syllabus_nodes is now always the live source for every exam type; this flag no longer gates anything.',
  content_review_queue_enabled: 'New PDF uploads land as in_review — require admin approval before students see them.',
  content_versioning_enabled:   'Keep full version history of every content change (content_versions table).',
  centre_content_pool_enabled:  'Coaching centres can publish their own content pool for enrolled students.',
  centre_test_builder_enabled:  'Coaching portal: test builder tab visible to coaching admins.',
  misconception_engine_enabled: 'Wrong answers in AI practice are logged to concept_misconceptions for targeted remediation.',
  atomic_quota_rpc_enabled:     'Quota increment uses check_and_increment_quota RPC (atomic, prevents race conditions).',
  dalle_proxy_enabled:          'DALL-E image generation routes through Supabase Edge Function (key stays server-side).',
  centre_invites_enabled:       'Coaching centres can create shareable invite links / QR codes to enrol students.',
  maintenance_mode_enabled:     'Shows a "back in a few minutes" screen to students. Turn ON right before deploying, OFF right after. The Admin Panel always stays reachable so you can turn it back off.',
};

function FlagRow({ flagKey, enabled, onToggle, toggling }) {
  const doc = FLAG_DOCS[flagKey] || '';
  return (
    <motion.div
      layout
      className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
        enabled ? 'bg-emerald-950/30 border-emerald-700/30' : 'bg-slate-800/50 border-white/5'
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code className="text-xs font-mono text-slate-300 bg-slate-900 px-2 py-0.5 rounded">
            {flagKey}
          </code>
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            enabled ? 'bg-emerald-900/50 text-emerald-400' : 'bg-slate-700 text-slate-500'
          }`}>
            {enabled ? 'ON' : 'OFF'}
          </span>
        </div>
        {doc && (
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed flex items-start gap-1.5">
            <Info size={11} className="shrink-0 mt-0.5 text-slate-600" />
            {doc}
          </p>
        )}
      </div>
      <button
        onClick={() => onToggle(flagKey, !enabled)}
        disabled={toggling === flagKey}
        className="shrink-0 mt-0.5 transition-colors"
        title={enabled ? 'Disable flag' : 'Enable flag'}
      >
        {toggling === flagKey ? (
          <Loader2 size={22} className="animate-spin text-slate-500" />
        ) : enabled ? (
          <ToggleRight size={28} className="text-emerald-500 hover:text-emerald-400" />
        ) : (
          <ToggleLeft size={28} className="text-slate-600 hover:text-slate-400" />
        )}
      </button>
    </motion.div>
  );
}

export default function AdminFeatureFlags() {
  const callerUid  = getCallerUid();
  const [flags,    setFlags]   = useState([]);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState('');
  const [toggling, setToggling] = useState('');
  const [saved,    setSaved]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error: e } = await supabase.rpc('admin_get_feature_flags', { p_caller: callerUid });
      if (e) throw e;
      setFlags(data ?? []);
    } catch (e) {
      setError(e.message || 'Failed to load feature flags. Ensure migration 0012 is applied.');
    } finally {
      setLoading(false);
    }
  }, [callerUid]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (key, newEnabled) => {
    setToggling(key); setError('');
    try {
      const { error: e } = await supabase.rpc('admin_toggle_feature_flag', {
        p_caller:  callerUid,
        p_key:     key,
        p_enabled: newEnabled,
      });
      if (e) throw e;
      setFlags((prev) => prev.map((f) => f.key === key ? { ...f, enabled: newEnabled } : f));
      invalidateFlagCache();
      logChange(ENTITY.SYSTEM, key, newEnabled ? ACTION.UPDATE : ACTION.UPDATE,
        { before: { enabled: !newEnabled }, after: { enabled: newEnabled } },
        `Feature flag ${key} ${newEnabled ? 'enabled' : 'disabled'}`);
      setSaved(key);
      setTimeout(() => setSaved(''), 2500);
    } catch (e) {
      setError(e.message || 'Toggle failed');
    } finally {
      setToggling('');
    }
  };

  const onCount  = flags.filter((f) => f.enabled).length;
  const offCount = flags.length - onCount;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ToggleRight size={22} className="text-primary-400" /> Feature Flags
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Toggle platform features without code deploys. Changes take effect on next page load.
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

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Flags',   value: flags.length, color: 'text-slate-400' },
          { label: 'Enabled',       value: onCount,      color: 'text-emerald-400' },
          { label: 'Disabled',      value: offCount,     color: 'text-slate-500' },
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

      <AnimatePresence>
        {saved && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2 bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-3 py-2 text-xs text-emerald-400"
          >
            ✓ Flag <code className="font-mono">{saved}</code> updated. Cache invalidated — reload app to observe change.
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : flags.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <p className="font-medium">No flags found</p>
          <p className="text-xs mt-1">Run migration 0001 to seed the feature_flags table.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Enabled flags first */}
          {[...flags].sort((a, b) => Number(b.enabled) - Number(a.enabled)).map((f) => (
            <FlagRow
              key={f.key}
              flagKey={f.key}
              enabled={f.enabled}
              onToggle={handleToggle}
              toggling={toggling}
            />
          ))}
        </div>
      )}

      <div className="bg-amber-950/20 border border-amber-700/20 rounded-2xl p-4 text-xs text-amber-500/80 space-y-1">
        <p className="font-semibold text-amber-400">⚠ Production checklist before enabling a flag</p>
        <ul className="space-y-0.5 list-disc list-inside text-amber-500/60">
          <li>Ensure the corresponding DB migration has been applied</li>
          <li>Test the flag on a staging student account first</li>
          <li>Changes are live immediately — no deploy required</li>
          <li>Cache is in-memory per browser session; students on active sessions see changes on next page load</li>
        </ul>
      </div>
    </div>
  );
}
