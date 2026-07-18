import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, BookOpen, RefreshCw, ExternalLink, Download, Layers, Trash2, CheckSquare, Square } from 'lucide-react';
import { adminGetPapers, adminDeletePapers, adminDeleteAllPapers, supabase } from '../lib/supabase';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { DIFFICULTY_DARK, subjectBadge, SUBJECT } from '../lib/badgeStyles';

const EDGE_PROXY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pdf-proxy`;

const TYPE_COLOR = {
  'Question Paper': 'bg-primary-900/40 text-primary-300',
  'Answer Key':     'bg-rose-900/40    text-rose-300',
  'Syllabus':       'bg-teal-900/40    text-teal-300',
  'Notes':          'bg-slate-700      text-slate-300',
  'Other':          'bg-slate-800      text-slate-400',
};

function getPdfUrl(paper) {
  // Crawled PDF → stream via Edge Function GET (works without storage upload)
  if (paper.source_url && !paper.source_url.startsWith('local:')) {
    return `${EDGE_PROXY}?url=${encodeURIComponent(paper.source_url)}`;
  }
  // Manual upload → use Supabase Storage public URL
  if (paper.storage_path) {
    const { data } = supabase.storage.from('question-papers').getPublicUrl(paper.storage_path);
    return data?.publicUrl || null;
  }
  return null;
}

/* ── Paper card ─────────────────────────────────────────── */
function PaperCard({ paper, selected, onToggle }) {
  const subjColor = DIFFICULTY_DARK.Mixed; // use dark subject palette via inline
  const subjBadge = `bg-white/5 text-slate-300 border border-white/10`; // dark surface subjects
  const typeColor = TYPE_COLOR[paper.paper_type] || TYPE_COLOR.Other;
  const topics    = paper.topics?.slice(0, 4) || [];
  const pdfUrl   = getPdfUrl(paper);
  const isManual = paper.source_url?.startsWith('local:');

  return (
    <motion.div
      className={[
        'bg-slate-800 rounded-2xl border p-4 flex flex-col gap-3 transition-colors cursor-pointer relative',
        selected ? 'border-primary-500 bg-slate-750' : 'border-white/5 hover:border-primary-500/30',
      ].join(' ')}
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      onClick={() => onToggle(paper.id)}
    >
      {/* Checkbox */}
      <div className="absolute top-3 right-3">
        {selected
          ? <CheckSquare size={16} className="text-primary-400" />
          : <Square      size={16} className="text-slate-600"   />
        }
      </div>

      {/* Header row */}
      <div className="flex items-start gap-2 pr-6">
        <div className="h-9 w-9 rounded-xl bg-slate-700 flex items-center justify-center shrink-0">
          <FileText size={16} className="text-slate-300" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${subjBadge}`}>{paper.subject}</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeColor}`}>{paper.paper_type}</span>
          {paper.board && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{paper.board}</span>
          )}
        </div>
      </div>

      {/* Title + summary */}
      <div>
        <p className="text-sm font-semibold text-white leading-snug">
          {paper.filename || paper.source_url?.split('/').pop()}
        </p>
        {paper.year && <p className="text-xs text-slate-500 mt-0.5">{paper.year}</p>}
        {paper.summary && (
          <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">{paper.summary}</p>
        )}
      </div>

      {/* Topics */}
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">{t}</span>
          ))}
          {(paper.topics?.length || 0) > 4 && (
            <span className="text-[10px] text-slate-600">+{paper.topics.length - 4} more</span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5 gap-2" onClick={(e) => e.stopPropagation()}>
        <span className="text-[10px] font-medium text-emerald-400">✓ In EWE KB</span>
        <div className="flex items-center gap-2">
          {!isManual && paper.source_url && (
            <a href={paper.source_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
              <ExternalLink size={11} /> Source
            </a>
          )}
          {pdfUrl ? (
            <a href={pdfUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-primary-700 hover:bg-primary-600 text-white transition-colors">
              <Download size={11} /> View PDF
            </a>
          ) : (
            <span className="text-[10px] text-slate-600 italic">No source</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Stats bar ─────────────────────────────────────────── */
function StatsBar({ papers }) {
  const bySubject = {};
  papers.forEach((p) => { bySubject[p.subject] = (bySubject[p.subject] || 0) + 1; });
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(bySubject).map(([subj, count]) => {
        const col = SUBJECT[subj] ?? 'bg-slate-700 text-slate-400';
        return (
          <div key={subj} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl ${col}`} style={{ background: 'rgba(0,0,0,0.25)' }}>
            <Layers size={11} />
            <span className="text-xs font-semibold">{subj}</span>
            <span className="text-xs opacity-60">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────── */
export default function AdminPapers() {
  const [papers,    setPapers]    = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [deleting,  setDeleting]  = useState(false);
  const [selected,  setSelected]  = useState(new Set());
  const [filter,    setFilter]    = useState('All');
  const [typeFilter,setTypeFilter]= useState('All');
  const [confirm,   setConfirm]   = useState(null); // { message, onConfirm }

  const load = () => {
    setLoading(true);
    setSelected(new Set());
    adminGetPapers()
      .then((data) => { setPapers(data || []); setLoading(false); })
      .catch((e) => { console.error('[AdminPapers] load failed:', e); setLoading(false); });
  };

  useEffect(load, []);

  const subjects = ['All', ...new Set(papers.map((p) => p.subject).filter(Boolean))];
  const types    = ['All', ...new Set(papers.map((p) => p.paper_type).filter(Boolean))];

  const displayed = papers
    .filter((p) => filter     === 'All' || p.subject    === filter)
    .filter((p) => typeFilter === 'All' || p.paper_type === typeFilter);

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll  = () => setSelected(new Set(displayed.map((p) => p.id)));
  const clearSel   = () => setSelected(new Set());
  const allSelected = displayed.length > 0 && displayed.every((p) => selected.has(p.id));

  const doDelete = async (fn) => {
    setDeleting(true);
    setConfirm(null);
    await fn();
    load();
    setDeleting(false);
  };

  const askDeleteSelected = () => {
    if (!selected.size) return;
    setConfirm({
      title: `Delete ${selected.size} paper${selected.size > 1 ? 's' : ''}?`,
      message: `This removes them and all their knowledge base chunks. EWE won't be able to answer from these papers. Cannot be undone.`,
      onConfirm: () => doDelete(() => adminDeletePapers([...selected])),
    });
  };

  const askDeleteAll = () => {
    setConfirm({
      title: `Delete all ${papers.length} papers?`,
      message: `EWE will lose all trained content. This cannot be undone.`,
      onConfirm: () => doDelete(adminDeleteAllPapers),
    });
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        onConfirm={confirm?.onConfirm ?? (() => {})}
        title={confirm?.title ?? 'Delete papers?'}
        description={confirm?.message}
        confirmLabel="Delete"
        loading={deleting}
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Question Papers & Notes</h1>
          <p className="text-slate-400 text-sm mt-1">
            {papers.length} document{papers.length !== 1 ? 's' : ''} in EWE's knowledge base
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={load} disabled={loading || deleting}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 rounded-xl text-slate-300 text-sm transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>

          {papers.length > 0 && (
            <button onClick={askDeleteAll} disabled={deleting}
              className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-red-900/60 border border-red-800/40 hover:border-red-700 disabled:opacity-40 rounded-xl text-red-400 text-sm transition-colors">
              <Trash2 size={14} /> Delete All
            </button>
          )}
        </div>
      </div>

      {/* Selection toolbar — appears when items are selected */}
      <AnimatePresence>
        {selected.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex items-center justify-between bg-primary-900/30 border border-primary-500/30 rounded-2xl px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <CheckSquare size={16} className="text-primary-400" />
              <span className="text-sm text-primary-300 font-medium">{selected.size} selected</span>
              <button onClick={clearSel} className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                Clear
              </button>
            </div>
            <button onClick={askDeleteSelected} disabled={deleting}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-xl text-white text-sm font-semibold transition-colors">
              <Trash2 size={13} /> Delete {selected.size}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {papers.length > 0 && <StatsBar papers={papers} />}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={allSelected ? clearSel : selectAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-slate-400 bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <div className="w-px h-4 bg-slate-700" />
          {subjects.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={[
                'px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors',
                filter === s ? 'bg-primary-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
              ].join(' ')}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          {types.map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={[
                'px-3 py-1 rounded-lg text-[11px] font-medium transition-colors',
                typeFilter === t ? 'bg-slate-600 text-white' : 'bg-slate-800/50 text-slate-500 hover:bg-slate-700',
              ].join(' ')}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {loading || deleting ? (
        <div className="flex items-center gap-2 text-slate-500 text-sm">
          <div className="h-4 w-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
          {deleting ? 'Deleting…' : 'Loading papers…'}
        </div>
      ) : displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <BookOpen size={36} className="text-slate-700" />
          <p className="text-slate-400 font-medium">
            {papers.length > 0 ? 'No papers match this filter' : 'No papers yet'}
          </p>
          <p className="text-slate-600 text-sm">
            {papers.length > 0 ? 'Try a different filter' : 'Use the Crawler to download PDFs or upload manually'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {displayed.map((p) => (
            <PaperCard
              key={p.id}
              paper={p}
              selected={selected.has(p.id)}
              onToggle={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
