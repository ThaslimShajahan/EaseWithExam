import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ClipboardList, BookOpen, Trash2, ChevronDown, ChevronUp,
  Search, Filter, Loader2, CheckCircle2, AlertTriangle, Send,
  RefreshCw, FileText, X,
} from 'lucide-react';
import { supabase, publishPYQPaper } from '../lib/supabase';
function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { useAdminFilter } from './hooks/useAdminFilter';
import { BOARDS, CLASS_LEVELS } from '../lib/categories';

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

// Board/class filtering happens client-side (see matchesExamSelection in
// KnowledgeBaseViewer) since a board-only or class-only selection is a
// prefix/suffix match over exam_type ("CBSE Class 8"), not an equality test.
async function fetchKB({ subject, search } = {}) {
  let q = supabase.from('knowledge_base')
    .select('id, subject, content, exam_type, chapter, unit, content_type, difficulty, techniques, page_no, figure_url, has_equations, source_ref, created_at')
    .order('created_at', { ascending: false }).limit(1000);
  if (subject) q = q.ilike('subject', subject); // ilike w/ no wildcards = case-insensitive equality
  if (search?.trim()) q = q.ilike('content', `%${search.trim()}%`);
  const { data } = await q;
  return data ?? [];
}

// Board+class combos sort after pure competitive exams, then by board name, then
// numerically by class — so "CBSE Class 8" and "CBSE Class 12" don't scatter
// alphabetically ("Class 12" < "Class 8" as strings).
function sortExamTypes(values) {
  return [...values].sort((a, b) => {
    const am = a.match(/^(.+?)\s+Class\s+(\d+)$/);
    const bm = b.match(/^(.+?)\s+Class\s+(\d+)$/);
    if (am && bm) return am[1] === bm[1] ? Number(am[2]) - Number(bm[2]) : am[1].localeCompare(bm[1]);
    if (am && !bm) return 1;
    if (!am && bm) return -1;
    return a.localeCompare(b);
  });
}

async function deletePYQ(id) {
  const { error } = await supabase.rpc('admin_delete_pyq_rows', {
    p_caller: getCallerUid(), p_ids: [id],
  });
  // Was a bare await with no error check — a refused delete looked identical to
  // a successful one, and the row vanished from the list either way because the
  // caller filters it out locally.
  if (error) throw new Error(error.message);
}

async function deleteKBChunk(id) {
  // knowledge_base no longer accepts a direct delete (20260815020000) —
  // same reason deletePYQ above already goes through an RPC.
  const { error } = await supabase.rpc('admin_delete_knowledge_chunks', {
    p_caller: getCallerUid(), p_ids: [id],
  });
  if (error) throw new Error(error.message);
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

  const [examOptions,    setExamOptions]    = useState(['All']);
  const [filterPairs, setFilterPairs] = useState([]);

  const load = async () => {
    setLoading(true);
    const data = await fetchPYQs({ examType: examFilter, subject: subjFilter, search });
    setRows(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [examFilter, subjFilter]);

  // Filter pill options come from the FULL dataset, fetched once — never from
  // the currently-filtered `rows`, or picking one exam type would hide every
  // other exam pill and make the filter impossible to change.
  useEffect(() => {
    supabase.from('pyq_questions').select('exam_type, subject').neq('question_type', 'KB_NOTE').limit(5000)
      .then(({ data }) => {
        const pairs = (data ?? []).filter((r) => r.exam_type || r.subject);
        setFilterPairs(pairs);
        setExamOptions(['All', ...sortExamTypes(new Set(pairs.map((r) => r.exam_type).filter(Boolean)))]);
      });
  }, []);

  const allExams = examOptions;

  /* SUBJECT options are scoped by the selected exam type; EXAM options are NOT
   * scoped by the selected subject. That asymmetry is the whole fix.
   *
   * Both lists used to come from the entire corpus, so selecting Class 8
   * offered "Biotechnology" — a Class 11 subject with 369 chunks, correctly
   * tagged, that simply has nothing to do with Class 8. The data was never
   * mis-tagged; the pill list just was not scoped.
   *
   * Scoping BOTH directions is the trap the original comment was avoiding:
   * once a subject is picked, cross-filtering the exam pills would strand you
   * on that combination with no way back. Keeping the exam axis unscoped means
   * changing class is always possible, and the subject list then follows it. */
  const allSubjects = useMemo(() => {
    const inScope = examFilter === 'All'
      ? filterPairs
      : filterPairs.filter((r) => r.exam_type === examFilter);
    return ['All', ...[...new Set(inScope.map((r) => r.subject).filter(Boolean))].sort()];
  }, [filterPairs, examFilter]);

  /* A subject that just went out of scope must not stay silently applied — it
   * would filter every row away and read as "no content" rather than "wrong
   * filter". Reset to All when the selected subject is not offered any more. */
  useEffect(() => {
    if (subjFilter !== 'All' && filterPairs.length && !allSubjects.includes(subjFilter)) {
      setSubjFilter('All');
    }
  }, [allSubjects, subjFilter, filterPairs.length]);

  // Decompose the flat examFilter string ("CBSE Class 8", "NEET", …) into
  // separate board/class/competitive picks so they can be filtered independently
  // instead of one long mixed pill list.
  const parseExam = (et) => {
    if (!et || et === 'All') return { board: null, cls: null, competitive: null };
    const combo = et.match(/^(.+?)\s+Class\s+(\d+)$/);
    if (combo) return { board: combo[1], cls: combo[2], competitive: null };
    if (BOARDS.includes(et)) return { board: et, cls: null, competitive: null };
    return { board: null, cls: null, competitive: et };
  };
  const parsedExam = parseExam(examFilter);
  const competitiveExams = allExams.filter((e) => e !== 'All' && !parseExam(e).board);

  const pickCompetitive = (e) => setExamFilter(examFilter === e ? 'All' : e);
  const pickBoard = (b) => {
    if (parsedExam.board === b) { setExamFilter('All'); return; }
    setExamFilter(parsedExam.cls ? `${b} Class ${parsedExam.cls}` : b);
  };
  const pickClass = (cl) => {
    if (parsedExam.cls === cl) { setExamFilter(parsedExam.board ?? 'All'); return; }
    setExamFilter(parsedExam.board ? `${parsedExam.board} Class ${cl}` : `Class ${cl}`);
  };

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
      await publishPYQPaper({ title, examType, subject, durationMinutes: dur, pyqRows: displayed, callerUid: getCallerUid() });
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

        {examFilter !== 'All' && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Filtering:</span>
            <span className="text-[10px] font-bold text-primary-400">{examFilter}</span>
            <button onClick={() => setExamFilter('All')} className="text-[10px] text-slate-500 hover:text-white underline">clear</button>
          </div>
        )}

        {competitiveExams.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Competitive Exam</p>
            <div className="flex flex-wrap gap-1.5">
              {competitiveExams.map((e) => <Pill key={e} label={e} active={examFilter === e} onClick={() => pickCompetitive(e)} />)}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Board</p>
          <div className="flex flex-wrap gap-1.5">
            {BOARDS.map((b) => <Pill key={b} label={b} active={parsedExam.board === b} onClick={() => pickBoard(b)} />)}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Class</p>
          <div className="flex flex-wrap gap-1.5">
            {CLASS_LEVELS.map((cl) => <Pill key={cl} label={`Class ${cl}`} active={parsedExam.cls === cl} onClick={() => pickClass(cl)} />)}
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
  const [search,        setSearch]        = useState('');
  const [deleting,      setDeleting]      = useState(null);

  // Board/Class/Competitive are tracked independently. exam_type is stored in
  // display form ("CBSE Class 8", "NEET"), never a bare board on its own, so
  // picking a board alone must prefix-match across every class of that board
  // rather than look up a single value that would never exist.
  const [boardSel,       setBoardSel]       = useState(null);
  const [clsSel,         setClsSel]         = useState(null);
  const [competitiveSel, setCompetitiveSel] = useState(null);

  const [kbPairs, setKbPairs] = useState([]);
  const [examTagOptions, setExamTagOptions] = useState(['All']);

  const load = async () => {
    setLoading(true);
    const data = await fetchKB({ subject: subjFilter === 'All' ? null : subjFilter, search });
    setChunks(data);
    setLoading(false);
  };

  useEffect(() => { load(); }, [subjFilter]);

  // Same fix as PYQBank — options must come from the full dataset, not the
  // currently-filtered `chunks`, or picking a filter hides the other pills.
  // Subject casing is inconsistent across sources ("Hindi" vs "hindi") —
  // dedupe case-insensitively so it doesn't split into two useless pills.
  useEffect(() => {
    supabase.from('knowledge_base').select('subject, exam_type').limit(5000).then(({ data }) => {
      const subjByKey = new Map();
      (data ?? []).forEach((c) => {
        if (!c.subject) return;
        const key = c.subject.toLowerCase();
        const existing = subjByKey.get(key);
        if (!existing || (/^[a-z]/.test(existing) && /^[A-Z]/.test(c.subject))) subjByKey.set(key, c.subject);
      });
      setKbPairs((data ?? []).filter((c) => c.subject || c.exam_type));
      setExamTagOptions(['All', ...sortExamTypes(new Set(
        (data ?? []).map((c) => c.exam_type).filter(Boolean)
      ))]);
    });
  }, []);

  const allExamTags = examTagOptions;
  const competitiveTags = allExamTags.filter((t) => t !== 'All' && !/\sClass\s\d+$/i.test(t));

  const pickCompetitiveTag = (t) => {
    setBoardSel(null); setClsSel(null);
    setCompetitiveSel((prev) => (prev === t ? null : t));
  };
  const pickBoard = (b) => { setCompetitiveSel(null); setBoardSel((prev) => (prev === b ? null : b)); };
  const pickClass = (cl) => { setCompetitiveSel(null); setClsSel((prev) => (prev === cl ? null : cl)); };
  const clearExamFilter = () => { setBoardSel(null); setClsSel(null); setCompetitiveSel(null); };

  const hasExamFilter = !!(boardSel || clsSel || competitiveSel);
  const examFilterLabel = competitiveSel
    || (boardSel && clsSel ? `${boardSel} Class ${clsSel}`
    : boardSel ? `${boardSel} (any class)`
    : clsSel ? `Class ${clsSel} (any board)`
    : null);

  // Matches against the exam_type column directly. This previously reconstructed
  // the same decision from a mixed tags[] array via examTypeToTag round-trips.
  function matchesExamSelection(examType) {
    if (!hasExamFilter) return true;
    const e = examType ?? '';
    if (competitiveSel) return e === competitiveSel;
    if (boardSel && clsSel) return e === `${boardSel} Class ${clsSel}`;
    if (boardSel) return e.startsWith(`${boardSel} Class `);
    if (clsSel) return new RegExp(`\\sClass\\s${clsSel}$`, 'i').test(e);
    return true;
  }

  /* Same asymmetry as PYQBank: subjects scoped by the selected exam, exam pills
   * never scoped by subject. Without this, selecting Class 8 offered Class 11
   * subjects like Biotechnology. Case-insensitive dedupe is retained — "Hindi"
   * and "hindi" both occur and would otherwise split into two useless pills.
   *
   * Scoping goes through matchesExamSelection rather than comparing exam_type
   * to a single filter value, because this view selects an exam as three
   * independent pills (board, class, competitive) and no single value exists to
   * compare against. It therefore has to sit BELOW that function: the matcher
   * closes over hasExamFilter, which is a const declared further down, so
   * calling it from higher up hits the temporal dead zone. */
  const allSubjects = useMemo(() => {
    const byKey = new Map();
    for (const c of kbPairs) {
      if (!c.subject || !matchesExamSelection(c.exam_type)) continue;
      const key = c.subject.toLowerCase();
      const existing = byKey.get(key);
      if (!existing || (/^[a-z]/.test(existing) && /^[A-Z]/.test(c.subject))) byKey.set(key, c.subject);
    }
    return ['All', ...[...byKey.values()].sort()];
    // Depends on the three selection pills, not on matchesExamSelection: that
    // function is rebuilt every render and listing it would defeat the memo.
  }, [kbPairs, boardSel, clsSel, competitiveSel]);

  const displayed = chunks.filter((c) => {
    const term = search.trim().toLowerCase();
    const matchSearch = !term ||
      c.content?.toLowerCase().includes(term) ||
      c.chapter?.toLowerCase().includes(term) ||
      (c.techniques ?? []).some((t) => t.toLowerCase().includes(term));
    return matchSearch && matchesExamSelection(c.exam_type);
  });

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
            placeholder="Search content, chapter or technique…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
          />
          {search && <button onClick={() => setSearch('')}><X size={13} className="text-slate-500" /></button>}
          <button onClick={load} className="text-primary-400 hover:text-primary-300"><RefreshCw size={13} /></button>
        </div>

        {hasExamFilter && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Filtering:</span>
            <span className="text-[10px] font-bold text-primary-400">{examFilterLabel}</span>
            <button onClick={clearExamFilter} className="text-[10px] text-slate-500 hover:text-white underline">clear</button>
          </div>
        )}

        {competitiveTags.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Competitive Exam</p>
            {/* exam_type is already display form ("NEET") — no tag prettifying needed */}
            <div className="flex flex-wrap gap-1.5">
              {competitiveTags.map((t) => (
                <Pill key={t} label={t} active={competitiveSel === t} onClick={() => pickCompetitiveTag(t)} />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Board</p>
          <div className="flex flex-wrap gap-1.5">
            {BOARDS.map((b) => <Pill key={b} label={b} active={boardSel === b} onClick={() => pickBoard(b)} />)}
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold text-slate-500 uppercase">Class</p>
          <div className="flex flex-wrap gap-1.5">
            {CLASS_LEVELS.map((cl) => <Pill key={cl} label={`Class ${cl}`} active={clsSel === cl} onClick={() => pickClass(cl)} />)}
          </div>
        </div>

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
          <p className="text-slate-400 text-sm">
            {chunks.length === 0
              ? 'No study material found. Upload notes first.'
              : 'No chunks match this filter combination.'}
          </p>
          {chunks.length > 0 && (hasExamFilter || subjFilter !== 'All') && (
            <button onClick={() => { clearExamFilter(); setSubjFilter('All'); }} className="mt-2 text-xs text-primary-400 hover:underline">
              Clear filters
            </button>
          )}
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
                  {chunk.exam_type && (
                    <span className="text-[9px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">{chunk.exam_type}</span>
                  )}
                  {/* Unit before chapter, reading as "Unit 1: Wit and Wisdom >
                      A Concrete Example". The column was already selected here
                      but never rendered, so a chapter's grouping was invisible
                      in the one screen used to audit what actually loaded. */}
                  {chunk.unit && (
                    <span className="text-[9px] text-sky-300 bg-sky-900/30 px-1.5 py-0.5 rounded">{chunk.unit}</span>
                  )}
                  {chunk.chapter && (
                    <span className="text-[9px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded">{chunk.chapter}</span>
                  )}
                  {chunk.content_type && (
                    <span className="text-[9px] font-bold text-violet-300 bg-violet-900/30 px-1.5 py-0.5 rounded">
                      {chunk.content_type.replace(/_/g, ' ')}
                    </span>
                  )}
                  {chunk.difficulty && (
                    <span className="text-[9px] text-amber-300 bg-amber-900/25 px-1.5 py-0.5 rounded">{chunk.difficulty}</span>
                  )}
                  {chunk.has_equations && (
                    <span className="text-[9px] text-sky-300 bg-sky-900/25 px-1.5 py-0.5 rounded">LaTeX</span>
                  )}
                  {chunk.figure_url && (
                    <a href={chunk.figure_url} target="_blank" rel="noopener noreferrer"
                      className="text-[9px] text-emerald-300 bg-emerald-900/25 px-1.5 py-0.5 rounded hover:underline">
                      figure
                    </a>
                  )}
                  {(chunk.techniques ?? []).slice(0, 3).map((t) => (
                    <span key={t} className="text-[9px] text-slate-500 bg-slate-900 px-1.5 py-0.5 rounded">{t.replace(/_/g, ' ')}</span>
                  ))}
                  {/* Source file — now a real jsonb field rather than a "src:" tag */}
                  {chunk.source_ref?.source && (
                    <span className="text-[9px] text-slate-600 flex items-center gap-0.5">
                      <FileText size={8} /> {chunk.source_ref.source}
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
