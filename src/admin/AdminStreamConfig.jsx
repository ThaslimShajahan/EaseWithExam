import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Layers, Languages, Plus, Pencil, X, Loader2, AlertTriangle, Info,
  Lock, ListChecks, Sparkles, Tag,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { validateStreamConfigDraft, validateBoardLanguageDraft, isAutoSelectAll } from '../lib/streamSelection';

/**
 * Editor for stream_configs + board_language_config — the Class 11/12 stream
 * and subject-combination model (docs/STREAM_SELECTION_HANDOFF.md).
 *
 * Two deliberate limits, both because the backing RPCs have no parameter for
 * them — surfaced in the UI rather than silently dropped:
 *
 *   - No activate/deactivate. admin_upsert_stream_config takes no p_is_active,
 *     so is_active is shown read-only.
 *   - No delete. There is no admin_delete_stream_config RPC at all.
 *
 * Both are honest gaps to close with a migration if the owner wants them; this
 * editor does not fake either one.
 *
 * Validation lives in ../lib/streamSelection (validateStreamConfigDraft /
 * validateBoardLanguageDraft) so the same rules are unit-tested against the
 * real live configs and shared with the student-side reader, rather than
 * being a second definition that can drift from it.
 */

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const CLASS_TIER = '11-12';
const STREAM_KEYS = ['science', 'commerce', 'humanities'];

const FIELD_LABEL = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5';
const FIELD_INPUT = 'w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500';

function ChipInput({ value, onChange, placeholder, emptyHint }) {
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
      <div className="flex flex-wrap gap-1.5 min-h-[26px]">
        {tags.map((t, i) => (
          <span key={i} className="flex items-center gap-1 bg-primary-900/40 border border-primary-700/40 text-primary-300 text-[11px] px-2 py-0.5 rounded-full">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((_, idx) => idx !== i))} className="hover:text-red-400 ml-0.5"><X size={9} /></button>
          </span>
        ))}
        {tags.length === 0 && <span className="text-[11px] text-slate-600 italic">{emptyHint ?? 'None'}</span>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 text-sm bg-slate-800 border border-white/10 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          placeholder={placeholder} value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="px-3 py-1.5 bg-primary-600 text-white text-xs rounded-lg hover:bg-primary-700 font-medium">Add</button>
      </div>
    </div>
  );
}

/** One choice/optional/language slot. Same shape for all three kinds. */
function SlotEditor({ slot, onChange, onRemove, index, kind }) {
  const pool = slot.choose_from ?? [];
  const count = Number(slot.count);
  const autoAll = isAutoSelectAll({ ...slot, count });
  const set = (patch) => onChange({ ...slot, ...patch });

  return (
    <div className="bg-slate-800/50 border border-white/8 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-300">{kind} slot {index + 1}</p>
        {onRemove && (
          <button type="button" onClick={onRemove} className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1">
            <X size={11} /> Remove
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={FIELD_LABEL}>Slot key</label>
          <input className={FIELD_INPUT} value={slot.slot_key ?? ''} placeholder="elective"
            onChange={(e) => set({ slot_key: e.target.value.trim().toLowerCase().replace(/\s+/g, '_') })} />
        </div>
        <div className="col-span-2">
          <label className={FIELD_LABEL}>Label shown to student</label>
          <input className={FIELD_INPUT} value={slot.label ?? ''} placeholder="Choose 2 more subjects"
            onChange={(e) => set({ label: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={FIELD_LABEL}>Pick count</label>
          <input type="number" min="1" className={FIELD_INPUT} value={slot.count ?? 1}
            onChange={(e) => set({ count: Number(e.target.value) })} />
        </div>
        <div className="col-span-2 flex items-end pb-2">
          {pool.length > 0 && Number.isInteger(count) && count >= 1 && (
            <p className="text-[11px] text-slate-500">
              {autoAll
                ? <span className="text-amber-300/90">Pick {count} of {pool.length} — auto-selected, the student is not asked.</span>
                : <>Student picks <span className="text-slate-300 font-medium">{count}</span> of {pool.length}.</>}
            </p>
          )}
        </div>
      </div>
      <div>
        <label className={FIELD_LABEL}>Subject pool</label>
        <ChipInput value={pool} onChange={(v) => set({ choose_from: v })}
          placeholder="Subject name — press Enter" emptyHint="Empty pool — the student would have nothing to pick." />
      </div>
    </div>
  );
}

function NamedCombosEditor({ combos, onChange }) {
  const list = Array.isArray(combos) ? combos : [];
  return (
    <div className="space-y-2">
      {list.length === 0 && (
        <p className="text-[11px] text-slate-600 italic">
          None. Legitimate — Kerala Commerce and Humanities ship with zero named combinations on purpose.
        </p>
      )}
      {list.map((c, i) => (
        <div key={i} className="bg-slate-800/50 border border-white/8 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input className={FIELD_INPUT} value={c.name ?? ''} placeholder="Course Code 1"
              onChange={(e) => onChange(list.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
            <button type="button" onClick={() => onChange(list.filter((_, idx) => idx !== i))}
              className="p-2 text-red-400 hover:bg-red-900/30 rounded-lg shrink-0"><X size={13} /></button>
          </div>
          <ChipInput value={c.resulting_subjects ?? []}
            onChange={(v) => onChange(list.map((x, idx) => idx === i ? { ...x, resulting_subjects: v } : x))}
            placeholder="Resulting subject — press Enter"
            emptyHint="No subjects — this combination can never match." />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, { name: '', resulting_subjects: [] }])}
        className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1">
        <Plus size={12} /> Add named combination
      </button>
    </div>
  );
}

function Issues({ errors, warnings }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <div className="space-y-2">
      {errors.length > 0 && (
        <div className="bg-red-900/25 border border-red-500/30 rounded-xl px-3 py-2.5 space-y-1">
          <p className="text-[11px] font-semibold text-red-300 flex items-center gap-1.5"><AlertTriangle size={12} /> Must fix before saving</p>
          {errors.map((e, i) => <p key={i} className="text-[11px] text-red-200/90">• {e}</p>)}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="bg-amber-900/20 border border-amber-500/30 rounded-xl px-3 py-2.5 space-y-1">
          <p className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5"><Info size={12} /> Warnings — you can still save</p>
          {warnings.map((w, i) => <p key={i} className="text-[11px] text-amber-200/90">• {w}</p>)}
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="font-bold text-white text-sm">{title}</h3>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">{children}</div>
        <div className="p-5 border-t border-white/10 flex gap-3">{footer}</div>
      </motion.div>
    </div>
  );
}

function StreamForm({ existing, boardKey, onClose, onSave, saving }) {
  const [label,     setLabel]     = useState(existing?.label ?? '');
  const [streamKey, setStreamKey] = useState(existing?.stream_key ?? 'science');
  const [board,     setBoard]     = useState(existing?.board_key ?? boardKey ?? '');
  const [mandatory, setMandatory] = useState(existing?.stream_mandatory ?? []);
  const [choice,    setChoice]    = useState(existing?.choice_slots ?? [{ slot_key: 'elective', label: '', count: 1, choose_from: [] }]);
  const [optional,  setOptional]  = useState(existing?.optional_slots ?? []);
  const [combos,    setCombos]    = useState(existing?.named_combinations ?? []);
  const [sortOrder, setSortOrder] = useState(existing?.sort_order ?? 0);

  const draft = {
    id: existing?.id ?? null, board_key: board.trim(), class_tier: CLASS_TIER,
    stream_key: streamKey, label: label.trim(), stream_mandatory: mandatory,
    choice_slots: choice, optional_slots: optional, named_combinations: combos,
    sort_order: Number(sortOrder) || 0,
  };
  const { errors, warnings } = validateStreamConfigDraft(draft);

  return (
    <Modal
      title={existing ? `Edit — ${existing.board_key} ${existing.label}` : 'Add stream'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={() => onSave(draft, warnings)} disabled={saving || errors.length > 0}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {errors.length > 0 ? `${errors.length} issue${errors.length > 1 ? 's' : ''} to fix` : 'Save'}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={FIELD_LABEL}>Board key *</label>
          <input className={FIELD_INPUT} value={board} onChange={(e) => setBoard(e.target.value)}
            placeholder="CBSE" disabled={!!existing} />
          {!existing && <p className="text-[10px] text-slate-500 mt-1">Must match the board_key students are onboarded with.</p>}
        </div>
        <div>
          <label className={FIELD_LABEL}>Stream *</label>
          <select className={FIELD_INPUT} value={streamKey} onChange={(e) => setStreamKey(e.target.value)} disabled={!!existing}>
            {STREAM_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className={FIELD_LABEL}>Display label *</label>
          <input className={FIELD_INPUT} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Science" />
        </div>
        <div>
          <label className={FIELD_LABEL}>Sort order</label>
          <input type="number" className={FIELD_INPUT} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>
      </div>

      <div>
        <label className={FIELD_LABEL}><Lock size={10} className="inline mr-1" />Locked subjects — every student in this stream gets these</label>
        <ChipInput value={mandatory} onChange={setMandatory} placeholder="Subject name — press Enter"
          emptyHint="None locked — the whole subject set is chosen." />
      </div>

      <div className="space-y-2">
        <label className={FIELD_LABEL}><ListChecks size={10} className="inline mr-1" />Choice slots — the graded pick</label>
        {choice.map((s, i) => (
          <SlotEditor key={i} slot={s} index={i} kind="Choice"
            onChange={(next) => setChoice(choice.map((x, idx) => idx === i ? next : x))}
            onRemove={choice.length > 1 ? () => setChoice(choice.filter((_, idx) => idx !== i)) : null} />
        ))}
        <button type="button" onClick={() => setChoice([...choice, { slot_key: '', label: '', count: 1, choose_from: [] }])}
          className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"><Plus size={12} /> Add choice slot</button>
      </div>

      <div className="space-y-2">
        <label className={FIELD_LABEL}><Sparkles size={10} className="inline mr-1" />Optional slots — ungraded extra (CBSE&apos;s 6th subject)</label>
        {optional.length === 0 && <p className="text-[11px] text-slate-600 italic">None — correct for Kerala, which totals exactly 6 subjects.</p>}
        {optional.map((s, i) => (
          <SlotEditor key={i} slot={s} index={i} kind="Optional"
            onChange={(next) => setOptional(optional.map((x, idx) => idx === i ? next : x))}
            onRemove={() => setOptional(optional.filter((_, idx) => idx !== i))} />
        ))}
        <button type="button" onClick={() => setOptional([...optional, { slot_key: 'sixth', label: 'Optional 6th subject', count: 1, max_count: 1, choose_from: [] }])}
          className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"><Plus size={12} /> Add optional slot</button>
      </div>

      <div>
        <label className={FIELD_LABEL}><Tag size={10} className="inline mr-1" />Named combinations — badge shown when a pick matches exactly</label>
        <NamedCombosEditor combos={combos} onChange={setCombos} />
      </div>

      <Issues errors={errors} warnings={warnings} />
    </Modal>
  );
}

function LanguageForm({ existing, onClose, onSave, saving }) {
  const [board,     setBoard]     = useState(existing?.board_key ?? '');
  const [mandatory, setMandatory] = useState(existing?.mandatory_languages ?? []);
  // The nullable slot is the entire reason this table is separate from
  // stream_configs — needsLanguageChoice() branches on null-ness, never on a
  // board name, so "no choice" must stay representable as actual null.
  const [hasChoice, setHasChoice] = useState(existing?.choice_language_slot != null);
  const [slot,      setSlot]      = useState(existing?.choice_language_slot ?? { slot_key: 'second_language', label: 'Second language', count: 1, choose_from: [] });

  const draft = {
    id: existing?.id ?? null, board_key: board.trim(), class_tier: CLASS_TIER,
    mandatory_languages: mandatory, choice_language_slot: hasChoice ? slot : null,
  };
  const { errors, warnings } = validateBoardLanguageDraft(draft);

  return (
    <Modal
      title={existing?.id ? `Edit languages — ${existing.board_key}` : 'Add board language config'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">Cancel</button>
          <button onClick={() => onSave(draft, warnings)} disabled={saving || errors.length > 0}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {errors.length > 0 ? `${errors.length} issue${errors.length > 1 ? 's' : ''} to fix` : 'Save'}
          </button>
        </>
      }
    >
      <div>
        <label className={FIELD_LABEL}>Board key *</label>
        <input className={FIELD_INPUT} value={board} onChange={(e) => setBoard(e.target.value)} placeholder="CBSE" disabled={!!existing} />
      </div>
      <div>
        <label className={FIELD_LABEL}>Mandatory languages — every student on this board gets these</label>
        <ChipInput value={mandatory} onChange={setMandatory} placeholder="e.g. English — press Enter" />
      </div>
      <div className="bg-slate-800/50 border border-white/8 rounded-xl p-3 space-y-3">
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={hasChoice} onChange={(e) => setHasChoice(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-slate-800 text-primary-600 focus:ring-primary-500" />
          This board asks for a second-language choice
        </label>
        <p className="text-[10px] text-slate-500">
          Off = stored as null, and the student is never asked (CBSE). On = the slot below is stored and the
          language step appears (Kerala State).
        </p>
        {hasChoice && <SlotEditor slot={slot} index={0} kind="Language choice" onChange={setSlot} onRemove={null} />}
      </div>
      <Issues errors={errors} warnings={warnings} />
    </Modal>
  );
}

function StreamCard({ row, onEdit }) {
  const choice = row.choice_slots?.[0];
  return (
    <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-slate-800/60 border border-white/5 group">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-slate-200">{row.label}</p>
          <span className="text-[10px] font-mono text-slate-600">#{row.stream_key}</span>
          {!row.is_active && <span className="text-[10px] text-slate-500">inactive</span>}
        </div>
        <p className="text-[11px] text-slate-500">
          <span className="text-slate-400">Locked:</span>{' '}
          {row.stream_mandatory?.length ? row.stream_mandatory.join(', ') : <em>none</em>}
        </p>
        {choice && (
          <p className="text-[11px] text-slate-500">
            <span className="text-slate-400">Choice:</span> pick {choice.count} of {choice.choose_from?.length ?? 0}
            {isAutoSelectAll(choice) && <span className="text-amber-300/80"> (auto-select-all)</span>}
          </p>
        )}
        {row.named_combinations?.length > 0 && (
          <p className="text-[11px] text-slate-500">
            <span className="text-slate-400">Named:</span> {row.named_combinations.map((c) => c.name).join(', ')}
          </p>
        )}
      </div>
      <button onClick={onEdit} className="p-1.5 hover:bg-primary-900/50 text-primary-400 rounded-lg transition-colors shrink-0 opacity-0 group-hover:opacity-100">
        <Pencil size={12} />
      </button>
    </div>
  );
}

export default function AdminStreamConfig() {
  const callerUid = getCallerUid();
  const [streams,   setStreams]   = useState([]);
  const [languages, setLanguages] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');
  const [streamModal,   setStreamModal]   = useState(null); // { existing } | { boardKey }
  const [languageModal, setLanguageModal] = useState(null);

  const load = async () => {
    setLoading(true);
    const [s, l] = await Promise.all([
      supabase.from('stream_configs').select('*').eq('class_tier', CLASS_TIER).order('board_key').order('sort_order'),
      supabase.from('board_language_config').select('*').eq('class_tier', CLASS_TIER).order('board_key'),
    ]);
    setStreams(Array.isArray(s.data) ? s.data : []);
    setLanguages(Array.isArray(l.data) ? l.data : []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  async function saveStream(draft, warnings) {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_stream_config', {
        p_caller: callerUid, p_id: draft.id, p_board_key: draft.board_key, p_class_tier: draft.class_tier,
        p_stream_key: draft.stream_key, p_label: draft.label, p_stream_mandatory: draft.stream_mandatory,
        p_choice_slots: draft.choice_slots, p_optional_slots: draft.optional_slots,
        p_named_combinations: draft.named_combinations, p_sort_order: draft.sort_order,
      });
      if (error) throw new Error(error.message);
      logChange(ENTITY.SYSTEM, `${draft.board_key}/${draft.stream_key}`, draft.id ? ACTION.UPDATE : ACTION.CREATE,
        { after: draft }, `Admin ${draft.id ? 'updated' : 'added'} stream config "${draft.board_key} ${draft.label}"`);
      setStreamModal(null);
      setToast(warnings.length ? `Saved with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}.` : 'Saved.');
      load();
    } catch (e) {
      setToast(`Save failed: ${e.message}`);
    } finally { setSaving(false); }
  }

  async function saveLanguage(draft, warnings) {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('admin_upsert_board_language_config', {
        p_caller: callerUid, p_id: draft.id, p_board_key: draft.board_key, p_class_tier: draft.class_tier,
        p_mandatory_languages: draft.mandatory_languages, p_choice_language_slot: draft.choice_language_slot,
      });
      if (error) throw new Error(error.message);
      logChange(ENTITY.SYSTEM, draft.board_key, draft.id ? ACTION.UPDATE : ACTION.CREATE,
        { after: draft }, `Admin ${draft.id ? 'updated' : 'added'} board language config "${draft.board_key}"`);
      setLanguageModal(null);
      setToast(warnings.length ? `Saved with ${warnings.length} warning${warnings.length > 1 ? 's' : ''}.` : 'Saved.');
      load();
    } catch (e) {
      setToast(`Save failed: ${e.message}`);
    } finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="text-center py-16 space-y-3">
        <Loader2 size={24} className="animate-spin mx-auto text-slate-600" />
        <p className="text-sm text-slate-500">Loading stream configuration…</p>
      </div>
    );
  }

  const boards = [...new Set([...streams.map((s) => s.board_key), ...languages.map((l) => l.board_key)])].sort();

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white">Streams &amp; Subjects</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Class 11–12 stream and subject-combination rules, per board. Live for every new signup
          immediately, no deploy needed. Classes 8–10 are unaffected — they have no streams at all.
        </p>
      </div>

      {toast && (
        <div className={`rounded-xl px-4 py-2.5 text-sm border ${toast.startsWith('Save failed')
          ? 'bg-red-900/30 border-red-500/30 text-red-300'
          : 'bg-emerald-900/25 border-emerald-500/30 text-emerald-300'}`}>{toast}</div>
      )}

      {boards.length === 0 && (
        <div className="bg-slate-900/60 border border-white/8 rounded-2xl p-8 text-center space-y-3">
          <p className="text-sm text-slate-400">No stream configuration yet.</p>
          <button onClick={() => setStreamModal({ boardKey: '' })}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-xl font-medium">
            Add the first stream
          </button>
        </div>
      )}

      {boards.map((board) => {
        const boardStreams = streams.filter((s) => s.board_key === board);
        const lang = languages.find((l) => l.board_key === board);
        return (
          <div key={board} className="bg-slate-900/60 border border-white/8 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0">
                <Layers size={16} className="text-primary-400" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-white text-sm">{board}</p>
                <p className="text-[11px] text-slate-500">Class {CLASS_TIER}</p>
              </div>
              <button onClick={() => setStreamModal({ boardKey: board })}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs rounded-lg flex items-center gap-1.5">
                <Plus size={12} /> Stream
              </button>
            </div>

            <div className="flex items-start gap-3 px-3 py-2.5 rounded-xl bg-slate-800/40 border border-white/5 group">
              <Languages size={14} className="text-slate-500 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                {lang ? (
                  <>
                    <p className="text-[11px] text-slate-400">
                      Mandatory: <span className="text-slate-300">{lang.mandatory_languages?.join(', ') || 'none'}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {lang.choice_language_slot
                        ? `Second-language choice: pick ${lang.choice_language_slot.count} of ${lang.choice_language_slot.choose_from?.length ?? 0}`
                        : 'No second-language choice — students are not asked.'}
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] text-amber-300/80">No language config for this board yet.</p>
                )}
              </div>
              <button onClick={() => setLanguageModal({ existing: lang ?? null, boardKey: board })}
                className="p-1.5 hover:bg-primary-900/50 text-primary-400 rounded-lg shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Pencil size={12} />
              </button>
            </div>

            <div className="space-y-2">
              {boardStreams.map((row) => (
                <StreamCard key={row.id} row={row} onEdit={() => setStreamModal({ existing: row })} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex items-start gap-2 text-[11px] text-slate-500 px-1">
        <Info size={12} className="mt-0.5 shrink-0" />
        <p>
          Streams can be added and edited here but not deleted or deactivated — the backing RPCs
          (<code className="text-slate-400">admin_upsert_stream_config</code>) have no parameter for either.
          Ask for a migration if you need it.
        </p>
      </div>

      {streamModal && (
        <StreamForm existing={streamModal.existing} boardKey={streamModal.boardKey}
          onClose={() => setStreamModal(null)} onSave={saveStream} saving={saving} />
      )}
      {languageModal && (
        <LanguageForm existing={languageModal.existing ?? { board_key: languageModal.boardKey }}
          onClose={() => setLanguageModal(null)} onSave={saveLanguage} saving={saving} />
      )}
    </div>
  );
}
