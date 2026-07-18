import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, BookOpen, Trash2, ChevronDown, ChevronUp,
  Search, Filter, Loader2, CheckCircle2, AlertTriangle, Send,
  RefreshCw, FileText, X,
} from 'lucide-react';
import { supabase, publishPYQPaper } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { useAdminFilter } from './hooks/useAdminFilter';

/* ── Helpers ─────────────────────────────────────────────── */
async function fetchPYQs({ examType, subject, search } = {}) {
  // KB_NOTE rows are Study Notes content pending review (see Review Queue),
  // not real exam questions — exclude them so this tab's counts/list aren't
  // polluted by uploaded notes.
  let q = supabase.from('pyq_questions').select('*').neq('question_type', 'KB_NOTE').order('created_at', { ascending: false }).limit(500);
  if (examType && examType !== 'All') q = q.eq('exam_type', examType);
  if (subject  && subject  !== 'All') q = q.eq('subject', subject);
  if (search?.trim()) q = q.ilike('question_text', `%${search.trim()}%`);
  const { data } = await q;
  return data ?? [];
}

async function fetchKB({ subject, examTag, search } = {}) {
  let q = supabase.from('knowledge_base').select('id, subject, content, tags, created_at').order('created_at', { ascending: false }).limit(500);
  if (subject && subject !== 'All') q = q.eq('subject', subject);
  if (examTag && examTag !== 'All') q = q.contains('tags', [examTag]);
  if (search?.trim()) q = q.ilike('content', `%${search.trim()}%`);
  const { data } = await q;
  return data ?? [];
}

const EXAM_TAG_RE = /^(neet|jee_|cbse_class_|icse_class_|state_board_class_)/;

function prettyExamTag(tag) {
  return tag
    .replace(/^neet$/, 'NEET')
    .replace(/^jee_main$/, 'JEE Main')
    .replace(/^jee_advanced$/, 'JEE Advanced')
    .replace(/^cbse_class_(\d+)$/, (_, n) => `CBSE Class ${n}`)
    .replace(/^icse_class_(\d+)$/, (_, n) => `ICSE Class ${n}`)
    .replace(/^state_board_class_(\d+)$/, (_, n) => `State Board Class ${n}`)
    .replace(/_/g, ' ');
}

async function deletePYQ(id) {
  await supabase.from('pyq_questions').delete().eq('id', id);
}

async function deleteKBChunk(id) {
  await supabase.from('knowledge_base').delete().eq('id', id);
}

/* ── Small components ────────────────────────────────────── */
function Pill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={[
        'px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap',
        active
          ? 'bg-primary-600 border-primary-500 text-white'
          : 'bg-slate-800 border-white/5 text-slate-400 hover:border-white/20',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function StatChip({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-slate-800 border border-white/5 rounded-xl px-4 py-3 text-center">
      <p className={`text-xl font-extrabold ${color}`}>{value}</p>
      <p className="text-[10px] text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

/* ── PYQ Bank tab ────────────────────────────────────────── */
function PYQBank() {
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [examFilter,  setExamFilter]  = useAdminFilter('exam', 'All');
  const [subjFilter,  setSubjFilter]  = useAdminFilter('subj', 'All');
  const [search,      setSearch]      = useState('');
  const [expanded,    setExpanded]    = useState(new Set());
  const [publishing,  setPublishing]  = useState(false);
  const [publishMsg,  setPublishMsg]  = useState('');
  const [deleting,    setDeleting]    = useState(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchPYQs({ examType: examFilter, subject: subjFilter, search });
    setRows(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [examFilter, subjFilter]);

  const allExams    = ['All', ...new Set(rows.map((r) => r.exam_type).filter(Boolean))];
  const allSubjects = ['All', ...new Set(rows.map((r) => r.subject).filter(Boolean))];

  const displayed = search.trim()
    ? rows.filter((r) => r.question_text?.toLowerCase().includes(search.toLowerCase()))
    : rows;

  // Group by section
  const grouped = {};
  displayed.forEach((q) => {
    const key = q.section ? `Section ${q.section}` : 'General';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(q);
  });

  const toggleExpand = (id) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleDelete = async (id) => {
    setDeleting(id);
    await deletePYQ(id);
    logChange(ENTITY.PYQ_QUESTION, id, ACTION.DELETE_REQUEST, null, 'Admin deleted PYQ question');
    setRows((r) => r.filter((q) => q.id !== id));
    setDeleting(null);
  };

  const handlePublish = async () => {
    if (!displayed.length) return;
    const title = `${examFilter !== 'All' ? examFilter : displayed[0]?.exam_type ?? 'Exam'} · ${subjFilter !== 'All' ? subjFilter : 'All Subjects'} · PYQ Paper`;
    const examType = examFilter !== 'All' ? examFilter : (displayed[0]?.exam_type ?? 'CBSE');
    const subject  = subjFilter !== 'All' ? subjFilter : 'Mixed';
    const dur      = Math.ceil(displayed.length * 2); // 2 min per question
    setPublishing(true);
    try {
      await publishPYQPaper({ title, examType, subject, durationMinutes: dur, pyqRows: displayed });
      setPublishMsg(`✓ Published "${title}" as a test — find it in Exam Center`);
    } catch (e) {
      setPublishMsg(`Error: ${e.message}`);
    }
    setPublishing(false);
    setTimeout(() => setPublishMsg(''), 6000);
  };

  const SECTION_COLORS = {
    'Section A': 'text-blue-400 bg-blue-900/20 border-blue-700/30',
    'Section B': 'text-violet-400 bg-violet-900/20 border-violet-700/30',
    'Section C': 'text-emerald-400 bg-emerald-900/20 border-emerald-700/30',
    'Section D': 'text-orange-400 bg-orange-900/20 border-orange-700/30',
    'Section E': 'text-red-400 bg-red-900/20 border-red-700/30',
    'General':   'text-slate-400 bg-slate-800 border-white/5',
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatChip label="Total Questions" value={rows.length} color="text-violet-400" />
        <StatChip label="Exam Types"  value={allExams.length - 1} />
        <StatChip label="Subjects"    value={allSubjects.length - 1} />
        <StatChip label="Sections"    value={Object.keys(grouped).length} />
      </div>

      {/* Filters + search */}
      <div className="bg-slate-800 border border-white/5 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search size={13} className="text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder="Search question text…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
          />
          {search && <button onClick={() => setSearch('')}><X size={13} className="text-slate-500" /></button>}
          <button onClick={load} className="text-primary-400 hover:text-primary-300">
            <RefreshCw size={13} />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Exam</p>
          <div className="flex flex-wrap gap-1.5">
            {allExams.map((e) => <Pill key={e} label={e} active={examFilter === e} onClick={() => setExamFilter(e)} />)}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Subject</p>
          <div className="flex flex-wrap gap-1.5">
            {allSubjects.map((s) => <Pill key={s} label={s} active={subjFilter === s} onClick={() => setSubjFilter(s)} />)}
          </div>
        </div>
      </div>

      {/* Publish button */}
      {displayed.length > 0 && (
        <div className="flex items-center gap-3">
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold disabled:opacity-50 transition-colors"
          >
            {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Publish {displayed.length} questions as test
          </button>
          {publishMsg && (
            <span className={`text-xs font-medium ${publishMsg.startsWith('✓') ? 'text-emerald-400' : 'text-red-400'}`}>
              {publishMsg}
            </span>
          )}
        </div>
      )}

      {/* Question list grouped by section */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Loading questions…
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-slate-800 border border-white/5 rounded-2xl p-8 text-center">
          <p className="text-slate-400 text-sm">No questions found. Upload a question paper first.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([section, qs]) => (
            <div key={section} className="space-y-2">
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border w-fit ${SECTION_COLORS[section] ?? SECTION_COLORS['General']}`}>
                <span className="text-xs font-bold">{section}</span>
                <span className="text-[10px] opacity-70">· {qs.length} questions</span>
              </div>

              {qs.map((q) => {
                const isOpen = expanded.has(q.id);
                return (
                  <div key={q.id} className="bg-slate-800 border border-white/5 rounded-xl overflow-hidden">
                    <button
                      onClick={() => toggleExpand(q.id)}
                      className="w-full text-left px-4 py-3 flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {q.question_type && q.question_type !== 'MCQ' && (
                            <span className="text-[9px] font-bold text-violet-400 bg-violet-900/30 px-1.5 py-0.5 rounded">{q.question_type}</span>
                          )}
                          {q.marks && (
                            <span className="text-[9px] font-bold text-amber-400 bg-amber-900/20 px-1.5 py-0.5 rounded">[{q.marks} mark{q.marks > 1 ? 's' : ''}]</span>
                          )}
                          {q.chapter && (
                            <span className="text-[9px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">{q.chapter}</span>
                          )}
                          {q.year && (
                            <span className="text-[9px] text-slate-600">{q.year}</span>
                          )}
                        </div>
                        <p className="text-sm text-slate-200 leading-snug line-clamp-2">{q.question_text}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(q.id); }}
                          disabled={deleting === q.id}
                          className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                        >
                          {deleting === q.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        </button>
                        {isOpen ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                      </div>
                    </button>

                    <AnimatePresence>
                      {isOpen && (
                        <motion.div
                          initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                            {/* Full question */}
                            <p className="text-sm text-white leading-relaxed">{q.question_text}</p>

                            {/* Options */}
                            {Array.isArray(q.options) && q.options.length > 0 && (
                              <div className="space-y-1.5">
                                {q.options.map((opt, i) => {
                                  const letter = ['A','B','C','D'][i] ?? String(i);
                                  const isCorrect = q.correct_answer?.toUpperCase() === letter;
                                  return (
                                    <div key={i} className={`text-xs flex items-start gap-2 px-2.5 py-1.5 rounded-lg ${isCorrect ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/30' : 'text-slate-400'}`}>
                                      <span className="font-bold shrink-0">{letter}.</span>
                                      <span>{String(opt).replace(/^[A-D]\.\s*/, '')}</span>
                                      {isCorrect && <CheckCircle2 size={11} className="text-emerald-400 shrink-0 ml-auto" />}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Correct answer (non-MCQ) */}
                            {q.correct_answer && (!Array.isArray(q.options) || !q.options.length) && (
                              <div className="text-xs text-emerald-400 bg-emerald-900/20 border border-emerald-700/30 px-3 py-2 rounded-lg">
                                <span className="font-bold">Answer: </span>{q.correct_answer}
                              </div>
                            )}

                            {/* Explanation */}
                            {q.explanation && (
                              <div className="text-xs text-slate-400 bg-slate-900/50 px-3 py-2 rounded-lg">
                                <span className="font-bold text-slate-300">Explanation: </span>{q.explanation}
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Knowledge Base tab ──────────────────────────────────── */
function KnowledgeBaseViewer() {
  const [chunks,        setChunks]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [subjFilter,    setSubjFilter]    = useState('All');
  const [examTagFilter, setExamTagFilter] = useState('All');
  const [search,        setSearch]        = useState('');
  const [deleting,      setDeleting]      = useState(null);

  const load = async () => {
    setLoading(true);
    const data = await fetchKB({ subject: subjFilter, examTag: examTagFilter, search });
    setChunks(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [subjFilter, examTagFilter]);

  const allSubjects = ['All', ...new Set(chunks.map((c) => c.subject).filter(Boolean))];
  const allExamTags = ['All', ...new Set(
    chunks.flatMap((c) => (c.tags ?? []).filter((t) => EXAM_TAG_RE.test(t)))
  )];

  const displayed = search.trim()
    ? chunks.filter((c) => c.content?.toLowerCase().includes(search.toLowerCase())
        || (c.tags ?? []).some((t) => t.toLowerCase().includes(search.toLowerCase())))
    : chunks;

  const handleDelete = async (id) => {
    setDeleting(id);
    await deleteKBChunk(id);
    logChange(ENTITY.CONTENT_ITEM, id, ACTION.DELETE_REQUEST, null, 'Admin deleted KB chunk');
    setChunks((c) => c.filter((x) => x.id !== id));
    setDeleting(null);
  };

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatChip label="Total Chunks"   value={chunks.length}           color="text-emerald-400" />
        <StatChip label="Subjects"       value={allSubjects.length - 1}  />
        <StatChip label="Exam / Classes" value={allExamTags.length - 1}  />
        <StatChip label="Shown"          value={displayed.length}        />
      </div>

      {/* Filter + search */}
      <div className="bg-slate-800 border border-white/5 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Search size={13} className="text-slate-500 shrink-0" />
          <input
            type="text"
            placeholder="Search content or tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
          />
          {search && <button onClick={() => setSearch('')}><X size={13} className="text-slate-500" /></button>}
          <button onClick={load} className="text-primary-400 hover:text-primary-300"><RefreshCw size={13} /></button>
        </div>

        {allExamTags.length > 1 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Exam / Class</p>
            <div className="flex flex-wrap gap-1.5">
              {allExamTags.map((t) => (
                <Pill
                  key={t}
                  label={t === 'All' ? 'All' : prettyExamTag(t)}
                  active={examTagFilter === t}
                  onClick={() => setExamTagFilter(t)}
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Subject</p>
          <div className="flex flex-wrap gap-1.5">
            {allSubjects.map((s) => <Pill key={s} label={s} active={subjFilter === s} onClick={() => setSubjFilter(s)} />)}
          </div>
        </div>
      </div>

      {/* Chunk list */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Loading knowledge base…
        </div>
      ) : displayed.length === 0 ? (
        <div className="bg-slate-800 border border-white/5 rounded-2xl p-8 text-center">
          <p className="text-slate-400 text-sm">No study material found. Upload notes first.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayed.map((chunk, i) => (
            <div key={chunk.id} className="bg-slate-800 border border-white/5 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[9px] text-slate-600 font-mono">#{i + 1}</span>
                  {chunk.subject && (
                    <span className="text-[9px] font-bold text-emerald-400 bg-emerald-900/20 px-1.5 py-0.5 rounded">{chunk.subject}</span>
                  )}
                  {(chunk.tags ?? []).filter((t) => t && !t.startsWith('src:')).map((tag) => (
                    <span key={tag} className="text-[9px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                  {/* Source file */}
                  {(chunk.tags ?? []).find((t) => t?.startsWith('src:')) && (
                    <span className="text-[9px] text-slate-600 flex items-center gap-0.5">
                      <FileText size={8} /> {(chunk.tags ?? []).find((t) => t.startsWith('src:'))?.replace('src:', '')}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => handleDelete(chunk.id)}
                  disabled={deleting === chunk.id}
                  className="p-1.5 rounded-lg text-slate-600 hover:text-red-400 hover:bg-red-900/20 shrink-0"
                >
                  {deleting === chunk.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed line-clamp-4">{chunk.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────── */
export default function AdminContentLibrary() {
  // Note: this key must NOT be 'tab' — AdminHub (the parent hub wrapper this page
  // renders inside) already owns that URL param for its own outer tab selection.
  // Reusing it here meant clicking "Study Notes (KB)" set ?tab=kb, which AdminHub
  // read as "switch to hub-tab id=kb", found no match, and fell back to its first
  // tab (Content Intake) — exactly the "redirects to upload page" bug.
  const [tab, setTab] = useAdminFilter('view', 'pyq');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Content Library</h1>
        <p className="text-slate-400 text-sm mt-1">
          All uploaded question papers and study material
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2 bg-slate-800/50 border border-white/5 rounded-2xl p-1 w-fit">
        {[
          { id: 'pyq',  icon: ClipboardList, label: 'Question Bank (PYQs)' },
          { id: 'kb',   icon: BookOpen,      label: 'Study Notes (KB)'     },
        ].map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              'flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors',
              tab === id ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white',
            ].join(' ')}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'pyq' ? <PYQBank /> : <KnowledgeBaseViewer />}
    </div>
  );
}
