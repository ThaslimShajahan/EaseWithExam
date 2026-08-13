import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BookMarked, Plus, Pencil, X, Loader2, Eye, EyeOff, Languages, Palette, GraduationCap, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { refreshCategories } from '../lib/categories';

/**
 * Editor for public.subjects — the subject vocabulary of record
 * (migration 20260813100000, docs/STREAM_SELECTION_HANDOFF.md §12a).
 *
 * The distinction this screen exists to make visible:
 *
 *   a row here          = the subject EXISTS; a student profile may carry it,
 *                         and a stream config may offer it
 *   content_bearing     = it also appears in content tooling (Practice
 *                         Generator, Syllabus, Content Intake, Study Notes,
 *                         Paper Gen)
 *
 * Kerala's Malayalam and CBSE's Physical Education are real student choices the
 * platform serves no content for — they belong in the first group, not the
 * second. Before this table existed they were in neither, which is how 21
 * subjects ended up writable onto profiles while being unknown to every
 * content screen.
 *
 * No delete, deliberately: removing a subject that a profile or stream config
 * still references would recreate exactly that dangling reference. Retire a
 * subject by unticking "serves content" instead.
 */

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const FIELD_LABEL = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5';
const FIELD_INPUT = 'w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500';

const KIND_META = {
  academic: { icon: GraduationCap, label: 'Academic', hint: 'A taught subject with a syllabus' },
  language: { icon: Languages,     label: 'Language', hint: 'A language paper' },
  activity: { icon: Palette,       label: 'Activity', hint: 'Arts, PE and similar' },
};

function SubjectForm({ existing, onClose, onSave, saving }) {
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState(existing?.kind ?? 'academic');
  const [bearing, setBearing] = useState(existing?.content_bearing ?? true);

  const trimmed = name.trim();
  const error = !trimmed ? 'Name is required.' : null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-md w-full flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="font-bold text-white text-sm">{existing ? `Edit — ${existing.name}` : 'Add subject'}</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className={FIELD_LABEL}>Subject name *</label>
            <input className={FIELD_INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Malayalam" />
            <p className="text-[10px] text-slate-500 mt-1">
              Must match exactly how it is written in stream configs and Categories — this string
              <em> is</em> the identity.
            </p>
          </div>
          <div>
            <label className={FIELD_LABEL}>Kind</label>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.entries(KIND_META).map(([k, meta]) => (
                <button key={k} type="button" onClick={() => setKind(k)} title={meta.hint}
                  className={`px-2 py-2 rounded-xl text-xs font-medium border transition-colors flex flex-col items-center gap-1 ${
                    kind === k ? 'bg-primary-600 border-primary-500 text-white' : 'bg-slate-800 border-white/10 text-slate-400 hover:border-white/25'}`}>
                  <meta.icon size={14} />{meta.label}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2.5 bg-slate-800/50 border border-white/8 rounded-xl p-3 cursor-pointer">
            <input type="checkbox" checked={bearing} onChange={(e) => setBearing(e.target.checked)}
              className="h-4 w-4 mt-0.5 rounded border-white/20 bg-slate-800 text-primary-600 focus:ring-primary-500" />
            <span>
              <span className="text-sm text-slate-200">We serve content for this subject</span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                On = appears in Practice Generator, Syllabus, Content Intake, Study Notes and Paper Gen.
                Off = still valid on a student profile and in stream configs, just hidden from content tooling.
              </span>
            </span>
          </label>
          {error && <p className="text-[11px] text-red-300">{error}</p>}
        </div>
        <div className="p-5 border-t border-white/10 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium">Cancel</button>
          <button onClick={() => onSave({ id: existing?.id ?? null, name: trimmed, kind, content_bearing: bearing })}
            disabled={saving || !!error}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}Save
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminSubjects() {
  const callerUid = getCallerUid();
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState('');
  const [modal, setModal]     = useState(null);
  const [filter, setFilter]   = useState('all');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('subjects').select('*').order('name');
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSave(form) {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_subject', {
        p_caller: callerUid, p_id: form.id, p_name: form.name,
        p_kind: form.kind, p_content_bearing: form.content_bearing,
      });
      if (error) throw new Error(error.message);
      logChange(ENTITY.SYSTEM, form.name, form.id ? ACTION.UPDATE : ACTION.CREATE,
        { after: form }, `Admin ${form.id ? 'updated' : 'added'} subject "${form.name}"`);
      // Content dropdowns read this through categories.js — refresh so the
      // change is visible in this tab session, not just after a reload.
      await refreshCategories();
      setModal(null); setToast('Saved.'); load();
    } catch (e) {
      setToast(`Save failed: ${e.message}`);
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="text-center py-16 space-y-3">
        <Loader2 size={24} className="animate-spin mx-auto text-slate-600" />
        <p className="text-sm text-slate-500">Loading subjects…</p>
      </div>
    );
  }

  const shown = rows.filter((r) => filter === 'all'
    || (filter === 'content' && r.content_bearing)
    || (filter === 'hidden' && !r.content_bearing));
  const hiddenCount = rows.filter((r) => !r.content_bearing).length;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">Subjects</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            The list of subjects that exist. A subject must be here before a stream config or
            Categories can use it — that check is enforced in the database, not just this screen.
          </p>
        </div>
        <button onClick={() => setModal({})}
          className="px-3 py-2 bg-primary-600 hover:bg-primary-700 text-white text-xs rounded-xl font-medium flex items-center gap-1.5 shrink-0">
          <Plus size={13} /> Add
        </button>
      </div>

      {toast && (
        <div className={`rounded-xl px-4 py-2.5 text-sm border ${toast.startsWith('Save failed')
          ? 'bg-red-900/30 border-red-500/30 text-red-300'
          : 'bg-emerald-900/25 border-emerald-500/30 text-emerald-300'}`}>{toast}</div>
      )}

      <div className="flex gap-1.5">
        {[
          ['all', `All (${rows.length})`],
          ['content', `Serves content (${rows.length - hiddenCount})`],
          ['hidden', `Profile only (${hiddenCount})`],
        ].map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filter === id ? 'bg-primary-600 border-primary-500 text-white' : 'bg-slate-800/60 border-white/10 text-slate-400 hover:border-white/25'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-slate-900/60 border border-white/8 rounded-2xl p-3 space-y-1.5">
        {shown.map((r) => {
          const Icon = KIND_META[r.kind]?.icon ?? BookMarked;
          return (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-slate-800/50 border border-white/5 group">
              <Icon size={14} className="text-slate-500 shrink-0" />
              <p className="text-sm text-slate-200 flex-1 min-w-0 truncate">{r.name}</p>
              <span className="text-[10px] text-slate-600 shrink-0">{KIND_META[r.kind]?.label ?? r.kind}</span>
              {r.content_bearing
                ? <span className="flex items-center gap-1 text-[10px] text-emerald-400/80 shrink-0"><Eye size={10} /> content</span>
                : <span className="flex items-center gap-1 text-[10px] text-slate-500 shrink-0"><EyeOff size={10} /> profile only</span>}
              <button onClick={() => setModal({ existing: r })}
                className="p-1.5 hover:bg-primary-900/50 text-primary-400 rounded-lg shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Pencil size={12} />
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-center text-sm text-slate-500 py-8">Nothing in this view.</p>}
      </div>

      <div className="flex items-start gap-2 text-[11px] text-slate-500 px-1">
        <Info size={12} className="mt-0.5 shrink-0" />
        <p>
          Subjects can be added and edited but not deleted — removing one that a student profile or
          stream config still references would leave a dangling reference, which is the problem this
          list exists to prevent. Retire a subject by unticking &ldquo;we serve content&rdquo; instead.
        </p>
      </div>

      {modal && (
        <SubjectForm existing={modal.existing} onClose={() => setModal(null)} onSave={handleSave} saving={saving} />
      )}
    </div>
  );
}
