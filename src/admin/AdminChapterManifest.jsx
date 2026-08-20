/**
 * Chapter Manifests — draft a book's contents page, review it by hand, approve it.
 *
 * This screen is the ignition the content rebuild was missing. The corroboration
 * engine (chapterIdentity.js, chapterManifest.js) and the draft extractor
 * (manifestExtraction.js) were both fully built, but nothing in the codebase
 * could ever produce an APPROVED manifest row — admin_upsert_chapter_manifest and
 * admin_approve_chapter_manifest had zero callers. So every Study Notes upload
 * took the fallback path and named chapters from model guesses, which is how one
 * upload produced a chapter called "Poorvi" (the book's title, read off a running
 * header) and merged two distinct texts into one lesson while reporting success.
 *
 * NO AUTO-APPROVE. There is deliberately no confidence score, no threshold, no
 * "looks good, approving automatically" path. A human reads every entry and
 * presses Approve, every time, regardless of how clean the draft looks — owner
 * decision, on the grounds that there is not yet real accuracy data on this
 * corpus to justify a numeric cutoff. Revisit only with measurements, not vibes.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Upload, Loader2, CheckCircle2, AlertTriangle, Plus, Trash2,
  ShieldCheck, RefreshCw, Info, GitMerge,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { draftManifestFromContentsPage } from '../lib/manifestExtraction';
import { validateManifest, inferFileStructure } from '../lib/chapterManifest';
import { BOARDS, CLASS_LEVELS, CATEGORIES, getSubjectsForExam } from '../lib/categories';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const EXAM_TABS = [
  ...BOARDS.map((b) => ({ key: b, label: CATEGORIES[b]?.label ?? b, isBoard: true })),
  ...Object.entries(CATEGORIES)
    .filter(([, v]) => v.type === 'competitive')
    .map(([k, v]) => ({ key: k, label: v.label ?? k, isBoard: false })),
];

const dbExamTypeFor = (examBase, classLevel) =>
  BOARDS.includes(examBase) && classLevel ? `${examBase} Class ${classLevel}` : examBase;

/* The key_prefix that chapterKeyFor() builds chapter keys from. Kept visible and
 * editable because it becomes part of every chapter_key this book ever writes —
 * changing it later orphans existing content, so it is a decision made once, in
 * front of the person approving. */
const DEFAULT_PREFIX = 'c';

const blankEntry = (ordinal) => ({
  ordinal, title: '', unit: null, pageStart: null, pageEnd: null,
  numbered: true, printedNumber: null, fileOrdinal: null, band: null,
});

const numOrNull = (v) => {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

export default function AdminChapterManifest() {
  const callerUid = getCallerUid();

  const [examBase,   setExamBase]   = useState(BOARDS[0]);
  const [classLevel, setClassLevel] = useState('8');
  const [subject,    setSubject]    = useState('');
  const [book,       setBook]       = useState('');

  const isBoard    = BOARDS.includes(examBase);
  const dbExamType = dbExamTypeFor(examBase, classLevel);
  const subjects   = useMemo(() => getSubjectsForExam(dbExamType), [dbExamType]);

  useEffect(() => { setSubject((s) => (subjects.includes(s) ? s : subjects[0] ?? '')); }, [subjects]);

  const [row,      setRow]      = useState(null);   // the chapter_manifests row, or null
  const [entries,  setEntries]  = useState([]);
  const [prefix,   setPrefix]   = useState(DEFAULT_PREFIX);
  const [sourceFile, setSourceFile] = useState('');
  // 'combined' = one physical file legitimately covers several entries
  // (Poorvi: 5 files, 3 texts each). 'per_chapter' = one file per chapter
  // (CBSE Class 8 Maths: 7 files, 7 entries). Pre-filled from inferFileStructure
  // when a fresh draft is read, loaded from the saved row otherwise — always
  // admin-confirmable via the dropdown below, never saved without being shown.
  const [fileStructure, setFileStructure] = useState('per_chapter');
  const [loading,  setLoading]  = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [msg,      setMsg]      = useState(null);   // { kind: 'ok'|'err'|'info', text }

  // Merge — for the case text-only extraction genuinely cannot resolve on its
  // own: whether two adjacent contents-page lines are two separate entries or
  // one entry whose title/paired-piece got split, is sometimes only knowable
  // by opening the real PDF (see CBSE Class 9 English "Kaveri" — verified live
  // that case was actually 16 real entries, but a book that draft-splits a
  // single wrapped title the same way needs the opposite correction). Indices
  // into the CURRENT `entries` array — cleared any time that array changes
  // structurally, so a stale index can never merge the wrong rows.
  const [selected, setSelected] = useState(() => new Set());
  const clearSelection = () => setSelected(new Set());
  const toggleSelect = (i) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });
  const selectedSorted = useMemo(() => [...selected].sort((a, b) => a - b), [selected]);
  // Merging non-adjacent rows would silently absorb whatever sits between them
  // into the new page range without the admin ever having selected it — that
  // is exactly the kind of guess this tool exists to not make. Refuse rather
  // than merge across a gap.
  const selectionIsAdjacent = useMemo(
    () => selectedSorted.length >= 2 && selectedSorted.every((v, i) => i === 0 || v === selectedSorted[i - 1] + 1),
    [selectedSorted],
  );

  /* Load whatever manifest already exists for this exact (exam, subject, book)
   * key. Deliberately the SAME key shape the intake screen looks it up by,
   * including `.is('book', null)` for a blank Book — a manifest approved under a
   * book name the uploader leaves blank will not be found, and under fail-closed
   * that is a refused upload rather than a silently mis-filed one. */
  const load = useCallback(async () => {
    if (!subject) { setRow(null); setEntries([]); return; }
    setLoading(true); setMsg(null); clearSelection();
    let q = supabase.from('chapter_manifests')
      .select('id, exam_type, subject, book, class_level, key_prefix, source_file, entries, status, approved_by, approved_at, file_structure')
      .eq('exam_type', dbExamType).eq('subject', subject);
    q = book.trim() ? q.eq('book', book.trim()) : q.is('book', null);
    const { data, error } = await q.maybeSingle();
    setLoading(false);
    if (error) { setMsg({ kind: 'err', text: `Load failed: ${error.message}` }); return; }
    setRow(data ?? null);
    setEntries(data?.entries ?? []);
    setPrefix(data?.key_prefix ?? DEFAULT_PREFIX);
    setSourceFile(data?.source_file ?? '');
    setFileStructure(data?.file_structure ?? 'per_chapter');
  }, [dbExamType, subject, book]);

  useEffect(() => { load(); }, [load]);

  const validation = useMemo(() => validateManifest(entries, fileStructure), [entries, fileStructure]);
  const isApproved = row?.status === 'approved';
  // Live suggestion only — never overwrites fileStructure on its own past the
  // initial draft. null means "not enough signal yet" (some numbered entries
  // still have no File #), shown as-is rather than guessed at.
  const suggestedStructure = useMemo(() => inferFileStructure(entries), [entries]);
  // Client-side mirror of the DB approval gate (20260815030000) — same rule,
  // shown before Approve is even clicked rather than only after the RPC
  // refuses it. The RPC is still the real gate; this is just faster feedback.
  const missingFileOrdinal = useMemo(
    () => entries.filter((e) => e?.numbered !== false && e?.fileOrdinal == null),
    [entries],
  );

  /* ── Draft from the book's own contents page ─────────────────────── */
  async function handleDraft(file) {
    if (!file) return;
    setDrafting(true); setMsg({ kind: 'info', text: 'Reading the contents page…' }); clearSelection();
    try {
      const buf = await file.arrayBuffer();
      const { entries: drafted } = await draftManifestFromContentsPage(buf, {
        examType: dbExamType, subject, book: book.trim() || null,
      });
      if (!drafted.length) throw new Error('No entries could be read from that file.');
      setEntries(drafted);
      setSourceFile(file.name);
      // Every entry gets a default File # now (printedNumber, or ordinal as a
      // fallback — see manifestExtraction.normaliseEntries), so a fresh draft
      // is always inferable immediately. Pre-fills the dropdown as a
      // suggestion; still fully overridable below before Save.
      setFileStructure(inferFileStructure(drafted) ?? 'per_chapter');
      setMsg({
        kind: 'info',
        text: `Drafted ${drafted.length} entr${drafted.length === 1 ? 'y' : 'ies'} from "${file.name}". `
            + 'Nothing is saved yet — check every row (including File #) against the book, confirm the file '
            + 'structure below, then Save, then Approve.',
      });
    } catch (e) {
      setMsg({ kind: 'err', text: `Draft failed: ${e.message}` });
    } finally {
      setDrafting(false);
    }
  }

  /* ── Row editing ─────────────────────────────────────────────────── */
  const patch = (i, field, value) =>
    setEntries((prev) => prev.map((e, n) => (n === i ? { ...e, [field]: value } : e)));

  const addRow = () => {
    setEntries((prev) => [...prev, blankEntry(prev.length ? Math.max(...prev.map((e) => e.ordinal || 0)) + 1 : 1)]);
    clearSelection();
  };

  const removeRow = (i) => { setEntries((prev) => prev.filter((_, n) => n !== i)); clearSelection(); };

  /* ── Merge — the generalised fix for "text-only extraction can't tell
   * whether two lines are one entry or two" ─────────────────────────────
   *
   * Deliberately mechanical, not a guess at which title is "correct": the
   * merged row inherits identity/type fields (title, unit, numbered,
   * printedNumber, fileOrdinal, band) from the FIRST selected entry and the
   * page range spans first.pageStart to last.pageEnd — a real, checkable
   * default the admin edits immediately after, same posture as every other
   * default in this pipeline (fileOrdinal defaulting to printedNumber, e.g.).
   * Ordinals are renumbered sequentially afterward, safe because nothing can
   * be approved (and so nothing can reference an ordinal) before Save. */
  function mergeSelected() {
    if (!selectionIsAdjacent) return;
    const [first, last] = [selectedSorted[0], selectedSorted[selectedSorted.length - 1]];
    const group = entries.slice(first, last + 1);
    const anchor = group[0];
    const merged = {
      ...anchor,
      pageStart: group.find((e) => e.pageStart != null)?.pageStart ?? anchor.pageStart,
      pageEnd:   [...group].reverse().find((e) => e.pageEnd != null)?.pageEnd ?? anchor.pageEnd,
    };
    setEntries((prev) => {
      const next = [...prev.slice(0, first), merged, ...prev.slice(last + 1)];
      // Re-sequence 1..N in display order — matches what a fresh draft
      // produces, and keeps ordinal a stable running count after a merge
      // removes rows from the middle.
      return next.map((e, n) => ({ ...e, ordinal: n + 1 }));
    });
    clearSelection();
    setMsg({
      kind: 'info',
      text: `Merged ${group.length} entries into one: pages ${merged.pageStart ?? '?'}–${merged.pageEnd ?? '?'}, `
          + `title kept from "${anchor.title || '(untitled)'}" — edit the row if that's not the real combined title.`,
    });
  }

  /* ── Persist ─────────────────────────────────────────────────────── */
  async function handleSave() {
    if (!validation.ok) return;
    setSaving(true); setMsg(null);
    const { data, error } = await supabase.rpc('admin_upsert_chapter_manifest', {
      p_caller:      callerUid,
      p_id:          row?.id ?? null,
      p_exam_type:   dbExamType,
      p_subject:     subject,
      p_book:        book.trim() || null,
      p_class_level: isBoard ? classLevel : null,
      p_key_prefix:  prefix.trim() || DEFAULT_PREFIX,
      p_source_file: sourceFile || null,
      p_entries:     entries,
      p_notes:       null,
      p_file_structure: fileStructure,
    });
    setSaving(false);
    if (error) { setMsg({ kind: 'err', text: `Save failed: ${error.message}` }); return; }
    logChange(ENTITY.CONTENT_ITEM, data?.id ?? row?.id ?? 'manifest', row ? ACTION.UPDATE : ACTION.CREATE,
      { exam_type: dbExamType, subject, book: book.trim() || null, entries: entries.length },
      `Chapter manifest ${row ? 'updated' : 'created'} for ${dbExamType} ${subject}${book.trim() ? ` — ${book.trim()}` : ''} (${entries.length} entries)`);
    setMsg({ kind: 'ok', text: 'Saved as a draft. It does not gate uploads until it is approved.' });
    load();
  }

  async function handleApprove() {
    if (!row?.id || !validation.ok) return;
    // Manual, explicit, every time — see this file's header on why there is no
    // confidence threshold that could skip this.
    const ok = window.confirm(
      `Approve this manifest for ${dbExamType} ${subject}${book.trim() ? ` — ${book.trim()}` : ''}?\n\n`
      + `${entries.length} chapter(s) become the closed set every Study Notes upload for this book is `
      + 'split and checked against. Confirm you have read each title, page range and File # against the book itself.',
    );
    if (!ok) return;
    setSaving(true); setMsg(null);
    const { error } = await supabase.rpc('admin_approve_chapter_manifest', { p_caller: callerUid, p_id: row.id });
    setSaving(false);
    if (error) { setMsg({ kind: 'err', text: `Approve failed: ${error.message}` }); return; }
    logChange(ENTITY.CONTENT_ITEM, row.id, ACTION.UPDATE,
      { exam_type: dbExamType, subject, book: book.trim() || null, status: 'approved' },
      `Chapter manifest APPROVED for ${dbExamType} ${subject}${book.trim() ? ` — ${book.trim()}` : ''}`);
    setMsg({ kind: 'ok', text: 'Approved. Study Notes uploads for this book are now gated by it.' });
    load();
  }

  const inputCls = 'bg-slate-800 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-primary-500';

  return (
    <div className="space-y-5">
      {/* Why this screen exists, stated where it will actually be read. */}
      <div className="flex items-start gap-2 bg-slate-800/40 border border-white/8 rounded-xl p-3">
        <Info size={14} className="text-slate-400 mt-0.5 shrink-0" />
        <p className="text-xs text-slate-400 leading-relaxed">
          A manifest is the book's chapter list, transcribed from its own contents page and approved by hand.
          Study Notes uploads are <b className="text-slate-300">blocked</b> until one exists: the manifest decides
          where each chapter starts and ends, so the AI only structures content <i>within</i> a chapter instead of
          guessing the boundaries. Every manifest requires manual approval — there is no automatic approval.
          Loading a book published in multiple parts (Part 1/2/3)? Each part is a separate manifest with its own
          <code className="text-slate-300"> book</code> value — see <code className="text-slate-300">docs/MULTI_PART_TEXTBOOK_WORKFLOW.md</code>.
        </p>
      </div>

      {/* ── Which book ──────────────────────────────────────────────── */}
      <div className="bg-slate-900/40 rounded-2xl border border-white/8 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Exam / Board</label>
            <select value={examBase} onChange={(e) => setExamBase(e.target.value)} className={`${inputCls} w-full`}>
              {EXAM_TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          {isBoard && (
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Class</label>
              <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)} className={`${inputCls} w-full`}>
                {CLASS_LEVELS.map((c) => <option key={c} value={c}>Class {c}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Subject</label>
            <select value={subject} onChange={(e) => setSubject(e.target.value)} className={`${inputCls} w-full`}>
              {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Book</label>
            <input value={book} onChange={(e) => setBook(e.target.value)} placeholder="blank for single-book subjects"
              className={`${inputCls} w-full placeholder-slate-600`} />
          </div>
        </div>

        {/* The lookup-key trap, stated where it bites. */}
        <p className="text-[11px] text-amber-400/80">
          The Book value here must match what you type on the upload screen exactly — blank matches blank.
          A mismatch means the upload finds no manifest and is refused.
        </p>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer
            ${drafting || isApproved ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-primary-600 hover:bg-primary-500 text-white'}`}>
            {drafting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {drafting ? 'Reading…' : 'Draft from contents page (PDF)'}
            <input type="file" accept="application/pdf" className="hidden" disabled={drafting || isApproved}
              onChange={(e) => { handleDraft(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <button onClick={addRow} disabled={isApproved}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40">
            <Plus size={13} /> Add row
          </button>
          <button onClick={load}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Reload
          </button>
          <div className="flex items-center gap-1.5 ml-auto">
            <label className="text-[11px] text-slate-500" title="'combined': one file legitimately covers several entries (Poorvi: 5 files, 3 texts each) — page ranges stay checked. 'per_chapter': one file per chapter (CBSE Class 8 Maths: 7 files, 7 entries) — File # alone is the check, no page range needed.">
              File structure
            </label>
            <select value={fileStructure} onChange={(e) => setFileStructure(e.target.value)} disabled={isApproved}
              className={`${inputCls} disabled:opacity-50`}>
              <option value="per_chapter">per_chapter — one file per chapter</option>
              <option value="combined">combined — several chapters share a file</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] text-slate-500">Key prefix</label>
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={isApproved}
              className={`${inputCls} w-16 disabled:opacity-50`} />
          </div>
        </div>
        {!isApproved && suggestedStructure && suggestedStructure !== fileStructure && (
          <p className="text-[11px] text-primary-400">
            Based on the current File # values, this looks like <b>{suggestedStructure}</b> — the dropdown above is
            set to <b>{fileStructure}</b>. Double-check before saving if that wasn't deliberate.
          </p>
        )}
      </div>

      {/* ── Status ──────────────────────────────────────────────────── */}
      {row ? (
        <div className={`flex items-start gap-2 rounded-xl p-3 border ${isApproved
          ? 'bg-emerald-900/20 border-emerald-700/25' : 'bg-amber-900/20 border-amber-700/25'}`}>
          {isApproved
            ? <ShieldCheck size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            : <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />}
          <p className={`text-xs ${isApproved ? 'text-emerald-300' : 'text-amber-300'}`}>
            {isApproved
              ? <>Approved{row.approved_at ? ` on ${new Date(row.approved_at).toLocaleString()}` : ''} — this manifest is live and gating uploads for this book.</>
              : <>Status <b>{row.status}</b> — saved but <b>not approved</b>, so Study Notes uploads for this book are still blocked.</>}
          </p>
        </div>
      ) : !loading && subject ? (
        <div className="flex items-start gap-2 bg-slate-800/40 border border-white/8 rounded-xl p-3">
          <Info size={14} className="text-slate-500 mt-0.5 shrink-0" />
          <p className="text-xs text-slate-500">No manifest yet for this book. Draft one from its contents page, or add rows by hand.</p>
        </div>
      ) : null}

      {msg && (
        <div className={`flex items-start gap-2 rounded-xl p-3 border text-xs ${
          msg.kind === 'ok'  ? 'bg-emerald-900/20 border-emerald-700/25 text-emerald-300' :
          msg.kind === 'err' ? 'bg-red-900/20 border-red-700/25 text-red-300' :
                               'bg-slate-800/40 border-white/8 text-slate-400'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
            : msg.kind === 'err' ? <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            : <Info size={14} className="mt-0.5 shrink-0" />}
          <p>{msg.text}</p>
        </div>
      )}

      {/* ── Entries ─────────────────────────────────────────────────── */}
      {entries.length > 0 && (
        <div className="bg-slate-900/40 rounded-2xl border border-white/8 overflow-hidden">
          {/* Merge toolbar — only visible once 2+ rows are checked, so it never
              competes for attention on a screen most admins use without merging
              anything. */}
          {!isApproved && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-primary-900/20 border-b border-primary-700/25">
              <GitMerge size={13} className="text-primary-400 shrink-0" />
              <p className="text-xs text-primary-300">
                {selected.size} row{selected.size === 1 ? '' : 's'} selected
                {selectionIsAdjacent
                  ? ' — will combine into one entry spanning their full page range.'
                  : selected.size > 1 ? ' — not adjacent, cannot merge (select a contiguous run of rows).' : '.'}
              </p>
              <button onClick={mergeSelected} disabled={!selectionIsAdjacent}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                <GitMerge size={13} /> Merge selected
              </button>
              <button onClick={clearSelection} className="text-xs text-slate-500 hover:text-white">Clear</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-white/8">
                  {!isApproved && (
                    <th className="text-left px-3 py-2 w-10" title="Select adjacent rows to merge into one entry">Sel</th>
                  )}
                  <th className="text-left px-3 py-2 w-14">Ord</th>
                  <th className="text-left px-3 py-2">Title</th>
                  <th className="text-left px-3 py-2 w-56">Unit (grouping heading)</th>
                  <th className="text-left px-3 py-2 w-20" title={fileStructure === 'per_chapter' ? 'Optional for per_chapter books — File # alone is the match signal. Leave blank if the contents page prints no page numbers.' : undefined}>
                    Pages{fileStructure === 'per_chapter' ? ' (optional)' : ''}
                  </th>
                  <th className="text-left px-3 py-2 w-20"></th>
                  <th className="text-left px-3 py-2 w-20" title="The number printed next to this chapter in the book">Printed #</th>
                  <th className="text-left px-3 py-2 w-20" title="The chapter number in the FILENAME of the PDF that contains this chapter. Several chapters in one unit file share the same File #.">File #</th>
                  <th className="text-left px-3 py-2 w-16">Num?</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i} className={`border-b border-white/5 last:border-0 ${selected.has(i) ? 'bg-primary-900/10' : ''}`}>
                    {!isApproved && (
                      <td className="px-3 py-1.5">
                        <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelect(i)}
                          className="accent-primary-500" />
                      </td>
                    )}
                    <td className="px-3 py-1.5">
                      <input value={e.ordinal ?? ''} onChange={(ev) => patch(i, 'ordinal', numOrNull(ev.target.value))}
                        disabled={isApproved} className={`${inputCls} w-12 disabled:opacity-60`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={e.title ?? ''} onChange={(ev) => patch(i, 'title', ev.target.value)}
                        disabled={isApproved} className={`${inputCls} w-full disabled:opacity-60`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={e.unit ?? ''} onChange={(ev) => patch(i, 'unit', ev.target.value.trim() || null)}
                        placeholder="e.g. Unit 1: Wit and Wisdom" disabled={isApproved}
                        className={`${inputCls} w-full placeholder-slate-600 disabled:opacity-60`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={e.pageStart ?? ''} onChange={(ev) => patch(i, 'pageStart', numOrNull(ev.target.value))}
                        placeholder="from" disabled={isApproved} className={`${inputCls} w-16 placeholder-slate-600 disabled:opacity-60`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={e.pageEnd ?? ''} onChange={(ev) => patch(i, 'pageEnd', numOrNull(ev.target.value))}
                        placeholder="to" disabled={isApproved} className={`${inputCls} w-16 placeholder-slate-600 disabled:opacity-60`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={e.printedNumber ?? ''} onChange={(ev) => patch(i, 'printedNumber', numOrNull(ev.target.value))}
                        disabled={isApproved || e.numbered === false} className={`${inputCls} w-14 disabled:opacity-40`} />
                    </td>
                    <td className="px-3 py-1.5">
                      <input value={e.fileOrdinal ?? ''} onChange={(ev) => patch(i, 'fileOrdinal', numOrNull(ev.target.value))}
                        disabled={isApproved || e.numbered === false} className={`${inputCls} w-14 disabled:opacity-40`} />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <input type="checkbox" checked={e.numbered !== false} disabled={isApproved}
                        onChange={(ev) => patch(i, 'numbered', ev.target.checked ? true : false)}
                        className="accent-primary-500" />
                    </td>
                    <td className="px-2 py-1.5">
                      {!isApproved && (
                        <button onClick={() => removeRow(i)} className="text-slate-500 hover:text-red-400" title="Remove row">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Validation is shown in full, never truncated — an admin needs every
              problem at once, which is why validateManifest returns them all. */}
          {!validation.ok && (
            <div className="bg-red-900/20 border-t border-red-700/25 p-3 space-y-1">
              <p className="text-xs font-semibold text-red-300 flex items-center gap-1.5">
                <AlertTriangle size={13} /> {validation.errors.length} problem(s) — save and approve are blocked
              </p>
              <ul className="text-[11px] text-red-300/90 list-disc pl-5 space-y-0.5">
                {validation.errors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}

          {/* Client-side mirror of the DB approval gate (20260815030000) —
              validateManifest allows a null File # (it's a legitimate mid-draft
              state), but approval never should. Shown separately from the red
              validation block above so "not ready to save" and "ready to save,
              not ready to approve" read as the different states they are. */}
          {validation.ok && missingFileOrdinal.length > 0 && (
            <div className="bg-amber-900/20 border-t border-amber-700/25 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                <AlertTriangle size={13} /> Missing File # on {missingFileOrdinal.length} entr{missingFileOrdinal.length === 1 ? 'y' : 'ies'} — can save as a draft, but approval will be refused
              </p>
              <ul className="text-[11px] text-amber-300/90 list-disc pl-5 space-y-0.5">
                {missingFileOrdinal.map((e) => <li key={e.ordinal}>#{e.ordinal} ("{e.title}")</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 p-3 border-t border-white/8">
            <button onClick={handleSave} disabled={!validation.ok || saving || isApproved}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <BookOpen size={13} />}
              {row ? 'Save draft' : 'Create draft'}
            </button>
            <button onClick={handleApprove} disabled={!row || !validation.ok || missingFileOrdinal.length > 0 || saving || isApproved}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 disabled:cursor-not-allowed">
              <ShieldCheck size={13} /> Approve manifest
            </button>
            {!row && <span className="text-[11px] text-slate-500">Save the draft before it can be approved.</span>}
            {isApproved && <span className="text-[11px] text-emerald-400/80">Approved manifests are read-only here.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
