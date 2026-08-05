import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpenText, ChevronDown, ChevronRight, Plus, Pencil, Trash2,
  Save, X, RefreshCw, CheckCircle2, Search, Zap, AlertTriangle,
  ArrowRight, Hash, GripVertical, Tag, Database, Sparkles, Check, Loader2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { getSyllabus as getSyllabusJS } from '../lib/syllabusData';
import { chatComplete } from '../lib/aiProxy';
import TabRow from '../components/admin/TabRow';
import { BOARDS, CLASS_LEVELS, CATEGORIES } from '../lib/categories';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

/* ── Exam configuration ──────────────────────────────────────────
 * Derived from the admin-editable category catalog (Admin > Platform >
 * Categories) instead of a hardcoded list — otherwise a board or competitive
 * exam added there never gets a tab here to add syllabus chapters for. */

const EXAM_TABS = [
  ...BOARDS.map((b) => ({ key: b, label: CATEGORIES[b]?.label ?? b, isBoard: true })),
  ...Object.entries(CATEGORIES)
    .filter(([, v]) => v.type === 'competitive')
    .map(([key, v]) => ({ key, label: v.label, isBoard: false })),
];

// Exam types that have hardcoded seed data in syllabusData.js
const SEEDABLE_EXAMS = new Set(['NEET', 'JEE Main', 'JEE Advanced']);

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// The stored exam_type key: for boards, combines board + class; for competitive, uses exact key.
// This MUST match what student app queries via getAllChapters(buildExamType(profile)).
function getDbExamType(examTab, classLevel) {
  const tab = EXAM_TABS.find((t) => t.key === examTab);
  if (tab?.isBoard && classLevel) return `${examTab} Class ${classLevel}`;
  return examTab;
}

/* ── Auto-fill sources: scan uploaded content, or ask AI ──────── */

// Distinct chapter names already tagged on uploaded PYQs for this exam+subject —
// lets an admin bulk-add chapters that already have content instead of typing
// every chapter name by hand.
async function fetchChaptersFromContent(examTab, dbExamType, subject) {
  const examCandidates = [...new Set([examTab, dbExamType])];
  const { data, error } = await supabase
    .from('pyq_questions')
    .select('chapter')
    .eq('subject', subject)
    .in('exam_type', examCandidates)
    .not('chapter', 'is', null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.chapter?.trim()).filter(Boolean);
}

// Asks AI for the standard textbook/exam chapter list — same idea as the
// existing "Seed NCERT Data" button, but works for any board+class+subject
// instead of only the three exams with hardcoded seed data.
async function fetchChaptersFromAI(dbExamType, subject) {
  const res = await chatComplete({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 700,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: `List the standard chapter/unit names for the ${dbExamType} ${subject} syllabus, in the order they are normally taught. Use the official NCERT/board textbook chapter titles where applicable.

Return ONLY JSON: {"chapters": ["...", "..."]}`,
    }],
  });
  const parsed = JSON.parse(res.choices[0].message.content);
  return Array.isArray(parsed.chapters) ? parsed.chapters.map((c) => String(c).trim()).filter(Boolean) : [];
}

/* ── Subtopics chip input ────────────────────────────────────── */

function SubtopicsInput({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const tags = Array.isArray(value) ? value : [];

  function add() {
    const name = draft.trim();
    if (!name || tags.find((t) => t.name === name)) return;
    onChange([...tags, { key: slugify(name), name }]);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Subtopics (optional)</p>
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {tags.map((t, i) => (
          <span key={i} className="flex items-center gap-1 bg-primary-900/40 border border-primary-700/40 text-primary-300 text-[11px] px-2 py-0.5 rounded-full">
            {t.name}
            <button type="button" onClick={() => onChange(tags.filter((_, idx) => idx !== i))} className="hover:text-red-400 ml-0.5">
              <X size={9} />
            </button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[11px] text-slate-600 italic">None</span>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 text-sm bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder="Add subtopic and press Enter…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add}
          className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-700 font-medium">
          Add
        </button>
      </div>
    </div>
  );
}

/* ── Chapter slide-in panel ──────────────────────────────────── */

function ChapterPanel({ open, exam, subject, classLevel, existing, onSave, onClose, callerUid }) {
  const isEdit = !!existing;
  const [name,       setName]       = useState('');
  const [key,        setKey]        = useState('');
  const [order,      setOrder]      = useState(1);
  const [subtopics,  setSubtopics]  = useState([]);
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');
  const [autoKey,    setAutoKey]    = useState(true);

  useEffect(() => {
    if (open) {
      setName(existing?.chapter_name ?? '');
      setKey(existing?.chapter_key  ?? '');
      setOrder(existing?.sort_order  ?? 1);
      setSubtopics(existing?.subtopics ?? []);
      setError('');
      setAutoKey(!existing);
    }
  }, [open, existing]);

  function buildAutoKey(n) {
    const prefix = classLevel ? `c${classLevel}_` : '';
    return prefix + slugify(n);
  }

  function handleNameChange(n) {
    setName(n);
    if (autoKey) setKey(buildAutoKey(n));
  }

  async function handleSave() {
    if (!name.trim()) { setError('Chapter name is required.'); return; }
    const finalKey = key.trim() || buildAutoKey(name);
    setSaving(true); setError('');
    try {
      const dbExamType = getDbExamType(exam, classLevel);
      const { data, error: err } = await supabase.rpc('admin_upsert_syllabus_node', {
        p_caller:       callerUid,
        p_exam_type:    dbExamType,
        p_subject:      subject,
        p_chapter_name: name.trim(),
        p_chapter_key:  finalKey,
        p_class_level:  classLevel || null,
        p_sort_order:   Number(order) || 1,
        p_subtopics:    subtopics,
        p_id:           existing?.id ?? null,
      });
      if (err) throw err;
      logChange(
        ENTITY.SYLLABUS_NODE,
        data?.[0]?.id ?? existing?.id ?? finalKey,
        existing ? ACTION.UPDATE : ACTION.CREATE,
        { after: { chapter_name: name.trim(), chapter_key: finalKey, exam: dbExamType, subject } },
        `Admin ${existing ? 'updated' : 'created'} syllabus chapter: ${name.trim()}`,
      );
      onSave();
    } catch (e) {
      setError(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed right-0 top-0 h-full w-full max-w-md bg-slate-900 border-l border-white/10 z-50 flex flex-col shadow-2xl"
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div>
                <h3 className="font-bold text-white">{isEdit ? 'Edit Chapter' : 'Add Chapter'}</h3>
                <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <Tag size={10} />{exam}{classLevel ? ` Class ${classLevel}` : ''} <ArrowRight size={10} /> {subject}
                </p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Panel body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block">Chapter Name *</label>
                <input
                  autoFocus
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g. Real Numbers"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block">Chapter Key</label>
                  {!isEdit && (
                    <button
                      onClick={() => setAutoKey((a) => !a)}
                      className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${autoKey ? 'bg-primary-900/50 text-primary-400' : 'bg-slate-700 text-slate-400'}`}
                    >
                      {autoKey ? 'Auto' : 'Manual'}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Hash size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    className="w-full bg-slate-800 border border-white/10 rounded-xl pl-8 pr-4 py-2.5 text-slate-300 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    value={key}
                    onChange={(e) => { setKey(e.target.value); setAutoKey(false); }}
                    placeholder={buildAutoKey(name || 'chapter_name')}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide block">Sort Order</label>
                <input
                  type="number" min={1}
                  className="w-24 bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                />
              </div>

              <SubtopicsInput value={subtopics} onChange={setSubtopics} />

              {error && (
                <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/30 rounded-xl px-4 py-3">
                  <AlertTriangle size={14} className="text-red-400 shrink-0" />
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}
            </div>

            {/* Panel footer */}
            <div className="p-6 border-t border-white/10 flex gap-3">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : isEdit ? 'Update' : 'Add Chapter'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Auto-fill review modal (fetch-from-content OR AI-generate) ─ */

function ChapterSuggestModal({ open, mode, exam, dbExamType, classLevel, subject, existingNames, onClose, onInserted }) {
  const [loading,   setLoading]   = useState(false);
  const [inserting, setInserting] = useState(false);
  const [candidates,setCandidates]= useState([]); // [{ name, checked }]
  const [error,     setError]     = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCandidates([]); setError(''); setLoading(true);
    (async () => {
      try {
        const names = mode === 'content'
          ? await fetchChaptersFromContent(exam, dbExamType, subject)
          : await fetchChaptersFromAI(dbExamType, subject);
        const existing = new Set(existingNames.map((n) => n.toLowerCase()));
        const fresh = [...new Set(names)].filter((n) => n && !existing.has(n.toLowerCase()));
        if (cancelled) return;
        setCandidates(fresh.map((name) => ({ name, checked: true })));
        if (!fresh.length) {
          setError(mode === 'content'
            ? 'No new chapter names found in uploaded PYQs for this subject — they may not be tagged with a chapter yet.'
            : 'AI did not return any usable chapters. Try again.');
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to fetch suggestions.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, mode, exam, dbExamType, subject]);

  function toggle(i) {
    setCandidates((cs) => cs.map((c, idx) => idx === i ? { ...c, checked: !c.checked } : c));
  }

  async function handleInsert() {
    const chosen = candidates.filter((c) => c.checked).map((c) => c.name);
    if (!chosen.length) return;
    setInserting(true); setError('');
    try {
      const baseOrder = existingNames.length;
      const rows = chosen.map((name, i) => ({
        exam_type:    dbExamType,
        subject,
        chapter_key:  (classLevel ? `c${classLevel}_` : '') + slugify(name),
        chapter_name: name,
        class_level:  classLevel || null,
        sort_order:   baseOrder + i + 1,
        is_active:    true,
        subtopics:    [],
      }));
      // syllabus_nodes has no unique constraint on (exam_type, chapter_key), so
      // ON CONFLICT upsert isn't usable — dedupe client-side against keys that
      // already exist for this exam_type, then plain insert.
      const { data: existingKeyRows } = await supabase
        .from('syllabus_nodes')
        .select('chapter_key')
        .eq('exam_type', dbExamType);
      const existingKeys = new Set((existingKeyRows ?? []).map((r) => r.chapter_key));
      const freshRows = rows.filter((r) => !existingKeys.has(r.chapter_key));
      if (!freshRows.length) {
        setError('These chapters already exist for this exam type.');
        setInserting(false);
        return;
      }
      const { error: err } = await supabase.from('syllabus_nodes').insert(freshRows);
      if (err) throw err;
      logChange(ENTITY.SYLLABUS_NODE, subject, ACTION.CREATE,
        { after: { subject, count: freshRows.length, source: mode } },
        `Admin bulk-added ${freshRows.length} chapters to ${subject} (${mode === 'content' ? 'from uploaded content' : 'AI-generated'})`);
      onInserted(freshRows.length);
    } catch (e) {
      setError('Insert failed: ' + e.message);
    } finally {
      setInserting(false);
    }
  }

  const checkedCount = candidates.filter((c) => c.checked).length;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
            className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] flex flex-col"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  {mode === 'content' ? <Database size={15} className="text-primary-400" /> : <Sparkles size={15} className="text-violet-400" />}
                  {mode === 'content' ? 'Fetch from Content' : 'Generate with AI'}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">{subject} · {dbExamType}</p>
              </div>
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-500">
                  <Loader2 size={20} className="animate-spin" />
                  <p className="text-xs">{mode === 'content' ? 'Scanning uploaded content…' : 'Asking AI…'}</p>
                </div>
              ) : error && !candidates.length ? (
                <p className="text-sm text-slate-400 text-center py-8">{error}</p>
              ) : (
                candidates.map((c, i) => (
                  <label key={c.name} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 cursor-pointer transition-colors">
                    <div
                      onClick={(e) => { e.preventDefault(); toggle(i); }}
                      className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        c.checked ? 'bg-primary-600 border-primary-600' : 'border-white/20'
                      }`}
                    >
                      {c.checked && <Check size={12} className="text-white" />}
                    </div>
                    <span className="text-sm text-slate-200">{c.name}</span>
                  </label>
                ))
              )}
              {error && candidates.length > 0 && (
                <p className="text-xs text-red-400 px-3">{error}</p>
              )}
            </div>

            {!loading && candidates.length > 0 && (
              <div className="p-5 border-t border-white/10 flex gap-3">
                <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleInsert}
                  disabled={inserting || checkedCount === 0}
                  className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {inserting ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                  {inserting ? 'Adding…' : `Add ${checkedCount} Chapter${checkedCount === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ── Chapter row ─────────────────────────────────────────────── */

function ChapterRow({ chapter, index, onEdit, onDelete }) {
  const subtopics = Array.isArray(chapter.subtopics) ? chapter.subtopics : [];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      className="group flex items-start gap-3 px-4 py-3 hover:bg-white/5 rounded-xl transition-colors"
    >
      <GripVertical size={14} className="text-slate-700 group-hover:text-slate-500 mt-0.5 shrink-0 cursor-grab" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-600 w-5 text-right shrink-0">{index + 1}</span>
          <p className="text-sm font-medium text-slate-200 truncate">{chapter.chapter_name}</p>
        </div>
        <p className="text-[10px] text-slate-600 font-mono mt-0.5 pl-7">#{chapter.chapter_key}</p>
        {subtopics.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5 pl-7">
            {subtopics.map((s, i) => (
              <span key={i} className="text-[10px] bg-slate-800 border border-white/5 text-slate-400 px-1.5 py-0.5 rounded">
                {s.name}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={() => onEdit(chapter)} className="p-1.5 hover:bg-primary-900/50 text-primary-400 rounded-lg transition-colors" title="Edit">
          <Pencil size={12} />
        </button>
        <button onClick={() => onDelete(chapter)} className="p-1.5 hover:bg-red-900/50 text-red-400 rounded-lg transition-colors" title="Delete">
          <Trash2 size={12} />
        </button>
      </div>
    </motion.div>
  );
}

/* ── Subject section ─────────────────────────────────────────── */

function SubjectSection({
  subject, chapters, exam, classLevel, onAddChapter, onEditChapter, onDeleteChapter,
  onFetchContent, onGenerateAI, onRenameSubject, onDeleteSubject, defaultOpen,
}) {
  const [open,     setOpen]     = useState(defaultOpen ?? chapters.length > 0);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft,setNameDraft]= useState(subject);

  function confirmRename() {
    const n = nameDraft.trim();
    setRenaming(false);
    if (n && n !== subject) onRenameSubject(subject, n);
    else setNameDraft(subject);
  }

  return (
    <div className="bg-slate-900/60 border border-white/8 rounded-2xl overflow-hidden">
      {/* Subject header */}
      <div className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-white/5 transition-colors group/subj">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
          {open
            ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
            : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
          {renaming ? (
            <input
              autoFocus
              value={nameDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmRename();
                if (e.key === 'Escape') { setRenaming(false); setNameDraft(subject); }
              }}
              onBlur={confirmRename}
              className="bg-slate-800 border border-primary-500/50 rounded-lg px-2 py-0.5 text-sm font-semibold text-white focus:outline-none"
            />
          ) : (
            <span className="font-semibold text-slate-200 text-sm truncate">{subject}</span>
          )}
          <span className="text-[10px] text-slate-500 bg-slate-800 border border-white/5 px-2 py-0.5 rounded-full font-medium shrink-0">
            {chapters.length}
          </span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); setNameDraft(subject); setRenaming(true); }}
            title="Rename subject"
            className="p-1.5 rounded-lg text-slate-500 hover:text-primary-400 hover:bg-primary-900/30 opacity-0 group-hover/subj:opacity-100 transition-all"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDeleteSubject(subject); }}
            title="Delete subject"
            className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/30 opacity-0 group-hover/subj:opacity-100 transition-all"
          >
            <Trash2 size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onFetchContent(subject); }}
            title="Fetch chapters from uploaded content"
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-primary-300 font-semibold px-2 py-1 rounded-lg hover:bg-primary-900/30 transition-colors"
          >
            <Database size={12} /> Fetch
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onGenerateAI(subject); }}
            title="Generate chapters with AI"
            className="flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200 font-semibold px-2 py-1 rounded-lg hover:bg-violet-900/30 transition-colors"
          >
            <Sparkles size={12} /> AI
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onAddChapter(subject); }}
            className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 font-semibold px-2.5 py-1 rounded-lg hover:bg-primary-900/30 transition-colors"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* Chapter list */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-white/5"
          >
            {chapters.length === 0 ? (
              <p className="text-xs text-slate-600 italic px-4 py-4 pl-11">No chapters yet — click Add.</p>
            ) : (
              <div className="py-1.5">
                <AnimatePresence>
                  {chapters.map((ch, i) => (
                    <ChapterRow
                      key={ch.id}
                      chapter={ch}
                      index={i}
                      onEdit={onEditChapter}
                      onDelete={onDeleteChapter}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── New subject input ───────────────────────────────────────── */

function NewSubjectInput({ onConfirm, onCancel }) {
  const [name, setName] = useState('');
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      className="flex gap-2 items-center bg-primary-900/30 border border-primary-700/40 rounded-2xl px-4 py-3"
    >
      <input
        autoFocus
        className="flex-1 text-sm bg-transparent text-white placeholder:text-slate-500 focus:outline-none"
        placeholder="Subject name (e.g. Mathematics)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onConfirm(name.trim());
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button onClick={() => name.trim() && onConfirm(name.trim())}
        className="p-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors">
        <CheckCircle2 size={14} />
      </button>
      <button onClick={onCancel} className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg transition-colors">
        <X size={14} />
      </button>
    </motion.div>
  );
}

/* ── Main page ───────────────────────────────────────────────── */

export default function AdminSyllabus() {
  const callerUid = getCallerUid();

  const [examTab,    setExamTab]    = useState('CBSE');
  const [classLevel, setClassLevel] = useState('10');
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [searchQ,    setSearchQ]    = useState('');
  const [toast,      setToast]      = useState('');

  const [panelOpen,    setPanelOpen]    = useState(false);
  const [panelSubject, setPanelSubject] = useState('');
  const [editingChap,  setEditingChap]  = useState(null);
  const [addingSubject, setAddingSubject] = useState(false);
  const [deleteTarget,  setDeleteTarget] = useState(null);
  const [seeding,       setSeeding]     = useState(false);
  const [oldFormatCount, setOldFormatCount] = useState(0);
  const [migrating, setMigrating] = useState(false);
  const [suggestFor,   setSuggestFor]   = useState(null); // { subject, mode: 'content'|'ai' }
  const [deleteSubjectTarget, setDeleteSubjectTarget] = useState(null); // subject name
  const [pendingNewSubject, setPendingNewSubject] = useState(''); // named but not yet populated

  const examMeta = EXAM_TABS.find((t) => t.key === examTab);
  const isBoard  = examMeta?.isBoard ?? false;
  const dbExamType = getDbExamType(examTab, isBoard ? classLevel : '');

  /* ── Load syllabus nodes ─────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true);
    setOldFormatCount(0);

    // Primary query: new-format combined key (e.g. 'CBSE Class 10')
    let q = supabase
      .from('syllabus_nodes')
      .select('*')
      .eq('exam_type', dbExamType)
      .eq('is_active', true)
      .order('subject')
      .order('sort_order');

    const { data: newData } = await q;
    let result = newData ?? [];

    // Backward compat: old admin stored as exam_type='CBSE' + class_level='10'
    if (result.length === 0 && isBoard && classLevel) {
      const { data: oldData } = await supabase
        .from('syllabus_nodes')
        .select('*')
        .eq('exam_type', examTab)
        .eq('class_level', classLevel)
        .eq('is_active', true)
        .order('subject')
        .order('sort_order');
      if (oldData?.length) {
        result = oldData;
        setOldFormatCount(oldData.length);
      }
    }

    setRows(result);
    setLoading(false);
  }, [dbExamType, examTab, classLevel, isBoard]);

  useEffect(() => { load(); }, [load]);

  /* toast auto-dismiss */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  /* ── Derived data ────────────────────────────────── */
  const subjectMap = useMemo(() => {
    const map = {};
    const src = searchQ.trim().toLowerCase();
    for (const r of rows) {
      const match = !src || r.chapter_name.toLowerCase().includes(src) || r.subject.toLowerCase().includes(src);
      if (!match) continue;
      if (!map[r.subject]) map[r.subject] = [];
      map[r.subject].push(r);
    }
    for (const s of Object.keys(map)) map[s].sort((a, b) => a.sort_order - b.sort_order);
    return map;
  }, [rows, searchQ]);

  const totalSubjects  = Object.keys(subjectMap).length;
  const totalChapters  = Object.values(subjectMap).reduce((s, ch) => s + ch.length, 0);

  /* ── Handlers ────────────────────────────────────── */
  function openAdd(subject) {
    setPanelSubject(subject);
    setEditingChap(null);
    setPanelOpen(true);
  }

  function openEdit(chapter) {
    setPanelSubject(chapter.subject);
    setEditingChap(chapter);
    setPanelOpen(true);
  }

  function handleSaved() {
    setPanelOpen(false);
    setToast(editingChap ? 'Chapter updated.' : 'Chapter added.');
    load();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const { error } = await supabase.rpc('admin_delete_syllabus_node', {
      p_caller: callerUid,
      p_id:     deleteTarget.id,
    });
    if (!error) {
      logChange(ENTITY.SYLLABUS_NODE, deleteTarget.id, ACTION.DELETE_REQUEST,
        { before: { chapter_name: deleteTarget.chapter_name } },
        `Admin deleted chapter: ${deleteTarget.chapter_name}`);
      setRows((r) => r.filter((row) => row.id !== deleteTarget.id));
      setToast('Chapter deleted.');
    }
    setDeleteTarget(null);
  }

  // A brand-new subject has no chapters yet, so it has no SubjectSection row to
  // click Fetch/AI/Add on — ask how to populate it before it exists at all.
  function handleNewSubject(name) {
    setAddingSubject(false);
    setPendingNewSubject(name);
  }

  function openSuggest(subject, mode) {
    setSuggestFor({ subject, mode });
  }

  function handleSuggestInserted(count) {
    setToast(`Added ${count} chapter${count === 1 ? '' : 's'}.`);
    setSuggestFor(null);
    load();
  }

  // Subject "rename" re-upserts every chapter under it via the same authorized
  // RPC used for individual edits, just with a new p_subject — no new SQL needed.
  async function handleRenameSubject(oldName, newName) {
    // Use unfiltered rows, not subjectMap — a search filter must not silently
    // leave some chapters behind under the old subject name.
    const chaptersUnder = rows.filter((r) => r.subject === oldName);
    setToast(`Renaming "${oldName}"…`);
    try {
      for (const ch of chaptersUnder) {
        const { error: err } = await supabase.rpc('admin_upsert_syllabus_node', {
          p_caller:       callerUid,
          p_exam_type:    dbExamType,
          p_subject:      newName,
          p_chapter_name: ch.chapter_name,
          p_chapter_key:  ch.chapter_key,
          p_class_level:  ch.class_level ?? null,
          p_sort_order:   ch.sort_order,
          p_subtopics:    ch.subtopics ?? [],
          p_id:           ch.id,
        });
        if (err) throw err;
      }
      logChange(ENTITY.SYLLABUS_NODE, oldName, ACTION.UPDATE,
        { before: { subject: oldName }, after: { subject: newName } },
        `Admin renamed subject "${oldName}" to "${newName}" (${chaptersUnder.length} chapters)`);
      setToast(`Renamed "${oldName}" to "${newName}".`);
      load();
    } catch (e) {
      setToast(`Rename failed: ${e.message}`);
    }
  }

  // Subject "delete" loops the same per-chapter delete RPC — same reasoning as rename.
  async function confirmDeleteSubject() {
    if (!deleteSubjectTarget) return;
    const chaptersUnder = rows.filter((r) => r.subject === deleteSubjectTarget);
    try {
      for (const ch of chaptersUnder) {
        const { error: err } = await supabase.rpc('admin_delete_syllabus_node', {
          p_caller: callerUid,
          p_id:     ch.id,
        });
        if (err) throw err;
      }
      logChange(ENTITY.SYLLABUS_NODE, deleteSubjectTarget, ACTION.DELETE_REQUEST,
        { count: chaptersUnder.length },
        `Admin deleted subject "${deleteSubjectTarget}" (${chaptersUnder.length} chapters)`);
      setRows((r) => r.filter((row) => row.subject !== deleteSubjectTarget));
      setToast(`Deleted "${deleteSubjectTarget}" and ${chaptersUnder.length} chapters.`);
    } catch (e) {
      setToast(`Delete failed: ${e.message}`);
    }
    setDeleteSubjectTarget(null);
  }

  /* ── Migrate old-format data ─────────────────────── */
  async function migrateOldFormat() {
    setMigrating(true);
    try {
      const { error } = await supabase
        .from('syllabus_nodes')
        .update({ exam_type: dbExamType })
        .eq('exam_type', examTab)
        .eq('class_level', classLevel);
      if (!error) {
        setToast(`Migrated ${oldFormatCount} chapters to new format.`);
        setOldFormatCount(0);
        load();
      }
    } catch {}
    setMigrating(false);
  }

  /* ── Seed from hardcoded syllabusData.js ─────────── */
  async function seedFromHardcoded() {
    if (!SEEDABLE_EXAMS.has(examTab)) return;
    const data = getSyllabusJS(examTab);
    if (!data) return;
    setSeeding(true);

    const rows = [];
    let order  = 0;
    for (const [subject, chapters] of Object.entries(data)) {
      for (const ch of chapters) {
        rows.push({
          exam_type:    examTab,
          subject,
          chapter_key:  ch.key,
          chapter_name: ch.name,
          class_level:  ch.class ?? null,
          sort_order:   ++order,
          is_active:    true,
          subtopics:    [],
        });
      }
    }

    // No unique constraint on (exam_type, chapter_key) in the live schema, so
    // ON CONFLICT upsert isn't usable — dedupe client-side, then plain insert.
    const { data: existingKeyRows } = await supabase
      .from('syllabus_nodes')
      .select('chapter_key')
      .eq('exam_type', examTab);
    const existingKeys = new Set((existingKeyRows ?? []).map((r) => r.chapter_key));
    const freshRows = rows.filter((r) => !existingKeys.has(r.chapter_key));

    if (!freshRows.length) {
      setSeeding(false);
      setToast('All NCERT chapters already seeded for this exam.');
      return;
    }

    const { error } = await supabase.from('syllabus_nodes').insert(freshRows);

    setSeeding(false);
    if (!error) {
      setToast(`Seeded ${freshRows.length} chapters from NCERT data.`);
      load();
    } else {
      setToast(`Seed failed: ${error.message}`);
    }
  }

  /* ── Render ──────────────────────────────────────── */
  return (
    <div className="max-w-5xl space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0 shadow-lg shadow-primary-900/30">
            <BookOpenText size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Syllabus Manager</h1>
            <p className="text-xs text-slate-400 mt-0.5">Chapters added here appear in Flashcards, Practice & Content Intake</p>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-sm font-medium transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Exam tabs */}
      <TabRow
        layoutId="admin-syllabus-exam-underline"
        items={EXAM_TABS.map((t) => ({ key: t.key, label: t.label }))}
        active={examTab}
        onChange={(key) => { setExamTab(key); setSearchQ(''); }}
      />

      {/* Class level chips (board exams only) */}
      {isBoard && (
        <div className="flex gap-1.5 flex-wrap">
          {CLASS_LEVELS.map((cl) => (
            <button
              key={cl}
              onClick={() => setClassLevel(cl)}
              className={[
                'px-3.5 py-1 text-xs font-bold rounded-full border transition-all',
                classLevel === cl
                  ? 'bg-primary-600 border-primary-600 text-white shadow shadow-primary-900/40'
                  : 'border-white/10 text-slate-400 hover:border-primary-500/50 hover:text-primary-300',
              ].join(' ')}
            >
              Class {cl}
            </button>
          ))}
        </div>
      )}

      {/* Old-format migration banner */}
      {oldFormatCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 bg-amber-900/30 border border-amber-500/30 rounded-2xl px-4 py-3"
        >
          <AlertTriangle size={15} className="text-amber-400 shrink-0" />
          <p className="text-sm text-amber-300 flex-1">
            <strong>{oldFormatCount} chapters</strong> stored in old format — students can't see them yet.
          </p>
          <button
            onClick={migrateOldFormat}
            disabled={migrating}
            className="flex items-center gap-1.5 text-xs font-bold bg-amber-500 text-amber-950 px-3 py-1.5 rounded-lg hover:bg-amber-400 transition-colors disabled:opacity-60"
          >
            {migrating ? <RefreshCw size={11} className="animate-spin" /> : null}
            {migrating ? 'Migrating…' : 'Fix Now'}
          </button>
        </motion.div>
      )}

      {/* Stats + actions bar */}
      <div className="flex items-center gap-3 bg-slate-900 border border-white/8 rounded-2xl px-4 py-3">
        {/* Stats */}
        <div className="flex items-center gap-4 text-xs mr-auto">
          <span className="text-slate-400">
            <span className="text-white font-bold text-sm">{totalSubjects}</span> subjects
          </span>
          <span className="text-slate-400">
            <span className="text-white font-bold text-sm">{totalChapters}</span> chapters
          </span>
          <span className="text-slate-600 text-[10px] font-mono bg-slate-800 px-2 py-0.5 rounded-lg">
            {dbExamType}
          </span>
        </div>
        {/* Seed button for NEET/JEE */}
        {SEEDABLE_EXAMS.has(examTab) && (
          <button
            onClick={seedFromHardcoded}
            disabled={seeding}
            className="flex items-center gap-1.5 text-xs font-bold text-violet-300 bg-violet-900/30 border border-violet-700/30 hover:bg-violet-900/50 px-3 py-1.5 rounded-xl transition-colors disabled:opacity-60"
          >
            {seeding ? <RefreshCw size={11} className="animate-spin" /> : <Zap size={11} />}
            {seeding ? 'Seeding…' : 'Seed NCERT Data'}
          </button>
        )}
        <button
          onClick={() => setAddingSubject(true)}
          className="flex items-center gap-1.5 text-xs font-bold text-primary-300 bg-primary-900/30 border border-primary-700/30 hover:bg-primary-900/50 px-3 py-1.5 rounded-xl transition-colors"
        >
          <Plus size={12} /> Add Subject
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search chapters…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          className="w-full bg-slate-900 border border-white/8 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500/50"
        />
        {searchQ && (
          <button onClick={() => setSearchQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
            <X size={13} />
          </button>
        )}
      </div>

      {/* New subject input */}
      <AnimatePresence>
        {addingSubject && (
          <NewSubjectInput onConfirm={handleNewSubject} onCancel={() => setAddingSubject(false)} />
        )}
      </AnimatePresence>

      {/* How to populate the just-named subject — it has no chapters yet, so it
          has no SubjectSection row to click Fetch/AI/Add on. */}
      <AnimatePresence>
        {pendingNewSubject && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex flex-wrap items-center gap-2 bg-primary-900/20 border border-primary-700/30 rounded-2xl px-4 py-3"
          >
            <span className="text-sm text-white font-semibold flex-1 min-w-[160px]">
              "{pendingNewSubject}" — how do you want to add chapters?
            </span>
            <button
              onClick={() => { openSuggest(pendingNewSubject, 'content'); setPendingNewSubject(''); }}
              className="flex items-center gap-1.5 text-xs font-bold text-slate-300 bg-slate-800 border border-white/10 hover:bg-slate-700 px-3 py-1.5 rounded-xl transition-colors"
            >
              <Database size={12} /> Fetch from Content
            </button>
            <button
              onClick={() => { openSuggest(pendingNewSubject, 'ai'); setPendingNewSubject(''); }}
              className="flex items-center gap-1.5 text-xs font-bold text-violet-300 bg-violet-900/30 border border-violet-700/30 hover:bg-violet-900/50 px-3 py-1.5 rounded-xl transition-colors"
            >
              <Sparkles size={12} /> Generate with AI
            </button>
            <button
              onClick={() => { openAdd(pendingNewSubject); setPendingNewSubject(''); }}
              className="flex items-center gap-1.5 text-xs font-bold text-primary-300 bg-primary-900/30 border border-primary-700/30 hover:bg-primary-900/50 px-3 py-1.5 rounded-xl transition-colors"
            >
              <Plus size={12} /> Add Manually
            </button>
            <button onClick={() => setPendingNewSubject('')} className="p-1.5 text-slate-500 hover:text-red-400 rounded-lg transition-colors">
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subject sections */}
      {loading ? (
        <div className="text-center py-16 space-y-3">
          <RefreshCw size={24} className="animate-spin mx-auto text-slate-600" />
          <p className="text-sm text-slate-500">Loading syllabus…</p>
        </div>
      ) : Object.keys(subjectMap).length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-white/10 rounded-2xl space-y-3">
          <BookOpenText size={32} className="mx-auto text-slate-700" />
          <p className="font-semibold text-slate-400">
            {searchQ ? `No chapters match "${searchQ}"` : `No chapters for ${dbExamType}`}
          </p>
          {!searchQ && (
            <p className="text-sm text-slate-600">
              {SEEDABLE_EXAMS.has(examTab)
                ? 'Click "Seed NCERT Data" above to auto-import all chapters.'
                : 'Use "Add Subject" above to start building the syllabus.'}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence>
            {Object.entries(subjectMap).map(([subject, chapters], i) => (
              <motion.div key={subject} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <SubjectSection
                  subject={subject}
                  chapters={chapters}
                  exam={examTab}
                  classLevel={isBoard ? classLevel : null}
                  onAddChapter={openAdd}
                  onEditChapter={openEdit}
                  onDeleteChapter={setDeleteTarget}
                  onFetchContent={(s) => openSuggest(s, 'content')}
                  onGenerateAI={(s) => openSuggest(s, 'ai')}
                  onRenameSubject={handleRenameSubject}
                  onDeleteSubject={setDeleteSubjectTarget}
                  defaultOpen={Object.keys(subjectMap).length <= 4}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Auto-fill review modal — fetch-from-content or AI-generate */}
      <ChapterSuggestModal
        open={!!suggestFor}
        mode={suggestFor?.mode}
        exam={examTab}
        dbExamType={dbExamType}
        classLevel={isBoard ? classLevel : null}
        subject={suggestFor?.subject ?? ''}
        existingNames={rows.filter((r) => r.subject === suggestFor?.subject).map((c) => c.chapter_name)}
        onClose={() => setSuggestFor(null)}
        onInserted={handleSuggestInserted}
      />

      {/* Chapter slide panel */}
      <ChapterPanel
        open={panelOpen}
        exam={examTab}
        subject={panelSubject}
        classLevel={isBoard ? classLevel : null}
        existing={editingChap}
        callerUid={callerUid}
        onSave={handleSaved}
        onClose={() => setPanelOpen(false)}
      />

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-red-900/30 border border-red-500/30 flex items-center justify-center shrink-0">
                  <Trash2 size={16} className="text-red-400" />
                </div>
                <h3 className="font-bold text-white">Delete Chapter?</h3>
              </div>
              <p className="text-sm text-slate-400">
                "<span className="text-white font-medium">{deleteTarget.chapter_name}</span>" will be hidden from all students immediately.
              </p>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-medium transition-colors">
                  Cancel
                </button>
                <button onClick={confirmDelete} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors">
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete subject confirm */}
      <AnimatePresence>
        {deleteSubjectTarget && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-red-900/30 border border-red-500/30 flex items-center justify-center shrink-0">
                  <Trash2 size={16} className="text-red-400" />
                </div>
                <h3 className="font-bold text-white">Delete Subject?</h3>
              </div>
              <p className="text-sm text-slate-400">
                "<span className="text-white font-medium">{deleteSubjectTarget}</span>" and all
                <strong className="text-white"> {rows.filter((r) => r.subject === deleteSubjectTarget).length} chapters</strong> under
                it will be hidden from all students immediately.
              </p>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setDeleteSubjectTarget(null)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-medium transition-colors">
                  Cancel
                </button>
                <button onClick={confirmDeleteSubject} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors">
                  Delete
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-white/10 text-white text-sm px-4 py-2.5 rounded-xl shadow-2xl z-50 flex items-center gap-2 whitespace-nowrap"
          >
            <CheckCircle2 size={15} className="text-emerald-400" />
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
