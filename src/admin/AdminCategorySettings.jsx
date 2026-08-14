import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Trophy, GraduationCap, Plus, Pencil, Trash2, X, Save,
  Loader2, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { refreshCategories } from '../lib/categories';

/**
 * Admin-editable board/class/subject/competitive-exam catalog — the single
 * source of truth this app-wide `exam_categories` table drives (replaces the
 * hardcoded CATEGORIES object in lib/categories.js). Every part of the app
 * that used to import a static list (Paper Gen, Syllabus Manager, Content
 * Intake, student onboarding, ...) reads the live cache in categories.js,
 * which this page's saves refresh immediately for the current tab.
 *
 * Board/class saves fan out into multiple exam_categories rows: a board save
 * writes the standalone board entry plus one board_class combo row per
 * existing class level (using the 6-10 or 11-12 subject tier as appropriate)
 * — the admin only edits two subject lists per board, not every combo.
 */

function getCallerUidFallback() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

/* ── Subject picker for category subject lists ─────────────────────
 * Was a free-text chip input. Free text is how subject-name drift got in
 * (docs/STREAM_SELECTION_HANDOFF.md §12 — 21 names on student profiles that
 * no content screen could resolve), so this now offers only names from the
 * vocabulary (public.subjects), the same way the Streams editor's
 * SubjectChips does. admin_upsert_exam_category rejects unknown names too
 * (20260814030000) — this picker is so an admin never has to hit that error.
 *
 * `vocabulary` empty (not loaded / fetch failed) falls back to the original
 * free-text behaviour rather than blocking all editing: the RPC is the real
 * guard, so the worst case is a rejected save with a clear message, never a
 * screen that cannot be used.
 */
function ChipInput({ value, onChange, placeholder, vocabulary = [] }) {
  const [draft, setDraft] = useState('');
  const tags = Array.isArray(value) ? value : [];
  const available = vocabulary.filter((s) => !tags.some((t) => t.toLowerCase() === s.name.toLowerCase()));
  const noVocabulary = vocabulary.length === 0;

  function add(name) {
    const n = String(name ?? '').trim();
    // Case-insensitive dedup — "Hindi" vs "hindi" silently created two separate
    // chips before, and unioning multiple subject lists (board + both class
    // tiers) compounded that into visible duplicate pills for admins.
    if (!n || tags.some((t) => t.toLowerCase() === n.toLowerCase())) { setDraft(''); return; }
    onChange([...tags, n]);
    setDraft('');
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {tags.map((t, i) => {
          const known = noVocabulary || vocabulary.some((s) => s.name === t);
          return (
            <span key={i} title={known ? undefined : 'Not in the subject list — this save will be rejected'}
              className={`flex items-center gap-1 border text-[11px] px-2 py-0.5 rounded-full ${known
                ? 'bg-primary-900/40 border-primary-700/40 text-primary-300'
                : 'bg-red-900/40 border-red-600/50 text-red-300'}`}>
              {t}
              <button type="button" onClick={() => onChange(tags.filter((_, idx) => idx !== i))} className="hover:text-red-400 ml-0.5">
                <X size={9} />
              </button>
            </span>
          );
        })}
        {tags.length === 0 && <span className="text-[11px] text-slate-600 italic">None yet</span>}
      </div>
      {noVocabulary ? (
        <div className="flex gap-2">
          <input
            className="flex-1 text-sm bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
          />
          <button type="button" onClick={() => add(draft)} className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-700 font-medium">Add</button>
        </div>
      ) : (
        <select className="w-full text-sm bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:ring-1 focus:ring-primary-500"
          value="" onChange={(e) => { if (e.target.value) add(e.target.value); }}>
          <option value="">Add a subject…</option>
          {available.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}{s.content_bearing === false ? '  (profile only — no content)' : ''}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/* ── Section shell ─────────────────────────────────────────────── */
function Section({ icon: Icon, title, subtitle, onAdd, children }) {
  return (
    <div className="bg-slate-900/60 border border-white/8 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
            <Icon size={16} className="text-primary-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-white">{title}</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
        <button onClick={onAdd} className="flex items-center gap-1.5 text-xs font-bold text-primary-300 bg-primary-900/30 border border-primary-700/30 hover:bg-primary-900/50 px-3 py-1.5 rounded-xl transition-colors">
          <Plus size={12} /> Add
        </button>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Row({ label, sub, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-white/5 group">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200">{label}</p>
        {sub && <p className="text-[11px] text-slate-500 truncate">{sub}</p>}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit} className="p-1.5 hover:bg-primary-900/50 text-primary-400 rounded-lg transition-colors"><Pencil size={12} /></button>
        <button onClick={onDelete} className="p-1.5 hover:bg-red-900/50 text-red-400 rounded-lg transition-colors"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

/* ── Modal shell ───────────────────────────────────────────────── */
function Modal({ title, onClose, onSave, saving, error, children }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-md w-full max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="font-bold text-white">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {children}
          {error && (
            <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/30 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </div>
        <div className="p-5 border-t border-white/10 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={onSave} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

const FIELD_LABEL = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5';
const FIELD_INPUT = 'w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500';

export default function AdminCategorySettings() {
  const callerUid = getCallerUidFallback();

  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');

  const [modal, setModal] = useState(null); // { kind: 'competitive'|'board', existing }
  const [deleteTarget, setDeleteTarget] = useState(null); // { kind, exam_key(s) }

  // The subject vocabulary (public.subjects) the pickers offer and
  // admin_upsert_exam_category enforces (20260814030000). Read-open RLS, so a
  // plain select — no RPC needed.
  const [vocabulary, setVocabulary] = useState([]);

  const load = async () => {
    setLoading(true);
    const [{ data }, vocab] = await Promise.all([
      supabase.rpc('admin_list_exam_categories', { p_caller: callerUid }),
      supabase.from('subjects').select('name, content_bearing').order('name'),
    ]);
    setRows(Array.isArray(data) ? data : []);
    setVocabulary(Array.isArray(vocab.data) ? vocab.data : []);
    setLoading(false);
  };
  useEffect(() => { if (callerUid) load(); }, [callerUid]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const competitive = rows.filter((r) => r.category_kind === 'competitive').sort((a, b) => a.sort_order - b.sort_order);
  const boards       = rows.filter((r) => r.category_kind === 'board').sort((a, b) => a.sort_order - b.sort_order);

  async function upsert(fields) {
    const { error: err } = await supabase.rpc('admin_upsert_exam_category', {
      p_caller: callerUid,
      p_id: fields.id ?? null,
      p_exam_key: fields.exam_key,
      p_label: fields.label,
      p_category_kind: fields.category_kind,
      p_board_key: fields.board_key ?? null,
      p_class_key: fields.class_key ?? null,
      p_group_label: fields.group_label ?? null,
      p_subjects: fields.subjects ?? [],
      p_sort_order: fields.sort_order ?? 0,
    });
    if (err) throw new Error(err.message);
  }

  async function saveCompetitive(form) {
    setSaving(true); setError('');
    try {
      await upsert({
        id: form.id, exam_key: form.key, label: form.label, category_kind: 'competitive',
        group_label: form.group, subjects: form.subjects, sort_order: form.id ? undefined : 100,
      });
      logChange(ENTITY.SYSTEM, form.key, form.id ? ACTION.UPDATE : ACTION.CREATE,
        { after: form }, `Admin ${form.id ? 'updated' : 'added'} competitive exam "${form.key}"`);
      await refreshCategories();
      setModal(null); setToast('Saved.'); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  // A board fans out into: the standalone board row (union of both subject
  // tiers) + one board_class row per class 6-12, using the 6-10 or 11-12 tier
  // as appropriate — so the admin edits two subject lists, not every
  // board+class combination by hand.
  async function saveBoard(form) {
    setSaving(true); setError('');
    try {
      const unionSubjects = [...new Set([...form.subjects8to10, ...form.subjects11to12])];
      await upsert({
        id: form.id, exam_key: form.key, label: form.label, category_kind: 'board',
        board_key: form.key, group_label: form.label, subjects: unionSubjects, sort_order: form.id ? undefined : 200,
      });

      const classLevels = ['6','7','8','9','10','11','12'];
      for (const cl of classLevels) {
        const tierSubjects = Number(cl) <= 10 ? form.subjects8to10 : form.subjects11to12;
        const comboKey = `${form.key} Class ${cl}`;
        const existingCombo = rows.find((r) => r.exam_key === comboKey);
        await upsert({
          id: existingCombo?.id ?? null, exam_key: comboKey, label: comboKey, category_kind: 'board_class',
          board_key: form.key, class_key: cl, group_label: form.label, subjects: tierSubjects,
          sort_order: existingCombo?.sort_order,
        });
      }

      logChange(ENTITY.SYSTEM, form.key, form.id ? ACTION.UPDATE : ACTION.CREATE,
        { after: form }, `Admin ${form.id ? 'updated' : 'added'} board "${form.key}" (+ ${classLevels.length} class combos)`);
      await refreshCategories();
      setModal(null); setToast('Saved.'); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      for (const id of deleteTarget.ids) {
        const { error: err } = await supabase.rpc('admin_delete_exam_category', { p_caller: callerUid, p_id: id });
        if (err) throw err;
      }
      logChange(ENTITY.SYSTEM, deleteTarget.label, ACTION.DELETE_REQUEST, null, `Admin removed "${deleteTarget.label}" (${deleteTarget.ids.length} row(s))`);
      await refreshCategories();
      setToast('Removed.'); load();
    } catch (e) {
      setToast(`Delete failed: ${e.message}`);
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16 space-y-3">
        <Loader2 size={24} className="animate-spin mx-auto text-slate-600" />
        <p className="text-sm text-slate-500">Loading categories…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Categories</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Boards, classes, subjects, and competitive exams — used app-wide (Paper Gen, Syllabus Manager, Content Intake, student onboarding). Editing here updates the whole app, not just this screen.
        </p>
      </div>

      <Section icon={Trophy} title="Competitive Exams" subtitle="NEET, JEE, or any other entrance exam" onAdd={() => setModal({ kind: 'competitive', existing: null })}>
        {competitive.length === 0 ? <p className="text-xs text-slate-600 italic px-1">None yet.</p> : competitive.map((r) => (
          <Row key={r.id} label={r.label} sub={r.subjects?.join(', ')}
            onEdit={() => setModal({ kind: 'competitive', existing: r })}
            onDelete={() => setDeleteTarget({ ids: [r.id], label: r.label })} />
        ))}
      </Section>

      <Section icon={GraduationCap} title="Boards" subtitle="CBSE, ICSE, State Board, or any other board — auto-generates its class combinations" onAdd={() => setModal({ kind: 'board', existing: null })}>
        {boards.length === 0 ? <p className="text-xs text-slate-600 italic px-1">None yet.</p> : boards.map((r) => (
          <Row key={r.id} label={r.label} sub={r.subjects?.join(', ')}
            onEdit={() => setModal({ kind: 'board', existing: r })}
            onDelete={() => setDeleteTarget({
              ids: [r.id, ...rows.filter((x) => x.board_key === r.board_key && x.category_kind === 'board_class').map((x) => x.id)],
              label: r.label,
            })} />
        ))}
      </Section>

      {/* Competitive exam modal */}
      {modal?.kind === 'competitive' && (
        <CompetitiveForm existing={modal.existing} onClose={() => setModal(null)} onSave={saveCompetitive} saving={saving} error={error} vocabulary={vocabulary} />
      )}
      {modal?.kind === 'board' && (
        <BoardForm existing={modal.existing} rows={rows} onClose={() => setModal(null)} onSave={saveBoard} saving={saving} error={error} vocabulary={vocabulary} />
      )}

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-red-900/30 border border-red-500/30 flex items-center justify-center shrink-0">
                  <Trash2 size={16} className="text-red-400" />
                </div>
                <h3 className="font-bold text-white">Remove "{deleteTarget.label}"?</h3>
              </div>
              <p className="text-sm text-slate-400">
                {deleteTarget.ids.length > 1
                  ? `This removes the board and all ${deleteTarget.ids.length - 1} of its class combinations. Won't affect syllabus chapters or content already uploaded.`
                  : `Won't affect syllabus chapters or content already uploaded under this key.`}
              </p>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-medium transition-colors">Cancel</button>
                <button onClick={confirmDelete} disabled={saving} className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-bold transition-colors disabled:opacity-50">
                  {saving ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-white/10 text-white text-sm px-4 py-2.5 rounded-xl shadow-2xl z-50 flex items-center gap-2 whitespace-nowrap">
            <CheckCircle2 size={15} className="text-emerald-400" /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Forms ─────────────────────────────────────────────────────── */

function CompetitiveForm({ existing, onClose, onSave, saving, error, vocabulary }) {
  const [key,      setKey]      = useState(existing?.exam_key ?? '');
  const [label,    setLabel]    = useState(existing?.label ?? '');
  const [group,    setGroup]    = useState(existing?.group_label ?? '');
  const [subjects, setSubjects] = useState(existing?.subjects ?? []);

  return (
    <Modal title={existing ? 'Edit Competitive Exam' : 'Add Competitive Exam'} onClose={onClose} saving={saving} error={error}
      onSave={() => onSave({ id: existing?.id, key: key.trim(), label: label.trim() || key.trim(), group: group.trim(), subjects })}>
      <div>
        <label className={FIELD_LABEL}>Exam Key *</label>
        <input className={FIELD_INPUT} value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. NEET" disabled={!!existing} />
      </div>
      <div>
        <label className={FIELD_LABEL}>Display Label</label>
        <input className={FIELD_INPUT} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. NEET UG" />
      </div>
      <div>
        <label className={FIELD_LABEL}>Group</label>
        <input className={FIELD_INPUT} value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. Medical" />
      </div>
      <div>
        <label className={FIELD_LABEL}>Subjects</label>
        <ChipInput value={subjects} onChange={setSubjects} placeholder="Add subject and press Enter…" vocabulary={vocabulary} />
      </div>
    </Modal>
  );
}

function BoardForm({ existing, rows, onClose, onSave, saving, error, vocabulary }) {
  const [key,   setKey]   = useState(existing?.board_key ?? existing?.exam_key ?? '');
  const [label, setLabel] = useState(existing?.label ?? '');

  // Seed the two subject tiers from any existing board_class combos for this board.
  const combo8to10 = rows.find((r) => r.category_kind === 'board_class' && r.board_key === (existing?.board_key ?? existing?.exam_key) && Number(r.class_key) <= 10);
  const combo11to12 = rows.find((r) => r.category_kind === 'board_class' && r.board_key === (existing?.board_key ?? existing?.exam_key) && Number(r.class_key) > 10);

  const [subjects8to10,  setSubjects8to10]  = useState(combo8to10?.subjects ?? existing?.subjects ?? []);
  const [subjects11to12, setSubjects11to12] = useState(combo11to12?.subjects ?? []);

  return (
    <Modal title={existing ? 'Edit Board' : 'Add Board'} onClose={onClose} saving={saving} error={error}
      onSave={() => onSave({ id: existing?.id, key: key.trim(), label: label.trim() || key.trim(), subjects8to10, subjects11to12 })}>
      <div>
        <label className={FIELD_LABEL}>Board Key *</label>
        <input className={FIELD_INPUT} value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. CBSE" disabled={!!existing} />
      </div>
      <div>
        <label className={FIELD_LABEL}>Display Label</label>
        <input className={FIELD_INPUT} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. CBSE Board" />
      </div>
      <div>
        <label className={FIELD_LABEL}>Subjects — Classes 6 to 10</label>
        <ChipInput value={subjects8to10} onChange={setSubjects8to10} placeholder="Add subject and press Enter…" vocabulary={vocabulary} />
      </div>
      <div>
        <label className={FIELD_LABEL}>Subjects — Classes 11 to 12</label>
        <ChipInput value={subjects11to12} onChange={setSubjects11to12} placeholder="Add subject and press Enter…" vocabulary={vocabulary} />
      </div>
      <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-700/20 rounded-xl p-3">
        <AlertTriangle size={13} className="text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-300 leading-relaxed">Saving this generates "{key || 'Board'} Class 6" through "Class 12" automatically using the tier above — you don't need to create those separately.</p>
      </div>
    </Modal>
  );
}
