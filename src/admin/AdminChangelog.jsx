/**
 * Deploy changelog — the permanent, viewable record of every production
 * deploy (supabase/migrations/20260818020000_deploy_log.sql). Read-only by
 * design: an entry is written once, as the first step of docs/DEPLOY.md's
 * 8-step procedure (before the build is even transferred), via
 * admin_insert_deploy_log — same posture as ai_call_log, which has no write
 * UI either because the thing writing it isn't a human filling in a form.
 * There is deliberately no update/delete RPC — a deploy record should not be
 * editable after the fact.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  History, Loader2, AlertTriangle, ChevronDown, ChevronUp, GitCommit,
  Package, PlusCircle, RefreshCw, Wrench, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const CHANGE_TYPE = {
  added:   { label: 'Added',   icon: PlusCircle, cls: 'text-emerald-400' },
  changed: { label: 'Changed', icon: RefreshCw,  cls: 'text-blue-400' },
  fixed:   { label: 'Fixed',   icon: Wrench,     cls: 'text-amber-400' },
  note:    { label: 'Note',    cls: 'text-slate-400', icon: Info },
};

function shortHash(h) {
  return h ? h.slice(0, 12) : null;
}

export default function AdminChangelog() {
  const callerUid = getCallerUid();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());

  async function load() {
    setLoading(true); setErr('');
    const { data, error } = await supabase.rpc('admin_list_deploy_log', { p_caller: callerUid, p_limit: 200 });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    setRows(data ?? []);
    // First (newest) entry open by default — that's the one anyone opening
    // this page right after a deploy actually wants to see.
    if (data?.length) setExpanded(new Set([data[0].id]));
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start gap-2 bg-slate-800/40 border border-white/8 rounded-xl p-3">
        <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400 leading-relaxed">
          Every production deploy gets one entry here, written before the 8-step
          procedure in <span className="font-mono text-slate-300">docs/DEPLOY.md</span> even
          starts. Read-only — there is no edit or delete, a deploy record should not change after the fact.
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8 justify-center">
          <Loader2 size={16} className="animate-spin" /> Loading deploy history…
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-700/25 rounded-xl p-3">
          <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300">{err}</p>
        </div>
      )}

      {!loading && !err && rows.length === 0 && (
        <div className="flex items-start gap-2 bg-slate-800/40 border border-white/8 rounded-xl p-3">
          <History size={14} className="text-slate-500 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-500">No deploys logged yet.</p>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => {
          const isOpen = expanded.has(r.id);
          const changes = Array.isArray(r.changes) ? r.changes : [];
          return (
            <div key={r.id} className="bg-slate-900/40 rounded-2xl border border-white/8 overflow-hidden">
              <button
                onClick={() => toggle(r.id)}
                className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-white/[0.02] transition-colors"
              >
                <History size={16} className="text-primary-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white font-mono">{r.version}</span>
                    <span className="text-[11px] text-slate-500">
                      {new Date(r.deployed_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 mt-0.5">{r.summary}</p>
                </div>
                {isOpen ? <ChevronUp size={15} className="text-slate-500 shrink-0 mt-0.5" /> : <ChevronDown size={15} className="text-slate-500 shrink-0 mt-0.5" />}
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">
                      {changes.length > 0 && (
                        <ul className="space-y-1.5 mt-3">
                          {changes.map((c, i) => {
                            const cfg = CHANGE_TYPE[c?.type] ?? CHANGE_TYPE.note;
                            const Icon = cfg.icon;
                            return (
                              <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                                <Icon size={13} className={`${cfg.cls} shrink-0 mt-0.5`} />
                                <span><span className={`font-semibold ${cfg.cls}`}>{cfg.label}:</span> {c?.text ?? String(c)}</span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500 pt-1">
                        {r.git_commit_hash && (
                          <span className="flex items-center gap-1.5">
                            <GitCommit size={12} /> <span className="font-mono">{shortHash(r.git_commit_hash)}</span>
                          </span>
                        )}
                        {r.bundle_hash && (
                          <span className="flex items-center gap-1.5">
                            <Package size={12} /> <span className="font-mono">{r.bundle_hash}</span>
                          </span>
                        )}
                        {r.deployed_by && <span>by {r.deployed_by}</span>}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}
