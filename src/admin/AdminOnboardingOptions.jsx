import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, GraduationCap, School, Plus, Pencil, Trash2, X, Save,
  Loader2, CheckCircle2, AlertTriangle, EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { refreshOnboardingOptions } from '../lib/onboardingOptions';
import { ONBOARDING_ICONS, resolveOnboardingIcon } from '../lib/onboardingIconRegistry';

// Which class values an exam option can be gated to. Deliberately a literal
// rather than CLASS_OPTIONS from onboardingOptions.js: this is the admin
// editing surface for those very rows, so reading them back would make the
// gate choices disappear the moment an admin deactivated a class option.
const CLASS_GATE_CHOICES = ['8', '9', '10', '11', '12', 'REPEATER'];

/**
 * Manages onboarding_category_display — the PRESENTATION (icon, title,
 * description, order) for student onboarding's exam/board/class option
 * cards. The underlying VALUE saved to a student's profile (option_key —
 * 'NEET', 'BOTH', 'CLASS_8_9', ...) is not editable here on purpose: it's
 * what every downstream reader (normalizeExamType, getExamLabel,
 * buildExamType, profile display) already expects, and changing it would
 * silently break students who picked it before the change. category_keys
 * is real Categories exam_key(s) this option corresponds to, purely for an
 * admin's own reference/validation — not what gets saved.
 */

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const COLORS = ['rose', 'blue', 'violet', 'amber', 'sky', 'emerald', 'teal', 'green', 'indigo', 'slate', 'purple'];
const COLOR_SWATCH = {
  rose: 'bg-rose-500', blue: 'bg-blue-500', violet: 'bg-violet-500', amber: 'bg-amber-500',
  sky: 'bg-sky-500', emerald: 'bg-emerald-500', teal: 'bg-teal-500', green: 'bg-green-500',
  indigo: 'bg-indigo-500', slate: 'bg-slate-500', purple: 'bg-purple-500',
};

const TYPE_META = {
  exam:  { icon: Compass,        label: 'Exam / Target',   subtitle: 'Step 1 — "What are you preparing for?"' },
  board: { icon: GraduationCap,  label: 'Board / Syllabus', subtitle: 'Step 2 — shown only when the exam choice needs it' },
  class: { icon: School,         label: 'Class / Year',     subtitle: 'Step 3 — shown only when the exam choice needs it' },
};

const FIELD_LABEL = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5';
const FIELD_INPUT = 'w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500';

function ChipInput({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const tags = Array.isArray(value) ? value : [];
  function add() {
    const name = draft.trim();
    if (!name || tags.includes(name)) { setDraft(''); return; }
    onChange([...tags, name]);
    setDraft('');
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[28px]">
        {tags.map((t, i) => (
          <span key={i} className="flex items-center gap-1 bg-primary-900/40 border border-primary-700/40 text-primary-300 text-[11px] px-2 py-0.5 rounded-full">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((_, idx) => idx !== i))} className="hover:text-red-400 ml-0.5"><X size={9} /></button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[11px] text-slate-600 italic">None — this option has no matching Categories row (fine for combos like "Repeater")</span>}
      </div>
      <div className="flex gap-2">
        <input className="flex-1 text-sm bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-700 font-medium">Add</button>
      </div>
    </div>
  );
}

function IconPicker({ value, onChange }) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {Object.keys(ONBOARDING_ICONS).map((name) => {
        const Icon = ONBOARDING_ICONS[name];
        const active = value === name;
        return (
          <button key={name} type="button" title={name} onClick={() => onChange(name)}
            className={`h-9 flex items-center justify-center rounded-lg border transition-colors ${active ? 'bg-primary-600 border-primary-600 text-white' : 'bg-slate-800 border-white/10 text-slate-400 hover:border-primary-500/50 hover:text-primary-300'}`}>
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}

function Row({ opt, onEdit, onDelete }) {
  const Icon = resolveOnboardingIcon(opt.icon_name);
  const swatch = COLOR_SWATCH[opt.color] ?? COLOR_SWATCH.slate;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-white/5 group">
      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${swatch}/15`}>
        <Icon size={16} className="text-white" style={{ opacity: 0.9 }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-200 truncate">{opt.title}</p>
          <span className="text-[10px] font-mono text-slate-600 shrink-0">#{opt.option_key}</span>
          {!opt.is_active && <span className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0"><EyeOff size={9} /> hidden</span>}
        </div>
        {opt.description && <p className="text-[11px] text-slate-500 truncate">{opt.description}</p>}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit} className="p-1.5 hover:bg-primary-900/50 text-primary-400 rounded-lg transition-colors"><Pencil size={12} /></button>
        <button onClick={onDelete} className="p-1.5 hover:bg-red-900/50 text-red-400 rounded-lg transition-colors"><Trash2 size={12} /></button>
      </div>
    </div>
  );
}

function OptionForm({ optionType, existing, onClose, onSave, saving, error }) {
  const [optionKey,    setOptionKey]    = useState(existing?.option_key ?? '');
  const [title,        setTitle]        = useState(existing?.title ?? '');
  const [description,  setDescription]  = useState(existing?.description ?? '');
  const [iconName,     setIconName]     = useState(existing?.icon_name ?? 'BookOpen');
  const [color,        setColor]        = useState(existing?.color ?? 'slate');
  const [sortOrder,    setSortOrder]    = useState(existing?.sort_order ?? 0);
  const [isActive,     setIsActive]     = useState(existing?.is_active ?? true);
  const [categoryKeys, setCategoryKeys] = useState(existing?.category_keys ?? []);
  // needs_board / needs_class / default_class_level are vestigial now that
  // class and board are always asked first — kept in state only so saving an
  // option round-trips the stored values instead of silently clearing them.
  const [needsBoard]   = useState(existing?.needs_board ?? false);
  const [needsClass]   = useState(existing?.needs_class ?? false);
  const [defaultClass] = useState(existing?.default_class_level ?? '');
  const [allowedClasses, setAllowedClasses] = useState(existing?.allowed_class_levels ?? []);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-lg w-full max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="font-bold text-white">{existing ? 'Edit Option' : 'Add Option'} — {TYPE_META[optionType].label}</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            {/* option_key is what's actually saved to a student's profile
                (target_exam/syllabus/class_level) — locked once created so
                an edit can never silently change what an existing selection
                resolves to for students who already picked it. */}
            <label className={FIELD_LABEL}>Option Key (saved value) *</label>
            <input className={FIELD_INPUT} value={optionKey} onChange={(e) => setOptionKey(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
              placeholder="e.g. NEET, CLASS_8_9" disabled={!!existing} />
            {!existing && <p className="text-[10px] text-slate-500 mt-1">Cannot be changed after creation — this is the literal value saved to a student's profile.</p>}
          </div>
          <div>
            <label className={FIELD_LABEL}>Display Title *</label>
            <input className={FIELD_INPUT} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Class 8-9" />
          </div>
          <div>
            <label className={FIELD_LABEL}>Description</label>
            <input className={FIELD_INPUT} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Foundation level" />
          </div>
          <div>
            <label className={FIELD_LABEL}>Icon</label>
            <IconPicker value={iconName} onChange={setIconName} />
          </div>
          <div>
            <label className={FIELD_LABEL}>Color</label>
            <div className="flex flex-wrap gap-1.5">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setColor(c)}
                  className={`h-7 w-7 rounded-full ${COLOR_SWATCH[c]} ${color === c ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-white' : 'opacity-60 hover:opacity-100'} transition-all`} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={FIELD_LABEL}>Sort Order</label>
              <input type="number" className={FIELD_INPUT} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-white/20 bg-slate-800 text-primary-600 focus:ring-primary-500" />
                Visible to students
              </label>
            </div>
          </div>
          <div>
            <label className={FIELD_LABEL}>Matching Categories key(s) — reference only</label>
            <ChipInput value={categoryKeys} onChange={setCategoryKeys} placeholder="e.g. NEET, Class 8 — press Enter" />
          </div>

          {/* Class and board are now always asked, and asked first, so the old
              "ask board / ask class / default class" controls no longer drive
              anything. What matters for an exam option is which classes it's
              offered to — that's what keeps NEET off a Class 8 student's screen. */}
          {optionType === 'exam' && (
            <div className="space-y-2 bg-slate-800/40 border border-white/5 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Offered to classes</p>
              <div className="flex flex-wrap gap-1.5">
                {CLASS_GATE_CHOICES.map((cl) => {
                  const active = allowedClasses.includes(cl);
                  return (
                    <button
                      key={cl}
                      onClick={() => setAllowedClasses((prev) =>
                        prev.includes(cl) ? prev.filter((x) => x !== cl) : [...prev, cl])}
                      className={[
                        'px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors',
                        active
                          ? 'bg-primary-600 border-primary-500 text-white'
                          : 'bg-slate-800 border-white/5 text-slate-400 hover:border-white/20',
                      ].join(' ')}
                    >
                      {cl === 'REPEATER' ? 'Repeater' : `Class ${cl}`}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500">
                {allowedClasses.length === 0
                  ? 'None selected — offered to every class.'
                  : `Only shown to: ${allowedClasses.map((c) => c === 'REPEATER' ? 'Repeater' : `Class ${c}`).join(', ')}`}
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/30 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </div>
        <div className="p-5 border-t border-white/10 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">Cancel</button>
          <button
            onClick={() => onSave({
              id: existing?.id ?? null, option_type: optionType, option_key: optionKey.trim(),
              category_keys: categoryKeys, title: title.trim(), description: description.trim(),
              icon_name: iconName, color, sort_order: Number(sortOrder) || 0, is_active: isActive,
              needs_board: needsBoard, needs_class: needsClass, default_class_level: defaultClass.trim() || null,
              allowed_class_levels: allowedClasses,
            })}
            disabled={saving || !optionKey.trim() || !title.trim()}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminOnboardingOptions() {
  const callerUid = getCallerUid();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast,   setToast]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [modal,   setModal]   = useState(null); // { optionType, existing }
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.rpc('admin_list_onboarding_options', { p_caller: callerUid });
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { if (callerUid) load(); }, [callerUid]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSave(form) {
    setSaving(true); setError('');
    try {
      const { error: err } = await supabase.rpc('admin_upsert_onboarding_option', {
        p_caller: callerUid, p_id: form.id, p_option_type: form.option_type, p_option_key: form.option_key,
        p_category_keys: form.category_keys, p_title: form.title, p_description: form.description,
        p_icon_name: form.icon_name, p_color: form.color, p_sort_order: form.sort_order, p_is_active: form.is_active,
        p_needs_board: form.needs_board, p_needs_class: form.needs_class, p_default_class_level: form.default_class_level,
        p_allowed_class_levels: form.allowed_class_levels ?? [],
      });
      if (err) throw new Error(err.message);
      logChange(ENTITY.SYSTEM, form.option_key, form.id ? ACTION.UPDATE : ACTION.CREATE,
        { after: form }, `Admin ${form.id ? 'updated' : 'added'} onboarding option "${form.option_key}"`);
      await refreshOnboardingOptions();
      setModal(null); setToast('Saved.'); load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const { error: err } = await supabase.rpc('admin_delete_onboarding_option', { p_caller: callerUid, p_id: deleteTarget.id });
      if (err) throw err;
      logChange(ENTITY.SYSTEM, deleteTarget.option_key, ACTION.DELETE_REQUEST, null, `Admin removed onboarding option "${deleteTarget.option_key}"`);
      await refreshOnboardingOptions();
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
        <p className="text-sm text-slate-500">Loading onboarding options…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Onboarding Options</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Icons, titles, and descriptions shown on the "What are you preparing for?" flow — live for every
          new signup immediately, no deploy needed. The saved value (Option Key) is locked after creation;
          only the presentation is editable here.
        </p>
      </div>

      {(['exam', 'board', 'class']).map((type) => {
        const meta = TYPE_META[type];
        const typeRows = rows.filter((r) => r.option_type === type).sort((a, b) => a.sort_order - b.sort_order);
        return (
          <div key={type} className="bg-slate-900/60 border border-white/8 rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                  <meta.icon size={16} className="text-primary-400" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{meta.label}</p>
                  <p className="text-xs text-slate-500">{meta.subtitle}</p>
                </div>
              </div>
              <button onClick={() => setModal({ optionType: type, existing: null })}
                className="flex items-center gap-1.5 text-xs font-bold text-primary-300 bg-primary-900/30 border border-primary-700/30 hover:bg-primary-900/50 px-3 py-1.5 rounded-xl transition-colors">
                <Plus size={12} /> Add
              </button>
            </div>
            <div className="space-y-1.5">
              {typeRows.length === 0
                ? <p className="text-xs text-slate-600 italic px-1">None yet.</p>
                : typeRows.map((r) => (
                  <Row key={r.id} opt={r}
                    onEdit={() => setModal({ optionType: type, existing: r })}
                    onDelete={() => setDeleteTarget(r)} />
                ))}
            </div>
          </div>
        );
      })}

      {modal && (
        <OptionForm optionType={modal.optionType} existing={modal.existing}
          onClose={() => setModal(null)} onSave={handleSave} saving={saving} error={error} />
      )}

      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-red-900/30 border border-red-500/30 flex items-center justify-center shrink-0">
                  <Trash2 size={16} className="text-red-400" />
                </div>
                <h3 className="font-bold text-white">Remove "{deleteTarget.title}"?</h3>
              </div>
              <p className="text-sm text-slate-400">
                A student who already selected this will keep their saved value — this only removes it from
                new onboarding flows going forward.
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
