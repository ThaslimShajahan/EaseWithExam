import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, Trash2, RefreshCw,
  CheckSquare, Square, Users, Clock, BookOpen, ChevronDown, ChevronUp,
} from 'lucide-react';
import { getPublishedTests, deletePublishedTest, supabase } from '../lib/supabase';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { DIFFICULTY_DARK, diffBadge } from '../lib/badgeStyles';

function fmt(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const SOURCE_META = {
  admin:    { label: 'Admin',   color: 'bg-violet-900/30 text-violet-300 border-violet-700/30' },
  student:  { label: 'Student', color: 'bg-blue-900/30 text-blue-300 border-blue-700/30' },
  pyq_auto: { label: 'PYQ',     color: 'bg-teal-900/30 text-teal-300 border-teal-700/30' },
  unknown:  { label: 'Unknown', color: 'bg-slate-700/40 text-slate-400 border-slate-600/30' },
};

function TestRow({ test, selected, onToggle, attempts, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const diffColor = diffBadge(test.difficulty, true);
  const attemptCount = attempts[test.id] ?? 0;
  const source = SOURCE_META[test.created_by] ?? SOURCE_META.unknown;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        className={[
          'border-b border-white/5 transition-colors cursor-pointer',
          selected ? 'bg-primary-900/20' : 'hover:bg-white/[0.03]',
        ].join(' ')}
        onClick={() => onToggle(test.id)}
      >
        {/* Checkbox */}
        <td className="px-4 py-3 w-8">
          {selected
            ? <CheckSquare size={15} className="text-primary-400" />
            : <Square      size={15} className="text-slate-600"   />}
        </td>

        {/* Title */}
        <td className="px-4 py-3 min-w-[200px]">
          <p className="text-sm font-semibold text-white leading-snug line-clamp-2">{test.title}</p>
          <p className="text-[11px] text-slate-500 mt-0.5">{test.exam_type}</p>
        </td>

        {/* Subject */}
        <td className="px-4 py-3 text-sm text-slate-300">{test.subject}</td>

        {/* Source */}
        <td className="px-4 py-3">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border ${source.color}`}>
            {source.label}
          </span>
        </td>

        {/* Difficulty */}
        <td className="px-4 py-3">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border ${diffColor}`}>
            {test.difficulty || '—'}
          </span>
        </td>

        {/* Questions */}
        <td className="px-4 py-3 text-sm text-slate-300 tabular-nums">
          {test.question_count ?? '—'}
        </td>

        {/* Duration */}
        <td className="px-4 py-3 text-sm text-slate-400 tabular-nums">
          {test.duration_minutes ? `${test.duration_minutes} min` : '—'}
        </td>

        {/* Attempts */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm">
            <Users size={12} className={attemptCount > 0 ? 'text-emerald-400' : 'text-slate-600'} />
            <span className={attemptCount > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-500'}>
              {attemptCount}
            </span>
          </div>
        </td>

        {/* Date */}
        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmt(test.created_at)}</td>

        {/* Actions */}
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-white/5 transition-colors"
              title="Preview questions"
            >
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <button
              onClick={() => onDelete(test)}
              className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
              title="Delete test"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </motion.tr>

      {/* Expanded preview row */}
      <AnimatePresence>
        {expanded && (
          <tr>
            <td colSpan={9} className="px-4 pb-4 pt-0">
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-slate-900 rounded-xl p-4 border border-white/5 space-y-2">
                  <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-2">
                    First 5 questions
                  </p>
                  {(test.questions ?? []).slice(0, 5).map((q, i) => (
                    <div key={i} className="flex gap-2 text-xs text-slate-400">
                      <span className="text-slate-600 shrink-0 tabular-nums">{i + 1}.</span>
                      <span className="line-clamp-2">{q.question}</span>
                    </div>
                  ))}
                  {(test.questions ?? []).length > 5 && (
                    <p className="text-[11px] text-slate-600 italic">
                      +{test.questions.length - 5} more questions not shown
                    </p>
                  )}
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

/* ── Main page ─────────────────────────────────────────────── */
export default function AdminPublishedTests() {
  const [tests,    setTests]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [attempts, setAttempts] = useState({});
  const [confirm,  setConfirm]  = useState(null);
  const [filter,   setFilter]   = useState('All');

  const load = async () => {
    setLoading(true);
    setSelected(new Set());

    const [testRows, sessionRows] = await Promise.all([
      getPublishedTests(),
      supabase
        .from('test_sessions')
        .select('test_id')
        .not('test_id', 'is', null)
        .then(({ data }) => data ?? []),
    ]);

    setTests(testRows);

    const counts = {};
    sessionRows.forEach(({ test_id }) => {
      counts[test_id] = (counts[test_id] || 0) + 1;
    });
    setAttempts(counts);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const subjects = ['All', ...new Set(tests.map((t) => t.subject).filter(Boolean))];

  const displayed = filter === 'All' ? tests : tests.filter((t) => t.subject === filter);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = displayed.length > 0 && displayed.every((t) => selected.has(t.id));
  const selectAll   = () => setSelected(new Set(displayed.map((t) => t.id)));
  const clearSel    = () => setSelected(new Set());

  const doDelete = async (ids) => {
    setDeleting(true);
    setConfirm(null);
    await Promise.all(ids.map((id) => deletePublishedTest(id)));
    await load();
    setDeleting(false);
  };

  const askDeleteOne = (test) => {
    const hasAttempts = (attempts[test.id] ?? 0) > 0;
    setConfirm({
      title: `Delete "${test.title}"?`,
      message: hasAttempts
        ? `This test has ${attempts[test.id]} attempt(s) on record. Student attempt data will remain but the test will be unlinked. Cannot be undone.`
        : `This test will be permanently removed from Exam Center. Cannot be undone.`,
      onConfirm: () => doDelete([test.id]),
    });
  };

  const askDeleteSelected = () => {
    if (!selected.size) return;
    const withAttempts = [...selected].filter((id) => (attempts[id] ?? 0) > 0);
    setConfirm({
      title: `Delete ${selected.size} test${selected.size > 1 ? 's' : ''}?`,
      message: withAttempts.length
        ? `${withAttempts.length} of them have student attempts on record. Student data will remain but tests will be unlinked. Cannot be undone.`
        : `These tests will be permanently removed from Exam Center. Cannot be undone.`,
      onConfirm: () => doDelete([...selected]),
    });
  };

  return (
    <div className="space-y-6 max-w-6xl">
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={confirm?.onConfirm ?? (() => {})}
        title={confirm?.title ?? 'Delete test?'}
        description={confirm?.message}
        confirmLabel="Delete"
        loading={deleting}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ClipboardList size={22} className="text-primary-400" />
            Published Tests
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {tests.length} test{tests.length !== 1 ? 's' : ''} live on Exam Center
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading || deleting}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl text-slate-300 text-sm transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Stats strip */}
      {tests.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Tests',    value: tests.length,                             icon: ClipboardList, color: 'text-primary-400' },
            { label: 'Total Attempts', value: Object.values(attempts).reduce((a, b) => a + b, 0), icon: Users, color: 'text-emerald-400' },
            { label: 'Total Questions',value: tests.reduce((s, t) => s + (t.question_count ?? 0), 0), icon: BookOpen, color: 'text-violet-400' },
            { label: 'Avg Duration',   value: tests.length ? `${Math.round(tests.reduce((s, t) => s + (t.duration_minutes ?? 0), 0) / tests.length)} min` : '—', icon: Clock, color: 'text-amber-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-slate-800 border border-white/5 rounded-2xl p-4 flex items-center gap-3">
              <Icon size={18} className={color} />
              <div>
                <p className="text-xs text-slate-500">{label}</p>
                <p className={`text-lg font-bold ${color}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Select all toggle */}
        <button
          onClick={allSelected ? clearSel : selectAll}
          disabled={displayed.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition-colors"
        >
          {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>

        <div className="w-px h-4 bg-slate-700" />

        {/* Subject filters */}
        {subjects.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
              filter === s ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
            ].join(' ')}>
            {s}
          </button>
        ))}

        {/* Bulk delete */}
        <AnimatePresence>
          {selected.size > 0 && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
              onClick={askDeleteSelected}
              disabled={deleting}
              className="ml-auto flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-xl text-white text-xs font-semibold transition-colors"
            >
              <Trash2 size={13} /> Delete {selected.size}
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Table */}
      {loading || deleting ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-8">
          <div className="h-4 w-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
          {deleting ? 'Deleting…' : 'Loading tests…'}
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
          <ClipboardList size={40} className="text-slate-700" />
          <p className="text-slate-400 font-medium">
            {tests.length > 0 ? 'No tests match this filter' : 'No published tests yet'}
          </p>
          <p className="text-slate-600 text-sm">
            {tests.length > 0 ? 'Try a different subject filter' : 'Use Paper Gen to generate and publish a test'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/5">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-800 border-b border-white/5">
                <th className="px-4 py-3 w-8" />
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Title</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Subject</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Source</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Difficulty</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Qs</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Attempts</th>
                <th className="px-4 py-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider">Published</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="bg-slate-900">
              {displayed.map((test) => (
                <TestRow
                  key={test.id}
                  test={test}
                  selected={selected.has(test.id)}
                  onToggle={toggleSelect}
                  attempts={attempts}
                  onDelete={askDeleteOne}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
