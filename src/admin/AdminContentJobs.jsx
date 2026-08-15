import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  ListChecks, Loader2, AlertTriangle, RefreshCw, Search, Clock, CheckCircle2,
  MinusCircle, Ban, RotateCcw, Hourglass,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

// Mirrors content_jobs.status's check constraint (20260814050000 + 20260815040000).
const STATUS = {
  queued:  { label: 'Queued',  icon: Clock,       cls: 'bg-slate-700/60  text-slate-300  border-slate-600' },
  running: { label: 'Running', icon: Hourglass,   cls: 'bg-blue-900/40   text-blue-400   border-blue-700/30' },
  done:    { label: 'Done',    icon: CheckCircle2, cls: 'bg-emerald-900/40 text-emerald-400 border-emerald-700/30' },
  failed:  { label: 'Failed',  icon: AlertTriangle, cls: 'bg-red-900/40   text-red-400    border-red-700/30' },
  skipped: { label: 'Skipped', icon: MinusCircle, cls: 'bg-amber-900/30  text-amber-400  border-amber-700/25' },
};
const STATUS_ORDER = ['queued', 'running', 'failed', 'done', 'skipped'];

function formatRelative(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)    return `${Math.round(diff)}s ago`;
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function JobRow({ job, onRequeue, requeuing }) {
  const st = STATUS[job.status] ?? STATUS.queued;
  const Icon = st.icon;
  const expected = job.chapters_expected ?? [];
  const written  = job.chapters_written ?? [];
  const chapterNote = job.status === 'done' || job.status === 'skipped'
    ? (written.length ? written.join(' | ') : null)
    : (expected.length ? `expects: ${expected.join(' | ')}` : null);

  return (
    <motion.div
      className="flex items-start gap-3 px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/3 transition-colors"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      <div className="h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={13} className={job.status === 'running' ? 'text-blue-400 animate-pulse' : 'text-slate-500'} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${st.cls}`}>{st.label.toUpperCase()}</span>
          <span className="text-xs font-semibold text-white truncate max-w-[280px]">{job.source_file}</span>
          <span className="text-[10px] text-slate-500">
            {job.exam_type} · {job.subject}{job.book ? ` · ${job.book}` : ''}
            {job.file_ordinal != null ? ` · File #${job.file_ordinal}` : ''}
          </span>
        </div>

        {job.status === 'failed' && job.error && (
          <p className="text-xs text-red-400 mt-1 leading-snug break-words">{job.error}</p>
        )}
        {chapterNote && (
          <p className="text-[11px] text-slate-500 mt-1 leading-snug break-words">{chapterNote}</p>
        )}

        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {job.chunk_count > 0 && <span className="text-[10px] text-slate-500">{job.chunk_count} chunks</span>}
          {job.claimed_by && <span className="text-[10px] text-slate-600 font-mono truncate max-w-[160px]" title={job.claimed_by}>worker: {job.claimed_by}</span>}
          <span className="text-[10px] text-slate-600">
            {job.status === 'queued' ? `queued ${formatRelative(job.started_at)}` : `started ${formatRelative(job.started_at)}`}
            {job.finished_at ? ` · finished ${formatRelative(job.finished_at)}` : ''}
          </span>
        </div>
      </div>

      {job.status === 'failed' && (
        <button
          onClick={() => onRequeue(job.id)}
          disabled={requeuing}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-900/20 hover:bg-amber-900/40 border border-amber-700/30 text-amber-400 text-[10px] font-bold transition-colors disabled:opacity-40"
        >
          <RotateCcw size={11} className={requeuing ? 'animate-spin' : ''} /> Requeue
        </button>
      )}
    </motion.div>
  );
}

export default function AdminContentJobs() {
  const callerUid = getCallerUid();
  const [jobs,      setJobs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [search,    setSearch]    = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [requeuingId, setRequeuingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const { data, error: e } = await supabase.rpc('admin_list_content_jobs', {
        p_caller: callerUid, p_limit: 300,
      });
      if (e) throw e;
      setJobs(data ?? []);
    } catch (e) {
      setError(e.message || 'Failed to load content jobs.');
    } finally {
      setLoading(false);
    }
  }, [callerUid]);

  useEffect(() => { load(); }, [load]);

  async function handleRequeue(id) {
    setRequeuingId(id);
    try {
      const { error: e } = await supabase.rpc('admin_requeue_content_job', { p_caller: callerUid, p_id: id });
      if (e) throw e;
      await load();
    } catch (e) {
      setError(e.message || 'Requeue failed.');
    } finally {
      setRequeuingId(null);
    }
  }

  const counts = STATUS_ORDER.reduce((acc, s) => ({ ...acc, [s]: jobs.filter((j) => j.status === s).length }), {});

  const visible = jobs
    .filter((j) => statusFilter === 'all' || j.status === statusFilter)
    .filter((j) => !search.trim() || [j.source_file, j.exam_type, j.subject, j.book, j.error]
      .filter(Boolean).some((f) => f.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ListChecks size={22} className="text-primary-400" /> Content Jobs
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            The content loader's queue — what's enqueued, running, or done. Enqueue and drain from the
            CLI (<code className="text-[11px] bg-slate-800 px-1 py-0.5 rounded">bulk-load-unit-notes.mjs --enqueue</code> /
            <code className="text-[11px] bg-slate-800 px-1 py-0.5 rounded ml-1">--work</code>); this tab is read-only status
            plus a manual requeue for a failed file.
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

      {/* Stats — also the status filter */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        {STATUS_ORDER.map((s) => {
          const st = STATUS[s];
          return (
            <button
              key={s}
              onClick={() => setStatusFilter((f) => f === s ? 'all' : s)}
              className={`rounded-2xl p-4 text-center border transition-colors ${
                statusFilter === s ? 'bg-primary-900/30 border-primary-600/50' : 'bg-slate-800 border-white/5 hover:border-white/15'
              }`}
            >
              <p className={`text-3xl font-extrabold ${counts[s] > 0 ? st.cls.split(' ').find((c) => c.startsWith('text-')) : 'text-slate-600'}`}>
                {counts[s]}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">{st.label}</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-slate-800/60 border border-white/5 rounded-xl px-3 py-2">
        <Search size={14} className="text-slate-500 shrink-0" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by filename, exam, subject, book, or error text…"
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
        />
        {statusFilter !== 'all' && (
          <button onClick={() => setStatusFilter('all')} className="shrink-0 flex items-center gap-1 text-[10px] text-slate-500 hover:text-white">
            <Ban size={11} /> clear filter
          </button>
        )}
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
          <ListChecks size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="font-medium">{jobs.length === 0 ? 'Nothing queued yet' : 'No jobs match this filter'}</p>
          <p className="text-xs mt-1">
            {jobs.length === 0
              ? 'Enqueue a folder with bulk-load-unit-notes.mjs --enqueue, then start a worker with --work.'
              : 'Try clearing the search or status filter.'}
          </p>
        </div>
      ) : (
        <div className="bg-slate-800/50 border border-white/5 rounded-2xl overflow-hidden">
          {visible.slice(0, 300).map((job) => (
            <JobRow key={job.id} job={job} onRequeue={handleRequeue} requeuing={requeuingId === job.id} />
          ))}
        </div>
      )}
    </div>
  );
}
